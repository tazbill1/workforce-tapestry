CREATE UNIQUE INDEX record_merges_active_duplicate_unique
  ON public.record_merges (client_id, duplicate_email)
  WHERE active;