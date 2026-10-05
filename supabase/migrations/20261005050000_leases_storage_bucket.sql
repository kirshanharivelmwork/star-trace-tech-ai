-- Private `leases` Storage bucket with org-scoped object policies.
--
-- Object names MUST be `<organization_id>/<anything>.pdf`
-- (components/dashboard/lease-uploader.tsx builds the path that way).
-- Objects uploaded before this migration were stored at the bucket root
-- (`<uuid>-<file name>`); they match no policy below, so they are no longer
-- reachable by browser clients (the service role still can). Nothing in the
-- app reads them back today.
--
-- Run as the `postgres` role (SQL editor). Safe to re-run.

-- Private bucket, PDFs only, 10 MB hard cap at the storage layer.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('leases', 'leases', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- First path segment as a uuid, or NULL if it isn't one (a bare cast would
-- raise for odd object names and break unrelated queries).
CREATE OR REPLACE FUNCTION public.storage_object_org_id(p_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN (storage.foldername(p_name))[1]
         ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN ((storage.foldername(p_name))[1])::uuid
  END;
$$;

GRANT EXECUTE ON FUNCTION public.storage_object_org_id(text) TO authenticated;

-- Remove any earlier policy that mentions this bucket (names unknown; the
-- bucket's original policies are not in version control).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        coalesce(qual, '') ILIKE '%leases%'
        OR coalesce(with_check, '') ILIKE '%leases%'
        OR policyname LIKE 'leases\_objects\_%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

CREATE POLICY leases_objects_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'leases'
    AND public.is_org_member(public.storage_object_org_id(name))
  );

CREATE POLICY leases_objects_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'leases'
    AND public.can_write_org(public.storage_object_org_id(name))
  );

-- No UPDATE / DELETE policy: lease PDFs are immutable from the browser.
