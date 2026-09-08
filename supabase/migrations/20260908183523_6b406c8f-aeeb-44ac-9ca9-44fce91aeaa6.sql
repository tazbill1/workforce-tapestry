CREATE TABLE public.historical_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period date NOT NULL,
  metric_key text NOT NULL,
  label text NOT NULL,
  value_numeric numeric,
  unit text,
  source text NOT NULL DEFAULT 'published_pdf',
  source_note text,
  entered_by uuid REFERENCES auth.users(id),
  entered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, period, metric_key, source)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.historical_baselines TO authenticated;
GRANT ALL ON public.historical_baselines TO service_role;

ALTER TABLE public.historical_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "baselines_select" ON public.historical_baselines
  FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "baselines_insert" ON public.historical_baselines
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_client(auth.uid(), client_id));

CREATE POLICY "baselines_update" ON public.historical_baselines
  FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));

CREATE POLICY "baselines_delete" ON public.historical_baselines
  FOR DELETE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id));

CREATE INDEX historical_baselines_client_period_idx
  ON public.historical_baselines (client_id, period);