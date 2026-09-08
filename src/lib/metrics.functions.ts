import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { METRIC_DEFINITIONS, computeMetrics } from "./metrics-core";
import {
  ensureDefinitions,
  loadManualInputs,
  loadPersonPeriod,
  loadRecognitionActivity,
  persistMetrics,
  priorPeriodOf,
} from "./metrics-load";

const scope = z.object({
  clientId: z.string().uuid(),
  period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const listMetricDefinitions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("metric_definitions")
      .select("key, version, description, formula_note, effective_from")
      .order("key")
      .order("version");
    if (error) throw new Error(error.message);
    const superseded = new Set(
      METRIC_DEFINITIONS.filter((d) => d.superseded).map((d) => `${d.key}::${d.version}`),
    );
    return (data ?? []).map((row) => ({
      ...row,
      superseded: superseded.has(`${row.key}::${row.version}`),
    }));
  });

export const seedMetricDefinitions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => ({ seeded: await ensureDefinitions(context.supabase) }));

export const listMetricPeriods = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string }) =>
    z.object({ clientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const [built, published] = await Promise.all([
      context.supabase.from("person_period").select("period").eq("client_id", data.clientId),
      context.supabase.from("published_metrics").select("period").eq("client_id", data.clientId),
    ]);
    if (built.error) throw new Error(built.error.message);
    if (published.error) throw new Error(published.error.message);
    const periods = new Set([
      ...(built.data ?? []).map((row) => row.period),
      ...(published.data ?? []).map((row) => row.period),
    ]);
    return [...periods].sort().reverse();
  });

export const rebuildMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; period: string }) => scope.parse(input))
  .handler(async ({ data, context }) => {
    await ensureDefinitions(context.supabase);
    const rows = await loadPersonPeriod(context.supabase, data.clientId, data.period);
    if (rows.length === 0) {
      throw new Error(
        "No person_period rows for that client and period. Rebuild the assembly layer first.",
      );
    }
    const priorPeriod = priorPeriodOf(data.period);
    const priorRows = await loadPersonPeriod(context.supabase, data.clientId, priorPeriod);
    const { engagement, recognitions } = await loadManualInputs(
      context.supabase,
      data.clientId,
      data.period,
    );
    const activity = await loadRecognitionActivity(
      context.supabase,
      data.clientId,
      data.period,
    );
    const { data: benchmarkRows, error: benchmarkError } = await context.supabase
      .from("role_benchmarks")
      .select("role_code, turnover_pct");
    if (benchmarkError) throw new Error(benchmarkError.message);
    const metrics = computeMetrics({
      period: data.period,
      rows,
      priorRows,
      engagement,
      recognitions,
      activity,
      benchmarks: benchmarkRows ?? [],
    });

    const written = await persistMetrics(context.supabase, data.clientId, data.period, metrics);
    return {
      written,
      priorPeriod,
      priorRows: priorRows.length,
      hasEngagement: engagement !== null,
      recognitionDepartments: recognitions.length,
      activityRows: activity.length,
    };
  });

/**
 * Read-time view. Deltas are never stored: the prior-period value is fetched at the same
 * scope and definition version, so restating the prior period corrects the delta for free.
 */
export const listMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; period: string }) => scope.parse(input))
  .handler(async ({ data, context }) => {
    const priorPeriod = priorPeriodOf(data.period);
    const { data: rows, error } = await context.supabase
      .from("published_metrics")
      .select("metric_key, definition_version, scope, value_numeric, value_text, computed_at, period")
      .eq("client_id", data.clientId)
      .in("period", [data.period, priorPeriod])
      .order("metric_key")
      .order("scope")
      .limit(20000);
    if (error) throw new Error(error.message);

    const priorMap = new Map<string, number | null>();
    for (const row of rows ?? []) {
      if (row.period !== priorPeriod) continue;
      priorMap.set(`${row.metric_key}::${row.scope}::${row.definition_version}`, row.value_numeric);
    }
    return {
      priorPeriod,
      rows: (rows ?? [])
        .filter((row) => row.period === data.period)
        .map((row) => ({
          metric_key: row.metric_key,
          definition_version: row.definition_version,
          scope: row.scope,
          value_numeric: row.value_numeric,
          value_text: row.value_text,
          computed_at: row.computed_at,
          prior_value:
            priorMap.get(`${row.metric_key}::${row.scope}::${row.definition_version}`) ?? null,
        })),
    };
  });

/** Headline figures as they appeared in previously issued PDF reports, alongside the
 * company-scope value the tool computes today. Baselines are never mixed into
 * published_metrics: they carry their own provenance and are for trend comparison only. */
const BASELINE_TO_METRIC: Record<string, string | null> = {
  records_total: "roster_size",
  headcount_active: "headcount_active",
  headcount_inactive: "headcount_inactive",
  turnover_pct: "turnover_pct",
  mood_score: "mood_per_employee",
  not_logged_in: null,
};

export const listBaselines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string }) =>
    z.object({ clientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const [baselines, published] = await Promise.all([
      context.supabase
        .from("historical_baselines")
        .select("period, metric_key, label, value_numeric, unit, source, source_note")
        .eq("client_id", data.clientId)
        .order("period", { ascending: false })
        .order("metric_key"),
      context.supabase
        .from("published_metrics")
        .select("period, metric_key, definition_version, value_numeric, computed_at")
        .eq("client_id", data.clientId)
        .eq("scope", "company")
        .limit(20000),
    ]);
    if (baselines.error) throw new Error(baselines.error.message);
    if (published.error) throw new Error(published.error.message);

    // Latest definition version wins for each period/metric.
    const current = new Map<string, { value: number | null; version: number }>();
    for (const row of published.data ?? []) {
      const key = `${row.period}::${row.metric_key}`;
      const seen = current.get(key);
      if (!seen || row.definition_version >= seen.version) {
        current.set(key, { value: row.value_numeric, version: row.definition_version });
      }
    }

    return (baselines.data ?? []).map((row) => {
      const mapped = BASELINE_TO_METRIC[row.metric_key] ?? null;
      const hit = mapped ? current.get(`${row.period}::${mapped}`) : undefined;
      const published_value = hit?.value ?? null;
      const diff =
        row.value_numeric === null || published_value === null
          ? null
          : Math.round((Number(published_value) - Number(row.value_numeric)) * 100) / 100;
      return { ...row, tool_metric_key: mapped, tool_value: published_value, diff };
    });
  });
