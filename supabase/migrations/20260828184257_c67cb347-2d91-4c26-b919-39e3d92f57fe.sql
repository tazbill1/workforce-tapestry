CREATE TABLE public.saved_insights (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  period date,
  title text NOT NULL,
  question text NOT NULL,
  answer_md text NOT NULL,
  table_json jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  include_in_report boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX saved_insights_client_period_idx ON public.saved_insights (client_id, period);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_insights TO authenticated;
GRANT ALL ON public.saved_insights TO service_role;

ALTER TABLE public.saved_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_insights_select" ON public.saved_insights
FOR SELECT TO authenticated
USING (
  public.is_analyst(auth.uid())
  OR created_by = auth.uid()
  OR (client_id IS NOT NULL AND public.has_client_access(auth.uid(), client_id))
);

CREATE POLICY "saved_insights_insert" ON public.saved_insights
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (client_id IS NULL OR public.has_client_access(auth.uid(), client_id))
);

CREATE POLICY "saved_insights_update" ON public.saved_insights
FOR UPDATE TO authenticated
USING (public.is_analyst(auth.uid()) OR created_by = auth.uid())
WITH CHECK (
  (public.is_analyst(auth.uid()) OR created_by = auth.uid())
  AND (client_id IS NULL OR public.has_client_access(auth.uid(), client_id))
);

CREATE POLICY "saved_insights_delete" ON public.saved_insights
FOR DELETE TO authenticated
USING (public.is_analyst(auth.uid()) OR created_by = auth.uid());