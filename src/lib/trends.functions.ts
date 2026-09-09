import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TrendPoint = {
  period: string;
  headcountActive: number | null;
  turnoverPct: number | null;
  moodPerEmployee: number | null;
  checkedInPct: number | null;
  recognitionsCount: number | null;
};

export type ClientTrend = {
  clientId: string;
  clientName: string;
  points: TrendPoint[];
};

const KEYS: Record<string, keyof Omit<TrendPoint, "period">> = {
  headcount_active: "headcountActive",
  turnover_pct: "turnoverPct",
  mood_per_employee: "moodPerEmployee",
  checked_in_pct: "checkedInPct",
  recognitions_count: "recognitionsCount",
};

export const getTrends = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ clients: ClientTrend[] }> => {
    const { supabase } = context;

    const [{ data: clients, error }, { data: rows, error: metricError }] = await Promise.all([
      supabase.from("clients").select("id, name, active").order("name"),
      supabase
        .from("published_metrics")
        .select("client_id, period, metric_key, scope, value_numeric")
        .eq("scope", "company")
        .in("metric_key", Object.keys(KEYS)),
    ]);
    if (error) throw new Error(error.message);
    if (metricError) throw new Error(metricError.message);

    const byClient = new Map<string, Map<string, TrendPoint>>();
    for (const row of (rows ?? []) as any[]) {
      const periods = byClient.get(row.client_id) ?? new Map<string, TrendPoint>();
      byClient.set(row.client_id, periods);
      const point =
        periods.get(row.period) ??
        ({
          period: row.period,
          headcountActive: null,
          turnoverPct: null,
          moodPerEmployee: null,
          checkedInPct: null,
          recognitionsCount: null,
        } satisfies TrendPoint);
      const field = KEYS[row.metric_key];
      if (field && row.value_numeric !== null) point[field] = Number(row.value_numeric);
      periods.set(row.period, point);
    }

    return {
      clients: ((clients ?? []) as any[])
        .filter((c) => c.active !== false)
        .map((c) => ({
          clientId: c.id,
          clientName: c.name,
          points: [...(byClient.get(c.id)?.values() ?? [])].sort((a, b) =>
            a.period.localeCompare(b.period),
          ),
        }))
        .filter((c) => c.points.length > 0),
    };
  });
