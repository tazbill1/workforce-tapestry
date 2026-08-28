ALTER TABLE public.report_runs
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS snapshot jsonb,
  ADD COLUMN IF NOT EXISTS sections text[] NOT NULL DEFAULT '{}'::text[];

-- Backfill deterministic version numbers for existing runs (oldest = 1).
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY client_id, period ORDER BY created_at, id) AS rn
  FROM public.report_runs
)
UPDATE public.report_runs r
SET version = ordered.rn
FROM ordered
WHERE ordered.id = r.id;

CREATE UNIQUE INDEX IF NOT EXISTS report_runs_client_period_version_key
  ON public.report_runs (client_id, period, version);