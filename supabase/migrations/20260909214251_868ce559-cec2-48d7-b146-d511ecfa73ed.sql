CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.fix_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period date NOT NULL,
  request_text text NOT NULL,
  diagnosis text,
  proposal jsonb NOT NULL,
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','undone','failed')),
  result jsonb,
  undo jsonb,
  applied_by uuid,
  applied_at timestamptz NOT NULL DEFAULT now(),
  undone_by uuid,
  undone_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fix_actions_client_period_idx ON public.fix_actions (client_id, period, applied_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.fix_actions TO authenticated;
GRANT ALL ON public.fix_actions TO service_role;

ALTER TABLE public.fix_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fix_actions_select" ON public.fix_actions
  FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "fix_actions_insert" ON public.fix_actions
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_client(auth.uid(), client_id) AND applied_by = auth.uid());

CREATE POLICY "fix_actions_update" ON public.fix_actions
  FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));

CREATE TRIGGER update_fix_actions_updated_at
  BEFORE UPDATE ON public.fix_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();