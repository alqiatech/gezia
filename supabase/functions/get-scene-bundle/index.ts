// =============================================================================
// GEZIA — get-scene-bundle/index.ts
// Edge Function: get-scene-bundle
//
// Retorna en una sola operación el bundle completo de una escena:
// - scene (sin raw_user_narrative en el response — queda en servidor)
// - scene_output (los 7 bloques)
// - scene_facts (hechos observables)
// - scene_signals (señales resumidas — solo tipo e intensidad, no texto crudo)
// - interventions vinculadas
// - safety_flag resumida
// - pattern_snippet (patrón dominante del dossier, solo safe_summary)
//
// GARANTÍA: NUNCA devuelve datos de app_private.
// GARANTÍA: NUNCA devuelve raw_user_narrative ni blocked_summary.
//
// Autenticación: JWT obligatorio
// Método: GET
// Query params: scene_id (UUID)
// =============================================================================

import { requireAuth } from "../_shared/auth.ts";
import { ErrorCode, errorResponse, okResponse, corsPreflightResponse } from "../_shared/errors.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "GET") {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "Method not allowed");
  }

  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult;
  const { userId, supabase } = authResult;

  const url = new URL(req.url);
  const sceneId = url.searchParams.get("scene_id");

  if (!sceneId) {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "scene_id query parameter is required");
  }

  // Fetch scene — excluye raw_user_narrative del response al cliente
  const { data: scene, error: sceneError } = await supabase
    .from("scenes")
    .select(`
      id,
      dossier_id,
      scene_type,
      title,
      summary,
      event_context,
      user_conclusion,
      post_event_change,
      activation_level,
      evidence_density,
      recurrence_level,
      distortion_level,
      externalization_level,
      risk_level,
      required_mode,
      locked_by_risk,
      processing_status,
      processing_started_at,
      processing_finished_at,
      processing_error_code,
      processing_attempts,
      share_eligible,
      version,
      occurred_at,
      created_at,
      updated_at
    `)
    .eq("id", sceneId)
    .eq("user_id", userId)
    .maybeSingle();

  if (sceneError) {
    console.error("[get-scene-bundle] scene fetch error:", sceneError.message);
    return errorResponse(ErrorCode.INTERNAL_ERROR);
  }
  if (!scene) {
    return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, "Scene not found or access denied");
  }

  // Fetch scene_output — todos los bloques
  const { data: output } = await supabase
    .from("scene_outputs")
    .select(`
      id,
      mode,
      risk_level,
      confidence,
      observable_text,
      probable_text,
      not_proven_text,
      user_part_text,
      friction_text,
      movement_text,
      limit_text,
      avoid_now_text,
      suggested_phrase,
      final_text,
      share_eligible,
      created_at,
      updated_at
    `)
    .eq("scene_id", sceneId)
    .eq("user_id", userId)
    .maybeSingle();

  // Fetch scene_facts
  const { data: facts } = await supabase
    .from("scene_facts")
    .select("id, fact_text, fact_type, source, created_at")
    .eq("scene_id", sceneId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  // Fetch scene_signals — sin contenido privado extra
  const { data: signals } = await supabase
    .from("scene_signals")
    .select("id, signal_type, signal_text, intensity, created_at")
    .eq("scene_id", sceneId)
    .eq("user_id", userId)
    .order("signal_type", { ascending: true });

  // Fetch interventions vinculadas a esta escena
  const { data: interventions } = await supabase
    .from("interventions")
    .select(`
      id,
      internal_move,
      external_move,
      suggested_phrase,
      avoid_now,
      followup_signal_watch,
      status,
      created_at,
      updated_at
    `)
    .eq("scene_id", sceneId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  // Fetch safety_flag activo (solo campos resumidos — sin notas internas)
  const { data: safetyFlag } = await supabase
    .from("safety_flags")
    .select("id, risk_level, risk_types, active, created_at")
    .eq("scene_id", sceneId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();

  // Fetch patrón dominante del dossier — solo safe_summary, NUNCA blocked_summary
  const { data: dominantPattern } = await supabase
    .from("patterns")
    .select("id, pattern_family, pattern_name, status, confidence, evidence_count, safe_summary, created_at")
    .eq("dossier_id", scene.dossier_id)
    .eq("user_id", userId)
    .in("status", ["candidate", "confirmed"])
    .order("confidence", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Construir bundle — blocked_summary nunca sale al cliente
  const bundle = {
    scene,
    output: output ?? null,
    facts: facts ?? [],
    signals: signals ?? [],
    interventions: interventions ?? [],
    safety_flag: safetyFlag ?? null,
    pattern_snippet: dominantPattern
      ? {
          id: dominantPattern.id,
          pattern_family: dominantPattern.pattern_family,
          pattern_name: dominantPattern.pattern_name,
          status: dominantPattern.status,
          confidence: dominantPattern.confidence,
          evidence_count: dominantPattern.evidence_count,
          safe_summary: dominantPattern.safe_summary,
          // blocked_summary: OMITIDO INTENCIONALMENTE
        }
      : null,
  };

  return okResponse(bundle);
});
