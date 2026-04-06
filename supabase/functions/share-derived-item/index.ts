/**
 * GEZIA — share-derived-item
 * Función más estricta del sistema. Todas las validaciones son server-side.
 * La síntesis compartida se genera desde observable_text ÚNICAMENTE.
 * NUNCA expone: raw_user_narrative, user_meanings, scene_signals, resonances.
 */

import { requireAuth } from "../_shared/auth.ts";
import { errorResponse, okResponse, ErrorCode } from "../_shared/errors.ts";
import { checkAndRegisterDedup, markDedupCompleted } from "../_shared/dedup.ts";
import { logAuditEvent } from "../_shared/audit.ts";
import { callLLM, parseLLMJson } from "../_shared/llm.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return errorResponse(ErrorCode.INVALID_PAYLOAD, "POST required");

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { userId, serviceClient } = auth;

  let body: {
    client_request_id: string;
    workspace_id: string;
    scene_id: string;
    consent_to_share: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "Body JSON inválido");
  }

  const { client_request_id, workspace_id, scene_id, consent_to_share } = body;

  if (!client_request_id?.trim()) return errorResponse(ErrorCode.INVALID_PAYLOAD, "client_request_id requerido");
  if (!workspace_id?.trim()) return errorResponse(ErrorCode.INVALID_PAYLOAD, "workspace_id requerido");
  if (!scene_id?.trim()) return errorResponse(ErrorCode.INVALID_PAYLOAD, "scene_id requerido");
  if (consent_to_share !== true) return errorResponse(ErrorCode.INVALID_PAYLOAD, "Se requiere consentimiento explícito");

  // Validación 1: el usuario es miembro activo del workspace
  const { data: membership } = await serviceClient
    .from("shared_workspace_members")
    .select("id")
    .eq("workspace_id", workspace_id)
    .eq("user_id", userId)
    .eq("consent_status", "accepted")
    .single();

  if (!membership) return errorResponse(ErrorCode.UNAUTHORIZED, "No eres miembro activo de este workspace");

  // Obtener escena — SOLO campos permitidos, NUNCA raw_user_narrative
  const { data: scene } = await serviceClient
    .from("scenes")
    .select("id, dossier_id, user_id, risk_level, processing_status")
    .eq("id", scene_id)
    .single();

  if (!scene) return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, "Escena no encontrada");

  // Validación 2: la escena pertenece a este usuario
  if (scene.user_id !== userId) {
    return errorResponse(ErrorCode.INVALID_OWNERSHIP, "La escena no te pertenece");
  }

  // Validación 3: el dossier de la escena está vinculado a este workspace
  const { data: dossierLink } = await serviceClient
    .from("workspace_dossier_links")
    .select("id")
    .eq("workspace_id", workspace_id)
    .eq("dossier_id", scene.dossier_id)
    .eq("user_id", userId)
    .single();

  if (!dossierLink) return errorResponse(ErrorCode.WORKSPACE_NOT_LINKED_TO_DOSSIER, "El dossier de esta escena no está vinculado al workspace");

  // Obtener scene_outputs — solo campos observables/seguros
  const { data: sceneOutput } = await serviceClient
    .from("scene_outputs")
    .select(
      "id, share_eligible, observable_text, block1_texto, block2_texto, block3_texto, block4_texto, block5_texto, block6_texto"
    )
    .eq("scene_id", scene_id)
    .single();

  if (!sceneOutput) return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, "Output de escena no encontrado");

  // Validación 4: scene_outputs.share_eligible = true
  if (!sceneOutput.share_eligible) {
    return errorResponse(ErrorCode.SHARE_NOT_ELIGIBLE, "Esta escena no está marcada como compartible");
  }

  // Validación 5: risk_level no es red ni black
  if (scene.risk_level === "red" || scene.risk_level === "black") {
    return errorResponse(ErrorCode.SHARE_NOT_ELIGIBLE, "Escenas con riesgo elevado no pueden compartirse");
  }

  // Validación 6: no hay safety_flags activos para esta escena
  const { data: activeFlag } = await serviceClient
    .from("safety_flags")
    .select("id")
    .eq("scene_id", scene_id)
    .eq("resolved", false)
    .maybeSingle();

  if (activeFlag) return errorResponse(ErrorCode.SHARE_NOT_ELIGIBLE, "Existe un indicador de seguridad activo para esta escena");

  // Validación 7: no hay shared_item previo activo (no revocado) para esta escena en este workspace
  const { data: existingShare } = await serviceClient
    .from("shared_items")
    .select("id")
    .eq("workspace_id", workspace_id)
    .eq("scene_id", scene_id)
    .eq("revoked", false)
    .maybeSingle();

  if (existingShare) return errorResponse(ErrorCode.INVALID_PAYLOAD, "Ya existe un elemento compartido activo para esta escena");

  // Deduplicación
  const dedup = await checkAndRegisterDedup(serviceClient, {
    userId,
    operationName: "share_derived_item",
    clientRequestId: client_request_id,
    resourceType: "shared_item",
  });

  if (dedup.isDuplicate) {
    return okResponse({ shared_item_id: dedup.existingResourceId, duplicate: true }, 200);
  }

  // Validación 8: generar shared_summary desde observable_text ÚNICAMENTE
  // NUNCA se pasan raw_user_narrative, user_meanings, scene_signals, resonances al LLM aquí
  const observableText: string = sceneOutput.observable_text ?? "";

  if (!observableText.trim()) {
    return errorResponse(ErrorCode.SHARE_NOT_ELIGIBLE, "No hay texto observable para generar resumen compartido");
  }

  const systemPrompt = `Eres un asistente que genera resúmenes de comportamientos observables para ser compartidos en un espacio de trabajo colaborativo.

REGLAS INVIOLABLES:
- Usa SOLO el texto observable proporcionado. NUNCA inferas sentimientos, intenciones ni causas.
- Describe comportamientos y hechos concretos únicamente.
- Lenguaje neutral, sin juicios ni interpretaciones.
- Máximo 3 oraciones.
- Responde en el mismo idioma que el texto recibido.
- Responde como JSON: { "shared_summary": "..." }`;

  const userPrompt = `Texto observable:\n${observableText}`;

  const llmResult = await callLLM(systemPrompt, userPrompt, true);
  const parsed = parseLLMJson<{ shared_summary: string }>(llmResult.content);

  if (!parsed.shared_summary?.trim()) {
    return errorResponse(ErrorCode.INTERNAL_ERROR, "No se pudo generar resumen compartido");
  }

  // Insertar shared_item
  const { data: sharedItem, error: shareErr } = await serviceClient
    .from("shared_items")
    .insert({
      workspace_id,
      shared_by_user_id: userId,
      scene_id,
      source_dossier_id: scene.dossier_id,
      shared_summary: parsed.shared_summary,
      revocable: true,
      revoked: false,
      consent_given: true,
      consent_given_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (shareErr || !sharedItem) {
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Error al crear elemento compartido");
  }

  await markDedupCompleted(serviceClient, {
    userId,
    operationName: "share_derived_item",
    clientRequestId: client_request_id,
    resourceId: sharedItem.id,
  });

  // Log en audit.share_log
  const { error: shareLogErr } = await serviceClient.schema("audit").from("share_log").insert({
    user_id: userId,
    workspace_id,
    shared_item_id: sharedItem.id,
    action: "item_shared",
    metadata: { scene_id, dossier_id: scene.dossier_id },
  });
  if (shareLogErr) console.error("share_log insert error:", shareLogErr.message);

  await logAuditEvent(serviceClient, {
    user_id: userId,
    event_type: "workspace.item_shared",
    resource_type: "shared_item",
    resource_id: sharedItem.id,
    metadata: { workspace_id, scene_id, dossier_id: scene.dossier_id },
  });
  return okResponse({
    shared_item_id: sharedItem.id,
    shared_summary: parsed.shared_summary,
  }, 201);
});
