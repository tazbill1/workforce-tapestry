-- ============================================================
-- 4. DECISIONS LAYER (append-only, supersede never update)
-- ============================================================

CREATE TYPE public.exclusion_match_type AS ENUM ('email','name','employee_id','email_domain','keyword');
CREATE TYPE public.exclusion_category AS ENUM ('test','demo','vendor','platform','internal','legacy','other');

CREATE TABLE public.exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  match_type public.exclusion_match_type NOT NULL,
  match_value text NOT NULL,
  category public.exclusion_category NOT NULL,
  reason text,
  confirmed_by uuid REFERENCES auth.users(id),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  effective_from date,
  superseded_by uuid REFERENCES public.exclusions(id),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.record_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  canonical_email text NOT NULL,
  duplicate_email text NOT NULL,
  reason text,
  confirmed_by uuid REFERENCES auth.users(id),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  effective_from date,
  superseded_by uuid REFERENCES public.record_merges(id),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.role_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  title_pattern text NOT NULL,
  department_pattern text NULL,
  role_code text NOT NULL REFERENCES public.canonical_roles(code),
  precedence int NOT NULL DEFAULT 100,
  reason text,
  confirmed_by uuid REFERENCES auth.users(id),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  effective_from date,
  superseded_by uuid REFERENCES public.role_mappings(id),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.department_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  pattern text NOT NULL,
  franchise_label text,
  function_label text,
  is_shared boolean NOT NULL DEFAULT false,
  confirmed_by uuid REFERENCES auth.users(id),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  effective_from date,
  superseded_by uuid REFERENCES public.department_rules(id),
  active boolean NOT NULL DEFAULT true
);

CREATE INDEX idx_exclusions_client_active ON public.exclusions (client_id, active);
CREATE INDEX idx_record_merges_client_active ON public.record_merges (client_id, active);
CREATE INDEX idx_role_mappings_client_precedence ON public.role_mappings (client_id, precedence);
CREATE INDEX idx_department_rules_client_active ON public.department_rules (client_id, active);

-- ---------- guard: only superseded_by / active may change ----------

CREATE OR REPLACE FUNCTION public.guard_decision_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  old_frozen jsonb;
  new_frozen jsonb;
BEGIN
  old_frozen := to_jsonb(OLD) - 'superseded_by' - 'active';
  new_frozen := to_jsonb(NEW) - 'superseded_by' - 'active';
  IF old_frozen IS DISTINCT FROM new_frozen THEN
    RAISE EXCEPTION 'decisions are append-only: only superseded_by and active may change; insert a superseding row instead';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_exclusions_update
  BEFORE UPDATE ON public.exclusions
  FOR EACH ROW EXECUTE FUNCTION public.guard_decision_update();
CREATE TRIGGER trg_guard_record_merges_update
  BEFORE UPDATE ON public.record_merges
  FOR EACH ROW EXECUTE FUNCTION public.guard_decision_update();
CREATE TRIGGER trg_guard_role_mappings_update
  BEFORE UPDATE ON public.role_mappings
  FOR EACH ROW EXECUTE FUNCTION public.guard_decision_update();
CREATE TRIGGER trg_guard_department_rules_update
  BEFORE UPDATE ON public.department_rules
  FOR EACH ROW EXECUTE FUNCTION public.guard_decision_update();

-- ---------- grants: no DELETE for anyone but service_role ----------

GRANT SELECT, INSERT, UPDATE ON public.exclusions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.record_merges TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.role_mappings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.department_rules TO authenticated;
GRANT ALL ON public.exclusions TO service_role;
GRANT ALL ON public.record_merges TO service_role;
GRANT ALL ON public.role_mappings TO service_role;
GRANT ALL ON public.department_rules TO service_role;
REVOKE DELETE ON public.exclusions, public.record_merges, public.role_mappings, public.department_rules FROM authenticated;

ALTER TABLE public.exclusions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.record_merges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.department_rules ENABLE ROW LEVEL SECURITY;

-- ---------- policies (no DELETE policies exist) ----------

CREATE POLICY "exclusions_select_scoped" ON public.exclusions
  FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "exclusions_insert_writers" ON public.exclusions
  FOR INSERT TO authenticated WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "exclusions_update_writers" ON public.exclusions
  FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));

CREATE POLICY "record_merges_select_scoped" ON public.record_merges
  FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "record_merges_insert_writers" ON public.record_merges
  FOR INSERT TO authenticated WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "record_merges_update_writers" ON public.record_merges
  FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));

CREATE POLICY "role_mappings_select_scoped" ON public.role_mappings
  FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "role_mappings_insert_writers" ON public.role_mappings
  FOR INSERT TO authenticated WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "role_mappings_update_writers" ON public.role_mappings
  FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));

CREATE POLICY "department_rules_select_scoped" ON public.department_rules
  FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "department_rules_insert_writers" ON public.department_rules
  FOR INSERT TO authenticated WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "department_rules_update_writers" ON public.department_rules
  FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));