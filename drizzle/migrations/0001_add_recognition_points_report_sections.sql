UPDATE public.report_format_sections
SET position = position + 1
WHERE section_id IN ('people','insights','action','notes','surveys','method');

INSERT INTO public.report_format_sections (client_id, format, section_id, position)
SELECT client_id, format, 'recognition-points', position + 1
FROM public.report_format_sections
WHERE section_id = 'recognition'
ON CONFLICT DO NOTHING;