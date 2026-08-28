CREATE OR REPLACE FUNCTION public.has_client_access(_user_id uuid, _client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- All authenticated users may access all clients (for now).
  SELECT _user_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.can_write_client(_user_id uuid, _client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_client_access(_user_id, _client_id);
$$;