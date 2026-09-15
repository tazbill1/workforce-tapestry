# Three locations, August data — how the tool handles it

Short answer: yes, you can throw it all in. The tool is built for exactly this, with one setup decision up front.

## The one decision: one location = one client

Each rooftop gets its own client record. That keeps headcount, turnover, mood and recognition clean per store, and lets the report compare a store against the group average (that comparison already exists — it averages all active clients).

You already have **My Lakeshore Subaru** set up (with a September roster and login file loaded). The other two rooftops get added the same way on the Clients page, with their email domains so mis-filed uploads get caught.

A combined "whole group" report is not part of this pass — the group view comes from the store-vs-group-average comparison inside each report.

## What happens when you drop August files in

For each location, in this order:

1. **HR roster** (status + hire dates) — required first. Everything else attaches to the people in it.
2. **Mood / check-in and login files** — feeds pulse score and participation.
3. **Recognition** (posts, comments, likes, and the points spreadsheet if you have it) — feeds engagement and Most Engaged / recognition points.

Uploads go through the import queue: it inspects each file, guesses the location, the month and the file type, warns you if the email domains don't match the client you picked, blocks a repeat of an identical file, and shows a checklist of what's still missing for August.

Anything it can't read is flagged rather than dropped — the raw text stays, the typed value is left blank, and you see the flags after upload.

## Then, per location

- **Decisions** — confirm exclusions (test/demo/vendor accounts), merges for duplicate people, and role/department mapping. The AI proposes mappings; you approve. Michigan's existing patterns don't carry over, so each new store needs its own first-time pass here. This is the slowest part for a brand-new client.
- **Assembly** — builds one row per person for August.
- **Metrics** — turnover, tenure, mood, participation, recognition, engagement per employee.
- **Report** — preview, then PDF.

## The audit against your Claude numbers

After the three Augusts are built, produce a side-by-side: for each location and each headline number (total, active, inactive, turnover %, pulse, check-in participation, departures, likes / comments / logins / recognitions), tool value vs your Claude value, with the gap.

Where they differ, trace the cause rather than overwrite it — almost always exclusions, merges, or departures dated before hire. Your figures stay stored as "as published" alongside the calculated ones, so both are visible in the report and neither is lost.

## What I need from you

- Names and email domains for the two locations not yet created.
- The August files for all three (roster, mood/logins, recognition).
- Your Claude numbers for August, per location, so the audit has something to compare against.

## Technical notes

- New clients via the existing `clients` flow (name, code, `expected_domains`, logo).
- Imports reuse the current queue: SHA-256 duplicate guard, tab sniffing, kind/period override, `raw_imports` + `raw_records`.
- Per-client decisions live in `exclusions`, `record_merges`, `role_mappings`, `department_rules` — no cross-client inheritance today.
- Group comparison uses the existing all-active-client peer averages in `report-load.ts`.
- Audit output: a comparison table from `published_metrics` vs `historical_baselines`, saved per location.
