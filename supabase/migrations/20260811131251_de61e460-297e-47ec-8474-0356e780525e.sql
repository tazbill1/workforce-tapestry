create policy "reports_read_scoped"
on storage.objects for select to authenticated
using (
  bucket_id = 'reports'
  and public.has_client_access(auth.uid(), public.storage_path_client_id(name))
);

create policy "reports_insert_writers"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'reports'
  and public.can_write_client(auth.uid(), public.storage_path_client_id(name))
);

create policy "reports_update_writers"
on storage.objects for update to authenticated
using (
  bucket_id = 'reports'
  and public.can_write_client(auth.uid(), public.storage_path_client_id(name))
)
with check (
  bucket_id = 'reports'
  and public.can_write_client(auth.uid(), public.storage_path_client_id(name))
);

alter table public.report_runs
  add column if not exists byte_size bigint,
  add column if not exists page_count integer,
  add column if not exists note text;

drop policy if exists "report_runs_delete_writers" on public.report_runs;
revoke delete on public.report_runs from authenticated;

create index if not exists report_runs_client_period_idx
  on public.report_runs (client_id, period, format, created_at desc);

create table if not exists public.report_format_sections (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  format public.report_format not null,
  section_id text not null,
  position integer not null,
  created_at timestamptz not null default now()
);

create unique index if not exists report_format_sections_default_unique
  on public.report_format_sections (format, section_id)
  where client_id is null;

create unique index if not exists report_format_sections_client_unique
  on public.report_format_sections (client_id, format, section_id)
  where client_id is not null;

grant select, insert, update, delete on public.report_format_sections to authenticated;
grant all on public.report_format_sections to service_role;
alter table public.report_format_sections enable row level security;

create policy "report_format_sections_select_scoped"
on public.report_format_sections for select to authenticated
using (client_id is null or public.has_client_access(auth.uid(), client_id));

create policy "report_format_sections_write_analyst"
on public.report_format_sections for all to authenticated
using (public.has_role(auth.uid(), 'analyst'))
with check (public.has_role(auth.uid(), 'analyst'));

create table if not exists public.report_run_metrics (
  report_run_id uuid not null references public.report_runs(id) on delete cascade,
  published_metric_id uuid not null references public.published_metrics(id) on delete cascade,
  primary key (report_run_id, published_metric_id)
);

create index if not exists report_run_metrics_metric_idx
  on public.report_run_metrics (published_metric_id);

grant select, insert on public.report_run_metrics to authenticated;
grant all on public.report_run_metrics to service_role;
alter table public.report_run_metrics enable row level security;

create policy "report_run_metrics_select_scoped"
on public.report_run_metrics for select to authenticated
using (
  exists (
    select 1 from public.report_runs r
    where r.id = report_run_id
      and public.has_client_access(auth.uid(), r.client_id)
  )
);

create policy "report_run_metrics_insert_writers"
on public.report_run_metrics for insert to authenticated
with check (
  exists (
    select 1 from public.report_runs r
    where r.id = report_run_id
      and public.can_write_client(auth.uid(), r.client_id)
  )
);

insert into public.report_format_sections (client_id, format, section_id, position)
select null, f.format, s.section_id, s.position
from (values
  ('cover',1),('summary',2),('headcount',3),('turnover',4),('benchmark',5),
  ('departures',6),('tenure',7),('participation',8),('mood',9),('watchlist',10),
  ('lowmood',11),('recognition',12),('people',13),('action',14),('method',15)
) as s(section_id, position)
cross join (values
  ('landscape'::public.report_format),('portrait'::public.report_format),('wide'::public.report_format)
) as f(format)
on conflict do nothing;

insert into public.report_format_sections (client_id, format, section_id, position)
values
  (null,'exec','cover',1),
  (null,'exec','summary',2),
  (null,'exec','turnover',3),
  (null,'exec','departures',4),
  (null,'exec','participation',5),
  (null,'exec','recognition',6),
  (null,'exec','mood',7),
  (null,'exec','action',8)
on conflict do nothing;