// Pure assembly-layer logic: roster union -> merges -> exclusions -> department
// rules -> role mappings -> mood matrix -> login report. No I/O here.

export type RosterRow = {
  import_id: string;
  normalized_email: string | null;
  email_raw: string | null;
  name_raw: string | null;
  employee_id_raw: string | null;
  title_raw: string | null;
  department_raw: string | null;
  status_raw: string | null;
  hire_date: string | null;
  created_at_src: string | null;
  modified_at_src: string | null;
  payload?: Record<string, unknown> | null;
};

export type MoodRow = {
  normalized_email: string | null;
  email_raw: string | null;
  payload: Record<string, unknown> | null;
};

export type LoginRow = {
  normalized_email: string | null;
  email_raw: string | null;
  last_login_at: string | null;
};

export type Merge = { canonical_email: string; duplicate_email: string; reason: string | null };
export type Exclusion = {
  match_type: string;
  match_value: string;
  category: string;
  reason: string | null;
  effective_from: string | null;
};
export type DepartmentRule = {
  pattern: string;
  franchise_label: string | null;
  function_label: string | null;
};
export type RoleMapping = {
  title_pattern: string;
  department_pattern: string | null;
  role_code: string;
  precedence: number;
};

export type PersonPeriodRow = {
  client_id: string;
  period: string;
  normalized_email: string;
  name: string | null;
  employee_id_raw: string | null;
  title_raw: string | null;
  department_raw: string | null;
  franchise_label: string | null;
  function_label: string | null;
  role_code: string | null;
  status: string | null;
  hire_date: string | null;
  departure_date_proxy: string | null;
  tenure_years: number | null;
  is_excluded: boolean;
  exclusion_reason: string | null;
  merged_from: string[];
  checkin_count: number | null;
  mood_avg: number | null;
  checked_in: boolean | null;
  last_login_at: string | null;
  flags: string[];
  built_at: string;
};

export const norm = (value: string | null | undefined) =>
  value ? value.trim().toLowerCase() : null;

