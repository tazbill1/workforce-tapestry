/**
 * Pure helpers for the report template.
 *
 * The hard rule for this layer: the view performs no calculation. Everything numeric that
 * appears in the report is looked up here from a snapshot of `published_metrics`. If a lookup
 * misses, the report renders an em dash — that is a gap in the metrics layer to be closed
 * there, never patched with arithmetic in the template.
 */

export type MetricRow = {
  /** Present when the row was loaded for a report run, so the run can record its provenance. */
  id?: string;
  metric_key: string;
  definition_version: number;
  scope: string;
  value_numeric: number | string | null;
  value_text?: string | null;
  period: string;
};


export type MetricBook = {
  /** Current-period value at the highest stored definition version. */
  get: (key: string, scope?: string) => number | null;
  /** Prior-period value at the same scope, for comparison columns. */
  prior: (key: string, scope?: string) => number | null;
  /** Definition version behind the current-period value, for the trace line. */
  version: (key: string, scope?: string) => number | null;
  /** Current-period text value, e.g. a named top contributor. */
  text: (key: string, scope?: string) => string | null;
  /** Scopes present for a key, e.g. every `dept:` bucket with a recognition count. */
  scopesFor: (key: string, prefix: string) => string[];
};

const toNumber = (value: number | string | null): number | null => {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function buildMetricBook(
  rows: MetricRow[],
  period: string,
  priorPeriod: string,
): MetricBook {
  type Entry = { version: number; value: number | null; text: string | null };
  const index = new Map<string, Entry>();
  const scopeIndex = new Map<string, Set<string>>();

  for (const row of rows) {
    const which = row.period === period ? "now" : row.period === priorPeriod ? "prior" : null;
    if (!which) continue;
    const key = `${which}::${row.metric_key}::${row.scope}`;
    const existing = index.get(key);
    if (!existing || row.definition_version > existing.version) {
      index.set(key, {
        version: row.definition_version,
        value: toNumber(row.value_numeric),
        text: row.value_text ?? null,
      });
    }
    if (which === "now") {
      const set = scopeIndex.get(row.metric_key) ?? new Set<string>();
      set.add(row.scope);
      scopeIndex.set(row.metric_key, set);
    }
  }

  const read = (which: string, key: string, scope: string) =>
    index.get(`${which}::${key}::${scope}`) ?? null;

  return {
    get: (key, scope = "company") => read("now", key, scope)?.value ?? null,
    prior: (key, scope = "company") => read("prior", key, scope)?.value ?? null,
    version: (key, scope = "company") => read("now", key, scope)?.version ?? null,
    text: (key, scope = "company") => read("now", key, scope)?.text ?? null,
    scopesFor: (key, prefix) =>
      [...(scopeIndex.get(key) ?? [])].filter((scope) => scope.startsWith(prefix)).sort(),
  };
}

export const scopeLabel = (scope: string) => scope.slice(scope.indexOf(":") + 1);

/* ---------- formatting ---------- */

export const DASH = "—";

export function fmtInt(value: number | null): string {
  return value === null ? DASH : Math.round(value).toLocaleString("en-US");
}

export function fmtPct(value: number | null, digits = 1): string {
  return value === null ? DASH : `${value.toFixed(digits)}%`;
}

export function fmtNum(value: number | null, digits = 1): string {
  return value === null ? DASH : value.toFixed(digits);
}

/** Signed percentage-point delta for comparison columns. */
export function fmtDeltaPp(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return DASH;
  const delta = Math.round((current - previous) * 10) / 10;
  if (delta === 0) return "0.0";
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`;
}

export function fmtDeltaInt(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return DASH;
  const delta = Math.round(current - previous);
  if (delta === 0) return "0";
  return `${delta > 0 ? "+" : ""}${delta}`;
}

export function fmtDate(value: string | null): string {
  if (!value) return DASH;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function periodLabel(period: string): string {
  const date = new Date(`${period}T00:00:00Z`);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function periodShort(period: string): string {
  const date = new Date(`${period}T00:00:00Z`);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/* ---------- design tokens ---------- */

export const TOKENS = {
  navy: "#1D224B",
  blue: "#1F5FAE",
  cyan: "#00BFE4",
  lime: "#C8D914",
  body: "#2C3143",
  muted: "#6B7280",
  panel: "#F4F5F8",
  rule: "#DDE1EA",
  highlight: "#FBE4E4",
  priorBar: "#C9CEDD",
  gridline: "#EEF0F5",
  axis: "#4B5162",
} as const;
