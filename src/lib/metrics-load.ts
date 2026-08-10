import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  METRIC_DEFINITIONS,
  type ComputedMetric,
  type EngagementRow,
  type PersonRow,
  type RecognitionRow,
} from "./metrics-core";

type Client = SupabaseClient<Database>;

const PERSON_COLUMNS =
  "normalized_email, status, franchise_label, department_raw, role_code, hire_date, departure_date_proxy, tenure_years, is_excluded, checkin_count, mood_avg, checked_in, flags";

export function priorPeriodOf(period: string): string {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 2, 1));
  return date.toISOString().slice(0, 10);
}

export async function loadPersonPeriod(
  supabase: Client,
  clientId: string,
  period: string,
): Promise<PersonRow[]> {
  const rows: PersonRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("person_period")
      .select(PERSON_COLUMNS)
      .eq("client_id", clientId)
      .eq("period", period)
      .order("normalized_email")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as PersonRow[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

export async function loadManualInputs(
  supabase: Client,
  clientId: string,
  period: string,
): Promise<{ engagement: EngagementRow | null; recognitions: RecognitionRow[] }> {
  const [engagement, recognitions] = await Promise.all([
    supabase
      .from("engagement_totals")
      .select("likes, comments, logins, recognitions")
      .eq("client_id", clientId)
      .eq("period", period)
      .maybeSingle(),
    supabase
      .from("recognition_counts")
      .select("department_raw, count")
      .eq("client_id", clientId)
      .eq("period", period),
  ]);
  if (engagement.error) throw new Error(engagement.error.message);
  if (recognitions.error) throw new Error(recognitions.error.message);
  return {
    engagement: (engagement.data as EngagementRow | null) ?? null,
    recognitions: (recognitions.data ?? []) as RecognitionRow[],
  };
}

/** Definitions are reference data; make sure every one the compute step needs exists. */
export async function ensureDefinitions(supabase: Client): Promise<number> {
  const { error } = await supabase
    .from("metric_definitions")
    .upsert(
      METRIC_DEFINITIONS.map((definition) => ({
        key: definition.key,
        version: definition.version,
        description: definition.description,
        formula_note: definition.formula_note,
        effective_from: definition.effective_from,
      })),
      { onConflict: "key,version" },
    );
  if (error) throw new Error(error.message);
  return METRIC_DEFINITIONS.length;
}

/**
 * Replace only the rows this compute run owns: same client, period, metric key AND
 * definition version. Values stored under any other version — a superseded definition
 * or an earlier exclusion set — are left untouched, which is the whole point of the layer.
 */
export async function persistMetrics(
  supabase: Client,
  clientId: string,
  period: string,
  metrics: ComputedMetric[],
): Promise<number> {
  const ownedVersions = new Set(
    metrics.map((metric) => `${metric.metric_key}::${metric.definition_version}`),
  );
  const { data: existing, error: readError } = await supabase
    .from("published_metrics")
    .select("id, metric_key, definition_version")
    .eq("client_id", clientId)
    .eq("period", period);
  if (readError) throw new Error(readError.message);
  const staleIds = (existing ?? [])
    .filter((row) => ownedVersions.has(`${row.metric_key}::${row.definition_version}`))
    .map((row) => row.id);
  for (let i = 0; i < staleIds.length; i += 200) {
    const { error } = await supabase
      .from("published_metrics")
      .delete()
      .in("id", staleIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }

  const payload = metrics.map((metric) => ({
    client_id: clientId,
    period,
    metric_key: metric.metric_key,
    definition_version: metric.definition_version,
    scope: metric.scope,
    value_numeric: metric.value_numeric,
    computed_at: new Date().toISOString(),
  }));
  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await supabase.from("published_metrics").insert(payload.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
  return payload.length;
}