export function periodBounds(period: string) {
  const start = new Date(`${period.slice(0, 10)}T00:00:00Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return { start, end };
}

const STATUS_RANK: Array<[RegExp, string, number]> = [
  [/^active/i, "Active", 0],
  [/^invited|^pending/i, "Invited", 1],
  [/^inactive|^terminated|^disabled/i, "Inactive", 2],
];

export function canonicalStatus(raw: string | null): { label: string | null; rank: number } {
  const value = (raw ?? "").trim();
  for (const [re, label, rank] of STATUS_RANK) {
    if (re.test(value)) return { label, rank };
  }
  return { label: value || null, rank: 3 };
}

export function patternMatches(pattern: string, value: string | null): boolean {
  if (!value) return false;
  const p = pattern.trim().toLowerCase();
  const v = value.trim().toLowerCase();
  if (!p) return false;
  if (p === v || v.includes(p)) return true;
  if (/[\\^$.*+?()[\]{}|]/.test(pattern)) {
    try {
      return new RegExp(pattern, "i").test(value);
    } catch {
      return false;
    }
  }
  return false;
}

/** Parses a spreadsheet column header that may be a date, e.g. "2026-06-03", "6/3/2026", "Jun 3". */
export function headerAsDate(header: string, year: number): Date | null {
  const value = header.trim();
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(+iso[1]!, +iso[2]! - 1, +iso[3]!));
  const us = value.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (us) {
    const rawYear = us[3];
    const y = rawYear ? (rawYear.length === 2 ? 2000 + +rawYear : +rawYear) : year;
    return new Date(Date.UTC(y, +us[1]! - 1, +us[2]!));
  }
  const parsed = Date.parse(`${value} ${year} UTC`);
  if (!Number.isNaN(parsed)) return new Date(parsed);
  return null;
}

export function moodForPeriod(
  payload: Record<string, unknown> | null,
  period: string,
): { checkin_count: number; mood_avg: number | null } {
  const { start, end } = periodBounds(period);
  let count = 0;
  let sum = 0;
  for (const [key, raw] of Object.entries(payload ?? {})) {
    const day = headerAsDate(key, start.getUTCFullYear());
    if (!day) continue;
    if (day < start || day > end) continue;
    const value =
      typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    if (!Number.isFinite(value)) continue;
    count += 1;
    sum += value;
  }
  return { checkin_count: count, mood_avg: count > 0 ? Math.round((sum / count) * 100) / 100 : null };
}

function dateOnly(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

function yearsBetween(from: string, to: Date): number {
  const start = new Date(`${from.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round(((to.getTime() - start) / (1000 * 60 * 60 * 24 * 365.25)) * 100) / 100;
}

export type BuildInput = {
  clientId: string;
  period: string;
  rosterRows: RosterRow[];
  moodRows: MoodRow[];
  loginRows: LoginRow[];
  merges: Merge[];
  exclusions: Exclusion[];
  departmentRules: DepartmentRule[];
  roleMappings: RoleMapping[];
  hasMoodImport: boolean;
  hasLoginImport: boolean;
};

export type BuildResult = {
  rows: PersonPeriodRow[];
  overlaps: Array<{ normalized_email: string; import_ids: string[] }>;
  skippedNoEmail: number;
};

export function buildPersonPeriod(input: BuildInput): BuildResult {
  const { clientId, period } = input;
  const { end } = periodBounds(period);
  const builtAt = new Date().toISOString();

  // 1. Roster union + overlap detection across parts.
  const seenIn = new Map<string, Set<string>>();
  let skippedNoEmail = 0;
  const byEmail = new Map<string, RosterRow[]>();
  for (const row of input.rosterRows) {
    const email = row.normalized_email ?? norm(row.email_raw);
    if (!email) {
      skippedNoEmail += 1;
      continue;
    }
    const set = seenIn.get(email) ?? new Set<string>();
    set.add(row.import_id);
    seenIn.set(email, set);
    byEmail.set(email, [...(byEmail.get(email) ?? []), { ...row, normalized_email: email }]);
  }
  const overlaps = [...seenIn.entries()]
    .filter(([, set]) => set.size > 1)
    .map(([normalized_email, set]) => ({ normalized_email, import_ids: [...set] }));

  // 2. Merges — collapse duplicates onto the canonical email (follow chains).
  const mergeTarget = new Map<string, string>();
  for (const merge of input.merges) {
    const dup = norm(merge.duplicate_email);
    const canonical = norm(merge.canonical_email);
    if (dup && canonical && dup !== canonical) mergeTarget.set(dup, canonical);
  }
  const resolveCanonical = (email: string): string => {
    let current = email;
    const seen = new Set<string>([current]);
    while (mergeTarget.has(current)) {
      const next = mergeTarget.get(current)!;
      if (seen.has(next)) break;
      seen.add(next);
      current = next;
    }
    return current;
  };

  const groups = new Map<string, { rows: RosterRow[]; mergedFrom: Set<string> }>();
  for (const [email, rows] of byEmail) {
    const canonical = resolveCanonical(email);
    const group = groups.get(canonical) ?? { rows: [], mergedFrom: new Set<string>() };
    group.rows.push(...rows);
    if (canonical !== email) group.mergedFrom.add(email);
    groups.set(canonical, group);
  }

  // Mood / login lookups keyed by canonical email.
  const moodByEmail = new Map<string, Record<string, unknown> | null>();
  for (const row of input.moodRows) {
    const email = row.normalized_email ?? norm(row.email_raw);
    if (!email) continue;
    moodByEmail.set(resolveCanonical(email), row.payload ?? null);
  }
  const loginByEmail = new Map<string, string | null>();
  for (const row of input.loginRows) {
    const email = row.normalized_email ?? norm(row.email_raw);
    if (!email) continue;
    const canonical = resolveCanonical(email);
    const existing = loginByEmail.get(canonical) ?? null;
    if (!existing || (row.last_login_at && row.last_login_at > existing)) {
      loginByEmail.set(canonical, row.last_login_at);
    }
  }

  const activeExclusions = input.exclusions.filter(
    (item) => !item.effective_from || item.effective_from.slice(0, 10) <= period.slice(0, 10),
  );
  const sortedMappings = [...input.roleMappings].sort((a, b) => a.precedence - b.precedence);

  const rows: PersonPeriodRow[] = [];

  for (const [email, group] of groups) {
    const flags: string[] = [];

    // Winning roster row by status precedence, then by most recent modified date.
    const ranked = [...group.rows].sort((a, b) => {
      const diff = canonicalStatus(a.status_raw).rank - canonicalStatus(b.status_raw).rank;
      if (diff !== 0) return diff;
      return (b.modified_at_src ?? "").localeCompare(a.modified_at_src ?? "");
    });
    const winner = ranked[0];
    if (!winner) continue;
    const statusSet = new Set(group.rows.map((r) => canonicalStatus(r.status_raw).label ?? ""));
    if (group.mergedFrom.size > 0) {
      flags.push("merged_record");
      if (statusSet.size > 1) flags.push("merged_status_conflict");
    }
    if (group.rows.length > 1) {
      flags.push("duplicate_roster_row");
      if ((seenIn.get(email)?.size ?? 0) > 1) flags.push("duplicate_across_parts");
    }

    const status = canonicalStatus(winner.status_raw).label;
    const isInactive = canonicalStatus(winner.status_raw).rank === 2;

    // Departure proxy: modified date on an inactive record, unless it equals created.
    let departure: string | null = null;
    if (isInactive) {
      const modified = dateOnly(winner.modified_at_src);
      const created = dateOnly(winner.created_at_src);
      if (!modified) {
        flags.push("no_usable_departure_date");
      } else if (created && modified === created) {
        flags.push("no_usable_departure_date");
      } else {
        departure = modified;
      }
    }

    const hire = dateOnly(winner.hire_date);
    if (!hire) flags.push("no_hire_date");
    const tenureEnd = departure ? new Date(`${departure}T00:00:00Z`) : end;
    const tenure = hire ? yearsBetween(hire, tenureEnd) : null;
    // Impossible tenure: the proxy departure date precedes the hire date. Kept and flagged as a
    // data-quality signal; the tenure metric drops these rows rather than averaging a negative.
    if (tenure !== null && tenure < 0) flags.push("negative_tenure");

    // Department rules.
    const rule = input.departmentRules.find((item) =>
      patternMatches(item.pattern, winner.department_raw),
    );
    if (!rule) flags.push("unmapped_department");

    // Role mappings — lowest precedence wins.
    const mapping = sortedMappings.find(
      (item) =>
        patternMatches(item.title_pattern, winner.title_raw) &&
        (!item.department_pattern ||
          patternMatches(item.department_pattern, winner.department_raw)),
    );
    if (!mapping) flags.push("unmapped_role");

    // Exclusions — kept, never dropped.
    const domain = email.split("@")[1] ?? null;
    const exclusion = activeExclusions.find((item) => {
      const value = item.match_value.trim().toLowerCase();
      switch (item.match_type) {
        case "email":
          return email === value;
        case "email_domain":
          return domain === value.replace(/^@/, "");
        case "name":
          return norm(winner.name_raw) === value;
        case "employee_id":
          return norm(winner.employee_id_raw) === value;
        case "keyword":
          return [winner.name_raw, email, winner.title_raw, winner.department_raw]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(value));
        default:
          return false;
      }
    });
    if (exclusion) flags.push("excluded");

    // Mood matrix — absent row means null, not zero.
    const moodPayload = moodByEmail.has(email) ? moodByEmail.get(email)! : undefined;
    let checkinCount: number | null = null;
    let moodAvg: number | null = null;
    let checkedIn: boolean | null = null;
    if (moodPayload !== undefined) {
      const mood = moodForPeriod(moodPayload, period);
      checkinCount = mood.checkin_count;
      moodAvg = mood.mood_avg;
      checkedIn = mood.checkin_count > 0;
    } else if (input.hasMoodImport) {
      flags.push("no_mood_row");
    } else {
      flags.push("no_mood_import");
    }

    const lastLogin = loginByEmail.get(email) ?? null;
    if (input.hasLoginImport) flags.push("last_login_as_of_export_date");

    rows.push({
      client_id: clientId,
      period,
      normalized_email: email,
      name: winner.name_raw,
      employee_id_raw: winner.employee_id_raw,
      title_raw: winner.title_raw,
      department_raw: winner.department_raw,
      franchise_label: rule?.franchise_label ?? null,
      function_label: rule?.function_label ?? null,
      role_code: mapping?.role_code ?? null,
      status,
      hire_date: hire,
      departure_date_proxy: departure,
      tenure_years: tenure,
      is_excluded: Boolean(exclusion),
      exclusion_reason: exclusion
        ? (exclusion.reason ?? `${exclusion.category}: ${exclusion.match_type}=${exclusion.match_value}`)
        : null,
      merged_from: [...group.mergedFrom].sort(),
      checkin_count: checkinCount,
      mood_avg: moodAvg,
      checked_in: checkedIn,
      last_login_at: lastLogin,
      flags,
      built_at: builtAt,
    });
  }

  rows.sort((a, b) => a.normalized_email.localeCompare(b.normalized_email));
  return { rows, overlaps, skippedNoEmail };
}

export function summarize(rows: PersonPeriodRow[]) {
  const exclusionReasons = new Map<string, number>();
  for (const row of rows) {
    if (!row.is_excluded) continue;
    const key = row.exclusion_reason ?? "Unspecified";
    exclusionReasons.set(key, (exclusionReasons.get(key) ?? 0) + 1);
  }
  return {
    total: rows.length,
    excluded: rows.filter((r) => r.is_excluded).length,
    exclusionReasons: [...exclusionReasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    nullRoleCode: rows.filter((r) => r.role_code === null).length,
    duplicateRows: rows.filter((r) => r.flags.includes("duplicate_roster_row")).length,
    checkedIn: rows.filter((r) => r.checked_in === true).length,
    noMoodRow: rows.filter((r) => r.checked_in === null).length,
    noUsableDepartureDate: rows.filter((r) => r.flags.includes("no_usable_departure_date")).length,
    builtAt: rows[0]?.built_at ?? null,
  };
}
