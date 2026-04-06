/**
 * GEZIA — export-account-data
 * Exporta todos los datos propios del usuario como bundle JSON.
 * EXCLUYE: inference_runs, prompt_snapshots, policy_decisions,
 *          response_assemblies, safety_triage_runs, audit logs,
 *          raw_user_narrative.
 */

import { requireAuth } from "../_shared/auth.ts";
import { errorResponse, okResponse, ErrorCode, corsPreflightResponse } from "../_shared/errors.ts";
import { logAuditEvent } from "../_shared/audit.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "GET") return errorResponse(ErrorCode.INVALID_PAYLOAD, "GET required");

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { userId, serviceClient } = auth;

  // Perfil
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("id, display_name, primary_language, country_code, timezone, onboarding_status, created_at, updated_at")
    .eq("id", userId)
    .single();

  // Dossiers
  const { data: dossiers } = await serviceClient
    .from("dossiers")
    .select("id, title, relationship_type, context_note, shared_workspace_enabled, created_at, updated_at")
    .eq("user_id", userId);

  // Baselines
  const { data: baselines } = await serviceClient
    .from("dossier_baselines")
    .select("id, dossier_id, things_that_help, things_that_worsen, notes, updated_at")
    .eq("user_id", userId);

  // Escenas — NUNCA raw_user_narrative
  const { data: scenes } = await serviceClient
    .from("scenes")
    .select(
      "id, dossier_id, scene_date, processing_status, risk_level, confrontation_level, created_at"
    )
    .eq("user_id", userId);

  // Outputs de escenas — solo bloques de texto público
  const sceneIds = (scenes ?? []).map((s: { id: string }) => s.id);

  let sceneOutputs: unknown[] = [];
  if (sceneIds.length > 0) {
    const { data } = await serviceClient
      .from("scene_outputs")
      .select(
        "id, scene_id, block1_texto, block2_texto, block3_texto, block4_texto, block5_texto, block6_texto, block7_texto, final_text, share_eligible, created_at"
      )
      .in("scene_id", sceneIds);
    sceneOutputs = data ?? [];
  }

  // Intervenciones
  const { data: interventions } = await serviceClient
    .from("interventions")
    .select("id, scene_id, dossier_id, description, tags, created_at")
    .eq("user_id", userId);

  // Outcomes de intervenciones
  const interventionIds = (interventions ?? []).map((i: { id: string }) => i.id);
  let outcomes: unknown[] = [];
  if (interventionIds.length > 0) {
    const { data } = await serviceClient
      .from("intervention_outcomes")
      .select("id, intervention_id, effect, notes, reported_at")
      .in("intervention_id", interventionIds);
    outcomes = data ?? [];
  }

  // Elementos compartidos (como fuente)
  const { data: sharedItems } = await serviceClient
    .from("shared_items")
    .select(
      "id, workspace_id, scene_id, source_dossier_id, shared_summary, revocable, revoked, revoked_at, consent_given_at, created_at"
    )
    .eq("shared_by_user_id", userId);

  // Acuerdos compartidos
  const { data: agreements } = await serviceClient
    .from("shared_agreements")
    .select("id, workspace_id, agreement_text, status, created_at")
    .eq("created_by", userId);

  await logAuditEvent(serviceClient, {
    user_id: userId,
    event_type: "account.data_exported",
    resource_type: "account",
    resource_id: userId,
    metadata: {
      dossier_count: (dossiers ?? []).length,
      scene_count: (scenes ?? []).length,
    },
  });

  return okResponse({
    exported_at: new Date().toISOString(),
    profile,
    dossiers: dossiers ?? [],
    baselines: baselines ?? [],
    scenes: scenes ?? [],
    scene_outputs: sceneOutputs,
    interventions: interventions ?? [],
    intervention_outcomes: outcomes,
    shared_items: sharedItems ?? [],
    shared_agreements: agreements ?? [],
  }, 200);
});
