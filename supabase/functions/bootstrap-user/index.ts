// =============================================================================
// GEZIA — bootstrap-user/index.ts
// Edge Function: bootstrap-user
//
// Propósito: Al primer arranque del usuario (post-signup o re-apertura),
// garantiza que el profile, user_settings y user_safety_preferences existen.
// Es idempotente — puede llamarse múltiples veces sin efecto secundario.
//
// Autenticación: JWT obligatorio
// Método: POST
// Body: { display_name?: string, primary_language?: string }
// =============================================================================

import { requireAuth } from "../_shared/auth.ts";
import { ErrorCode, errorResponse, okResponse } from "../_shared/errors.ts";
import { logAuditEvent } from "../_shared/audit.ts";

Deno.serve(async (req: Request) => {
  // Solo POST
  if (req.method !== "POST") {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "Method not allowed");
  }

  // Validar JWT
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult;
  const { userId, supabase, serviceClient } = authResult;

  // Parsear body opcional
  let body: { display_name?: string; primary_language?: string } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "Invalid JSON body");
  }

  const displayName = body.display_name?.trim().slice(0, 80) ?? "";
  const primaryLanguage = body.primary_language ?? "es-MX";

  // Verificar si el profile ya existe
  const { data: existingProfile, error: profileSelectError } = await supabase
    .from("profiles")
    .select("id, onboarding_status, display_name, primary_language")
    .eq("id", userId)
    .maybeSingle();

  if (profileSelectError) {
    console.error("[bootstrap-user] profile select error:", profileSelectError.message);
    return errorResponse(ErrorCode.INTERNAL_ERROR);
  }

  // Si no existe, crearlo (fallback para casos donde el trigger falló)
  if (!existingProfile) {
    const { error: profileInsertError } = await serviceClient
      .from("profiles")
      .insert({
        id: userId,
        display_name: displayName,
        primary_language: primaryLanguage,
      });

    if (profileInsertError && profileInsertError.code !== "23505") {
      console.error("[bootstrap-user] profile insert error:", profileInsertError.message);
      return errorResponse(ErrorCode.INTERNAL_ERROR);
    }
  } else if (displayName && existingProfile.display_name === "" && displayName !== "") {
    // Actualizar display_name si estaba vacío y ahora viene uno
    await serviceClient
      .from("profiles")
      .update({ display_name: displayName, primary_language: primaryLanguage })
      .eq("id", userId);
  }

  // Garantizar user_settings
  const { error: settingsError } = await serviceClient
    .from("user_settings")
    .insert({ user_id: userId })
    .onConflict("user_id")
    .ignoreDuplicates();

  if (settingsError) {
    console.error("[bootstrap-user] user_settings error:", settingsError.message);
  }

  // Garantizar user_safety_preferences
  const { error: prefsError } = await serviceClient
    .from("user_safety_preferences")
    .insert({ user_id: userId })
    .onConflict("user_id")
    .ignoreDuplicates();

  if (prefsError) {
    console.error("[bootstrap-user] user_safety_preferences error:", prefsError.message);
  }

  // Leer el estado actual del perfil para devolverlo
  const { data: profile, error: finalSelectError } = await supabase
    .from("profiles")
    .select("id, display_name, primary_language, onboarding_status, confrontation_style, safety_notice_accepted")
    .eq("id", userId)
    .single();

  if (finalSelectError || !profile) {
    console.error("[bootstrap-user] final select error:", finalSelectError?.message);
    return errorResponse(ErrorCode.INTERNAL_ERROR);
  }

  // Registrar en audit
  await logAuditEvent(serviceClient, {
    actorUserId: userId,
    eventName: "user.bootstrapped",
    entityTable: "profiles",
    entityId: userId,
    payload: { onboarding_status: profile.onboarding_status },
  });

  return okResponse({
    profile,
    bootstrapped: true,
  });
});
