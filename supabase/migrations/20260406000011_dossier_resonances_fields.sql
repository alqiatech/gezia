-- =============================================================================
-- GEZIA — Fase 5 — Migration 11
-- Campos adicionales en dossier_resonances para el worker de resonancias
-- =============================================================================

-- Agregar campos que necesita refresh-resonances-job
ALTER TABLE public.dossier_resonances
  ADD COLUMN IF NOT EXISTS resonance_type  text,
  ADD COLUMN IF NOT EXISTS safe_summary    text,
  ADD COLUMN IF NOT EXISTS last_scene_id   uuid REFERENCES public.scenes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS model_version   text;

-- structural_similarity ya existe — safe_summary es el nombre semántico nuevo.
-- Ambas coexisten; el worker escribe en safe_summary.

-- Index para lecturas del cliente por usuario
CREATE INDEX IF NOT EXISTS idx_dossier_resonances_user
  ON public.dossier_resonances (user_id, confidence DESC)
  WHERE active = true;
