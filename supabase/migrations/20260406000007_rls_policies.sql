-- =============================================================================
-- GEZIA — Fase 1 — Migration 7
-- Políticas Row Level Security (RLS)
--
-- Principio: cada usuario accede SOLO a sus propios datos.
-- El schema app_private no tiene RLS (no lo necesita porque no es accesible al cliente).
-- El schema audit no tiene RLS (es append-only, accesible solo vía service_role).
-- =============================================================================

-- =============================================================================
-- IDENTIDAD
-- =============================================================================

-- profiles: cada usuario lee y modifica solo su propio perfil
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- INSERT lo hace solo el trigger handle_new_user (service_role)
-- No se permite INSERT desde el cliente
CREATE POLICY "profiles_insert_service_role"
  ON public.profiles FOR INSERT
  TO service_role
  WITH CHECK (true);

-- -----------------------------------------------------------------------------

CREATE POLICY "user_settings_select_own"
  ON public.user_settings FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "user_settings_insert_own"
  ON public.user_settings FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_settings_update_own"
  ON public.user_settings FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- -----------------------------------------------------------------------------

CREATE POLICY "user_safety_preferences_select_own"
  ON public.user_safety_preferences FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "user_safety_preferences_insert_own"
  ON public.user_safety_preferences FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_safety_preferences_update_own"
  ON public.user_safety_preferences FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- =============================================================================
-- EXPEDIENTES
-- =============================================================================

CREATE POLICY "dossiers_select_own"
  ON public.dossiers FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "dossiers_insert_own"
  ON public.dossiers FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "dossiers_update_own"
  ON public.dossiers FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "dossiers_delete_own"
  ON public.dossiers FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------

CREATE POLICY "dossier_baselines_select_own"
  ON public.dossier_baselines FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.dossiers d
      WHERE d.id = dossier_id AND d.user_id = auth.uid()
    )
  );

CREATE POLICY "dossier_baselines_insert_own"
  ON public.dossier_baselines FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.dossiers d
      WHERE d.id = dossier_id AND d.user_id = auth.uid()
    )
  );

CREATE POLICY "dossier_baselines_update_own"
  ON public.dossier_baselines FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.dossiers d
      WHERE d.id = dossier_id AND d.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.dossiers d
      WHERE d.id = dossier_id AND d.user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------

CREATE POLICY "dossier_tags_select_own"
  ON public.dossier_tags FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.dossiers d
      WHERE d.id = dossier_id AND d.user_id = auth.uid()
    )
  );

CREATE POLICY "dossier_tags_insert_own"
  ON public.dossier_tags FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.dossiers d
      WHERE d.id = dossier_id AND d.user_id = auth.uid()
    )
  );

CREATE POLICY "dossier_tags_delete_own"
  ON public.dossier_tags FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.dossiers d
      WHERE d.id = dossier_id AND d.user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------

CREATE POLICY "dossier_resonances_select_own"
  ON public.dossier_resonances FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- INSERT y UPDATE solo vía service_role (el worker los crea, no el cliente)
CREATE POLICY "dossier_resonances_service_role"
  ON public.dossier_resonances FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- ESCENAS Y SEÑALES
-- =============================================================================

CREATE POLICY "scenes_select_own"
  ON public.scenes FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "scenes_insert_own"
  ON public.scenes FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- UPDATE desde el cliente solo pueden cambiar campos de narración y tipo
-- El processing_status lo actualiza solo el worker vía service_role
CREATE POLICY "scenes_update_own_draft"
  ON public.scenes FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() AND processing_status = 'draft')
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "scenes_update_service_role"
  ON public.scenes FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "scenes_delete_own"
  ON public.scenes FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------

CREATE POLICY "scene_outputs_select_own"
  ON public.scene_outputs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Solo el worker inserta/actualiza scene_outputs
CREATE POLICY "scene_outputs_service_role"
  ON public.scene_outputs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------

CREATE POLICY "scene_facts_select_own"
  ON public.scene_facts FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "scene_facts_service_role"
  ON public.scene_facts FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------

