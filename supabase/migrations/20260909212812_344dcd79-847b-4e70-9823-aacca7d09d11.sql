UPDATE public.report_format_sections SET position = position + 1
WHERE client_id IS NULL AND section_id = 'method';

INSERT INTO public.report_format_sections (client_id, format, section_id, position)
SELECT NULL, format, 'surveys', position - 1
FROM public.report_format_sections
WHERE client_id IS NULL AND section_id = 'method';

INSERT INTO public.report_format_sections (client_id, format, section_id, position)
SELECT NULL, 'exec'::report_format, 'surveys',
  (SELECT max(position) + 1 FROM public.report_format_sections WHERE client_id IS NULL AND format = 'exec')
WHERE NOT EXISTS (
  SELECT 1 FROM public.report_format_sections
  WHERE client_id IS NULL AND format = 'exec' AND section_id = 'surveys'
);