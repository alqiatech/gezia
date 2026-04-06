-- =============================================================================
-- GEZIA — Fase 1 — Migration 1
-- Schemas, extensiones y enums
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SCHEMAS
-- -----------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS app_private;
CREATE SCHEMA IF NOT EXISTS audit;

-- Revocar acceso público a schemas privados
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
REVOKE ALL ON SCHEMA audit FROM PUBLIC;

GRANT USAGE ON SCHEMA app_private TO service_role;
GRANT USAGE ON SCHEMA audit TO service_role;

-- El schema public permanece accesible para usuarios autenticados bajo RLS
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;

-- -----------------------------------------------------------------------------
-- EXTENSIONES
-- -----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- ENUMS
-- -----------------------------------------------------------------------------

CREATE TYPE public.dossier_type AS ENUM (
  'partner',
  'ex_partner',
  'mother',
  'father',
  'parent_figure',
  'authority',
  'friend',
  'other'
);

CREATE TYPE public.dossier_status AS ENUM (
  'active',
  'paused',
  'ended',
  'limited_contact',
  'no_contact'
);

CREATE TYPE public.scene_type AS ENUM (
  'conflict',
  'distance',
  'ambiguity',
  'rejection',
  'criticism',
  'jealousy',
  'repair',
  'sexual',
  'support',
  'other'
);

CREATE TYPE public.mode_type AS ENUM (
  'S0',
  'S1',
  'S2',
  'S3',
  'S4',
  'S5'
);

CREATE TYPE public.risk_level AS ENUM (
  'green',
  'amber',
  'red',
  'black'
);

CREATE TYPE public.pattern_status AS ENUM (
  'candidate',
  'confirmed',
  'fading',
  'resolved',
  'blocked_by_risk'
);

CREATE TYPE public.intervention_status AS ENUM (
  'suggested',
  'accepted',
  'completed',
  'rejected',
  'invalidated_by_risk'
);

CREATE TYPE public.workspace_type AS ENUM (
  'couple',
  'co_parent',
  'family_pair'
);

CREATE TYPE public.workspace_status AS ENUM (
  'active',
  'paused',
  'closed'
);

CREATE TYPE public.processing_status AS ENUM (
  'draft',
  'submitted',
  'queued',
  'triage_running',
  'blocked_risk',
  'inference_running',
  'ready',
  'failed_retryable',
  'failed_terminal'
);
