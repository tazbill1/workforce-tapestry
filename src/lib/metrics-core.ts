// Pure metrics layer: reads resolved person_period rows, emits published_metrics rows.
// Nothing here touches raw_records. Every emitted value carries its definition_version.

export type PersonRow = {
  normalized_email: string;
  status: string | null;
  franchise_label: string | null;
  department_raw: string | null;
  role_code: string | null;
  hire_date: string | null;
  departure_date_proxy: string | null;
  tenure_years: number | string | null;
  is_excluded: boolean;
  checkin_count: number | null;
  mood_avg: number | string | null;
  checked_in: boolean | null;
  flags: string[];
};

export type EngagementRow = {
  likes: number | null;
  comments: number | null;
  logins: number | null;
  recognitions: number | null;
};

export type RecognitionRow = { department_raw: string; count: number };

/** One imported recognition-activity row, already name-matched where possible. */
export type ActivityRow = {
  name_raw: string;
  normalized_name: string;
  matched_email: string | null;
  posts: number | null;
  comments: number | null;
  likes: number | null;
};

export type MetricDefinition = {
  key: string;
  version: number;
  description: string;
  formula_note: string;
  effective_from: string;
  superseded?: boolean;
};

export const UNDATED_FLAG = "no_usable_departure_date";

/** Exclusion-set-sensitive metrics: v1 = the narrower set in use through June 2026, v2 = the current 30-exclusion set. */
const EXCLUSION_SENSITIVE = [
  "headcount_active",
  "headcount_inactive",
  "headcount_invited",
  "turnover_pct",
] as const;

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  ...EXCLUSION_SENSITIVE.flatMap((key): MetricDefinition[] => [
    {
      key,
      version: 1,
      description: `${key} computed under the exclusion set published through June 2026 (10 confirmed exclusions).`,
      formula_note:
        "Population: person_period rows for the client/period, excluding is_excluded, under the exclusion set active at the time of first publication.",
      effective_from: "2026-06-01",
      superseded: true,
    },
    {
      key,
      version: 2,
      description: `${key} computed under the current confirmed exclusion set (30 exclusions).`,
      formula_note:
        key === "turnover_pct"
          ? "inactive / (active + inactive) * 100. Cumulative snapshot of everyone marked inactive to date, NOT a monthly rate. Invited excluded from the ratio."
          : "Count of non-excluded people in person_period with the given status. Invited counted separately and never folded into turnover, tenure or mood.",
      effective_from: "2026-07-01",
    },
  ]),
  {
    key: "avg_tenure_years",
    version: 1,
    description: "Mean tenure in years across Active and Inactive people — as published.",
    formula_note:
      "Rows flagged no_usable_departure_date excluded, but negative tenures were left in the average. Published 2.95 for July 2026. Superseded: the definition always excluded negatives; the published figure did not.",
    effective_from: "2026-06-01",
    superseded: true,
  },
  {
    key: "avg_tenure_years",
    version: 2,
    description: "Mean tenure in years across Active and Inactive people — restated to the definition.",
    formula_note:
      "Active: period end minus hire_date. Inactive: departure_date_proxy minus hire_date. Excluded: rows flagged no_usable_departure_date (no reliable end date), rows flagged negative_tenure (departure precedes hire — impossible), and Invited. tenure_rows_included, tenure_dropped_negative and tenure_dropped_undated are stored alongside so the population is always visible.",
    effective_from: "2026-07-01",
  },
  {
    key: "tenure_rows_included",
    version: 1,
    description: "Rows entering avg_tenure_years.",
    formula_note: "Active or Inactive, not excluded, with a tenure value, after dropping undated and negative rows.",
    effective_from: "2026-07-01",
  },
  {
    key: "tenure_dropped_negative",
    version: 1,
    description: "Rows dropped from avg_tenure_years for a negative result.",
    formula_note: "departure_date_proxy earlier than hire_date. Also flagged negative_tenure on person_period.",
    effective_from: "2026-07-01",
  },
  {
    key: "tenure_dropped_undated",
    version: 1,
    description: "Rows dropped from avg_tenure_years for having no usable departure date.",
    formula_note: "Active or Inactive rows flagged no_usable_departure_date.",
    effective_from: "2026-07-01",
  },
  {
    key: "departures_count",
    version: 1,
    description: "People Active in the prior period and Inactive in this one.",
    formula_note:
      "Matched on normalized_email only — never on Employee ID, which carries shared placeholder values in this system.",
    effective_from: "2026-06-01",
  },
  {
    key: "departures_in_period",
    version: 1,
    description: "Departures whose proxy departure date falls on or before period end.",
    formula_note: "Subset of departures_count with departure_date_proxy <= period end.",
    effective_from: "2026-06-01",
  },
  {
    key: "departures_after_period_end",
    version: 1,
    description: "Departures whose proxy departure date falls after period end.",
    formula_note:
      "Exports pulled after month end catch deactivations outside the period; stored separately so the in-period figure stays clean.",
    effective_from: "2026-06-01",
  },
  {
    key: "early_departure_pct",
    version: 1,
    description: "Share of departures within 90 days of hire — original published definition.",
    formula_note:
      "Denominator was ALL inactive rows, including those with no usable departure date. Published 55.5% for this client. Superseded: the denominator overstated the datable population.",
    effective_from: "2026-05-01",
    superseded: true,
  },
  {
    key: "early_departure_pct",
    version: 2,
    description: "Share of departures within 90 days of hire — first restatement.",
    formula_note:
      "Denominator restricted to inactive rows with a usable departure date. Restated to 26.9%. Superseded by v3.",
    effective_from: "2026-06-01",
    superseded: true,
  },
  {
    key: "early_departure_pct",
    version: 3,
    description: "Share of dated departures occurring 0–90 days after hire — current definition.",
    formula_note:
      "Numerator: inactive rows with a usable departure date and 0 <= (departure_date_proxy - hire_date) <= 90 days. Denominator: datable_departures = inactive rows not flagged no_usable_departure_date. early_departure_count and datable_departures are stored alongside so the denominator is always visible.",
    effective_from: "2026-07-01",
  },
  {
    key: "early_departure_count",
    version: 1,
    description: "Numerator of early_departure_pct.",
    formula_note: "Inactive, dated, 0–90 days between hire_date and departure_date_proxy.",
    effective_from: "2026-06-01",
  },
  {
    key: "datable_departures",
    version: 1,
    description: "Denominator of early_departure_pct.",
    formula_note: "Inactive rows not flagged no_usable_departure_date.",
    effective_from: "2026-06-01",
  },
  {
    key: "undated_inactive_count",
    version: 1,
    description: "Inactive rows with no usable departure date.",
    formula_note:
      "Rows flagged no_usable_departure_date: the roster's modified date equals its created date, so the timestamp is a creation stamp, not a departure.",
    effective_from: "2026-06-01",
  },
  {
    key: "mood_per_employee",
    version: 1,
    description: "Mean of each person's own mean mood across their check-ins — original definition.",
    formula_note:
      "Denominator was everyone with a check-in, including people Inactive at period end. Superseded: mood then sat on a different population from headcount and checked_in_pct.",
    effective_from: "2026-06-01",
    superseded: true,
  },
  {
    key: "mood_per_employee",
    version: 2,
    description: "Mean of each person's own mean mood across their check-ins in the period.",
    formula_note:
      "Population: Active headcount at period end. A person who checked in during the period but was deactivated before period close is excluded. Equal weight per person; people with no check-in contribute nothing — they are not zeros.",
    effective_from: "2026-07-01",
  },
  {
    key: "mood_per_checkin",
    version: 1,
    description: "Mean across all individual check-ins in the period — original definition.",
    formula_note:
      "Included check-ins from people Inactive at period end. Superseded for the same reason as mood_per_employee v1.",
    effective_from: "2026-06-01",
    superseded: true,
  },
  {
    key: "mood_per_checkin",
    version: 2,
    description: "Mean across all individual check-ins in the period.",
    formula_note:
      "Population: Active headcount at period end. A person who checked in during the period but was deactivated before period close is excluded. Equal weight per check-in: sum(person mood_avg * checkin_count) / sum(checkin_count). Diverges from mood_per_employee wherever enthusiastic people check in more often; the report shows both.",
    effective_from: "2026-07-01",
  },
  {
    key: "checked_in_count",
    version: 1,
    description: "People with at least one check-in in the period.",
    formula_note:
      "Participation measure. It replaces a login-based measure because the platform's login report can only be generated as of the current date, so a period-bounded login count is not obtainable.",
    effective_from: "2026-06-01",
  },
  {
    key: "checked_in_pct",
    version: 1,
    description: "checked_in_count over active headcount, as a percentage.",
    formula_note: "checked_in_count / headcount_active * 100.",
    effective_from: "2026-06-01",
  },
  {
    key: "recent_hire_turnover_pct",
    version: 1,
    description: "Turnover among people hired within two years of period end.",
    formula_note: "inactive / (active + inactive) * 100 within the recent-hire cohort.",
    effective_from: "2026-06-01",
  },
  {
    key: "tenured_turnover_pct",
    version: 1,
    description: "Turnover among people hired more than two years before period end.",
    formula_note:
      "inactive / (active + inactive) * 100 within the tenured cohort. Rows with no hire date fall into this cohort.",
    effective_from: "2026-06-01",
  },
  {
    key: "engagement_likes",
    version: 1,
    description: "Likes for the period, from manually entered engagement totals.",
    formula_note: "Read from engagement_totals; stored as a metric so it carries a definition.",
    effective_from: "2026-06-01",
  },
  {
    key: "engagement_comments",
    version: 1,
    description: "Comments for the period, from manually entered engagement totals.",
    formula_note: "Read from engagement_totals.",
    effective_from: "2026-06-01",
  },
  {
    key: "engagement_logins",
    version: 1,
    description: "Platform-reported logins for the period, from manually entered totals.",
    formula_note:
      "Read from engagement_totals. Not a period-bounded per-person measure; participation uses checked_in_pct.",
    effective_from: "2026-06-01",
  },
  {
    key: "engagement_recognitions",
    version: 1,
    description: "Recognitions for the period, from manually entered engagement totals.",
    formula_note: "Read from engagement_totals.",
    effective_from: "2026-06-01",
  },
  {
    key: "recognitions_per_employee",
    version: 1,
    description: "Department recognition count over that department's active headcount.",
    formula_note: "recognition_counts.count / headcount_active for the same department.",
    effective_from: "2026-06-01",
  },
  {
    key: "recognitions_count",
    version: 1,
    description: "Recognitions given in the department during the period.",
    formula_note: "Read from recognition_counts; stored so the report never re-reads manual entry.",
    effective_from: "2026-06-01",
  },
  {
    key: "not_checked_in_count",
    version: 1,
    description: "Active people with no check-in in the period.",
    formula_note:
      "headcount_active minus the active people with at least one check-in. Stored rather than derived so the report performs no arithmetic.",
    effective_from: "2026-06-01",
  },
  {
    key: "recognition_participation_pct",
    version: 1,
    description: "Share of active people with at least one recognition post, comment or like.",
    formula_note:
      "recognition_participants_count / headcount_active. Activity rows are matched to people by name link; unmatched rows are excluded from the numerator.",
    effective_from: "2026-08-01",
  },
  {
    key: "recognition_participants_count",
    version: 1,
    description: "Active people with at least one recognition post, comment or like.",
    formula_note:
      "Distinct matched people in recognition_activity with posts + comments + likes > 0, restricted to Active person_period rows.",
    effective_from: "2026-08-01",
  },
  {
    key: "recognition_activity_matched_pct",
    version: 1,
    description: "Share of imported recognition-activity rows matched to a person on the roster.",
    formula_note: "Rows with a matched_email over all imported activity rows for the period.",
    effective_from: "2026-08-01",
  },
  {
    key: "top_contributor",
    version: 1,
    description:
      "Named person ranked by total recognition activity for the period; scope carries the rank.",
    formula_note:
      "posts + comments + likes per matched person, ranked descending, top 10 stored as rank:1..rank:10. Name in value_text, total in value_numeric.",
    effective_from: "2026-08-01",
  },
  {
    key: "roster_size",
    version: 1,
    description: "People on the resolved roster for the period, after exclusions.",
    formula_note: "Non-excluded person_period rows of any status, including Invited.",
    effective_from: "2026-06-01",
  },
  {
    key: "excluded_count",
    version: 1,
    description: "Roster rows removed by a confirmed exclusion.",
    formula_note: "person_period rows with is_excluded true. Reported as the exclusions footnote.",
    effective_from: "2026-06-01",
  },
  {
    key: "role_benchmark_turnover_pct",
    version: 1,
    description: "External turnover benchmark for the role.",
    formula_note:
      "Read from role_benchmarks for the role code. Absent where no benchmark row exists — the report renders 'No benchmark' from the absence, never a hardcoded value.",
    effective_from: "2026-06-01",
  },
  {
    key: "turnover_variance_pp",
    version: 1,
    description: "Role turnover minus its benchmark, in percentage points.",
    formula_note: "turnover_pct - role_benchmark_turnover_pct. Only stored where a benchmark exists.",
    effective_from: "2026-06-01",
  },
];


