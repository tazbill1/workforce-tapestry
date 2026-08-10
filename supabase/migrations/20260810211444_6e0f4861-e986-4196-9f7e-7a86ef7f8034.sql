ALTER TABLE public.raw_imports DISABLE TRIGGER trg_guard_raw_import_update;

UPDATE public.raw_imports
SET kind = 'login_report'
WHERE id = '03d0638f-d500-4cef-8b19-93c8513d8d6d'
  AND original_filename = 'we_auto_july_login_report.xlsx';

ALTER TABLE public.raw_imports ENABLE TRIGGER trg_guard_raw_import_update;