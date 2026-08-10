-- ============================================================
-- 3. RAW LAYER (immutable)
-- ============================================================

CREATE TYPE public.import_kind AS ENUM (
  'roster','mood_matrix','login_report','engagement_totals','recognition_counts','screenshot'
);
CREATE TYPE public.import_state AS ENUM ('uploaded','parsed','failed','superseded');

CREATE TABLE public.raw_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  period date NOT NULL,
  kind public.import_kind NOT NULL,
  original_filename text,
  storage_path text,
  content_sha256 text,
  row_count int,
  column_names text[],
  exported_at date,
  covers_from date,
  covers_to date,
  state public.import_state NOT NULL DEFAULT 'uploaded',
  parse_error text,
  supersedes uuid REFERENCES public.raw_imports(id),
  superseded_by uuid REFERENCES public.raw_imports(id),
  uploaded_by uuid REFERENCES auth.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

CREATE UNIQUE INDEX uq_raw_imports_identity
  ON public.raw_imports (client_id, period, kind, content_sha256);
CREATE INDEX idx_raw_imports_client_period ON public.raw_imports (client_id, period);

CREATE TABLE public.raw_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.raw_imports(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id),
  period date NOT NULL,
  row_number int,
  payload jsonb NOT NULL,
  name_raw text,
  email_raw text,
  normalized_email text GENERATED ALWAYS AS (nullif(lower(btrim(email_raw)), '')) STORED,
  employee_id_raw text,
  title_raw text,
  department_raw text,
  status_raw text,
  user_type_raw text,
  hire_date_raw text,
  hire_date date NULL,
  created_raw text,
  created_at_src date,
  modified_raw text,
  modified_at_src date,
  last_login_raw text,
  last_login_at timestamptz,
  parse_flags text[] NOT NULL DEFAULT '{}',
  inserted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, row_number)
);

CREATE INDEX idx_raw_records_normalized_email ON public.raw_records (normalized_email);
CREATE INDEX idx_raw_records_period ON public.raw_records (period);
CREATE INDEX idx_raw_records_payload_gin ON public.raw_records USING gin (payload);
CREATE INDEX idx_raw_records_client_period ON public.raw_records (client_id, period);

-- ---------- guard: raw_imports may only change state/parse_error/superseded_by ----------

CREATE OR REPLACE FUNCTION public.guard_raw_import_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.period IS DISTINCT FROM OLD.period
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
     OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
     OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
     OR NEW.row_count IS DISTINCT FROM OLD.row_count
     OR NEW.column_names IS DISTINCT FROM OLD.column_names
     OR NEW.exported_at IS DISTINCT FROM OLD.exported_at
     OR NEW.covers_from IS DISTINCT FROM OLD.covers_from
     OR NEW.covers_to IS DISTINCT FROM OLD.covers_to
     OR NEW.supersedes IS DISTINCT FROM OLD.supersedes
     OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
     OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at
  THEN
    RAISE EXCEPTION 'raw_imports is immutable except state, parse_error, superseded_by and notes; upload a superseding import instead';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_raw_import_update
  BEFORE UPDATE ON public.raw_imports
  FOR EACH ROW EXECUTE FUNCTION public.guard_raw_import_update();

-- ---------- grants: note the absent DELETE ----------

GRANT SELECT, INSERT, UPDATE ON public.raw_imports TO authenticated;
GRANT SELECT, INSERT ON public.raw_records TO authenticated;
GRANT ALL ON public.raw_imports TO service_role;
GRANT ALL ON public.raw_records TO service_role;
REVOKE DELETE ON public.raw_imports FROM authenticated;
REVOKE DELETE, UPDATE ON public.raw_records FROM authenticated;

ALTER TABLE public.raw_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_records ENABLE ROW LEVEL SECURITY;

-- ---------- policies (no DELETE policy exists anywhere here) ----------

CREATE POLICY "raw_imports_select_scoped" ON public.raw_imports
  FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "raw_imports_insert_writers" ON public.raw_imports
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_client(auth.uid(), client_id));

CREATE POLICY "raw_imports_update_writers" ON public.raw_imports
  FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));

CREATE POLICY "raw_records_select_scoped" ON public.raw_records
  FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "raw_records_insert_writers" ON public.raw_records
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_client(auth.uid(), client_id));