/** Current (non-superseded) version for a metric key. */
export function currentVersion(key: string): number {
  const versions = METRIC_DEFINITIONS.filter((d) => d.key === key && !d.superseded).map(
    (d) => d.version,
  );
  if (versions.length === 0) throw new Error(`No current definition for metric ${key}`);
  return Math.max(...versions);
}

export type ComputedMetric = {
  metric_key: string;
  definition_version: number;
  scope: string;
  value_numeric: number | null;
  value_text?: string | null;
};

const num = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const round = (value: number, digits = 4) =>
  Math.round(value * 10 ** digits) / 10 ** digits;

export function periodEnd(period: string): Date {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year!, month!, 0));
}

const isUndated = (row: PersonRow) => row.flags.includes(UNDATED_FLAG);

type Bucket = { scope: string; rows: PersonRow[] };

function buckets(rows: PersonRow[]): {
  company: Bucket;
  franchises: Bucket[];
  roles: Bucket[];
  departments: Bucket[];
  cohorts: Bucket[];
  deptLabel: (row: PersonRow) => string;
} {
  const group = (keyOf: (row: PersonRow) => string | null, prefix: string): Bucket[] => {
    const map = new Map<string, PersonRow[]>();
    for (const row of rows) {
      const key = keyOf(row);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, list]) => ({ scope: `${prefix}:${key}`, rows: list }));
  };
  const deptLabel = (row: PersonRow) => (row.department_raw ?? "").trim() || "(blank)";
  return {
    company: { scope: "company", rows },
    franchises: group((row) => row.franchise_label, "franchise"),
    roles: group((row) => row.role_code, "role"),
    departments: group((row) => deptLabel(row), "dept"),
    cohorts: [],
    deptLabel,
  };
}

