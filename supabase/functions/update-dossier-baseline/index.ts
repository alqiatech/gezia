// =============================================================================
// GEZIA — update-dossier-baseline/index.ts
// Edge Function: update-dossier-baseline
//
// Actualiza el baseline de un expediente existente del usuario autenticado.
// Idempotente vía client_request_id.
// Solo el dueño del expediente puede actualizar su baseline.
//
// Autenticación: JWT obligatorio
// Método: POST
// Body: {
//   client_request_id: string,
//   dossier_id: string,
//   lived_summary?: string,
//   main_triggers?: string[],
//   core_fears?: string[],
//   core_needs?: string[],
//   typical_user_sequence?: string[],
//   typical_other_sequence?: string[],
//   things_that_help?: string[],
//   things_that_worsen?: string[],
//   sensitive_topics?: string[],
// }
// =============================================================================

import { requireAuth } from "../_shared/auth.ts";
import { ErrorCode, errorResponse, okResponse, corsPreflightResponse } from "../_shared/errors.ts";
import { logAuditEvent } from "../_shared/audit.ts";
import { checkAndRegisterDedup, markDedupCompleted } from "../_shared/dedup.ts";

/** Filtra arrays de strings: descarta vacíos y trunca a 200 chars por item. */
function sanitizeStringArray(val: unknown): string[] | undefined {
  if (!Array.isArray(val)) return undefined;
  return (val as unknown[])
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim().slice(0, 200));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "Method not allowed");
  }

  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult;
  const { userId, supabase, serviceClient } = authResult;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "Invalid JSON body");
  }

  const { client_request_id, dossier_id, ...baselineFields } = body;

  if (!client_request_id || typeof client_request_id !== "string") {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "client_request_id is required");
  }
  if (!dossier_id || typeof dossier_id !== "string") {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "dossier_id is required");
  }

  // Verificar que el dossier pertenece al usuario autenticado
  const { data: dossier, error: dossierError } = await supabase
    .from("dossiers")
    .select("id")
    .eq("id", dossier_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (dossierError) {
    console.error("[update-dossier-baseline] dossier lookup error:", dossierError.message);
    return errorResponse(ErrorCode.INTERNAL_ERROR);
  }
  if (!dossier) {
    return errorResponse(ErrorCode.INVALID_OWNERSHIP, "Dossier not found or access denied");
  }

  // Verificar deduplicación
  const dedupResult = await checkAndRegisterDedup(serviceClient, {
    userId,
    operationName: "update-dossier-baseline",
    clientRequestId: client_request_id as string,
    resourceType: "dossier_baseline",
  });

  if (dedupResult.isDuplicate) {
    // Baseline ya actualizado con esta petición — devolver el estado actual
    const { data: baseline } = await supabase
      .from("dossier_baselines")
      .select("*")
      .eq("dossier_id", dossier_id)
      .single();
    return okResponse({ baseline, duplicate: true });
  }

  // Construir el objeto de actualización solo con campos presentes en el body
  const updatePayload: Record<string, unknown> = {};

  if ("lived_summary" in baselineFields) {
    const val = baselineFields.lived_summary;
    updatePayload.lived_summary = typeof val === "string" ? val.slice(0, 4000) : null;
  }

  const arrayFields = [
    "main_triggers", "core_fears", "core_needs",
    "typical_user_sequence", "typical_other_sequence",
    "things_that_help", "things_that_worsen", "sensitive_topics",
  ];

  for (const field of arrayFields) {
    if (field in baselineFields) {
      const sanitized = sanitizeStringArray(baselineFields[field]);
      if (sanitized !== undefined) updatePayload[field] = sanitized;
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "No valid fields provided for update");
  }

  const { data: baseline, error: updateError } = await serviceClient
    .from("dossier_baselines")
    .update(updatePayload)
    .eq("dossier_id", dossier_id)
    .select("*")
    .single();

  if (updateError || !baseline) {
    console.error("[update-dossier-baseline] update error:", updateError?.message);
    return errorResponse(ErrorCode.INTERNAL_ERROR);
  }

  await markDedupCompleted(serviceClient, {
    userId,
    operationName: "update-dossier-baseline",
    clientRequestId: client_request_id as string,
    resourceId: dossier_id as string,
  });

  await logAuditEvent(serviceClient, {
    actorUserId: userId,
    eventName: "dossier_baseline.updated",
    entityTable: "dossier_baselines",
    entityId: dossier_id as string,
    payload: { fields_updated: Object.keys(updatePayload) },
  });

  return okResponse({ baseline });
});
