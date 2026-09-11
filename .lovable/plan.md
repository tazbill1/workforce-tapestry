# Update the report to the new format

## Goal
Bring the reporting tool in line with the redesigned August report while preserving the tool’s audit trail. Where uploaded published figures and calculated figures disagree, show both and label their sources instead of silently choosing one.

## What will change

### 1. Report data and definitions
- Change the recent-hire cohort from under two years to under one year, with a new metric-definition version so older published results remain intact.
- Publish mood at role level, engagement totals per active employee, and the existing one-year cohort results at dealership level.
- Calculate group comparisons from every active client that has published metrics for the selected month. Exclude the client being viewed from its peer average and show an em dash when no peer data exists.
- Add report-ready breakdowns for missed check-ins and low mood by department, dealership, and role.
- Change anniversaries to the month after the report period while keeping new starters tied to the report month.

### 2. Calculated versus as-published figures
- Load the period’s saved published figures alongside calculated metrics.
- On summary and relevant detail pages, show both values when they differ, with clear “Calculated” and “As published” labels and source notes.
- Keep calculated metrics as the basis for charts, comparisons, and downstream analysis; never overwrite them with PDF figures.
- Include both sets in immutable report snapshots so prior report versions remain reproducible.

### 3. Recognition-points spreadsheet upload
- Add a new monthly spreadsheet type for manager recognition-point allocations and usage.
- Detect common column names for manager, title, department, allocated points, and points given, while allowing the user to confirm the file type and worksheet.
- Store the original file privately, retain immutable imported rows, prevent duplicate uploads, and flag invalid or missing numeric values.
- Add a monthly recognition-points table with client access rules matching the rest of the reporting data.
- Publish total allocated, total given, utilization percentage, manager count, zero-use manager count, and department totals.

### 4. Redesigned report pages
- Update the portrait report’s structure and styling to follow the supplied 21-page example: stronger cover, executive summary, dealership overview, role/group comparisons, engagement-per-person views, detailed check-in and low-mood breakdowns, recognition utilization, next-month anniversaries, departures, examples/surveys, and action plan.
- Add concise, deterministic executive-summary statements generated only from stored metrics and approved published figures.
- Preserve existing survey, analyst insight, notes, action-plan, PDF export, sharing, report-history, and snapshot behavior.
- Keep landscape, wide, and executive formats usable, with their existing section controls and appropriate compact layouts.

### 5. Validation
- Rebuild August metrics after the definition changes.
- Verify the Michigan preview displays calculated and published values side by side for the known differences.
- Test spreadsheet detection, duplicate prevention, malformed rows, zero allocations, and missing peer data.
- Verify portrait and compact report formats visually, including page boundaries, tables, charts, and PDF export.
- Confirm report snapshots retain the exact figures, group comparisons, and recognition-point rows used for each version.

## Technical details
- Add a migration for the new import type, recognition-point rows, grants, indexes, and client-scoped RLS policies.
- Extend the existing import parser and authenticated import functions rather than introducing a separate upload system.
- Extend metric definitions and computation with versioned keys; the report view will continue to perform no metric arithmetic.
- Load peer averages, historical baselines, and recognition-point detail through the authenticated report data layer.
- Update report section defaults without removing any client-specific section configuration.