function headcounts(bucket: Bucket): ComputedMetric[] {
  const count = (status: string) =>
    bucket.rows.filter((row) => (row.status ?? "").toLowerCase() === status).length;
  const active = count("active");
  const inactive = count("inactive");
  const invited = count("invited");
  const out: ComputedMetric[] = [
    { metric_key: "headcount_active", definition_version: currentVersion("headcount_active"), scope: bucket.scope, value_numeric: active },
    { metric_key: "headcount_inactive", definition_version: currentVersion("headcount_inactive"), scope: bucket.scope, value_numeric: inactive },
    { metric_key: "headcount_invited", definition_version: currentVersion("headcount_invited"), scope: bucket.scope, value_numeric: invited },
  ];
  return out;
}

function turnover(bucket: Bucket): ComputedMetric | null {
  const active = bucket.rows.filter((r) => (r.status ?? "").toLowerCase() === "active").length;
  const inactive = bucket.rows.filter((r) => (r.status ?? "").toLowerCase() === "inactive").length;
  if (active + inactive === 0) return null;
  return {
    metric_key: "turnover_pct",
    definition_version: currentVersion("turnover_pct"),
    scope: bucket.scope,
    value_numeric: round((inactive / (active + inactive)) * 100, 1),
  };
}

function tenure(bucket: Bucket): ComputedMetric[] {
  // Population trace: A+I in, then the two documented exclusions, so the denominator is auditable.
  const population = bucket.rows.filter((row) => {
    const status = (row.status ?? "").toLowerCase();
    return status === "active" || status === "inactive";
  });
  const undated = population.filter(isUndated);
  const dated = population.filter((row) => !isUndated(row));
  const withValue = dated
    .map((row) => num(row.tenure_years))
    .filter((value): value is number => value !== null);
  const negative = withValue.filter((value) => value < 0);
  const values = withValue.filter((value) => value >= 0);
  const out: ComputedMetric[] = [
    { metric_key: "tenure_rows_included", definition_version: currentVersion("tenure_rows_included"), scope: bucket.scope, value_numeric: values.length },
    { metric_key: "tenure_dropped_negative", definition_version: currentVersion("tenure_dropped_negative"), scope: bucket.scope, value_numeric: negative.length },
    { metric_key: "tenure_dropped_undated", definition_version: currentVersion("tenure_dropped_undated"), scope: bucket.scope, value_numeric: undated.length },
  ];
  if (values.length === 0) return out;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  out.push({
    metric_key: "avg_tenure_years",
    definition_version: currentVersion("avg_tenure_years"),
    scope: bucket.scope,
    value_numeric: round(mean, 2),
  });
  return out;
}

