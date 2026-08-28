import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { MetricRow } from "./report-core";

type Client = SupabaseClient<Database>;

const PERSON_COLUMNS =
  "normalized_email, name, title_raw, department_raw, franchise_label, role_code, status, hire_date, departure_date_proxy, tenure_years, is_excluded, checkin_count, mood_avg, checked_in, flags";

export type ReportPerson = {
  normalized_email: string;
  name: string | null;
  title_raw: string | null;
  department_raw: string | null;
  franchise_label: string | null;
  role_code: string | null;
  status: string | null;
  hire_date: string | null;
  departure_date_proxy: string | null;
  tenure_years: number | string | null;
  is_excluded: boolean;
  checkin_count: number | null;
  mood_avg: number | string | null;
  checked_in: boolean | null;
  flags: string[];
};

/** Mood at or below this reads as a signal worth surfacing, per the report spec. */
export const MOOD_THRESHOLD = 75;

export function priorPeriodOf(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 2, 1)).toISOString().slice(0, 10);
}

export function periodEnd(period: string): Date {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year!, month!, 0));
}

async function loadPeople(
  supabase: Client,
  clientId: string,
  period: string,
): Promise<ReportPerson[]> {
  const rows: ReportPerson[] = [];
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
    rows.push(...((data ?? []) as unknown as ReportPerson[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

const num = (value: number | string | null): number | null => {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const displayName = (person: ReportPerson) => person.name ?? person.normalized_email;

const byName = (a: ReportPerson, b: ReportPerson) =>
  displayName(a).localeCompare(displayName(b), "en-US", { sensitivity: "base" });

export type DepartureRow = {
  name: string;
  email: string;
  department: string | null;
  role: string | null;
  hire_date: string | null;
  departure_date: string | null;
  tenure_years: number | null;
  after_period_end: boolean;
  on_watch_list: boolean;
};

export type ListRow = {
  name: string;
  email: string;
  department: string | null;
  mood: number | null;
  checkins: number | null;
  highlight: boolean;
};

export type AnniversaryRow = {
  name: string;
  department: string | null;
  hire_date: string | null;
  years: number;
  milestone: boolean;
};

const MILESTONES = new Set([1, 3, 5, 10, 15, 20, 25, 30]);

export async function buildReport(supabase: Client, clientId: string, period: string) {
  const priorPeriod = priorPeriodOf(period);
  const end = periodEnd(period);

  const [clientResult, metricsResult, planResult, people, priorPeople] = await Promise.all([
    supabase.from("clients").select("id, name, code").eq("id", clientId).maybeSingle(),
    supabase
      .from("published_metrics")
      .select("id, metric_key, definition_version, scope, value_numeric, value_text, period")
      .eq("client_id", clientId)
      .in("period", [period, priorPeriod])
      .limit(20000),
    supabase
      .from("action_plan_items")
      .select("id, position, headline, problem, solution")
      .eq("client_id", clientId)
      .eq("period", period)
      .order("position"),
    loadPeople(supabase, clientId, period),
    loadPeople(supabase, clientId, priorPeriod),
  ]);

  if (clientResult.error) throw new Error(clientResult.error.message);
  if (metricsResult.error) throw new Error(metricsResult.error.message);
  if (planResult.error) throw new Error(planResult.error.message);
  if (!clientResult.data) throw new Error("Client not found");

  const included = people.filter((person) => !person.is_excluded);
  const priorIncluded = priorPeople.filter((person) => !person.is_excluded);
  const statusOf = (person: ReportPerson) => (person.status ?? "").toLowerCase();

  const priorActive = new Set(
    priorIncluded.filter((person) => statusOf(person) === "active").map((p) => p.normalized_email),
  );

  // The prior month's watch list: people who were flagged then for the same two reasons this
  // report flags now — no check-in, or a check-in with mood at or below the threshold.
  const watchList = new Set(
    priorIncluded
      .filter((person) => {
        if (statusOf(person) !== "active") return false;
        const mood = num(person.mood_avg);
        const checkins = person.checkin_count ?? 0;
        return checkins === 0 || (mood !== null && mood <= MOOD_THRESHOLD);
      })
      .map((person) => person.normalized_email),
  );

  const departures: DepartureRow[] = included
    .filter(
      (person) => statusOf(person) === "inactive" && priorActive.has(person.normalized_email),
    )
    .sort((a, b) => (b.departure_date_proxy ?? "").localeCompare(a.departure_date_proxy ?? ""))
    .map((person) => ({
      name: displayName(person),
      email: person.normalized_email,
      department: person.department_raw,
      role: person.role_code,
      hire_date: person.hire_date,
      departure_date: person.departure_date_proxy,
      tenure_years: num(person.tenure_years),
      after_period_end:
        person.departure_date_proxy !== null && new Date(person.departure_date_proxy) > end,
      on_watch_list: watchList.has(person.normalized_email),
    }));

  const invited: ListRow[] = included
    .filter((person) => statusOf(person) === "invited")
    .sort(byName)
    .map((person) => ({
      name: displayName(person),
      email: person.normalized_email,
      department: person.department_raw,
      mood: null,
      checkins: person.checkin_count ?? 0,
      highlight: false,
    }));

  const activePeople = included.filter((person) => statusOf(person) === "active");

  const notCheckedIn: ListRow[] = activePeople
    .filter((person) => (person.checkin_count ?? 0) === 0)
    .sort(byName)
    .map((person) => {
      const priorRow = priorIncluded.find((p) => p.normalized_email === person.normalized_email);
      const priorMood = priorRow ? num(priorRow.mood_avg) : null;
      return {
        name: displayName(person),
        email: person.normalized_email,
        department: person.department_raw,
        mood: priorMood,
        checkins: 0,
        // No check-in means no mood this period; the highlight uses last month's mood, which is
        // the only signal available for someone who has gone quiet.
        highlight: priorMood !== null && priorMood <= MOOD_THRESHOLD,
      };
    });

  const lowMood: ListRow[] = activePeople
    .filter((person) => {
      const mood = num(person.mood_avg);
      return (person.checkin_count ?? 0) > 0 && mood !== null && mood < MOOD_THRESHOLD;
    })
    .sort((a, b) => (num(a.mood_avg) ?? 0) - (num(b.mood_avg) ?? 0))
    .map((person) => ({
      name: displayName(person),
      email: person.normalized_email,
      department: person.department_raw,
      mood: num(person.mood_avg),
      checkins: person.checkin_count ?? 0,
      highlight: true,
    }));

  const periodMonth = Number(period.slice(5, 7));
  const periodYear = Number(period.slice(0, 4));

  const anniversaries: AnniversaryRow[] = activePeople
    .filter((person) => person.hire_date !== null)
    .map((person) => {
      const hireYear = Number(person.hire_date!.slice(0, 4));
      const hireMonth = Number(person.hire_date!.slice(5, 7));
      return { person, hireYear, hireMonth, years: periodYear - hireYear };
    })
    .filter((entry) => entry.hireMonth === periodMonth && entry.years >= 1)
    .sort((a, b) => b.years - a.years || byName(a.person, b.person))
    .map((entry) => ({
      name: displayName(entry.person),
      department: entry.person.department_raw,
      hire_date: entry.person.hire_date,
      years: entry.years,
      milestone: MILESTONES.has(entry.years),
    }));

  const newStarters = activePeople
    .filter((person) => {
      if (!person.hire_date) return false;
      return (
        Number(person.hire_date.slice(0, 4)) === periodYear &&
        Number(person.hire_date.slice(5, 7)) === periodMonth
      );
    })
    .sort((a, b) => (a.hire_date ?? "").localeCompare(b.hire_date ?? ""))
    .map((person) => ({
      name: displayName(person),
      department: person.department_raw,
      title: person.title_raw,
      hire_date: person.hire_date,
    }));

  return {
    client: clientResult.data,
    period,
    priorPeriod,
    metrics: (metricsResult.data ?? []) as MetricRow[],
    actionPlan: planResult.data ?? [],
    lists: {
      departures,
      invited,
      notCheckedIn,
      lowMood,
      anniversaries,
      newStarters,
      moodThreshold: MOOD_THRESHOLD,
    },
  };
}

export type ReportData = Awaited<ReturnType<typeof buildReport>>;
