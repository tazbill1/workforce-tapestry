# Multi-client reporting backend (database only, no UI)

The backend isn't connected yet, so step one is enabling Lovable Cloud (managed Postgres + auth + storage). Everything below then ships as SQL migrations. No UI work in this step.

## Migration order

1. **Enums + access control first** — `app_role` (analyst/coach/viewer), `user_roles`, `user_clients`, and the `SECURITY DEFINER` helpers all later policies depend on:
   - `has_role(uid, role)` — role lookup without recursive RLS
   - `is_analyst(uid)` — full cross-client access
   - `has_client_access(uid, client_id)` — analyst OR row in `user_clients`
2. **Reference tables** — `clients`, `canonical_roles`, `role_benchmarks`
3. **Raw layer** — `raw_imports`, `raw_records`
4. **Decisions layer** — `exclusions`, `record_merges`, `role_mappings`, `department_rules`
5. **Manual entry** — `engagement_totals`, `recognition_counts`, `action_plan_items`
6. **Output layer** — `metric_definitions`, `published_metrics`, `report_runs`
7. **Seeds** — the six canonical roles; two benchmarks only (Sales 60, Service 39, source `2025 NADA Dealership Workforce Study`). The other four roles are deliberately left without a benchmark.

Every table is created exactly as specified: enums for `kind`/`state`/`match_type`/`category`/`format`, the generated `normalized_email` column, both raw-text and parsed-date columns everywhere, `parse_flags text[]`, self-referencing `supersedes`/`superseded_by`, the unique index on `(client_id, period, kind, content_sha256)`, `unique (import_id, row_number)`, GIN index on `payload`, btree on `normalized_email` and `period`, and the composite FK from `published_metrics` to `metric_definitions(key, version)`.

## Access model

Applied uniformly to all 18 tables:

- RLS enabled everywhere, including reference tables. No policy names the `anon` role; every policy is `TO authenticated` and additionally predicate-gated.
- Explicit `GRANT` per table (`authenticated` only for the privileges its policies allow, plus `service_role`). No grants to `anon` anywhere — this is what makes unauthenticated reads impossible even before RLS is consulted.
- **analyst** — SELECT/INSERT/UPDATE across all clients and all tables.
- **coach** — SELECT/INSERT/UPDATE limited to clients in their `user_clients` rows.
- **viewer** — SELECT only, limited to their assigned clients.
- Reference tables (`clients`, `canonical_roles`, `role_benchmarks`, `metric_definitions`) are readable by any authenticated user with a role row; writable by analysts only. `clients` read is additionally scoped to assigned clients for coach/viewer.
- `user_roles` / `user_clients`: a user may read their own rows; only analysts may read all or write. No self-service role assignment.

### Immutability

- **No DELETE policy exists** on `raw_imports`, `raw_records`, `exclusions`, `record_merges`, `role_mappings`, `department_rules`. Absent policy = denied. In addition, `REVOKE DELETE` on those tables from `authenticated` so it fails at the privilege layer too.
- Decision tables also get a trigger that blocks any UPDATE except setting `superseded_by`/`active` — corrections happen by inserting a superseding row, never by rewriting history.
- `raw_records` is fully immutable (no UPDATE policy). `raw_imports` allows UPDATE only of `state`, `parse_error`, `superseded_by`.

### Signup

Signup is disabled in auth settings; accounts are created by invitation. There is no trigger that auto-grants a role — a new user with no `user_roles` row sees nothing anywhere.

## What an unauthenticated user can read

Nothing. Zero rows from every table. `anon` receives no table grants and appears in no policy, so a request without a valid JWT gets a permission error or an empty set from all 18 tables — reference tables included.

## Deliverable

After the migrations apply, I'll post the complete SQL in chat: every `CREATE TABLE`, every `GRANT`/`REVOKE`, and every `CREATE POLICY`, plus the immutability triggers and the seed rows.

## Assumptions worth flagging

- Coaches can write to every client-scoped table they're assigned to, including raw imports — say the word if coaches should be limited to `action_plan_items`, `engagement_totals`, and `recognition_counts` only.
- `published_metrics` and `report_runs` are writable by analysts (and assigned coaches); viewers read only.
