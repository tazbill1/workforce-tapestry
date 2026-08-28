/**
 * Pre-flight sanity checks for a report: is this data really this client's, and really this
 * period's? Everything here is advisory — we warn, we never block — but a "danger" finding means
 * the report almost certainly names the wrong client or the wrong date range.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

export type CheckLevel = "danger" | "warning" | "info";

export type ReportCheck = {
  id: string;
  level: CheckLevel;
  title: string;
  detail: string;
};

function monthBounds(period: string) {
  const start = new Date(`${period}T00:00:00Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return { start, end };
}

function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

const monthName = (period: string) =>
  new Date(`${period}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

const emailDomain = (email: string) => email.slice(email.indexOf("@") + 1).toLowerCase();

export async function runReportChecks(
  supabase: Client,
  clientId: string,
  period: string,
): Promise<ReportCheck[]> {
  const checks: ReportCheck[] = [];
  const { start, end } = monthBounds(period);

  const [clientRow, imports, people, metrics, insights, readiness] = await Promise.all([
    supabase.from("clients").select("id, name, code, active").eq("id", clientId).maybeSingle(),
    supabase
      .from("raw_imports")
      .select("id, kind, part_label, original_filename, covers_from, covers_to, state, row_count")
      .eq("client_id", clientId)
      .eq("period", period)
      .is("superseded_by", null),
    supabase
      .from("person_period")
      .select("normalized_email, is_excluded, status, built_at")
      .eq("client_id", clientId)
      .eq("period", period),
    supabase
      .from("published_metrics")
      .select("metric_key, computed_at")
      .eq("client_id", clientId)
      .eq("period", period),
    supabase
      .from("saved_insights")
      .select("id, title, client_id, period")
      .eq("include_in_report", true),
    supabase
      .from("period_readiness")
      .select("id")
      .eq("client_id", clientId)
      .eq("period", period)
      .maybeSingle(),
  ]);

  const clientName = clientRow.data?.name ?? "this client";

  // --- Period plausibility -------------------------------------------------
  const now = new Date();
  if (start > now) {
    checks.push({
      id: "future-period",
      level: "danger",
      title: "Period is in the future",
      detail: `${monthName(period)} has not happened yet. Check the period selector before sending this report.`,
    });
  } else if ((now.getTime() - end.getTime()) / 86_400_000 > 550) {
    checks.push({
      id: "stale-period",
      level: "warning",
      title: "Period is over 18 months old",
      detail: `You are building a report for ${monthName(period)}. Confirm this is intentional and not a mis-picked date.`,
    });
  }

  if (clientRow.data && clientRow.data.active === false) {
    checks.push({
      id: "inactive-client",
      level: "warning",
      title: "Client is marked inactive",
      detail: `${clientName} is flagged inactive. Confirm you meant to report on this client.`,
    });
  }

  // --- Source files: do they actually cover this month? --------------------
  const importRows = imports.data ?? [];
  const parsed = importRows.filter((r) => r.state === "parsed");

  if (parsed.length === 0) {
    checks.push({
      id: "no-imports",
      level: "danger",
      title: "No parsed source files for this period",
      detail: `Nothing has been imported and parsed for ${clientName} · ${monthName(period)}. The report would be built on data carried in from elsewhere, or on nothing at all.`,
    });
  }

  const outOfRange = parsed.filter((r) => {
    const from = r.covers_from ? new Date(`${r.covers_from}T00:00:00Z`) : null;
    const to = r.covers_to ? new Date(`${r.covers_to}T00:00:00Z`) : null;
    if (!from && !to) return false;
    // Any overlap with the report month is fine; zero overlap is a mismatch.
    if (to && to < start) return true;
    if (from && from > end) return true;
    return false;
  });
  if (outOfRange.length > 0) {
    checks.push({
      id: "coverage-mismatch",
      level: "danger",
      title: "A source file covers a different date range",
      detail: `${outOfRange
        .map(
          (r) =>
            `${r.original_filename ?? r.kind} (${r.covers_from ?? "?"} → ${r.covers_to ?? "?"})`,
        )
        .join("; ")} does not overlap ${monthName(period)} (${fmt(start)} → ${fmt(end)}). This file was probably filed under the wrong period.`,
    });
  }

  const partial = parsed.filter((r) => {
    const from = r.covers_from ? new Date(`${r.covers_from}T00:00:00Z`) : null;
    const to = r.covers_to ? new Date(`${r.covers_to}T00:00:00Z`) : null;
    if (!from || !to) return false;
    if (to < start || from > end) return false; // handled above
    return from > start || to < end;
  });
  if (partial.length > 0) {
    checks.push({
      id: "partial-coverage",
      level: "warning",
      title: "A source file covers only part of the month",
      detail: `${partial
        .map((r) => `${r.original_filename ?? r.kind} (${r.covers_from} → ${r.covers_to})`)
        .join("; ")} covers less than the full ${monthName(period)} window. Totals may undercount.`,
    });
  }

  if (parsed.length > 0 && !parsed.some((r) => r.kind === "roster")) {
    checks.push({
      id: "no-roster",
      level: "warning",
      title: "No roster file for this period",
      detail: `Headcount, turnover and tenure all come from the roster. None was imported for ${monthName(period)}.`,
    });
  }

  // --- Assembled people ----------------------------------------------------
  const peopleRows = people.data ?? [];
  const included = peopleRows.filter((p) => !p.is_excluded);
  if (peopleRows.length === 0) {
    checks.push({
      id: "no-people",
      level: "danger",
      title: "No assembled people for this period",
      detail: `${clientName} has no person rows built for ${monthName(period)}. Run Assembly before reporting.`,
    });
  }

  // --- Wrong-client detection: whose roster is this, really? ---------------
  if (included.length >= 10) {
    const emails = new Set(included.map((p) => p.normalized_email));

    const { data: otherClients } = await supabase
      .from("clients")
      .select("id, name")
      .neq("id", clientId);

    for (const other of otherClients ?? []) {
      const { data: otherPeople } = await supabase
        .from("person_period")
        .select("normalized_email")
        .eq("client_id", other.id)
        .eq("is_excluded", false)
        .limit(5000);
      const otherEmails = new Set((otherPeople ?? []).map((p) => p.normalized_email));
      if (otherEmails.size < 10) continue;
      let shared = 0;
      for (const e of emails) if (otherEmails.has(e)) shared += 1;
      const overlap = shared / emails.size;
      if (overlap >= 0.5) {
        checks.push({
          id: `cross-client-${other.id}`,
          level: "danger",
          title: "This roster looks like another client's",
          detail: `${Math.round(overlap * 100)}% of the people in this report (${shared} of ${emails.size}) also appear under ${other.name}. Confirm the files were uploaded to the right client.`,
        });
      } else if (overlap >= 0.15) {
        checks.push({
          id: `cross-client-soft-${other.id}`,
          level: "warning",
          title: `Some people overlap with ${other.name}`,
          detail: `${shared} of ${emails.size} people also appear under ${other.name}. That is expected for shared corporate staff — otherwise check for a mis-filed upload.`,
        });
      }
    }

    // Domain sanity: one dominant work domain is normal; a second large one can mean a mixed file.
    const domainCounts = new Map<string, number>();
    for (const p of included) {
      const d = emailDomain(p.normalized_email);
      domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
    }
    const ranked = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]);
    const second = ranked[1];
    if (ranked[0] && second && second[1] / included.length >= 0.25) {
      checks.push({
        id: "mixed-domains",
        level: "warning",
        title: "Two large email domains in one roster",
        detail: `${ranked[0][0]} (${ranked[0][1]}) and ${second[0]} (${second[1]}) each make up a big share of this roster. If ${second[0]} is a different company, the wrong file may have been imported.`,
      });
    }
  }

  // --- Metrics freshness ---------------------------------------------------
  const metricRows = metrics.data ?? [];
  if (metricRows.length === 0) {
    checks.push({
      id: "no-metrics",
      level: "danger",
      title: "No published metrics for this period",
      detail: `Rebuild metrics for ${monthName(period)} before generating; the report reads published numbers only.`,
    });
  } else if (peopleRows.length > 0) {
    const builtAt = Math.max(...peopleRows.map((p) => new Date(p.built_at).getTime()));
    const computedAt = Math.max(...metricRows.map((m) => new Date(m.computed_at).getTime()));
    if (builtAt > computedAt) {
      checks.push({
        id: "stale-metrics",
        level: "warning",
        title: "Metrics are older than the assembled data",
        detail: `People were rebuilt after the last metrics run for ${monthName(period)}. Rebuild metrics so the report matches Assembly.`,
      });
    }
  }

  if (!readiness.data) {
    checks.push({
      id: "not-ready",
      level: "info",
      title: "Period not marked ready",
      detail: `${monthName(period)} has not passed the Decisions review gate. You can still generate, but findings may change.`,
    });
  }

  // --- Pinned insights from another client or period -----------------------
  const strayInsights = (insights.data ?? []).filter(
    (i) =>
      (i.client_id !== null && i.client_id !== clientId) ||
      (i.period !== null && i.period !== period),
  );
  if (strayInsights.length > 0) {
    checks.push({
      id: "stray-insights",
      level: "warning",
      title: "Pinned insights from another client or period",
      detail: `${strayInsights
        .slice(0, 4)
        .map((i) => i.title)
        .join("; ")}${strayInsights.length > 4 ? ` and ${strayInsights.length - 4} more` : ""} were pinned for a different client or month. Unpin them in Ask before sending this report.`,
    });
  }

  return checks;
}
