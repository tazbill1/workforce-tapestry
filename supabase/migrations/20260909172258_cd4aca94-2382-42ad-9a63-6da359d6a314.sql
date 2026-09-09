CREATE TABLE public.period_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period date NOT NULL,
  position integer NOT NULL DEFAULT 1,
  heading text,
  body text NOT NULL DEFAULT '',
  include_in_report boolean NOT NULL DEFAULT true,
  authored_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.period_notes TO authenticated;
GRANT ALL ON public.period_notes TO service_role;

ALTER TABLE public.period_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read notes for accessible clients" ON public.period_notes
  FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "Write notes for accessible clients" ON public.period_notes
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_client(auth.uid(), client_id));

CREATE POLICY "Update notes for accessible clients" ON public.period_notes
  FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));

CREATE POLICY "Delete notes for accessible clients" ON public.period_notes
  FOR DELETE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id));

CREATE INDEX period_notes_client_period_idx ON public.period_notes (client_id, period, position);

CREATE OR REPLACE FUNCTION public.set_period_notes_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER period_notes_set_updated_at
  BEFORE UPDATE ON public.period_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_period_notes_updated_at();