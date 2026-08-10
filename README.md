# Client Insights Hub

Build the Supabase backend for an internal multi-client reporting tool. Do not build any UI in this step. Show me the SQL for every table and every RLS policy when you are done.

Context: we produce a monthly culture and workforce report for six dealership-group clients from spreadsheet exports. The reports depend on judgement calls — which accounts to exclude, which records are duplicates, how job titles map to roles — that must be recorded once and reapplied every month, never re-litigated.

Reference tables

clients — id uuid pk, name text not null, code text unique not null (e.g. 'WEAUTO_MI'), active boolean default true, created_at timestamptz default now().

canonical_roles — code text pk, label text not null, sort_order int. Seed with exactly: Service, Sales, Management, BDC, Admin/Support, Parts. This list is global and must never vary by client.

role_benchmarks — id uuid pk, role_code text references canonical_roles(code), source text, source_year int, turnover_pct numeric null, notes text. Seed: Sales 60, Service 39, source '2025 NADA Dealership Workforce Study'. Do NOT seed the other four roles — their absence is what makes the report print "no benchmark available".

Raw layer — immutable

raw_imports — id uuid pk, client_id, period date (first day of the reporting month), kind enum('roster','mood_matrix','login_report','engagement_totals','recognition_counts','screenshot'), original_filename text, storage_path text, content_sha256 text, row_count int, column_names text[], exported_at date, covers_from date, covers_to date, state enum('uploaded','parsed','failed','superseded') default 'uploaded', parse_error text, supersedes uuid self-ref, superseded_by uuid self-ref, uploaded_by uuid references auth.users(id), uploaded_at timestamptz default now(), notes text. Unique index on (client_id, period, kind, content_sha256) so an identical re-upload is a no-op.

covers_from/covers_to matter: source files do not respect month boundaries. One export labelled year-to-date actually ran to 08/10 while the period ended 07/31.

raw_records — id uuid pk, import_id references raw_imports on delete cascade, client_id, period date, row_number int, payload jsonb not null (the verbatim source row), name_raw text, email_raw text, normalized_email text generated always as (nullif(lower(btrim(email_raw)), '')) stored, employee_id_raw text (not integer — real values include 'aaaaaaaaa', '010101', '1'), title_raw text, department_raw text, status_raw text, user_type_raw text, hire_date_raw text, hire_date date null, created_raw text, created_at_src date, modified_raw text, modified_at_src date, last_login_raw text, last_login_at timestamptz, parse_flags text[] default '{}', inserted_at timestamptz default now(), unique (import_id, row_number). Index normalized_email, period, and a gin index on payload.

Every date is stored twice — raw text and parsed value, parse allowed to fail to null. A real source value was "04/2822026". Keep the text, flag it, never guess.

Decisions layer — the important part

All four tables below share the same pattern: a decision is never updated or deleted. It is superseded by a new row. Each carries confirmed_by uuid references auth.users(id), confirmed_at timestamptz default now(), effective_from date (the period it starts applying), superseded_by uuid self-ref, and active boolean default true.

exclusions — client_id, match_type enum('email','name','employee_id','email_domain','keyword'), match_value text, category enum('test','demo','vendor','platform','internal','legacy','other'), reason text.

record_merges — client_id, canonical_email text, duplicate_email text, reason text.

role_mappings — client_id, title_pattern text, department_pattern text null, role_code references canonical_roles(code), precedence int (lower wins), reason text. Precedence matters: 'Parts Manager' must map to Management even though a later rule maps 'parts' to Parts.

department_rules — client_id, pattern text, franchise_label text, function_label text, is_shared boolean. Michigan uses TAA/SAA prefixes with unprefixed departments treated as Shared Support Staff; Tennessee is flat with the brand in the email domain. Per-client config, never code.

Manually entered content

Three parts of the report do not arrive as files.

engagement_totals — client_id, period, likes int, comments int, logins int, recognitions int, source_note text, entered_by, entered_at. Typed from the platform dashboard.

recognition_counts — client_id, period, department_raw text, count int, entered_by, entered_at. Read off a screenshot; must reconcile to the recognitions figure above.

action_plan_items — client_id, period, position int, headline text, problem text, solution text, authored_by, authored_at. Written by the Culture Coach, not derived.

Output layer — versioned

metric_definitions — key text, version int, description text, formula_note text, effective_from date, primary key (key, version). A published metric changed definition mid-project: a 90-day early-departure figure went from 55.5% to 26.9% and was then withdrawn. Without a version on every stored value, trend lines silently lie.

published_metrics — id uuid pk, client_id, period, metric_key text, definition_version int, value_numeric numeric null, value_text text null, scope text (e.g. 'company', 'role:Sales', 'dept:TAA SERVICE'), report_run_id uuid null, computed_at timestamptz default now(), foreign key (metric_key, definition_version) references metric_definitions(key, version). Unique on (client_id, period, metric_key, scope, definition_version).

report_runs — id uuid pk, client_id, period, format enum('portrait','landscape','wide','exec'), storage_path text, created_by, created_at.

Access control — build this first, not last

user_roles — user_id references auth.users(id), role enum('analyst','coach','viewer'). user_clients — user_id, client_id. Scopes a user to specific clients.

Requirements:

Enable RLS on every table including the reference tables.

Deny by default. No policy may grant anything to the anon role. An unauthenticated request must return zero rows from every table.

analyst — full read and write across all clients.

coach — read and write, but only for clients listed in user_clients for that user.

viewer — read only, only their assigned clients.

Nobody may DELETE from raw_imports, raw_records, or any decisions table. Corrections happen by superseding.

No self-service signup. Users created by invitation only.

When finished, show me the full SQL for every RLS policy, and state plainly what an unauthenticated user can read.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://workforce-tapestry.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ac3e081d-a06f-4399-8612-c0fc5fdfbd45).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