function mood(bucket: Bucket): ComputedMetric[] {
  // Mood sits on the same denominator as headcount and checked_in_pct: Active at period end.
  // Someone who checked in during the period but was deactivated before close is excluded.
  const rows = bucket.rows.filter((row) => (row.status ?? "").toLowerCase() === "active");
  const withMood = rows
    .map((row) => ({ avg: num(row.mood_avg), count: row.checkin_count ?? 0 }))
    .filter((entry): entry is { avg: number; count: number } => entry.avg !== null);
  if (withMood.length === 0) return [];
  const perEmployee =
    withMood.reduce((sum, entry) => sum + entry.avg, 0) / withMood.length;
  const totalCheckins = withMood.reduce((sum, entry) => sum + entry.count, 0);
  const perCheckin =
    totalCheckins > 0
      ? withMood.reduce((sum, entry) => sum + entry.avg * entry.count, 0) / totalCheckins
      : null;
  const out: ComputedMetric[] = [
    { metric_key: "mood_per_employee", definition_version: currentVersion("mood_per_employee"), scope: bucket.scope, value_numeric: round(perEmployee, 2) },
  ];
  if (perCheckin !== null) {
    out.push({ metric_key: "mood_per_checkin", definition_version: currentVersion("mood_per_checkin"), scope: bucket.scope, value_numeric: round(perCheckin, 2) });
  }
  return out;
}

