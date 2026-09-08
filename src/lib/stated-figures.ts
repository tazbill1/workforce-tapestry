/**
 * Some exports arrive already summarised: a title row, then label/value pairs
 * ("Mean of user averages | 90.54"). Those sheets carry no per-person detail,
 * so instead of forcing them through the roster/mood parsers we lift the
 * headline numbers off them and store them as stated figures with provenance.
 * They are never mixed into computed metrics — they sit beside them so a
 * mismatch is visible.
 */

export type StatedFigure = {
  metric_key: string;
  label: string;
  value: number;
  unit: string | null;
  raw_label: string;
};

type Rule = { key: string; label: string; unit: string | null; test: RegExp; not?: RegExp };

const RULES: Rule[] = [
  { key: "mood_score", label: "Mood score", unit: "score", test: /(mean of user averages|average mood|mood score|pulse score|overall mood)/ },
  { key: "users_with_mood", label: "People with at least one mood day", unit: "people", test: /users? with (>=|at least )?\s*1? ?(august |month |monthly )?mood/ },
  { key: "users_without_mood", label: "People with no mood entry", unit: "people", test: /users? with no .*mood/ },
  { key: "users_on_login_sheet", label: "People on the login sheet", unit: "people", test: /users? on (the )?login sheet/ },
  { key: "users_logged_in", label: "People who logged in", unit: "people", test: /logged in (since|on or after|during)/ },
  { key: "not_logged_in", label: "People who did not log in", unit: "people", test: /(last login before|never logged in|not logged in|no login)/ },
  { key: "records_total", label: "Total records", unit: "people", test: /(total users|all users|total records|total people|total headcount)/ },
  { key: "headcount_active", label: "Active", unit: "people", test: /\bactive\b/, not: /inactive/ },
  { key: "headcount_inactive", label: "Inactive", unit: "people", test: /inactive/ },
  { key: "turnover_pct", label: "Turnover", unit: "%", test: /turnover/ },
  { key: "mood_users_below_100", label: "People averaging below 100", unit: "people", test: /average.*(<|below|under) ?100/ },
  { key: "mood_users_at_100", label: "People averaging 100", unit: "people", test: /average ?(=|of|at) ?100/ },
];

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[,$\s]/g, "");
  const pct = cleaned.endsWith("%");
  const num = Number(pct ? cleaned.slice(0, -1) : cleaned);
  if (!Number.isFinite(num) || cleaned === "") return null;
  return pct ? num : num;
};

/** True when the sheet reads like a summary (few rows, label/value pairs) rather than a record list. */
export function looksLikeSummary(rows: Record<string, unknown>[]): boolean {
  if (rows.length === 0 || rows.length > 80) return false;
  return extractStatedFigures(rows).length >= 2;
}

export function extractStatedFigures(rows: Record<string, unknown>[]): StatedFigure[] {
  const found = new Map<string, StatedFigure>();

  for (const row of rows) {
    const cells = Object.values(row);
    const rawLabel = cells.find((cell) => typeof cell === "string" && cell.trim().length > 1);
    if (typeof rawLabel !== "string") continue;
    const label = rawLabel.toLowerCase().trim();
    if (label.length > 90) continue;

    let value: number | null = null;
    for (const cell of cells) {
      if (cell === rawLabel) continue;
      const parsed = toNumber(cell);
      if (parsed !== null) {
        value = parsed;
        break;
      }
    }
    if (value === null) continue;

    for (const rule of RULES) {
      if (!rule.test.test(label)) continue;
      if (rule.not?.test(label)) continue;
      if (found.has(rule.key)) break;
      const scaled = rule.unit === "%" && value > 0 && value <= 1 ? value * 100 : value;
      found.set(rule.key, {
        metric_key: rule.key,
        label: rule.label,
        value: Math.round(scaled * 100) / 100,
        unit: rule.unit,
        raw_label: rawLabel.trim(),
      });
      break;
    }
  }

  return [...found.values()];
}
