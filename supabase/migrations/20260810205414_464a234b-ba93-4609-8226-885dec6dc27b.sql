CREATE TABLE public.person_period (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period date NOT NULL,
  normalized_email text NOT NULL,
  name text,
  employee_id_raw text,
  title_raw text,
  department_raw text,
  franchise_label text,
  function_label text,
  role_code text REFERENCES public.canonical_roles(code),
  status text,
  hire_date date,
  departure_date_proxy date,
  tenure_years numeric,
  is_excluded boolean NOT NULL DEFAULT false,
  exclusion_reason text,
  merged_from text[] NOT NULL DEFAULT '{}',
  checkin_count integer,
  mood_avg numeric,
  checked_in boolean,
  last_login_at timestamptz,
  flags text[] NOT NULL DEFAULT '{}',
  built_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, period, normalized_email)
);

CREATE INDEX idx_person_period_client_period ON public.person_period (client_id, period);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.person_period TO authenticated;
GRANT ALL ON public.person_period TO service_role;

ALTER TABLE public.person_period ENABLE ROW LEVEL SECURITY;

CREATE POLICY "person_period select scoped"
  ON public.person_period FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "person_period insert scoped"
  ON public.person_period FOR INSERT TO authenticated
  WITH CHECK (public.can_write_client(auth.uid(), client_id));

CREATE POLICY "person_period update scoped"
  ON public.person_period FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));

CREATE POLICY "person_period delete scoped"
  ON public.person_period FOR DELETE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id));