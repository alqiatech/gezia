-- =============================================================================
-- GEZIA — seed.sql
-- Configuración inicial del entorno: buckets de Storage
--
-- IMPORTANTE: Este archivo se ejecuta UNA SOLA VEZ después de las migrations,
-- en entorno local y en producción antes de la primera sesión de usuario.
-- No contiene datos de usuario — solo configuración del sistema.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Buckets de Storage privados
-- public = false → no acceso público; signed URLs obligatorias para todo acceso
-- file_size_limit en bytes: 50 MB para audio/imágenes, 10 MB para documentos
-- -----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'scene-audio-private',
    'scene-audio-private',
    false,
    52428800,   -- 50 MB
    ARRAY['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/m4a']
  ),
  (
    'scene-images-private',
    'scene-images-private',
    false,
    52428800,   -- 50 MB
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
  ),
  (
    'secure-docs-private',
    'secure-docs-private',
    false,
    10485760,   -- 10 MB
    ARRAY['application/pdf', 'text/plain']
  )
ON CONFLICT (id) DO NOTHING;
