import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  latestReportAt: string | null;
};

export const getConsoleOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ clients: ClientSummary[] }> => {
    const { supabase } = context;

    const [{ data: clients, error }, pp, ready, metrics, imports, runs] = await Promise.all([
      supabase.from("clients").select("id, name, code, logo_url, active").order("name"),
      supabase.from("person_period").select("client_id, period, is_excluded"),
      supabase.from("period_readiness").select("client_id, period"),
      supabase.from("published_metrics").select("client_id, period"),
      supabase.from("raw_imports").select("client_id, uploaded_at"),
      supabase.from("report_runs").select("client_id, created_at"),
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
    for (const row of (metrics.data ?? []) as any[]) {
      const key = `${row.client_id}|${row.period}`;
      metricCount.set(key, (metricCount.get(key) ?? 0) + 1);
    }

    const latest = (rows: any[], idKey: string, tsKey: string) => {
      const m = new Map<string, string>();
      for (const r of rows ?? []) {
        const cur = m.get(r[idKey]);
        if (!cur || r[tsKey] > cur) m.set(r[idKey], r[tsKey]);
      }
      return m;
    };
    const lastImport = latest(imports.data ?? [], "client_id", "uploaded_at");
    const lastRun = latest(runs.data ?? [], "client_id", "created_at");

    return {
      clients: ((clients ?? []) as any[])
        .filter((c) => c.active !== false)
        .map((c) => {
          const period = latestPeriod.get(c.id) ?? null;
          const key = period ? `${c.id}|${period}` : "";
          return {
            id: c.id,
            name: c.name,
            code: c.code,
            logoUrl: c.logo_url ?? null,
            latestPeriod: period,
            headcount: headcount.get(c.id) ?? 0,
            ready: period ? readySet.has(key) : false,
            metricCount: metricCount.get(key) ?? 0,
            latestImportAt: lastImport.get(c.id) ?? null,
            latestReportAt: lastRun.get(c.id) ?? null,
          };
        }),
    };
  });