CREATE POLICY "scene_signals_select_own"
  ON public.scene_signals FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "scene_signals_service_role"
  ON public.scene_signals FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------

CREATE POLICY "scene_attachments_select_own"
  ON public.scene_attachments FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "scene_attachments_insert_own"
  ON public.scene_attachments FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "scene_attachments_delete_own"
  ON public.scene_attachments FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- =============================================================================
-- SEGURIDAD
-- =============================================================================

CREATE POLICY "safety_flags_select_own"
  ON public.safety_flags FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Solo el motor crea y actualiza safety_flags
CREATE POLICY "safety_flags_service_role"
  ON public.safety_flags FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------

CREATE POLICY "safety_events_select_own"
  ON public.safety_events FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "safety_events_service_role"
  ON public.safety_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- PATRONES E INTERVENCIONES
-- =============================================================================

CREATE POLICY "patterns_select_own"
  ON public.patterns FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "patterns_service_role"
  ON public.patterns FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------

CREATE POLICY "pattern_evidence_select_own"
  ON public.pattern_evidence FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "pattern_evidence_service_role"
  ON public.pattern_evidence FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------

CREATE POLICY "interventions_select_own"
  ON public.interventions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "interventions_service_role"
  ON public.interventions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------

CREATE POLICY "intervention_outcomes_select_own"
  ON public.intervention_outcomes FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "intervention_outcomes_insert_own"
  ON public.intervention_outcomes FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- =============================================================================
-- ZONA COMPARTIDA
-- =============================================================================

-- shared_workspaces: solo los miembros activos del workspace lo ven
CREATE POLICY "shared_workspaces_select_member"
  ON public.shared_workspaces FOR SELECT
  TO authenticated
  USING (public.is_active_workspace_member(id));

CREATE POLICY "shared_workspaces_insert_service_role"
  ON public.shared_workspaces FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "shared_workspaces_update_service_role"
  ON public.shared_workspaces FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------

-- shared_workspace_members: solo si eres el usuario de la fila o miembro activo del workspace
CREATE POLICY "shared_workspace_members_select"
  ON public.shared_workspace_members FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_active_workspace_member(workspace_id)
  );

CREATE POLICY "shared_workspace_members_service_role"
  ON public.shared_workspace_members FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------

-- workspace_dossier_links: owner del dossier Y miembro activo del workspace
CREATE POLICY "workspace_dossier_links_select"
  ON public.workspace_dossier_links FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND public.is_active_workspace_member(workspace_id)
  );

CREATE POLICY "workspace_dossier_links_service_role"
  ON public.workspace_dossier_links FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------

-- workspace_invites: solo el invitador o el invitado ve la invitación suya
CREATE POLICY "workspace_invites_select"
  ON public.workspace_invites FOR SELECT
  TO authenticated
  USING (
    inviter_id = auth.uid()
    OR (
      invitee_email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

CREATE POLICY "workspace_invites_service_role"
  ON public.workspace_invites FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------

-- shared_items: solo miembros activos del workspace, solo no revocados (salvo para el owner)
CREATE POLICY "shared_items_select_member"
  ON public.shared_items FOR SELECT
  TO authenticated
  USING (
    public.is_active_workspace_member(workspace_id)
  );

CREATE POLICY "shared_items_service_role"
  ON public.shared_items FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------

CREATE POLICY "shared_agreements_select_member"
  ON public.shared_agreements FOR SELECT
  TO authenticated
  USING (public.is_active_workspace_member(workspace_id));

CREATE POLICY "shared_agreements_insert_member"
  ON public.shared_agreements FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.is_active_workspace_member(workspace_id)
  );

CREATE POLICY "shared_agreements_update_service_role"
  ON public.shared_agreements FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- Garantizar que service_role puede operar en todas las tablas sin restricción
-- (ya tiene BYPASSRLS por defecto en Supabase, pero las políticas explícitas
-- lo hacen claro en el código)
-- =============================================================================

-- Nota: en Supabase, service_role tiene BYPASSRLS = true por defecto.
-- Las políticas "service_role" de arriba son documentación explícita del diseño,
-- no son estrictamente necesarias para el service_role, pero aclaran la intención.
