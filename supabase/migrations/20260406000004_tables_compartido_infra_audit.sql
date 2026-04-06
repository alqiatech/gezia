-- =============================================================================
-- GEZIA — Fase 1 — Migration 4
-- Tablas de zona compartida, infra de operaciones y auditoría
--
-- public: shared_workspaces, shared_workspace_members, workspace_dossier_links,
--         workspace_invites, shared_items, shared_agreements
-- app_private: job_queue, request_dedup, outbox_events
-- audit: event_log, security_log, share_log
-- =============================================================================

-- =============================================================================
-- ZONA COMPARTIDA (public)
-- =============================================================================

CREATE TABLE public.shared_workspaces (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_type  public.workspace_type NOT NULL,
  status          public.workspace_status NOT NULL DEFAULT 'active',
  title           text        NOT NULL CHECK (char_length(title) >= 1 AND char_length(title) <= 120),
  created_by      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shared_workspaces ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------

CREATE TABLE public.shared_workspace_members (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES public.shared_workspaces(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role            text        NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  consent_status  text        NOT NULL DEFAULT 'pending' CHECK (consent_status IN ('pending', 'accepted', 'declined')),
  joined_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

ALTER TABLE public.shared_workspace_members ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Vínculo explícito workspace ↔ dossier
-- Sin esta entrada, no se pueden compartir escenas del dossier en el workspace
-- -----------------------------------------------------------------------------

CREATE TABLE public.workspace_dossier_links (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES public.shared_workspaces(id) ON DELETE CASCADE,
  dossier_id      uuid        NOT NULL REFERENCES public.dossiers(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, dossier_id)
);

ALTER TABLE public.workspace_dossier_links ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------

CREATE TABLE public.workspace_invites (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES public.shared_workspaces(id) ON DELETE CASCADE,
  inviter_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invitee_email   text        NOT NULL,
  -- NUNCA se almacena el token plano. Solo el hash.
  token_hash      text        NOT NULL UNIQUE,
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'revoked')),
  expires_at      timestamptz NOT NULL,
  accepted_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------

CREATE TABLE public.shared_items (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL REFERENCES public.shared_workspaces(id) ON DELETE CASCADE,
  shared_by_user_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scene_id            uuid        NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  -- Resumen derivado generado server-side: NUNCA raw_user_narrative aquí
  shared_summary      text        NOT NULL,
  tension_point       text,
  user_need           text,
  possible_agreement  text,
  followup_agreed     text,
  -- Control de revocación
  revoked             boolean     NOT NULL DEFAULT false,
  revoked_at          timestamptz,
  -- Este campo se llena desde scene_outputs.share_eligible al momento de compartir
  share_eligible_at_time boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shared_items ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------

CREATE TABLE public.shared_agreements (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES public.shared_workspaces(id) ON DELETE CASCADE,
  created_by      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  agreement_text  text        NOT NULL,
  agreed_by       uuid[]      NOT NULL DEFAULT '{}',
  status          text        NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'completed', 'cancelled')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shared_agreements ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- INFRAESTRUCTURA DE OPERACIONES (app_private)
-- =============================================================================

CREATE TABLE app_private.job_queue (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type        text        NOT NULL CHECK (job_type IN (
                                'process_scene_inference',
                                'refresh_patterns',
                                'refresh_resonances',
                                'generate_shared_item',
                                'cleanup_expired_invites'
                              )),
  payload         jsonb       NOT NULL DEFAULT '{}',
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'dead')),
  attempt_count   smallint    NOT NULL DEFAULT 0,
  max_attempts    smallint    NOT NULL DEFAULT 3,
  run_after       timestamptz NOT NULL DEFAULT now(),
  locked_at       timestamptz,
  locked_by       text,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------

CREATE TABLE app_private.request_dedup (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL,
  operation_name      text        NOT NULL,
  client_request_id   text        NOT NULL,
  resource_type       text,
  resource_id         uuid,
  status              text        NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- La combinación user_id + operation_name + client_request_id debe ser única
  UNIQUE (user_id, operation_name, client_request_id)
);

-- -----------------------------------------------------------------------------

CREATE TABLE app_private.outbox_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name      text        NOT NULL,
  aggregate_type  text        NOT NULL,
  aggregate_id    uuid        NOT NULL,
  payload         jsonb       NOT NULL DEFAULT '{}',
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);

-- =============================================================================
-- AUDITORÍA (audit schema — append-only, sin exposición al cliente)
-- =============================================================================

CREATE TABLE audit.event_log (
  id              bigserial   PRIMARY KEY,
  actor_user_id   uuid,
  event_name      text        NOT NULL,
  entity_schema   text,
  entity_table    text,
  entity_id       uuid,
  payload         jsonb       NOT NULL DEFAULT '{}',
  ip_address      inet,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------

CREATE TABLE audit.security_log (
  id              bigserial   PRIMARY KEY,
  user_id         uuid,
  event_type      text        NOT NULL,
  severity        text        NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  description     text,
  payload         jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------

CREATE TABLE audit.share_log (
  id              bigserial   PRIMARY KEY,
  actor_user_id   uuid,
  workspace_id    uuid,
  operation       text        NOT NULL, -- 'share', 'revoke', 'access', 'invite_sent', 'invite_accepted'
  shared_item_id  uuid,
  scene_id        uuid,
  payload         jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
