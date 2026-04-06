// =============================================================================
// GEZIA — create-dossier/index.ts
// Edge Function: create-dossier
//
// Crea un expediente (dossier) y su baseline vacío para el usuario autenticado.
// Idempotente vía client_request_id.
//
// Autenticación: JWT obligatorio
// Método: POST
// Body: {
//   client_request_id: string,      // UUID generado por el cliente
//   title: string,                  // 1-120 chars
//   dossier_type: DossierType,
//   counterparty_label?: string,
//   closeness_level?: 1-5,
//   emotional_importance?: 1-5,
//   power_asymmetry?: -2 to 2,
//   sexual_layer_enabled?: boolean,
// }
// =============================================================================

import { requireAuth } from "../_shared/auth.ts";
import { ErrorCode, errorResponse, okResponse } from "../_shared/errors.ts";
import { logAuditEvent } from "../_shared/audit.ts";
import { checkAndRegisterDedup, markDedupCompleted } from "../_shared/dedup.ts";

const VALID_DOSSIER_TYPES = [
  "partner", "ex_partner", "mother", "father",
  "parent_figure", "authority", "friend", "other",
] as const;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "Method not allowed");
  }

  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult;
  const { userId, serviceClient, supabase } = authResult;

  // Parsear y validar body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "Invalid JSON body");
  }

  const {
    client_request_id,
    title,
    dossier_type,
    counterparty_label,
    closeness_level = 3,
    emotional_importance = 3,
    power_asymmetry = 0,
    sexual_layer_enabled = false,
  } = body;

  // Validaciones obligatorias
  if (!client_request_id || typeof client_request_id !== "string") {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "client_request_id is required");
  }
  if (!title || typeof title !== "string" || title.trim().length < 1 || title.length > 120) {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "title must be 1-120 characters");
  }
  if (!dossier_type || !VALID_DOSSIER_TYPES.includes(dossier_type as typeof VALID_DOSSIER_TYPES[number])) {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, `dossier_type must be one of: ${VALID_DOSSIER_TYPES.join(", ")}`);
  }
  if (typeof closeness_level !== "number" || closeness_level < 1 || closeness_level > 5) {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "closeness_level must be 1-5");
  }
  if (typeof emotional_importance !== "number" || emotional_importance < 1 || emotional_importance > 5) {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "emotional_importance must be 1-5");
  }
  if (typeof power_asymmetry !== "number" || power_asymmetry < -2 || power_asymmetry > 2) {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "power_asymmetry must be -2 to 2");
  }

  // Verificar deduplicación
  const dedupResult = await checkAndRegisterDedup(serviceClient, {
    userId,
    operationName: "create-dossier",
    clientRequestId: client_request_id as string,
    resourceType: "dossier",
  });

  if (dedupResult.isDuplicate) {
    // Devolver el dossier existente
    if (dedupResult.existingResourceId) {
      const { data: existing } = await supabase
        .from("dossiers")
        .select("*")
        .eq("id", dedupResult.existingResourceId)
        .eq("user_id", userId)
        .single();
      if (existing) return okResponse({ dossier: existing, duplicate: true });
    }
    return errorResponse(ErrorCode.DUPLICATE_REQUEST);
  }

  // Crear dossier
  const { data: dossier, error: dossierError } = await serviceClient
    .from("dossiers")
    .insert({
      user_id: userId,
      title: title.trim(),
      dossier_type,
      counterparty_label: counterparty_label ?? null,
      closeness_level,
      emotional_importance,
      power_asymmetry,
      sexual_layer_enabled: Boolean(sexual_layer_enabled),
    })
    .select("*")
    .single();

  if (dossierError || !dossier) {
    console.error("[create-dossier] insert error:", dossierError?.message);
    return errorResponse(ErrorCode.INTERNAL_ERROR);
  }

  // Crear baseline vacío
  const { error: baselineError } = await serviceClient
    .from("dossier_baselines")
    .insert({ dossier_id: dossier.id });

  if (baselineError) {
    console.error("[create-dossier] baseline insert error:", baselineError.message);
    // No es crítico para el retorno pero se loguea
  }

  // Marcar dedup como completado
  await markDedupCompleted(serviceClient, {
    userId,
    operationName: "create-dossier",
    clientRequestId: client_request_id as string,
    resourceId: dossier.id,
  });

  // Audit
  await logAuditEvent(serviceClient, {
    actorUserId: userId,
    eventName: "dossier.created",
    entityTable: "dossiers",
    entityId: dossier.id,
    payload: { dossier_type, title: title.trim() },
  });

  return okResponse({ dossier }, 201);
});
