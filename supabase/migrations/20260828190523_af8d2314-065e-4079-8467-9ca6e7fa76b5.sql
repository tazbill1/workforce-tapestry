CREATE TABLE public.report_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_run_id uuid NOT NULL REFERENCES public.report_runs(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id),
  token text NOT NULL UNIQUE,
  label text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX report_shares_run_idx ON public.report_shares (report_run_id);

GRANT SELECT, INSERT, UPDATE ON public.report_shares TO authenticated;
GRANT ALL ON public.report_shares TO service_role;

ALTER TABLE public.report_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read shares for accessible clients"
  ON public.report_shares FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "writers create shares"
  ON public.report_shares FOR INSERT TO authenticated
  WITH CHECK (public.can_write_client(auth.uid(), client_id) AND created_by = auth.uid());

CREATE POLICY "writers revoke shares"
  ON public.report_shares FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));