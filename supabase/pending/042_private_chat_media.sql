-- PENDIENTE: mover a supabase/migrations/ solo cuando el código de URLs firmadas esté desplegado y probado.

-- ============================================================
-- chat-media PRIVADO (fotos y documentos de clientas)
-- ============================================================
-- APLICAR SOLO DESPUÉS de desplegar el código que resuelve URLs firmadas
-- (src/lib/storage/private-media.ts) y de probar fotos entrantes, adjuntos
-- salientes y cabeceras de plantillas con el bucket aún público.
--
-- Efecto: las URLs públicas permanentes dejan de funcionar. Quien ve un medio
-- es un miembro autenticado de la cuenta (política SELECT) o Meta, mediante
-- una URL firmada de 15 minutos generada en el servidor al enviar.
--
-- Rollback (si algo falla): UPDATE storage.buckets SET public = TRUE
-- WHERE id = 'chat-media'; y volver a crear la política pública de 023.

UPDATE storage.buckets SET public = FALSE WHERE id = 'chat-media';

-- La política pública de 023 permitía listar/leer cualquier objeto.
DROP POLICY IF EXISTS "Chat media is publicly readable" ON storage.objects;

-- Lectura: solo miembros de la cuenta dueña de la carpeta `account-<uuid>/…`.
DROP POLICY IF EXISTS "Members can read chat media" ON storage.objects;
CREATE POLICY "Members can read chat media"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- Escritura: exigir rol mínimo "agent" (antes cualquier miembro, incluido viewer).
DROP POLICY IF EXISTS "Members can upload chat media" ON storage.objects;
CREATE POLICY "Members can upload chat media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND public.is_account_member(p.account_id, 'agent')
    )
  );

DROP POLICY IF EXISTS "Members can update chat media" ON storage.objects;
CREATE POLICY "Members can update chat media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND public.is_account_member(p.account_id, 'agent')
    )
  );

DROP POLICY IF EXISTS "Members can delete chat media" ON storage.objects;
CREATE POLICY "Members can delete chat media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND public.is_account_member(p.account_id, 'agent')
    )
  );
