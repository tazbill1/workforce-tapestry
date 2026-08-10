-- 1. Relax raw_imports guard for parse-discovered fields
CREATE OR REPLACE FUNCTION public.guard_raw_import_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.period IS DISTINCT FROM OLD.period
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
     OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
     OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
     OR NEW.exported_at IS DISTINCT FROM OLD.exported_at
     OR NEW.supersedes IS DISTINCT FROM OLD.supersedes
     OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
     OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at
  THEN
    RAISE EXCEPTION 'raw_imports is immutable except state, parse_error, superseded_by, notes and the parse-discovered fields; upload a superseding import instead';
  END IF;

  -- Parse-discovered fields: NULL -> value once, never value -> other value.
  IF OLD.row_count IS NOT NULL AND NEW.row_count IS DISTINCT FROM OLD.row_count THEN
    RAISE EXCEPTION 'row_count may only be set once (NULL -> value)';
  END IF;
  IF OLD.column_names IS NOT NULL AND NEW.column_names IS DISTINCT FROM OLD.column_names THEN
    RAISE EXCEPTION 'column_names may only be set once (NULL -> value)';
  END IF;
  IF OLD.covers_from IS NOT NULL AND NEW.covers_from IS DISTINCT FROM OLD.covers_from THEN
    RAISE EXCEPTION 'covers_from may only be set once (NULL -> value)';
  END IF;
  IF OLD.covers_to IS NOT NULL AND NEW.covers_to IS DISTINCT FROM OLD.covers_to THEN
    RAISE EXCEPTION 'covers_to may only be set once (NULL -> value)';
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Unique constraints on manual-entry tables
ALTER TABLE public.engagement_totals
  ADD CONSTRAINT engagement_totals_client_period_key UNIQUE (client_id, period);
ALTER TABLE public.recognition_counts
  ADD CONSTRAINT recognition_counts_client_period_dept_key UNIQUE (client_id, period, department_raw);
ALTER TABLE public.action_plan_items
  ADD CONSTRAINT action_plan_items_client_period_position_key UNIQUE (client_id, period, position);

-- 4. content_sha256 required so the duplicate index actually bites
ALTER TABLE public.raw_imports
  ALTER COLUMN content_sha256 SET NOT NULL;

-- 2. Storage RLS: object path must be <client_id>/...
CREATE OR REPLACE FUNCTION public.storage_path_client_id(_name text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  first_segment text := split_part(_name, '/', 1);
BEGIN
  RETURN first_segment::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.storage_path_client_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_path_client_id(text) TO authenticated, service_role;

CREATE POLICY "raw imports readable by users with client access"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'raw-imports'
  AND public.has_client_access(auth.uid(), public.storage_path_client_id(name))
);

CREATE POLICY "raw imports insertable by client writers"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'raw-imports'
  AND public.can_write_client(auth.uid(), public.storage_path_client_id(name))
);

CREATE POLICY "raw imports updatable by client writers"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'raw-imports'
  AND public.can_write_client(auth.uid(), public.storage_path_client_id(name))
)
WITH CHECK (
  bucket_id = 'raw-imports'
  AND public.can_write_client(auth.uid(), public.storage_path_client_id(name))
);

CREATE POLICY "raw imports deletable by analysts"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'raw-imports'
  AND public.is_analyst(auth.uid())
);

-- 5. Bootstrap helper: promote an existing auth user to analyst by email.
CREATE OR REPLACE FUNCTION public.bootstrap_analyst(_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid;
BEGIN
  SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_email);
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'no auth user with email %', _email;
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (_uid, 'analyst')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN _uid;
END;
$function$;

REVOKE ALL ON FUNCTION public.bootstrap_analyst(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_analyst(text) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_analyst(text) TO service_role;