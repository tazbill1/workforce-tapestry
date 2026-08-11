# Report PDF output

## Renderer recommendation: self-hosted Gotenberg

Recommended: **Gotenberg (headless Chromium) on Fly.io**, called from a server function.

Why, in order of weight:

1. **The page contains employee names, emails and individual mood scores.** A hosted API means a data processing agreement, a retention answer in writing, and a re-check every time their terms change. Gotenberg is stateless — HTML in, PDF out, nothing persisted — so there is no retention question to answer.
2. **No public preview route is needed either way, and Gotenberg makes that easy.** We render the report to an HTML string inside the server function and POST the markup to the renderer. The renderer never gets a URL, never authenticates, never touches the database.
3. **Cost and control.** A Fly machine that scales to zero costs a few dollars a month, versus per-render pricing, and Chromium version and flags stay pinned.
4. **Chromium fidelity is identical** — Browserless and PDFShift are also Chromium; the only thing a hosted API buys is skipping one deploy.

Trade-off accepted: one small piece of infrastructure to deploy and keep patched. Requires two secrets — `GOTENBERG_URL` and `GOTENBERG_TOKEN` (the service is fronted by a shared-secret header so only this app can call it).

If you would rather not run infrastructure, DocRaptor is the closest hosted equivalent, but it needs the DPA and retention confirmation before we send a single row.

## What gets built

### 1. Four page formats from one template

A `format` prop threads through the document and drives CSS variables — no second template.

| format | page size | changes |
|---|---|---|
| landscape | 11 × 8.5in | as built |
| portrait | 8.5 × 11in | long lists collapse to one column; more pages |
| wide | 13.333 × 7.5in | reduced chart heights, tighter stat-card padding, smaller table row padding |
| exec | 13.333 × 7.5in | wide metrics plus a stored section subset |

`wide` is an inch shorter than landscape, so chart heights and card padding become per-format values rather than constants.

### 2. Section configuration, not a hardcoded filter

New table `report_format_sections` (client_id nullable for the default cut, format, section_id, position). `exec` reads its section list from there; a client-specific row set overrides the default. Cross-references between sections resolve against the included list for that format and drop when the target section is absent.

### 3. Generate, store, trace

- `generateReport` server function: render HTML → POST to Gotenberg → upload to a private `reports` bucket at `<client_id>/<period>/<format>-<timestamp>.pdf` → insert a `report_runs` row (client_id, period, format, storage_path, created_by, created_at, byte size).
- Every `published_metrics` row read during a run is linked via a new `report_run_id` column on a join table `report_run_metrics` (a metric row can feed many runs, so a link table rather than a column on the metric row keeps history intact).
- Prior runs are never overwritten — the timestamped path plus an append-only `report_runs` table means both July restatements stay downloadable exactly as sent.

### 4. Storage policies

`reports` bucket, private, same shape as `raw-imports`: client id derived from the first path segment via `public.storage_path_client_id(name)`, `has_client_access` for SELECT, `can_write_client` for INSERT/UPDATE/DELETE, no anon grant. Full SQL shown when applied.

Downloads go through a server function that issues a 60-second signed URL after checking access. No public links.

### 5. Report screen

`/report` gains a runs panel: client and period pickers already exist; below them a table of the four formats with last-generated timestamp, a Generate button per format, and a list of prior runs per format with download links. Preview stays as is.

## Acceptance

Generate all four formats for WE Auto Michigan, July 2026, then verify the PDFs page by page: figures (243 / 171 / 41.3% / 90.47 / 91 / 52 / 9 / 90, engagement 469 / 355 / 1,358 / 284), running header on every page but the cover, sequential page numbers, no split sections or tables, vector charts. Plus a logged-out fetch of a report path returning nothing.

## Before I start

I need the Gotenberg endpoint. I can give you the exact Fly deploy (a three-line `fly.toml` and one command) — or if you already have a renderer, paste its URL and token and I will wire to that.
