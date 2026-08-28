ALTER TYPE public.import_kind ADD VALUE IF NOT EXISTS 'recognition_activity';

CREATE TABLE public.recognition_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  period date NOT NULL,
  import_id uuid NOT NULL REFERENCES public.raw_imports(id),
  row_number integer,
  name_raw text NOT NULL,
  normalized_name text NOT NULL,
  posts integer NOT NULL DEFAULT 0,
  comments integer NOT NULL DEFAULT 0,
  likes integer NOT NULL DEFAULT 0,
  matched_email text,
  match_source text,
  window_from date,
  window_to date,
  inserted_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.recognition_activity TO authenticated;
GRANT ALL ON public.recognition_activity TO service_role;

ALTER TABLE public.recognition_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read recognition activity for assigned clients"
  ON public.recognition_activity FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "write recognition activity for assigned clients"
  ON public.recognition_activity FOR INSERT TO authenticated
  WITH CHECK (public.can_write_client(auth.uid(), client_id));

CREATE INDEX recognition_activity_client_period_idx
  ON public.recognition_activity (client_id, period);
CREATE INDEX recognition_activity_import_idx
  ON public.recognition_activity (import_id);
CREATE UNIQUE INDEX recognition_activity_import_row_unique
  ON public.recognition_activity (import_id, normalized_name);

CREATE TABLE public.name_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  normalized_name text NOT NULL,
  normalized_email text NOT NULL,
  reason text,
  confirmed_by uuid REFERENCES auth.users(id),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  effective_from date,
  superseded_by uuid REFERENCES public.name_links(id),
  active boolean NOT NULL DEFAULT true
);

GRANT SELECT, INSERT, UPDATE ON public.name_links TO authenticated;
GRANT ALL ON public.name_links TO service_role;

ALTER TABLE public.name_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read name links for assigned clients"
  ON public.name_links FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "insert name links for assigned clients"
  ON public.name_links FOR INSERT TO authenticated
  WITH CHECK (public.can_write_client(auth.uid(), client_id));

CREATE POLICY "supersede name links for assigned clients"
  ON public.name_links FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));

CREATE TRIGGER trg_guard_name_links_update
  BEFORE UPDATE ON public.name_links
  FOR EACH ROW EXECUTE FUNCTION public.guard_decision_update();

CREATE UNIQUE INDEX name_links_active_unique
  ON public.name_links (client_id, normalized_name) WHERE active;
