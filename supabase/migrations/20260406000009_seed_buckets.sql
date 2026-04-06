-- =============================================================================
-- GEZIA — Fase 2 — Migration 9
-- Buckets de Storage privados (seed promovido a migration)
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'scene-audio-private',
    'scene-audio-private',
    false,
    52428800,
    ARRAY['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/m4a']
  ),
  (
    'scene-images-private',
    'scene-images-private',
    false,
    52428800,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
  ),
  (
    'secure-docs-private',
    'secure-docs-private',
    false,
    10485760,
    ARRAY['application/pdf', 'text/plain']
  )
ON CONFLICT (id) DO NOTHING;