function participation(bucket: Bucket): ComputedMetric[] {
  const rows = bucket.rows.filter((row) => (row.status ?? "").toLowerCase() !== "invited");
  const isCheckedIn = (row: PersonRow) => (row.checkin_count ?? 0) > 0 || row.checked_in === true;
  const checkedIn = rows.filter(isCheckedIn).length;
  const activeRows = rows.filter((row) => (row.status ?? "").toLowerCase() === "active");
  const active = activeRows.length;
  const out: ComputedMetric[] = [
    { metric_key: "checked_in_count", definition_version: currentVersion("checked_in_count"), scope: bucket.scope, value_numeric: checkedIn },
    {
      metric_key: "not_checked_in_count",
      definition_version: currentVersion("not_checked_in_count"),
      scope: bucket.scope,
      value_numeric: activeRows.filter((row) => !isCheckedIn(row)).length,
    },
  ];
  if (active > 0) {
    out.push({
      metric_key: "checked_in_pct",
      definition_version: currentVersion("checked_in_pct"),
      scope: bucket.scope,
      value_numeric: round((checkedIn / active) * 100, 1),
    });
  }
  return out;
}

export type BenchmarkRow = { role_code: string; turnover_pct: number | string | null };

export type ComputeInput = {
  period: string;
  rows: PersonRow[];
  priorRows: PersonRow[];
  engagement: EngagementRow | null;
  recognitions: RecognitionRow[];
  /** Per-person recognition activity for the period, already name-matched where possible. */
  activity?: ActivityRow[];
  benchmarks?: BenchmarkRow[];
};

