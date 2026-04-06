-- =============================================================================
-- GEZIA — Fase 1 — Migration 6
-- Funciones helper y triggers
--
-- - set_updated_at()       → trigger en todas las tablas con updated_at
-- - handle_new_user()      → crea profile al signup; security definer
-- - is_active_workspace_member() → helper para políticas RLS de workspace
-- - on_auth_user_created   → trigger que invoca handle_new_user
-- =============================================================================

-- -----------------------------------------------------------------------------
-- set_updated_at()
-- Actualiza el campo updated_at al valor actual de now() en cada UPDATE.
-- Se aplica como trigger a todas las tablas que tienen ese campo.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Aplicar trigger a todas las tablas con updated_at en public
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_user_safety_preferences_updated_at
  BEFORE UPDATE ON public.user_safety_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_dossiers_updated_at
  BEFORE UPDATE ON public.dossiers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_dossier_baselines_updated_at
  BEFORE UPDATE ON public.dossier_baselines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_dossier_resonances_updated_at
  BEFORE UPDATE ON public.dossier_resonances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_scenes_updated_at
  BEFORE UPDATE ON public.scenes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_scene_outputs_updated_at
  BEFORE UPDATE ON public.scene_outputs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_safety_flags_updated_at
  BEFORE UPDATE ON public.safety_flags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_patterns_updated_at
  BEFORE UPDATE ON public.patterns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_interventions_updated_at
  BEFORE UPDATE ON public.interventions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_shared_workspaces_updated_at
  BEFORE UPDATE ON public.shared_workspaces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_shared_workspace_members_updated_at
  BEFORE UPDATE ON public.shared_workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_shared_items_updated_at
  BEFORE UPDATE ON public.shared_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_shared_agreements_updated_at
  BEFORE UPDATE ON public.shared_agreements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_job_queue_updated_at
  BEFORE UPDATE ON app_private.job_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- handle_new_user()
-- Se ejecuta tras la creación de un nuevo usuario en auth.users.
-- Crea el registro en public.profiles, user_settings y user_safety_preferences.
-- Es idempotente: usa INSERT ... ON CONFLICT DO NOTHING para seguridad.
-- SECURITY DEFINER + search_path = '' para no exponer schemas privados.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, primary_language)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'primary_language', 'es-MX')
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_safety_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- El trigger no debe bloquear el signup bajo ninguna circunstancia.
    -- El Edge Function bootstrap-user actúa como segunda línea de defensa.
    RAISE WARNING 'handle_new_user failed for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- Trigger que invoca handle_new_user tras cada nuevo registro en auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- is_active_workspace_member(p_workspace_id uuid)
-- Helper para políticas RLS del workspace.
-- Retorna true si el usuario autenticado es miembro activo con consent aceptado.
-- SECURITY DEFINER para poder consultar la tabla sin loop de RLS.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_active_workspace_member(p_workspace_id uuid)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shared_workspace_members swm
    JOIN public.shared_workspaces sw ON sw.id = swm.workspace_id
    WHERE swm.workspace_id   = p_workspace_id
      AND swm.user_id        = auth.uid()
      AND swm.consent_status = 'accepted'
      AND sw.status          = 'active'
  );
$$;

-- Expresamente revocar ejecución de esta función a anon y public
-- Solo puede llamarse por service_role y por auth.uid() dentro de políticas RLS
REVOKE ALL ON FUNCTION public.is_active_workspace_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_workspace_member(uuid) TO authenticated;
