-- ============================================================
-- 5. MANUALLY ENTERED CONTENT
-- ============================================================

CREATE TABLE public.engagement_totals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  period date NOT NULL,
  likes int,
  comments int,
  logins int,
  recognitions int,
  source_note text,
  entered_by uuid REFERENCES auth.users(id),
  entered_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.recognition_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  period date NOT NULL,
  department_raw text NOT NULL,
  count int NOT NULL,
  entered_by uuid REFERENCES auth.users(id),
  entered_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.action_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  period date NOT NULL,
  position int NOT NULL DEFAULT 1,
  headline text NOT NULL,
  problem text,
  solution text,
  authored_by uuid REFERENCES auth.users(id),
  authored_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_engagement_totals_client_period ON public.engagement_totals (client_id, period);
CREATE INDEX idx_recognition_counts_client_period ON public.recognition_counts (client_id, period);
CREATE INDEX idx_action_plan_items_client_period ON public.action_plan_items (client_id, period);

-- ============================================================
-- 6. OUTPUT LAYER (versioned)
-- ============================================================

CREATE TYPE public.report_format AS ENUM ('portrait','landscape','wide','exec');

CREATE TABLE public.metric_definitions (
  key text NOT NULL,
  version int NOT NULL,
  description text,
  formula_note text,
  effective_from date,
  PRIMARY KEY (key, version)
);

CREATE TABLE public.report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  period date NOT NULL,
  format public.report_format NOT NULL,
  storage_path text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.published_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  period date NOT NULL,
  metric_key text NOT NULL,
  definition_version int NOT NULL,
  value_numeric numeric NULL,
  value_text text NULL,
  scope text NOT NULL DEFAULT 'company',
  report_run_id uuid NULL REFERENCES public.report_runs(id),
  computed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (metric_key, definition_version)
    REFERENCES public.metric_definitions(key, version),
  UNIQUE (client_id, period, metric_key, scope, definition_version)
);

CREATE INDEX idx_published_metrics_client_period ON public.published_metrics (client_id, period);
CREATE INDEX idx_report_runs_client_period ON public.report_runs (client_id, period);

-- ---------- grants (no anon) ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.engagement_totals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recognition_counts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.action_plan_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.published_metrics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.metric_definitions TO authenticated;
GRANT ALL ON public.engagement_totals TO service_role;
GRANT ALL ON public.recognition_counts TO service_role;
GRANT ALL ON public.action_plan_items TO service_role;
GRANT ALL ON public.published_metrics TO service_role;
GRANT ALL ON public.report_runs TO service_role;
GRANT ALL ON public.metric_definitions TO service_role;

ALTER TABLE public.engagement_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recognition_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.published_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metric_definitions ENABLE ROW LEVEL SECURITY;

-- ---------- client-scoped tables: same 4-policy shape ----------

CREATE POLICY "engagement_totals_select_scoped" ON public.engagement_totals
  FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "engagement_totals_insert_writers" ON public.engagement_totals
  FOR INSERT TO authenticated WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "engagement_totals_update_writers" ON public.engagement_totals
  FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "engagement_totals_delete_writers" ON public.engagement_totals
  FOR DELETE TO authenticated USING (public.can_write_client(auth.uid(), client_id));

CREATE POLICY "recognition_counts_select_scoped" ON public.recognition_counts
  FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "recognition_counts_insert_writers" ON public.recognition_counts
  FOR INSERT TO authenticated WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "recognition_counts_update_writers" ON public.recognition_counts
  FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "recognition_counts_delete_writers" ON public.recognition_counts
  FOR DELETE TO authenticated USING (public.can_write_client(auth.uid(), client_id));

CREATE POLICY "action_plan_items_select_scoped" ON public.action_plan_items
  FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "action_plan_items_insert_writers" ON public.action_plan_items
  FOR INSERT TO authenticated WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "action_plan_items_update_writers" ON public.action_plan_items
  FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "action_plan_items_delete_writers" ON public.action_plan_items
  FOR DELETE TO authenticated USING (public.can_write_client(auth.uid(), client_id));

CREATE POLICY "published_metrics_select_scoped" ON public.published_metrics
  FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "published_metrics_insert_writers" ON public.published_metrics
  FOR INSERT TO authenticated WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "published_metrics_update_writers" ON public.published_metrics
  FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "published_metrics_delete_writers" ON public.published_metrics
  FOR DELETE TO authenticated USING (public.can_write_client(auth.uid(), client_id));

CREATE POLICY "report_runs_select_scoped" ON public.report_runs
  FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "report_runs_insert_writers" ON public.report_runs
  FOR INSERT TO authenticated WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "report_runs_update_writers" ON public.report_runs
  FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "report_runs_delete_writers" ON public.report_runs
  FOR DELETE TO authenticated USING (public.can_write_client(auth.uid(), client_id));

-- ---------- metric_definitions: global, analyst-managed ----------

CREATE POLICY "metric_definitions_select_known_users" ON public.metric_definitions
  FOR SELECT TO authenticated USING (public.is_known_user(auth.uid()));
CREATE POLICY "metric_definitions_insert_analyst" ON public.metric_definitions
  FOR INSERT TO authenticated WITH CHECK (public.is_analyst(auth.uid()));
CREATE POLICY "metric_definitions_update_analyst" ON public.metric_definitions
  FOR UPDATE TO authenticated
  USING (public.is_analyst(auth.uid()))
  WITH CHECK (public.is_analyst(auth.uid()));
CREATE POLICY "metric_definitions_delete_analyst" ON public.metric_definitions
  FOR DELETE TO authenticated USING (public.is_analyst(auth.uid()));

-- ============================================================
-- 7. HARDENING: nothing is reachable without a session
-- ============================================================

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_analyst(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_known_user(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_client_access(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_client(uuid, uuid) TO authenticated, service_role;