/**
 * Person-level recognition activity. Participation is published per bucket so the report
 * never divides; top contributors are published as ranked scopes with the name in value_text.
 */
function recognitionActivity(
  activity: ActivityRow[],
  company: Bucket,
  franchises: Bucket[],
  departments: Bucket[],
  deptLabel: (row: PersonRow) => string,
): ComputedMetric[] {
  const out: ComputedMetric[] = [];
  if (activity.length === 0) return out;

  const total = (row: ActivityRow) => (row.posts ?? 0) + (row.comments ?? 0) + (row.likes ?? 0);
  const matched = activity.filter((row) => row.matched_email);

  // Roll up repeated rows for the same person (multi-part exports).
  const perPerson = new Map<string, { total: number; name: string }>();
  for (const row of matched) {
    const email = row.matched_email!.toLowerCase();
    const existing = perPerson.get(email);
    const name = (row.name_raw || row.normalized_name || email).trim();
    perPerson.set(email, {
      total: (existing?.total ?? 0) + total(row),
      name: existing?.name ?? name,
    });
  }

  out.push({
    metric_key: "recognition_activity_matched_pct",
    definition_version: currentVersion("recognition_activity_matched_pct"),
    scope: "company",
    value_numeric: round((matched.length / activity.length) * 100, 1),
  });

  const bucketsToPublish = [company, ...franchises, ...departments];
  for (const bucket of bucketsToPublish) {
    const active = bucket.rows.filter((row) => (row.status ?? "").toLowerCase() === "active");
    if (active.length === 0) continue;
    const participants = active.filter((row) => {
      const entry = perPerson.get(row.normalized_email.toLowerCase());
      return entry !== undefined && entry.total > 0;
    }).length;
    out.push(
      {
        metric_key: "recognition_participants_count",
        definition_version: currentVersion("recognition_participants_count"),
        scope: bucket.scope,
        value_numeric: participants,
      },
      {
        metric_key: "recognition_participation_pct",
        definition_version: currentVersion("recognition_participation_pct"),
        scope: bucket.scope,
        value_numeric: round((participants / active.length) * 100, 1),
      },
    );
  }

  // Top contributors: only people present on the resolved roster, so the report never
  // names someone who was excluded or who left the roster.
  const onRoster = new Map(company.rows.map((row) => [row.normalized_email.toLowerCase(), row]));
  const ranked = [...perPerson.entries()]
    .filter(([email, entry]) => entry.total > 0 && onRoster.has(email))
    .sort((a, b) => b[1].total - a[1].total || a[1].name.localeCompare(b[1].name))
    .slice(0, 10);
  ranked.forEach(([email, entry], index) => {
    const person = onRoster.get(email)!;
    const where = person.franchise_label ?? deptLabel(person);
    out.push({
      metric_key: "top_contributor",
      definition_version: currentVersion("top_contributor"),
      scope: `rank:${index + 1}`,
      value_numeric: entry.total,
      value_text: where ? `${entry.name} — ${where}` : entry.name,
    });
  });
  return out;
}


