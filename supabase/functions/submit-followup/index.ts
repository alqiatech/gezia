/**
 * GEZIA — submit-followup
 * Captura el resultado de una intervención aplicada por el usuario.
 * Encola refresh_patterns para actualización longitudinal.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import { errorResponse, okResponse, ErrorCode } from "../_shared/errors.ts";
import { checkAndRegisterDedup, markDedupCompleted } from "../_shared/dedup.ts";
import { logAuditEvent } from "../_shared/audit.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return errorResponse(ErrorCode.INVALID_PAYLOAD, "POST required");

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { userId, serviceClient } = auth;

  let body: {
    client_request_id: string;
    intervention_id: string;
    user_action_taken?: string;
    observed_outcome?: string;
    clarity_score?: number;
    activation_score?: number;
    connection_score?: number;
    safety_score?: number;
    intervention_effect: "positive" | "neutral" | "negative" | "unclear";
  };

  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "Body JSON inválido");
  }

  const {
    client_request_id,
    intervention_id,
    user_action_taken,
    observed_outcome,
    clarity_score,
    activation_score,
    connection_score,
    safety_score,
    intervention_effect,
  } = body;

  if (!client_request_id?.trim()) return errorResponse(ErrorCode.INVALID_PAYLOAD, "client_request_id requerido");
  if (!intervention_id?.trim()) return errorResponse(ErrorCode.INVALID_PAYLOAD, "intervention_id requerido");
  if (!["positive", "neutral", "negative", "unclear"].includes(intervention_effect)) {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "intervention_effect inválido");
  }

  // Validar scores en rango 1-5
  for (const [name, val] of Object.entries({ clarity_score, activation_score, connection_score, safety_score })) {
    if (val !== undefined && (val < 1 || val > 5 || !Number.isInteger(val))) {
      return errorResponse(ErrorCode.INVALID_PAYLOAD, `${name} debe ser entero entre 1 y 5`);
    }
  }

  // Verificar ownership de la intervención
  const { data: intervention, error: intErr } = await serviceClient
    .from("interventions")
    .select("id, scene_id, dossier_id, user_id")
    .eq("id", intervention_id)
    .eq("user_id", userId)
    .single();

  if (intErr || !intervention) return errorResponse(ErrorCode.INVALID_OWNERSHIP, "Intervención no encontrada");

  // Deduplicación
  const dedup = await checkAndRegisterDedup(serviceClient, {
    userId,
    operationName: "submit_followup",
    clientRequestId: client_request_id,
    resourceType: "intervention_outcome",
  });

  if (dedup.isDuplicate) {
    return okResponse({ outcome_id: dedup.existingResourceId, duplicate: true }, 200);
  }

  // Insertar outcome
  const { data: outcome, error: outErr } = await serviceClient
    .from("intervention_outcomes")
    .insert({
      intervention_id,
      user_id: userId,
      user_action_taken: user_action_taken ?? null,
      observed_outcome: observed_outcome ?? null,
      clarity_score: clarity_score ?? null,
      activation_score: activation_score ?? null,
      connection_score: connection_score ?? null,
      safety_score: safety_score ?? null,
      intervention_effect,
      client_request_id,
    })
    .select("id")
    .single();

  if (outErr || !outcome) {
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Error al guardar outcome");
  }

  // Actualizar dossier.updated_at
  await serviceClient
    .from("dossiers")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", intervention.dossier_id);

  // Encolar refresh_patterns
  await serviceClient.schema("app_private").from("job_queue").insert({
    job_type: "refresh_patterns",
    payload: {
      intervention_outcome_id: outcome.id,
      intervention_id,
      scene_id: intervention.scene_id,
      dossier_id: intervention.dossier_id,
      user_id: userId,
    },
    status: "pending",
    run_after: new Date().toISOString(),
    max_attempts: 3,
  });

  await markDedupCompleted(serviceClient, {
    userId,
    operationName: "submit_followup",
    clientRequestId: client_request_id,
    resourceId: outcome.id,
  });

  await logAuditEvent(serviceClient, {
    user_id: userId,
    event_type: "followup.submitted",
    resource_type: "intervention_outcome",
    resource_id: outcome.id,
    metadata: { intervention_id, intervention_effect },
  });

  return okResponse({ outcome_id: outcome.id }, 201);
});
