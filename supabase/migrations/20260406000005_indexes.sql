-- =============================================================================
-- GEZIA — Fase 1 — Migration 5
-- Índices críticos
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Expedientes y baselines
-- -----------------------------------------------------------------------------

CREATE INDEX idx_dossiers_user_created
  ON public.dossiers (user_id, created_at DESC);

CREATE INDEX idx_dossiers_user_status
  ON public.dossiers (user_id, dossier_status);

CREATE INDEX idx_dossier_tags_dossier
  ON public.dossier_tags (dossier_id);

CREATE INDEX idx_dossier_resonances_user_created
  ON public.dossier_resonances (user_id, created_at DESC);

CREATE INDEX idx_dossier_resonances_source
  ON public.dossier_resonances (source_dossier_id);

CREATE INDEX idx_dossier_resonances_target
  ON public.dossier_resonances (target_dossier_id);

-- -----------------------------------------------------------------------------
-- Escenas
-- -----------------------------------------------------------------------------

CREATE INDEX idx_scenes_dossier_occurred
  ON public.scenes (dossier_id, occurred_at DESC, created_at DESC);

CREATE INDEX idx_scenes_user_created
  ON public.scenes (user_id, created_at DESC);

-- Índice para el worker de jobs: filtra por estado de procesamiento
CREATE INDEX idx_scenes_processing_status
  ON public.scenes (processing_status);

CREATE INDEX idx_scenes_user_processing_status
  ON public.scenes (user_id, processing_status);

CREATE INDEX idx_scenes_client_request
  ON public.scenes (user_id, client_request_id) WHERE client_request_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Salidas del motor
-- -----------------------------------------------------------------------------

CREATE INDEX idx_scene_outputs_user_created
  ON public.scene_outputs (user_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Hechos y señales
-- -----------------------------------------------------------------------------

CREATE INDEX idx_scene_facts_scene
  ON public.scene_facts (scene_id);

CREATE INDEX idx_scene_signals_scene
  ON public.scene_signals (scene_id);

CREATE INDEX idx_scene_attachments_scene
  ON public.scene_attachments (scene_id);

-- -----------------------------------------------------------------------------
-- Seguridad
-- -----------------------------------------------------------------------------

CREATE INDEX idx_safety_flags_user_active
  ON public.safety_flags (user_id, active, created_at DESC);

CREATE INDEX idx_safety_flags_scene
  ON public.safety_flags (scene_id) WHERE scene_id IS NOT NULL;

CREATE INDEX idx_safety_flags_dossier
  ON public.safety_flags (dossier_id) WHERE dossier_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Patrones
-- -----------------------------------------------------------------------------

CREATE INDEX idx_patterns_dossier_status_confidence
  ON public.patterns (dossier_id, status, confidence DESC);

CREATE INDEX idx_patterns_user_status
  ON public.patterns (user_id, status);

CREATE INDEX idx_pattern_evidence_pattern
  ON public.pattern_evidence (pattern_id);

CREATE INDEX idx_pattern_evidence_scene
  ON public.pattern_evidence (scene_id);

-- -----------------------------------------------------------------------------
-- Intervenciones
-- -----------------------------------------------------------------------------

CREATE INDEX idx_interventions_dossier_created
  ON public.interventions (dossier_id, created_at DESC);

CREATE INDEX idx_interventions_scene
  ON public.interventions (scene_id);

CREATE INDEX idx_intervention_outcomes_intervention
  ON public.intervention_outcomes (intervention_id);

-- -----------------------------------------------------------------------------
-- Zona compartida
-- -----------------------------------------------------------------------------

CREATE INDEX idx_shared_workspace_members_user
  ON public.shared_workspace_members (user_id);

CREATE INDEX idx_shared_workspace_members_workspace
  ON public.shared_workspace_members (workspace_id);

CREATE INDEX idx_workspace_dossier_links_workspace
  ON public.workspace_dossier_links (workspace_id);

CREATE INDEX idx_workspace_dossier_links_dossier
  ON public.workspace_dossier_links (dossier_id);

CREATE INDEX idx_workspace_invites_token_hash
  ON public.workspace_invites (token_hash);

CREATE INDEX idx_workspace_invites_workspace_status
  ON public.workspace_invites (workspace_id, status);

CREATE INDEX idx_shared_items_workspace_created
  ON public.shared_items (workspace_id, created_at DESC);

CREATE INDEX idx_shared_items_scene
  ON public.shared_items (scene_id);

CREATE INDEX idx_shared_items_not_revoked
  ON public.shared_items (workspace_id, created_at DESC) WHERE revoked = false;

-- -----------------------------------------------------------------------------
-- Infraestructura de operaciones (app_private)
-- -----------------------------------------------------------------------------

-- Worker: filtra por status y run_after para tomar el próximo job
CREATE INDEX idx_job_queue_status_run_after
  ON app_private.job_queue (status, run_after) WHERE status IN ('pending', 'failed');

-- Liberación de locks
CREATE INDEX idx_job_queue_locked_by
  ON app_private.job_queue (locked_by) WHERE locked_by IS NOT NULL;

-- Deduplicación
CREATE INDEX idx_request_dedup_lookup
  ON app_private.request_dedup (user_id, operation_name, client_request_id);

-- Outbox
CREATE INDEX idx_outbox_events_status_created
  ON app_private.outbox_events (status, created_at) WHERE status = 'pending';

-- -----------------------------------------------------------------------------
-- Auditoría
-- -----------------------------------------------------------------------------

CREATE INDEX idx_audit_event_log_actor
  ON audit.event_log (actor_user_id, created_at DESC);

CREATE INDEX idx_audit_event_log_entity
  ON audit.event_log (entity_table, entity_id);

CREATE INDEX idx_audit_share_log_workspace
  ON audit.share_log (workspace_id, created_at DESC);

CREATE INDEX idx_audit_share_log_actor
  ON audit.share_log (actor_user_id, created_at DESC);

CREATE INDEX idx_audit_security_log_user
  ON audit.security_log (user_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Trazabilidad del motor (app_private)
-- -----------------------------------------------------------------------------

CREATE INDEX idx_inference_runs_scene
  ON app_private.inference_runs (scene_id);

CREATE INDEX idx_inference_runs_user
  ON app_private.inference_runs (user_id, created_at DESC);

CREATE INDEX idx_policy_decisions_scene
  ON app_private.policy_decisions (scene_id);

CREATE INDEX idx_prompt_snapshots_run
  ON app_private.prompt_snapshots (inference_run_id, module_name);

CREATE INDEX idx_safety_triage_runs_scene
  ON app_private.safety_triage_runs (scene_id);