export function computeMetrics(input: ComputeInput): ComputedMetric[] {
  // Population rule: excluded rows never enter any metric.
  const rows = input.rows.filter((row) => !row.is_excluded);
  const prior = input.priorRows.filter((row) => !row.is_excluded);
  const end = periodEnd(input.period);
  const out: ComputedMetric[] = [];
  const { company, franchises, roles, departments, deptLabel } = buckets(rows);

  for (const bucket of [company, ...franchises, ...roles, ...departments]) {
    out.push(...headcounts(bucket));
  }
  for (const bucket of [company, ...franchises, ...roles]) {
    const value = turnover(bucket);
    if (value) out.push(value);
  }
  // Tenure is published at role scope as well so the report can table it by role.
  for (const bucket of [company, ...franchises, ...roles]) {
    out.push(...tenure(bucket));
  }
  for (const bucket of [company, ...franchises, ...departments]) {
    out.push(...mood(bucket));
    out.push(...participation(bucket));
  }

  // Departures: prior Active -> current Inactive, matched on normalized_email only.
  const priorActive = new Set(
    prior.filter((row) => (row.status ?? "").toLowerCase() === "active").map((r) => r.normalized_email),
  );
  const departures = rows.filter(
    (row) => (row.status ?? "").toLowerCase() === "inactive" && priorActive.has(row.normalized_email),
  );
  const inPeriod = departures.filter(
    (row) => row.departure_date_proxy !== null && new Date(row.departure_date_proxy) <= end,
  ).length;
  const afterEnd = departures.filter(
    (row) => row.departure_date_proxy !== null && new Date(row.departure_date_proxy) > end,
  ).length;
  out.push(
    { metric_key: "departures_count", definition_version: currentVersion("departures_count"), scope: "company", value_numeric: departures.length },
    { metric_key: "departures_in_period", definition_version: currentVersion("departures_in_period"), scope: "company", value_numeric: inPeriod },
    { metric_key: "departures_after_period_end", definition_version: currentVersion("departures_after_period_end"), scope: "company", value_numeric: afterEnd },
  );

  // Early departures — denominator is the datable subset only.
  const inactive = rows.filter((row) => (row.status ?? "").toLowerCase() === "inactive");
  const datable = inactive.filter((row) => !isUndated(row));
  const early = datable.filter((row) => {
    if (!row.hire_date || !row.departure_date_proxy) return false;
    const days =
      (new Date(row.departure_date_proxy).getTime() - new Date(row.hire_date).getTime()) / 86_400_000;
    return days >= 0 && days <= 90;
  }).length;
  out.push(
    { metric_key: "early_departure_count", definition_version: currentVersion("early_departure_count"), scope: "company", value_numeric: early },
    { metric_key: "datable_departures", definition_version: currentVersion("datable_departures"), scope: "company", value_numeric: datable.length },
    {
      metric_key: "early_departure_pct",
      definition_version: currentVersion("early_departure_pct"),
      scope: "company",
      value_numeric: datable.length > 0 ? round((early / datable.length) * 100, 1) : null,
    },
    {
      metric_key: "undated_inactive_count",
      definition_version: currentVersion("undated_inactive_count"),
      scope: "company",
      value_numeric: inactive.filter(isUndated).length,
    },
  );

  // Tenure cohorts: hired within two years of period end vs earlier (or unknown).
  const twoYearsBefore = new Date(end);
  twoYearsBefore.setUTCFullYear(twoYearsBefore.getUTCFullYear() - 2);
  const isRecent = (row: PersonRow) =>
    row.hire_date !== null && new Date(row.hire_date) > twoYearsBefore;
  const cohortRows = rows.filter((row) => (row.status ?? "").toLowerCase() !== "invited");
  const cohortPairs: Array<[string, string, PersonRow[]]> = [
    ["recent_hire_turnover_pct", "cohort:recent", cohortRows.filter(isRecent)],
    ["tenured_turnover_pct", "cohort:tenured", cohortRows.filter((row) => !isRecent(row))],
  ];
  for (const [key, scope, cohort] of cohortPairs) {
    const active = cohort.filter((row) => (row.status ?? "").toLowerCase() === "active").length;
    const inactiveCount = cohort.filter((row) => (row.status ?? "").toLowerCase() === "inactive").length;
    out.push(...headcounts({ scope, rows: cohort }));
    if (active + inactiveCount > 0) {
      const value = round((inactiveCount / (active + inactiveCount)) * 100, 1);
      out.push({ metric_key: key, definition_version: currentVersion(key), scope: "company", value_numeric: value });
      out.push({ metric_key: key, definition_version: currentVersion(key), scope, value_numeric: value });
    }
  }
  for (const franchise of franchises) {
    const franchiseRows = franchise.rows.filter((row) => (row.status ?? "").toLowerCase() !== "invited");
    const pairs: Array<[string, PersonRow[]]> = [
      ["recent_hire_turnover_pct", franchiseRows.filter(isRecent)],
      ["tenured_turnover_pct", franchiseRows.filter((row) => !isRecent(row))],
    ];
    for (const [key, cohort] of pairs) {
      const active = cohort.filter((row) => (row.status ?? "").toLowerCase() === "active").length;
      const inactiveCount = cohort.filter((row) => (row.status ?? "").toLowerCase() === "inactive").length;
      if (active + inactiveCount === 0) continue;
      out.push({
        metric_key: key,
        definition_version: currentVersion(key),
        scope: franchise.scope,
        value_numeric: round((inactiveCount / (active + inactiveCount)) * 100, 1),
      });
    }
  }

  // Engagement totals, stored as metrics so they carry a definition.
  if (input.engagement) {
    const map: Array<[string, number | null]> = [
      ["engagement_likes", input.engagement.likes],
      ["engagement_comments", input.engagement.comments],
      ["engagement_logins", input.engagement.logins],
      ["engagement_recognitions", input.engagement.recognitions],
    ];
    for (const [key, value] of map) {
      if (value === null || value === undefined) continue;
      out.push({ metric_key: key, definition_version: currentVersion(key), scope: "company", value_numeric: value });
    }
  }

  // Recognitions, department scope: raw count and the per-employee rate.
  for (const recognition of input.recognitions) {
    const label = (recognition.department_raw ?? "").trim() || "(blank)";
    out.push({
      metric_key: "recognitions_count",
      definition_version: currentVersion("recognitions_count"),
      scope: `dept:${label}`,
      value_numeric: recognition.count,
    });
    const active = rows.filter(
      (row) => deptLabel(row) === label && (row.status ?? "").toLowerCase() === "active",
    ).length;
    if (active === 0) continue;
    out.push({
      metric_key: "recognitions_per_employee",
      definition_version: currentVersion("recognitions_per_employee"),
      scope: `dept:${label}`,
      value_numeric: round(recognition.count / active, 3),
    });
  }

  // Roster size and the exclusions footnote, so the cover and summary read stored values.
  out.push(
    { metric_key: "roster_size", definition_version: currentVersion("roster_size"), scope: "company", value_numeric: rows.length },
    {
      metric_key: "excluded_count",
      definition_version: currentVersion("excluded_count"),
      scope: "company",
      value_numeric: input.rows.length - rows.length,
    },
  );

  // Role benchmarks and the variance against them. No benchmark row means no metric row:
  // the report renders "No benchmark" from the absence rather than a placeholder value.
  const benchmarkByRole = new Map<string, number>();
  for (const benchmark of input.benchmarks ?? []) {
    const value = num(benchmark.turnover_pct);
    if (value !== null) benchmarkByRole.set(benchmark.role_code, value);
  }
  for (const role of roles) {
    const code = role.scope.slice("role:".length);
    const benchmark = benchmarkByRole.get(code);
    if (benchmark === undefined) continue;
    const roleTurnover = turnover(role);
    out.push({
      metric_key: "role_benchmark_turnover_pct",
      definition_version: currentVersion("role_benchmark_turnover_pct"),
      scope: role.scope,
      value_numeric: benchmark,
    });
    if (roleTurnover?.value_numeric !== null && roleTurnover !== null) {
      out.push({
        metric_key: "turnover_variance_pp",
        definition_version: currentVersion("turnover_variance_pp"),
        scope: role.scope,
        value_numeric: round(roleTurnover.value_numeric! - benchmark, 1),
      });
    }
  }

  return out;
}

