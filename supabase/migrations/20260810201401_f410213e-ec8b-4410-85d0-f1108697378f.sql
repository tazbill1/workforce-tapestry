-- ============================================================
-- 1. ACCESS CONTROL FOUNDATION
-- ============================================================

CREATE TYPE public.app_role AS ENUM ('analyst', 'coach', 'viewer');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE TABLE public.user_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);

CREATE INDEX idx_user_clients_user ON public.user_clients (user_id);
CREATE INDEX idx_user_roles_user ON public.user_roles (user_id);

-- ---------- security definer helpers ----------

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_analyst(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'analyst'
  )
$$;

-- Any authenticated principal that has been granted a role at all.
CREATE OR REPLACE FUNCTION public.is_known_user(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
$$;

-- Read access to a client: analyst (all clients) or explicitly assigned.
CREATE OR REPLACE FUNCTION public.has_client_access(_user_id uuid, _client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_analyst(_user_id)
      OR EXISTS (
        SELECT 1 FROM public.user_clients
        WHERE user_id = _user_id AND client_id = _client_id
      )
$$;

-- Write access to a client: analyst anywhere, coach only where assigned.
-- Viewers never get write.
CREATE OR REPLACE FUNCTION public.can_write_client(_user_id uuid, _client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_analyst(_user_id)
      OR (
        public.has_role(_user_id, 'coach')
        AND EXISTS (
          SELECT 1 FROM public.user_clients
          WHERE user_id = _user_id AND client_id = _client_id
        )
      )
$$;

-- ---------- grants (no anon anywhere) ----------

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_clients TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
GRANT ALL ON public.user_clients TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_clients ENABLE ROW LEVEL SECURITY;

-- ---------- policies ----------

CREATE POLICY "user_roles_select_own_or_analyst" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_analyst(auth.uid()));

CREATE POLICY "user_roles_insert_analyst" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_analyst(auth.uid()));

CREATE POLICY "user_roles_update_analyst" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.is_analyst(auth.uid()))
  WITH CHECK (public.is_analyst(auth.uid()));

CREATE POLICY "user_roles_delete_analyst" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.is_analyst(auth.uid()));

CREATE POLICY "user_clients_select_own_or_analyst" ON public.user_clients
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_analyst(auth.uid()));

CREATE POLICY "user_clients_insert_analyst" ON public.user_clients
  FOR INSERT TO authenticated
  WITH CHECK (public.is_analyst(auth.uid()));

CREATE POLICY "user_clients_update_analyst" ON public.user_clients
  FOR UPDATE TO authenticated
  USING (public.is_analyst(auth.uid()))
  WITH CHECK (public.is_analyst(auth.uid()));

CREATE POLICY "user_clients_delete_analyst" ON public.user_clients
  FOR DELETE TO authenticated
  USING (public.is_analyst(auth.uid()));