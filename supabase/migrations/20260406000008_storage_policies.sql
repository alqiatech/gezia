-- =============================================================================
-- GEZIA — Fase 2 — Migration 8
-- Políticas de Storage para buckets privados
--
-- Buckets: scene-audio-private, scene-images-private, secure-docs-private
--
-- Convención de path obligatoria: {user_id}/{dossier_id}/{scene_id}/{filename}
-- El primer segmento del path DEBE ser el user_id del usuario autenticado.
-- Esta validación ocurre en el servidor antes de emitir cualquier signed URL.
--
-- NOTA: Los buckets se crean vía Supabase dashboard o vía seed.sql.
-- Las políticas de Storage se registran aquí para que queden versionadas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- El API de policies de storage usa la tabla storage.objects.
-- Cada política valida que el primer segmento del path sea el uid del usuario.
-- -----------------------------------------------------------------------------

-- SCENE AUDIO — INSERT
CREATE POLICY "storage_scene_audio_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'scene-audio-private'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- SCENE AUDIO — SELECT (lectura de propios adjuntos)
CREATE POLICY "storage_scene_audio_select_own"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'scene-audio-private'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- SCENE AUDIO — UPDATE
CREATE POLICY "storage_scene_audio_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'scene-audio-private'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'scene-audio-private'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- SCENE AUDIO — DELETE
CREATE POLICY "storage_scene_audio_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'scene-audio-private'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- -----------------------------------------------------------------------------

-- SCENE IMAGES — INSERT
CREATE POLICY "storage_scene_images_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'scene-images-private'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- SCENE IMAGES — SELECT
CREATE POLICY "storage_scene_images_select_own"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'scene-images-private'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- SCENE IMAGES — UPDATE
CREATE POLICY "storage_scene_images_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'scene-images-private'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'scene-images-private'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- SCENE IMAGES — DELETE
CREATE POLICY "storage_scene_images_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'scene-images-private'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- -----------------------------------------------------------------------------

-- SECURE DOCS — INSERT
CREATE POLICY "storage_secure_docs_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'secure-docs-private'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- SECURE DOCS — SELECT
CREATE POLICY "storage_secure_docs_select_own"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'secure-docs-private'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- SECURE DOCS — UPDATE
CREATE POLICY "storage_secure_docs_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'secure-docs-private'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'secure-docs-private'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- SECURE DOCS — DELETE
CREATE POLICY "storage_secure_docs_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'secure-docs-private'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
