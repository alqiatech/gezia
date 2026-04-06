// =============================================================================
// GEZIA — submit-scene/index.ts
// Edge Function: submit-scene
//
// Recibe la narrativa del usuario, crea la escena en estado 'submitted'
// y encola el job de inferencia en app_private.job_queue.
// La escena solo se crea una vez por client_request_id (deduplicación).
//
// Autenticación: JWT obligatorio
// Método: POST
// Body: {
//   client_request_id: string,
//   dossier_id: string,
//   scene_type: SceneType,
//   title?: string,
//   raw_user_narrative: string,         // Min 20 chars
//   event_context?: string,
//   user_conclusion?: string,
//   post_event_change?: string[],
//   occurred_at?: string,               // ISO 8601
// }
// =============================================================================

import { requireAuth } from "../_shared/auth.ts";
import { ErrorCode, errorResponse, okResponse, corsPreflightResponse } from "../_shared/errors.ts";
import { logAuditEvent } from "../_shared/audit.ts";
import { checkAndRegisterDedup, markDedupCompleted } from "../_shared/dedup.ts";

const VALID_SCENE_TYPES = [
  "conflict", "distance", "ambiguity", "rejection",
  "criticism", "jealousy", "repair", "sexual", "support", "other",
] as const;

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

  const {
    client_request_id,
    dossier_id,
    scene_type,
    title,
    raw_user_narrative,
    event_context,
    user_conclusion,
    post_event_change,
    occurred_at,
  } = body;

  // Validaciones
  if (!client_request_id || typeof client_request_id !== "string") {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "client_request_id is required");
  }
  if (!dossier_id || typeof dossier_id !== "string") {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "dossier_id is required");
  }
  if (!scene_type || !VALID_SCENE_TYPES.includes(scene_type as typeof VALID_SCENE_TYPES[number])) {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, `scene_type must be one of: ${VALID_SCENE_TYPES.join(", ")}`);
  }
  if (!raw_user_narrative || typeof raw_user_narrative !== "string" || raw_user_narrative.trim().length < 20) {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "raw_user_narrative must be at least 20 characters");
  }

  // Validar occurred_at si se proporciona
  let parsedOccurredAt: string | null = null;
  if (occurred_at) {
    const d = new Date(occurred_at as string);
    if (isNaN(d.getTime())) {
      return errorResponse(ErrorCode.INVALID_PAYLOAD, "occurred_at must be a valid ISO 8601 date");
    }
    parsedOccurredAt = d.toISOString();
  }

  // Verificar que el dossier pertenece al usuario
  const { data: dossier, error: dossierError } = await supabase
    .from("dossiers")
    .select("id, dossier_status")
    .eq("id", dossier_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (dossierError) {
    console.error("[submit-scene] dossier lookup error:", dossierError.message);
    return errorResponse(ErrorCode.INTERNAL_ERROR);
  }
  if (!dossier) {
    return errorResponse(ErrorCode.INVALID_OWNERSHIP, "Dossier not found or access denied");
  }

  // Verificar deduplicación
  const dedupResult = await checkAndRegisterDedup(serviceClient, {
    userId,
    operationName: "submit-scene",
    clientRequestId: client_request_id as string,
    resourceType: "scene",
  });

  if (dedupResult.isDuplicate) {
    if (dedupResult.existingResourceId) {
      const { data: existing } = await supabase
        .from("scenes")
        .select("id, processing_status, scene_type, title, created_at")
        .eq("id", dedupResult.existingResourceId)
        .eq("user_id", userId)
        .single();
      if (existing) return okResponse({ scene_id: existing.id, processing_status: existing.processing_status, duplicate: true });
    }
    return errorResponse(ErrorCode.DUPLICATE_REQUEST);
  }

  // Crear la escena en estado 'submitted'
  const { data: scene, error: sceneError } = await serviceClient
    .from("scenes")
    .insert({
      user_id: userId,
      dossier_id: dossier_id as string,
      scene_type,
      title: typeof title === "string" ? title.trim().slice(0, 120) || null : null,
      raw_user_narrative: (raw_user_narrative as string).trim(),
      event_context: typeof event_context === "string" ? event_context.trim().slice(0, 2000) : null,
      user_conclusion: typeof user_conclusion === "string" ? user_conclusion.trim().slice(0, 1000) : null,
      post_event_change: Array.isArray(post_event_change)
        ? (post_event_change as unknown[]).filter((v): v is string => typeof v === "string").map((v) => v.trim().slice(0, 200))
        : [],
      processing_status: "submitted",
      client_request_id: client_request_id as string,
      occurred_at: parsedOccurredAt ?? new Date().toISOString(),
    })
    .select("id, processing_status, scene_type, created_at")
    .single();

  if (sceneError || !scene) {
    console.error("[submit-scene] scene insert error:", sceneError?.message);
    return errorResponse(ErrorCode.INTERNAL_ERROR);
  }

  // Encolar job de inferencia en app_private.job_queue
  const { data: job, error: jobError } = await serviceClient
    .schema("app_private")
    .from("job_queue")
    .insert({
      job_type: "process_scene_inference",
      payload: {
        scene_id: scene.id,
        user_id: userId,
        dossier_id: dossier_id,
        client_request_id: client_request_id,
      },
      status: "pending",
    })
    .select("id")
    .single();

  if (jobError || !job) {
    console.error("[submit-scene] job enqueue error:", jobError?.message);
    // Intentar actualizar la escena con error si no se pudo encolar
    await serviceClient
      .from("scenes")
      .update({
        processing_status: "failed_retryable",
        processing_error_code: "JOB_ENQUEUE_FAILED",
      })
      .eq("id", scene.id);
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Failed to enqueue processing job");
  }

  // Actualizar la escena con el job_id asignado y pasar a 'queued'
  await serviceClient
    .from("scenes")
    .update({
      processing_status: "queued",
      current_job_id: job.id,
    })
    .eq("id", scene.id);

  // Marcar dedup completado
  await markDedupCompleted(serviceClient, {
    userId,
    operationName: "submit-scene",
    clientRequestId: client_request_id as string,
    resourceId: scene.id,
  });

  // Audit
  await logAuditEvent(serviceClient, {
    actorUserId: userId,
    eventName: "scene.submitted",
    entityTable: "scenes",
    entityId: scene.id,
    payload: { scene_type, dossier_id, job_id: job.id },
  });

  return okResponse({
    scene_id: scene.id,
    processing_status: "queued",
    job_id: job.id,
  }, 201);
});
