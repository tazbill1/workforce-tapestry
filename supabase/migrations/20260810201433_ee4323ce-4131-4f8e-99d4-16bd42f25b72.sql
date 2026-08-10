-- ============================================================
-- 2. REFERENCE TABLES
-- ============================================================

CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_clients
  ADD CONSTRAINT user_clients_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

CREATE TABLE public.canonical_roles (
  code text PRIMARY KEY,
  label text NOT NULL,
  sort_order int
);

CREATE TABLE public.role_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_code text NOT NULL REFERENCES public.canonical_roles(code),
  source text,
  source_year int,
  turnover_pct numeric NULL,
  notes text
);

CREATE INDEX idx_role_benchmarks_role ON public.role_benchmarks (role_code);

-- ---------- grants (no anon) ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.canonical_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_benchmarks TO authenticated;
GRANT ALL ON public.clients TO service_role;
GRANT ALL ON public.canonical_roles TO service_role;
GRANT ALL ON public.role_benchmarks TO service_role;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_benchmarks ENABLE ROW LEVEL SECURITY;

-- ---------- policies ----------

CREATE POLICY "clients_select_scoped" ON public.clients
  FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), id));

CREATE POLICY "clients_insert_analyst" ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (public.is_analyst(auth.uid()));

CREATE POLICY "clients_update_analyst" ON public.clients
  FOR UPDATE TO authenticated
  USING (public.is_analyst(auth.uid()))
  WITH CHECK (public.is_analyst(auth.uid()));

CREATE POLICY "clients_delete_analyst" ON public.clients
  FOR DELETE TO authenticated
  USING (public.is_analyst(auth.uid()));

CREATE POLICY "canonical_roles_select_known_users" ON public.canonical_roles
  FOR SELECT TO authenticated
  USING (public.is_known_user(auth.uid()));

CREATE POLICY "canonical_roles_insert_analyst" ON public.canonical_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_analyst(auth.uid()));

CREATE POLICY "canonical_roles_update_analyst" ON public.canonical_roles
  FOR UPDATE TO authenticated
  USING (public.is_analyst(auth.uid()))
  WITH CHECK (public.is_analyst(auth.uid()));

CREATE POLICY "canonical_roles_delete_analyst" ON public.canonical_roles
  FOR DELETE TO authenticated
  USING (public.is_analyst(auth.uid()));

CREATE POLICY "role_benchmarks_select_known_users" ON public.role_benchmarks
  FOR SELECT TO authenticated
  USING (public.is_known_user(auth.uid()));

CREATE POLICY "role_benchmarks_insert_analyst" ON public.role_benchmarks
  FOR INSERT TO authenticated
  WITH CHECK (public.is_analyst(auth.uid()));

CREATE POLICY "role_benchmarks_update_analyst" ON public.role_benchmarks
  FOR UPDATE TO authenticated
  USING (public.is_analyst(auth.uid()))
  WITH CHECK (public.is_analyst(auth.uid()));

CREATE POLICY "role_benchmarks_delete_analyst" ON public.role_benchmarks
  FOR DELETE TO authenticated
  USING (public.is_analyst(auth.uid()));

-- ---------- seeds ----------

INSERT INTO public.canonical_roles (code, label, sort_order) VALUES
  ('Service',       'Service',       1),
  ('Sales',         'Sales',         2),
  ('Management',    'Management',    3),
  ('BDC',           'BDC',           4),
  ('Admin/Support', 'Admin/Support', 5),
  ('Parts',         'Parts',         6);

-- Only two benchmarks exist. The absence of the other four is deliberate:
-- the report must print "no benchmark available" for them.
INSERT INTO public.role_benchmarks (role_code, source, source_year, turnover_pct, notes) VALUES
  ('Sales',   '2025 NADA Dealership Workforce Study', 2025, 60, NULL),
  ('Service', '2025 NADA Dealership Workforce Study', 2025, 39, NULL);