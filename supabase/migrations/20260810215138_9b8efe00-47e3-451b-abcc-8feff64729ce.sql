CREATE TABLE public.review_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('exclusion','merge','diff')),
  candidate_key text NOT NULL,
  note text,
  period_reviewed date,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, kind, candidate_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_dismissals TO authenticated;
GRANT ALL ON public.review_dismissals TO service_role;
ALTER TABLE public.review_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "review_dismissals_select" ON public.review_dismissals
  FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "review_dismissals_insert" ON public.review_dismissals
  FOR INSERT TO authenticated WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "review_dismissals_update" ON public.review_dismissals
  FOR UPDATE TO authenticated USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "review_dismissals_delete" ON public.review_dismissals
  FOR DELETE TO authenticated USING (public.can_write_client(auth.uid(), client_id));

CREATE TABLE public.period_readiness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period date NOT NULL,
  marked_ready_by uuid REFERENCES auth.users(id),
  marked_ready_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, period)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.period_readiness TO authenticated;
GRANT ALL ON public.period_readiness TO service_role;
ALTER TABLE public.period_readiness ENABLE ROW LEVEL SECURITY;

CREATE POLICY "period_readiness_select" ON public.period_readiness
  FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "period_readiness_insert" ON public.period_readiness
  FOR INSERT TO authenticated WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "period_readiness_update" ON public.period_readiness
  FOR UPDATE TO authenticated USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "period_readiness_delete" ON public.period_readiness
  FOR DELETE TO authenticated USING (public.can_write_client(auth.uid(), client_id));