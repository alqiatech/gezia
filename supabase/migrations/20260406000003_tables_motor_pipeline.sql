-- =============================================================================
-- GEZIA — Fase 1 — Migration 3
-- Tablas del motor relacional y pipeline
-- scenes, scene_outputs, scene_facts, scene_signals, scene_attachments,
-- safety_flags, safety_events,
-- patterns, pattern_evidence,
-- interventions, intervention_outcomes,
-- app_private: inference_runs, policy_decisions, prompt_snapshots,
--              response_assemblies, safety_triage_runs
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ESCENAS
-- -----------------------------------------------------------------------------

CREATE TABLE public.scenes (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id                  uuid        NOT NULL REFERENCES public.dossiers(id) ON DELETE CASCADE,
  user_id                     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scene_type                  public.scene_type NOT NULL,
  title                       text,
  -- Narrativa cruda del usuario: NUNCA sale al cliente por ninguna ruta de compartido
  raw_user_narrative          text,
  summary                     text,
  event_context               text,
  user_conclusion             text,
  post_event_change           text[]      NOT NULL DEFAULT '{}',
  -- Variables calculadas por el motor (se llenan durante el pipeline)
  activation_level            numeric(3,2) CHECK (activation_level BETWEEN 0.00 AND 1.00),
  evidence_density            numeric(3,2) CHECK (evidence_density BETWEEN 0.00 AND 1.00),
  recurrence_level            numeric(3,2) CHECK (recurrence_level BETWEEN 0.00 AND 1.00),
  distortion_level            numeric(3,2) CHECK (distortion_level BETWEEN 0.00 AND 1.00),
  externalization_level       numeric(3,2) CHECK (externalization_level BETWEEN 0.00 AND 1.00),
  risk_level                  public.risk_level,
  required_mode               public.mode_type,
  locked_by_risk              boolean     NOT NULL DEFAULT false,
  -- Control de procesamiento
  processing_status           public.processing_status NOT NULL DEFAULT 'draft',
  processing_started_at       timestamptz,
  processing_finished_at      timestamptz,
  processing_error_code       text,
  processing_error_message    text,
  processing_attempts         smallint    NOT NULL DEFAULT 0,
  -- Trazabilidad de la petición del cliente
  client_request_id           text,
  last_inference_run_id       uuid,       -- FK a app_private.inference_runs (se fuerza por CHECK de integridad manual)
  current_job_id              uuid,       -- FK a app_private.job_queue
  share_eligible              boolean     NOT NULL DEFAULT false,
  version                     integer     NOT NULL DEFAULT 1,
  occurred_at                 timestamptz NOT NULL DEFAULT now(),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scenes ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- SALIDA PÚBLICA DEL MOTOR (lectura client-side)
-- -----------------------------------------------------------------------------

CREATE TABLE public.scene_outputs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id            uuid        NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  user_id             uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Modo y riesgo calculados por el motor
  mode                public.mode_type NOT NULL,
  risk_level          public.risk_level NOT NULL,
  confidence          numeric(3,2) NOT NULL DEFAULT 0.00 CHECK (confidence BETWEEN 0.00 AND 1.00),
  -- Los 7 bloques de la lectura estructurada
  observable_text     text,       -- Bloque 1: Lo que sí veo
  probable_text       text,       -- Bloque 2: Lo que probablemente pasa
  not_proven_text     text,       -- Bloque 3: Lo que no está probado
  user_part_text      text,       -- Bloque 4: Lo que tú estás poniendo en juego
  friction_text       text,       -- Bloque 5: La fricción aquí (confrontación)
  movement_text       text,       -- Bloque 6: Lo más útil ahora
  limit_text          text,       -- Bloque 7: Lo que no voy a hacer (NUNCA vacío)
  -- Movimiento
  avoid_now_text      text,
  suggested_phrase    text,
  -- Ensamblado final
  final_text          text        NOT NULL,
  -- Control de compartido
  share_eligible      boolean     NOT NULL DEFAULT false,
  last_inference_run_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scene_id)               -- Una sola salida vigente por escena
);

