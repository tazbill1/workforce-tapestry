import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ClientAlert = {
  level: "warn" | "info";
  message: string;
};

export type ClientSummary = {
  id: string;
  name: string;
  code: string;
  logoUrl: string | null;
  latestPeriod: string | null;
  headcount: number;
  ready: boolean;
  metricCount: number;
  latestImportAt: string | null;
  latestImportPeriod: string | null;
  latestReportAt: string | null;
  turnoverPct: number | null;
  moodPerEmployee: number | null;
  alerts: ClientAlert[];
};

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function priorMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y!, (m ?? 1) - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export const getConsoleOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ clients: ClientSummary[] }> => {
    const { supabase } = context;

    const [{ data: clients, error }, pp, ready, metrics, imports, runs] = await Promise.all([
      supabase.from("clients").select("id, name, code, logo_url, active").order("name"),
      supabase.from("person_period").select("client_id, period, is_excluded"),
      supabase.from("period_readiness").select("client_id, period"),
      supabase
        .from("published_metrics")
        .select("client_id, period, metric_key, scope, value_numeric, computed_at"),
      supabase.from("raw_imports").select("client_id, period, uploaded_at, state"),
      supabase.from("report_runs").select("client_id, period, created_at"),
    ]);
    if (error) throw new Error(error.message);

    const latestPeriod = new Map<string, string>();
    const headcount = new Map<string, number>();
    for (const row of (pp.data ?? []) as any[]) {
      const cur = latestPeriod.get(row.client_id);
      if (!cur || row.period > cur) latestPeriod.set(row.client_id, row.period);
    }
    for (const row of (pp.data ?? []) as any[]) {
      if (row.period !== latestPeriod.get(row.client_id)) continue;
      if (row.is_excluded) continue;
      headcount.set(row.client_id, (headcount.get(row.client_id) ?? 0) + 1);
    }

    const readySet = new Set((ready.data ?? []).map((r: any) => `${r.client_id}|${r.period}`));
    const metricCount = new Map<string, number>();
    const metricValue = new Map<string, number>();
    const metricComputedAt = new Map<string, string>();
    for (const row of (metrics.data ?? []) as any[]) {
      const key = `${row.client_id}|${row.period}`;
      metricCount.set(key, (metricCount.get(key) ?? 0) + 1);
      if (row.scope === "company" && row.value_numeric !== null) {
        metricValue.set(`${key}|${row.metric_key}`, Number(row.value_numeric));
      }
      const cur = metricComputedAt.get(key);
      if (row.computed_at && (!cur || row.computed_at > cur)) {
        metricComputedAt.set(key, row.computed_at);
      }
    }

    const latest = (rows: any[], tsKey: string) => {
      const m = new Map<string, any>();
      for (const r of rows ?? []) {
        const cur = m.get(r.client_id);
        if (!cur || r[tsKey] > cur[tsKey]) m.set(r.client_id, r);
      }
      return m;
    };
    const lastImport = latest(imports.data ?? [], "uploaded_at");
    const lastRun = latest(runs.data ?? [], "created_at");

    // Newest imported period per client, and the newest upload timestamp within a period.
    const importPeriodMax = new Map<string, string>();
    const importAtForPeriod = new Map<string, string>();
    for (const r of (imports.data ?? []) as any[]) {
      const cur = importPeriodMax.get(r.client_id);
      if (!cur || r.period > cur) importPeriodMax.set(r.client_id, r.period);
      const key = `${r.client_id}|${r.period}`;
      const at = importAtForPeriod.get(key);
      if (!at || r.uploaded_at > at) importAtForPeriod.set(key, r.uploaded_at);
    }

    const thisMonth = currentMonth();
    const lastMonth = priorMonth(thisMonth);

    return {
      clients: ((clients ?? []) as any[])
        .filter((c) => c.active !== false)
        .map((c) => {
          const period = latestPeriod.get(c.id) ?? null;
          const key = period ? `${c.id}|${period}` : "";
          const importPeriod = importPeriodMax.get(c.id) ?? null;
          const run = lastRun.get(c.id) ?? null;
          const alerts: ClientAlert[] = [];

          if (!importPeriod) {
            alerts.push({ level: "warn", message: "No files uploaded yet." });
          } else if (importPeriod < lastMonth) {
            alerts.push({ level: "warn", message: "No files uploaded for last month yet." });
          }

          if (importPeriod && (!period || period < importPeriod)) {
            alerts.push({
              level: "warn",
              message: "Newer files uploaded — the people list needs rebuilding.",
            });
          }

          if (period) {
            const computedAt = metricComputedAt.get(key) ?? null;
            const importedAt = importAtForPeriod.get(key) ?? null;
            if (!computedAt) {
              alerts.push({ level: "warn", message: "No numbers published for the latest month." });
            } else if (importedAt && importedAt > computedAt) {
              alerts.push({
                level: "warn",
                message: "Files changed after the numbers were built — rebuild the numbers.",
              });
            }
            if (!readySet.has(key)) {
              alerts.push({ level: "info", message: "Latest month is not signed off yet." });
            }
            if (run && run.period === period) {
              const computed = metricComputedAt.get(`${c.id}|${run.period}`);
              if (computed && run.created_at < computed) {
                alerts.push({
                  level: "warn",
                  message: "The last report was made before the numbers were rebuilt.",
                });
              }
            }
          }

          const num = (k: string) => {
            const v = metricValue.get(`${key}|${k}`);
            return v === undefined ? null : v;
          };

          return {
            id: c.id,
            name: c.name,
            code: c.code,
            logoUrl: c.logo_url ?? null,
            latestPeriod: period,
            headcount: headcount.get(c.id) ?? 0,
            ready: period ? readySet.has(key) : false,
            metricCount: metricCount.get(key) ?? 0,
            latestImportAt: lastImport.get(c.id)?.uploaded_at ?? null,
            latestImportPeriod: importPeriod,
            latestReportAt: run?.created_at ?? null,
            turnoverPct: num("turnover_pct"),
            moodPerEmployee: num("mood_per_employee"),
            alerts,
          };
        }),
    };
  });
