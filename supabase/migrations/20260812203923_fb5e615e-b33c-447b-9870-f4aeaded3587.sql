CREATE TABLE public.record_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  normalized_email text NOT NULL,
  discriminator text NOT NULL CHECK (discriminator IN ('name','employee_id')),
  reason text,
  confirmed_by uuid REFERENCES auth.users(id),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  effective_from date,
  superseded_by uuid REFERENCES public.record_splits(id),
  active boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX record_splits_active_email_unique
  ON public.record_splits (client_id, normalized_email)
  WHERE active;

GRANT SELECT, INSERT, UPDATE ON public.record_splits TO authenticated;
GRANT ALL ON public.record_splits TO service_role;

ALTER TABLE public.record_splits ENABLE ROW LEVEL SECURITY;

CREATE POLICY record_splits_select_scoped ON public.record_splits
  FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY record_splits_insert_writers ON public.record_splits
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_client(auth.uid(), client_id));

CREATE POLICY record_splits_update_writers ON public.record_splits
  FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));

CREATE TRIGGER trg_guard_record_splits_update
  BEFORE UPDATE ON public.record_splits
  FOR EACH ROW EXECUTE FUNCTION public.guard_decision_update();