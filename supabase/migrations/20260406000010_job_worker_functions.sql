-- =============================================================================
-- GEZIA — Fase 4 — Migration 10
-- Funciones de trabajo para el pipeline de inferencia asíncrona
-- =============================================================================

-- -----------------------------------------------------------------------------
-- claim_next_job()
-- Toma atómicamente el siguiente job pendiente usando FOR UPDATE SKIP LOCKED.
-- Retorna el job reclamado o ninguna fila si no hay jobs disponibles.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.claim_next_job(p_worker_id text)
RETURNS TABLE (
  id               uuid,
  job_type         text,
  payload          jsonb,
  attempt_count    int,
  max_attempts     int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  UPDATE app_private.job_queue jq
  SET
    status        = 'running',
    locked_at     = now(),
    locked_by     = p_worker_id,
    attempt_count = jq.attempt_count + 1,
    updated_at    = now()
  WHERE jq.id = (
    SELECT j.id
    FROM app_private.job_queue j
    WHERE j.status = 'pending'
      AND j.run_after <= now()
    ORDER BY j.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING
    jq.id,
    jq.job_type,
    jq.payload,
    jq.attempt_count,
    jq.max_attempts;
END;
$$;

REVOKE ALL ON FUNCTION app_private.claim_next_job(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.claim_next_job(text) TO service_role;

-- -----------------------------------------------------------------------------
-- fail_job()
-- Marca un job como fallido. Si hay reintentos disponibles, lo reencola con
-- backoff exponencial. Si no, lo marca como dead y la escena como failed_terminal.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.fail_job(
  p_job_id         uuid,
  p_scene_id       uuid,
  p_error_message  text,
  p_error_code     text DEFAULT 'PIPELINE_ERROR'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt_count int;
  v_max_attempts  int;
  v_backoff_interval interval;
BEGIN
  SELECT attempt_count, max_attempts
  INTO v_attempt_count, v_max_attempts
  FROM app_private.job_queue
  WHERE id = p_job_id;

  IF v_attempt_count < v_max_attempts THEN
    -- Backoff: 2^attempt minutos (2, 4, 8...)
    v_backoff_interval := (POWER(2, v_attempt_count) || ' minutes')::interval;

    UPDATE app_private.job_queue
    SET
      status     = 'pending',
      locked_at  = NULL,
      locked_by  = NULL,
      run_after  = now() + v_backoff_interval,
      last_error = p_error_message,
      updated_at = now()
    WHERE id = p_job_id;

    UPDATE public.scenes
    SET
      processing_status        = 'failed_retryable',
      processing_error_code    = p_error_code,
      processing_error_message = p_error_message,
      updated_at               = now()
    WHERE id = p_scene_id;
  ELSE
    UPDATE app_private.job_queue
    SET
      status     = 'dead',
      last_error = p_error_message,
      updated_at = now()
    WHERE id = p_job_id;

    UPDATE public.scenes
    SET
      processing_status        = 'failed_terminal',
      processing_error_code    = p_error_code,
      processing_error_message = p_error_message,
      processing_finished_at   = now(),
      updated_at               = now()
    WHERE id = p_scene_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION app_private.fail_job(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.fail_job(uuid, uuid, text, text) TO service_role;

-- -----------------------------------------------------------------------------
-- complete_job()
-- Marca un job como completado y la escena como ready.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.complete_job(
  p_job_id   uuid,
  p_scene_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE app_private.job_queue
  SET
    status     = 'completed',
    locked_at  = NULL,
    updated_at = now()
  WHERE id = p_job_id;

  UPDATE public.scenes
  SET
    processing_status      = 'ready',
    processing_finished_at = now(),
    processing_error_code  = NULL,
    processing_error_message = NULL,
    updated_at             = now()
  WHERE id = p_scene_id;

  INSERT INTO app_private.outbox_events (event_name, aggregate_type, aggregate_id, payload)
  VALUES (
    'scene.ready',
    'scene',
    p_scene_id,
    jsonb_build_object('scene_id', p_scene_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION app_private.complete_job(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.complete_job(uuid, uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- close_job_blocked_risk()
-- Cierre de pipeline por riesgo red/black.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.close_job_blocked_risk(
  p_job_id   uuid,
  p_scene_id uuid,
  p_risk_level text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE app_private.job_queue
  SET
    status     = 'completed',
    locked_at  = NULL,
    updated_at = now()
  WHERE id = p_job_id;

  UPDATE public.scenes
  SET
    processing_status      = 'blocked_risk',
    processing_finished_at = now(),
    locked_by_risk         = true,
    risk_level             = p_risk_level::public.risk_level,
    required_mode          = 'S0',
    updated_at             = now()
  WHERE id = p_scene_id;

  INSERT INTO app_private.outbox_events (event_name, aggregate_type, aggregate_id, payload)
  VALUES (
    'scene.blocked_risk',
    'scene',
    p_scene_id,
    jsonb_build_object('scene_id', p_scene_id, 'risk_level', p_risk_level)
  );
END;
$$;

REVOKE ALL ON FUNCTION app_private.close_job_blocked_risk(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.close_job_blocked_risk(uuid, uuid, text) TO service_role;
