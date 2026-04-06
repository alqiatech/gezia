-- =============================================================================
-- Migration 12: ajustes para Fase 6 (workspaces compartidos y gestión de cuenta)
-- =============================================================================

-- 1. Columna para solicitudes de eliminación de cuenta
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;

-- 2. shared_items: columnas de control adicionales requeridas por Fase 6
ALTER TABLE public.shared_items
  ADD COLUMN IF NOT EXISTS source_dossier_id uuid REFERENCES public.dossiers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revocable          boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS consent_given      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS consent_given_at   timestamptz;

-- 3. workspace_invites.invitee_email: hacer nullable para permitir invitaciones sin email
ALTER TABLE public.workspace_invites
  ALTER COLUMN invitee_email DROP NOT NULL;

-- 4. Índice para búsqueda de shared_items por dossier fuente
CREATE INDEX IF NOT EXISTS idx_shared_items_source_dossier
  ON public.shared_items (source_dossier_id)
  WHERE source_dossier_id IS NOT NULL;

-- 5. Índice para búsquedas de deletion_requested_at (cleanup jobs)
CREATE INDEX IF NOT EXISTS idx_profiles_deletion_requested
  ON public.profiles (deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL;
