ALTER TYPE public.import_kind ADD VALUE IF NOT EXISTS 'recognition_points';

CREATE TABLE public.recognition_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  period date NOT NULL,
  import_id uuid NOT NULL REFERENCES public.raw_imports(id),
  row_number integer,
  manager_name text NOT NULL,
  manager_title text,
  department_raw text,
  points_allocated integer,
  points_given integer,
  parse_flags text[] NOT NULL DEFAULT '{}',
  inserted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recognition_points_nonnegative CHECK (
    (points_allocated IS NULL OR points_allocated >= 0)
    AND (points_given IS NULL OR points_given >= 0)
  )
);

GRANT SELECT, INSERT ON public.recognition_points TO authenticated;
GRANT ALL ON public.recognition_points TO service_role;

ALTER TABLE public.recognition_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recognition_points_select_scoped"
ON public.recognition_points FOR SELECT TO authenticated
USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "recognition_points_insert_scoped"
ON public.recognition_points FOR INSERT TO authenticated
WITH CHECK (public.can_write_client(auth.uid(), client_id));

CREATE INDEX recognition_points_client_period_idx
ON public.recognition_points (client_id, period);

CREATE INDEX recognition_points_import_idx
ON public.recognition_points (import_id);

CREATE UNIQUE INDEX recognition_points_import_row_unique
ON public.recognition_points (import_id, row_number);