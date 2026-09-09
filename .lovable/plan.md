# Fix it from the report

Today, when something looks wrong on a report, you have to work backwards yourself: figure out which person or number is off, go to Decisions or Imports, make the change, then rebuild. This adds a "Fix it" helper right on the report page so you can describe the problem in plain words, see what the AI found and exactly what it wants to change, and approve it before anything happens.

## How it works

1. On the report preview, a "Fix this" button opens a side panel. You can also click a number or a table row to start with that spot pre-filled.
2. You type what's wrong, e.g. "Jane Doe shouldn't be in this report" or "the Service department count looks too high".
3. The AI reads the data behind the report — the people list, the decisions already made, the imported files, the metric rows — and comes back with:
   - What it believes is causing it, in plain language
   - The exact change it proposes (who/what is affected, and how the numbers would move)
   - A confidence note and what it could not confirm
4. Nothing is saved yet. You get three buttons: **Apply**, **Edit** (adjust the change before applying), **Dismiss**.
5. On Apply, the change is written using the same rules the Decisions screen already uses, then the affected period is reassembled and its metrics rebuilt, so the report refreshes with the corrected numbers.
6. Every applied fix is logged (who, when, what changed, the request that prompted it) and shown in a "Recent fixes" list on the panel, each with an Undo where the change is reversible.

## What it is allowed to change

Only the decision layer — never imported source data, which stays immutable:

- Exclude a person, or reverse an exclusion
- Merge two people, or split a shared mailbox record
- Add or edit a role mapping (title + department)
- Add or edit a department rule
- Correct engagement totals for a period
- Dismiss or confirm a flagged difference

Anything outside that list (for example, a wrong figure that traces back to a bad source file) comes back as a diagnosis with instructions and a link to the right screen, not as an automatic change.

## Safeguards

- No change is written without an explicit Apply click; the AI can propose, never commit.
- Fixes that affect more than a set number of people are marked high impact and need a second confirm.
- The preview shows before/after counts for the period so you can see the effect first.
- Everything respects existing client access rules; you can only fix clients you can already reach.

## Technical notes

- New `src/lib/fix-core.ts`: read-only diagnosis tools (person lookup by name/email, person_period rows for a period, active decisions, raw records behind a person, metric rows for a scope) plus a proposal schema describing one change as `{ action, args, affectedPeople, rationale, confidence }`.
- New `src/lib/fix.functions.ts` with `diagnoseReportIssue` (tool-calling loop against the Lovable AI gateway, mirroring `ask.functions.ts`, read-only) and `applyFixProposal` (validates the proposal server-side with Zod, re-checks impact, dispatches to the existing exported actions in `decisions.functions.ts` core logic, then calls the assembly and metrics rebuild paths).
- The apply path calls shared core logic rather than the server functions themselves, so validation and RLS scoping stay in one place.
- New table `public.fix_actions` (client_id, period, request_text, proposal jsonb, applied_by, applied_at, undo jsonb, status) with RLS matching the other client-scoped tables and GRANTs for `authenticated`/`service_role`; no anon access.
- New `src/components/FixPanel.tsx` mounted in `src/routes/_authenticated/report.tsx`; the report preview gains click targets that seed the panel's context (client, period, metric key or person).
- Snapshot/saved report versions are read-only: the panel is disabled when viewing a saved snapshot, with a note to switch to the live view.
