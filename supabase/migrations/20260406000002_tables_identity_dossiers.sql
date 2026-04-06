-- =============================================================================
-- GEZIA — Fase 1 — Migration 2
-- Tablas de identidad y expedientes
-- public.profiles, user_settings, user_safety_preferences,
-- dossiers, dossier_baselines, dossier_tags, dossier_resonances
-- =============================================================================

-- -----------------------------------------------------------------------------
-- IDENTIDAD Y ACCESO
-- -----------------------------------------------------------------------------

CREATE TABLE public.profiles (
  id                      uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name            text        NOT NULL DEFAULT '',
  birth_year              smallint    CHECK (birth_year >= 1900 AND birth_year <= 2099),
  primary_language        text        NOT NULL DEFAULT 'es-MX',
  country_code            text,
  timezone                text,
  onboarding_status       text        NOT NULL DEFAULT 'pending'
                                      CHECK (onboarding_status IN ('pending', 'in_progress', 'completed')),
  confrontation_style     text        CHECK (confrontation_style IN ('direct', 'gradual', 'clarity_first')),
  safety_notice_accepted  boolean     NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------

CREATE TABLE public.user_settings (
  user_id                 uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  theme                   text        NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  haptics_enabled         boolean     NOT NULL DEFAULT true,
  sound_enabled           boolean     NOT NULL DEFAULT false,
  notification_scene_ready boolean    NOT NULL DEFAULT true,
  notification_pattern    boolean     NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------

CREATE TABLE public.user_safety_preferences (
  user_id                         uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Consentimientos granulares del onboarding
  sexual_layer_enabled            boolean     NOT NULL DEFAULT false,
  shared_workspace_enabled        boolean     NOT NULL DEFAULT false,
  voice_input_enabled             boolean     NOT NULL DEFAULT false,
  cross_dossier_resonances_enabled boolean    NOT NULL DEFAULT false,
  relational_memory_enabled       boolean     NOT NULL DEFAULT true,
  -- Tipos de vínculos seleccionados en onboarding
  selected_dossier_types          public.dossier_type[] NOT NULL DEFAULT '{}',
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_safety_preferences ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- EXPEDIENTES (DOSSIERS)
-- -----------------------------------------------------------------------------

CREATE TABLE public.dossiers (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title                   text        NOT NULL CHECK (char_length(title) >= 1 AND char_length(title) <= 120),
  dossier_type            public.dossier_type NOT NULL,
  dossier_status          public.dossier_status NOT NULL DEFAULT 'active',
  counterparty_label      text,                   -- nombre o alias del otro
  closeness_level         smallint    NOT NULL DEFAULT 3 CHECK (closeness_level BETWEEN 1 AND 5),
  emotional_importance    smallint    NOT NULL DEFAULT 3 CHECK (emotional_importance BETWEEN 1 AND 5),
  power_asymmetry         smallint    NOT NULL DEFAULT 0 CHECK (power_asymmetry BETWEEN -2 AND 2),
  sexual_layer_enabled    boolean     NOT NULL DEFAULT false,
  shared_workspace_enabled boolean    NOT NULL DEFAULT false,
  archived                boolean     NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dossiers ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------

CREATE TABLE public.dossier_baselines (
  dossier_id              uuid        PRIMARY KEY REFERENCES public.dossiers(id) ON DELETE CASCADE,
  lived_summary           text,
  main_triggers           text[]      NOT NULL DEFAULT '{}',
  core_fears              text[]      NOT NULL DEFAULT '{}',
  core_needs              text[]      NOT NULL DEFAULT '{}',
  typical_user_sequence   text[]      NOT NULL DEFAULT '{}',
  typical_other_sequence  text[]      NOT NULL DEFAULT '{}',
  things_that_help        text[]      NOT NULL DEFAULT '{}',
  things_that_worsen      text[]      NOT NULL DEFAULT '{}',
  sensitive_topics        text[]      NOT NULL DEFAULT '{}',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dossier_baselines ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------

CREATE TABLE public.dossier_tags (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id  uuid    NOT NULL REFERENCES public.dossiers(id) ON DELETE CASCADE,
  tag         text    NOT NULL CHECK (char_length(tag) >= 1 AND char_length(tag) <= 60),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dossier_id, tag)
);

ALTER TABLE public.dossier_tags ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------

CREATE TABLE public.dossier_resonances (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_dossier_id   uuid        NOT NULL REFERENCES public.dossiers(id) ON DELETE CASCADE,
  target_dossier_id   uuid        NOT NULL REFERENCES public.dossiers(id) ON DELETE CASCADE,
  pattern_name        text        NOT NULL,
  structural_similarity text      NOT NULL,   -- descripción de qué se repite y cómo
  confidence          numeric(3,2) NOT NULL DEFAULT 0.00 CHECK (confidence BETWEEN 0.00 AND 1.00),
  evidence_count      smallint    NOT NULL DEFAULT 0,
  active              boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- Un vínculo de resonancia es único entre dos expedientes para el mismo patrón
  UNIQUE (user_id, source_dossier_id, target_dossier_id, pattern_name),
  CHECK (source_dossier_id <> target_dossier_id)
);

ALTER TABLE public.dossier_resonances ENABLE ROW LEVEL SECURITY;