ALTER TABLE public.scene_outputs ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- HECHOS Y SEÑALES DE ESCENA
-- -----------------------------------------------------------------------------

CREATE TABLE public.scene_facts (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id    uuid    NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  user_id     uuid    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  fact_text   text    NOT NULL,
  fact_type   text    NOT NULL CHECK (fact_type IN ('observable', 'quote_user', 'quote_other', 'behavioral', 'contextual')),
  source      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scene_facts ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------

CREATE TABLE public.scene_signals (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id        uuid    NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  user_id         uuid    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  signal_type     text    NOT NULL CHECK (signal_type IN ('emotion', 'action', 'meaning', 'literal_phrase', 'ambiguity', 'missing_data', 'memory_link', 'body_sensation')),
  signal_text     text    NOT NULL,
  intensity       numeric(3,2) CHECK (intensity BETWEEN 0.00 AND 1.00),
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scene_signals ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------

CREATE TABLE public.scene_attachments (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id        uuid    NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  user_id         uuid    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bucket_name     text    NOT NULL,
  object_path     text    NOT NULL,
  mime_type       text    NOT NULL,
  attachment_type text    NOT NULL CHECK (attachment_type IN ('audio', 'image', 'document')),
  file_size_bytes bigint,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scene_attachments ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- SEGURIDAD Y FLAGS
-- -----------------------------------------------------------------------------

CREATE TABLE public.safety_flags (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  dossier_id      uuid        REFERENCES public.dossiers(id) ON DELETE SET NULL,
  scene_id        uuid        REFERENCES public.scenes(id) ON DELETE SET NULL,
  risk_level      public.risk_level NOT NULL,
  risk_types      text[]      NOT NULL DEFAULT '{}',
  active          boolean     NOT NULL DEFAULT true,
  notes           text,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.safety_flags ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------

CREATE TABLE public.safety_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  safety_flag_id  uuid        REFERENCES public.safety_flags(id) ON DELETE SET NULL,
  event_type      text        NOT NULL,
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.safety_events ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- PATRONES E INTERVENCIONES
-- -----------------------------------------------------------------------------

CREATE TABLE public.patterns (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id      uuid        NOT NULL REFERENCES public.dossiers(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pattern_family  text        NOT NULL,
  pattern_name    text        NOT NULL,
  status          public.pattern_status NOT NULL DEFAULT 'candidate',
  confidence      numeric(3,2) NOT NULL DEFAULT 0.00 CHECK (confidence BETWEEN 0.00 AND 1.00),
  evidence_count  smallint    NOT NULL DEFAULT 0,
  -- safe_summary: visible al usuario en la UI
  -- blocked_summary: NUNCA expuesto al cliente, solo para uso interno del motor
  safe_summary    text,
  blocked_summary text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.patterns ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------

CREATE TABLE public.pattern_evidence (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id      uuid        NOT NULL REFERENCES public.patterns(id) ON DELETE CASCADE,
  scene_id        uuid        NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  weight          numeric(3,2) NOT NULL DEFAULT 1.00 CHECK (weight BETWEEN 0.00 AND 1.00),
  rationale       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pattern_id, scene_id)
);

ALTER TABLE public.pattern_evidence ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------

CREATE TABLE public.interventions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id            uuid        NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  dossier_id          uuid        NOT NULL REFERENCES public.dossiers(id) ON DELETE CASCADE,
  user_id             uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  internal_move       text,
  external_move       text,
  suggested_phrase    text,
  avoid_now           text[]      NOT NULL DEFAULT '{}',
  followup_signal_watch text[]    NOT NULL DEFAULT '{}',
  status              public.intervention_status NOT NULL DEFAULT 'suggested',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.interventions ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------

CREATE TABLE public.intervention_outcomes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_id     uuid        NOT NULL REFERENCES public.interventions(id) ON DELETE CASCADE,
  user_id             uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_action_taken   text,
  observed_outcome    text,
  clarity_score       smallint    CHECK (clarity_score BETWEEN 1 AND 5),
  activation_score    smallint    CHECK (activation_score BETWEEN 1 AND 5),
  connection_score    smallint    CHECK (connection_score BETWEEN 1 AND 5),
  safety_score        smallint    CHECK (safety_score BETWEEN 1 AND 5),
  intervention_effect text        CHECK (intervention_effect IN ('positive', 'neutral', 'negative', 'unclear')),
  client_request_id   text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.intervention_outcomes ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- TABLAS INTERNAS DEL MOTOR (app_private)
-- El cliente NUNCA accede a estas tablas por ningún método
-- =============================================================================

-- -----------------------------------------------------------------------------
-- CORRIDAS DE INFERENCIA (trazabilidad completa del motor)
-- -----------------------------------------------------------------------------

CREATE TABLE app_private.inference_runs (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid        NOT NULL,
  dossier_id                  uuid        NOT NULL,
  scene_id                    uuid        NOT NULL,
  job_id                      uuid,
  -- Payloads de cada módulo del pipeline
  risk_payload                jsonb,      -- Módulo A: Router de Seguridad
  normalized_scene_payload    jsonb,      -- Módulo B: Normalizador
  dossier_context_payload     jsonb,      -- Módulo C: Lector de Expediente
  reading_payload             jsonb,      -- Módulo D: Motor de Lectura
  confrontation_payload       jsonb,      -- Módulo E: Motor de Confrontación
  movement_payload            jsonb,      -- Módulo F: Motor de Movimiento
  assembly_payload            jsonb,      -- Módulo G: Ensamblador
  final_text                  text,
  -- Versiones de modelos usados
  model_versions              jsonb,
  -- Resultado del pipeline
  success                     boolean,
  error_phase                 text,
  error_code                  text,
  error_message               text,
  duration_ms                 integer,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

-- Sin RLS — schema privado. Acceso solo vía service_role en Edge Functions internas.

-- -----------------------------------------------------------------------------

CREATE TABLE app_private.policy_decisions (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  inference_run_id            uuid        NOT NULL REFERENCES app_private.inference_runs(id) ON DELETE CASCADE,
  scene_id                    uuid        NOT NULL,
  -- Variables calculadas del Policy Engine
  activation_level            numeric(3,2),
  evidence_density            numeric(3,2),
  recurrence_level            numeric(3,2),
  distortion_level            numeric(3,2),
  externalization_level       numeric(3,2),
  confrontation_eligibility   numeric(4,3), -- fórmula compuesta
  required_mode               text,
  allow_relational_inference  boolean,
  allow_confrontation         boolean,
  confrontation_level         smallint,
  risk_level                  text,
  risk_types                  text[],
  created_at                  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------

CREATE TABLE app_private.prompt_snapshots (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  inference_run_id uuid       REFERENCES app_private.inference_runs(id) ON DELETE CASCADE,
  module_name     text        NOT NULL,   -- A, B, C, D, E, F, G, H
  prompt_version  text        NOT NULL,
  prompt_text     text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Retención: 90 días — se gestiona con un cleanup job

-- -----------------------------------------------------------------------------

CREATE TABLE app_private.response_assemblies (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  inference_run_id    uuid        NOT NULL REFERENCES app_private.inference_runs(id) ON DELETE CASCADE,
  scene_id            uuid        NOT NULL,
  block_1_observable  text,
  block_2_probable    text,
  block_3_not_proven  text,
  block_4_user_part   text,
  block_5_friction    text,
  block_6_movement    text,
  block_7_limit       text,
  assembly_notes      text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------

CREATE TABLE app_private.safety_triage_runs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  inference_run_id    uuid        NOT NULL REFERENCES app_private.inference_runs(id) ON DELETE CASCADE,
  scene_id            uuid        NOT NULL,
  user_id             uuid        NOT NULL,
  risk_level          text        NOT NULL,
  risk_types          text[]      NOT NULL DEFAULT '{}',
  signals_detected    jsonb,
  decision_rationale  text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
