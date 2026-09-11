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

export type RecognitionPointDetail = {
  manager_name: string;
  manager_title: string | null;
  department_raw: string | null;
  points_allocated: number | null;
  points_given: number | null;
};

export type PublishedBaseline = {
  metric_key: string;
  value_numeric: number | null;
  label: string;
  source: string;
  source_note: string | null;
};

export type PeerAverage = { metric_key: string; value_numeric: number; client_count: number };

const MILESTONES = new Set([1, 3, 5, 10, 15, 20, 25, 30]);

/** A free-text comment written for this client and period and marked for the report. */
export type NoteBlock = {
  id: string;
  position: number;
  heading: string | null;
  body: string;
};

/** An answer from the Ask screen that an analyst pinned to this client and period. */
export type InsightBlock = {
  id: string;
  title: string;
  question: string;
  answer_md: string;
  table_json: { columns: string[]; rows: Record<string, string | number | null>[] } | null;
  sources: string[];
  created_at: string;
};

/** A survey whose written summary an analyst read and accepted for this period's report. */
export type SurveyBlock = {
  id: string;
  title: string;
  respondents: number;
  questions: number;
  anonymous: boolean;
  summary_md: string;
  themes: { label: string; sentiment: string; detail: string }[];
  sentiment: { positive: number; neutral: number; negative: number; scored: number };
  highlights: { question: string; answers: { label: string; count: number }[] }[];
};

/** Approved survey summaries only: an unaccepted draft never reaches a report. */
async function loadSurveys(
  supabase: Client,
  clientId: string,
  period: string,
): Promise<SurveyBlock[]> {
  const { data: surveys, error } = await supabase
    .from("surveys")
    .select("id, title, respondent_count, question_count, anonymous")
    .eq("client_id", clientId)
    .eq("period", period)
    .eq("include_in_report", true)
    .order("created_at");
  if (error) throw new Error(error.message);
  if (!surveys || surveys.length === 0) return [];

  const ids = surveys.map((survey) => survey.id);
  const [summaries, questions, responses] = await Promise.all([
    supabase
      .from("survey_summaries")
      .select("survey_id, draft_md, edited_md, themes, accepted_at")
      .in("survey_id", ids)
      .not("accepted_at", "is", null),
    supabase
      .from("survey_questions")
      .select("id, survey_id, position, question_text, kind")
      .in("survey_id", ids)
      .order("position"),
    supabase
      .from("survey_responses")
      .select("survey_id, question_id, answer_text, sentiment")
      .in("survey_id", ids)
      .limit(20000),
  ]);
  for (const result of [summaries, questions, responses]) {
    if (result.error) throw new Error(result.error.message);
  }

  const summaryBySurvey = new Map((summaries.data ?? []).map((row) => [row.survey_id, row]));

  return surveys.flatMap((survey) => {
    const summary = summaryBySurvey.get(survey.id);
    if (!summary) return [];

    const rows = (responses.data ?? []).filter((row) => row.survey_id === survey.id);
    const sentiment = { positive: 0, neutral: 0, negative: 0, scored: 0 };
    for (const row of rows) {
      if (row.sentiment === "positive") sentiment.positive += 1;
      else if (row.sentiment === "neutral") sentiment.neutral += 1;
      else if (row.sentiment === "negative") sentiment.negative += 1;
      else continue;
      sentiment.scored += 1;
    }

    // Countable questions print as a tally; written answers are represented by the summary.
    const highlights = (questions.data ?? [])
      .filter((question) => question.survey_id === survey.id && question.kind !== "text")
      .slice(0, 4)
      .map((question) => {
        const tally = new Map<string, number>();
        for (const row of rows.filter((entry) => entry.question_id === question.id)) {
          const value = (row.answer_text ?? "").trim();
          if (!value) continue;
          tally.set(value, (tally.get(value) ?? 0) + 1);
        }
        return {
          question: question.question_text,
          answers: [...tally.entries()]
            .map(([label, count]) => ({ label, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 6),
        };
      })
      .filter((entry) => entry.answers.length > 0);

    const themes = Array.isArray(summary.themes)
      ? (summary.themes as unknown[]).flatMap((theme) => {
          const row = theme as Record<string, unknown>;
          const label = typeof row["label"] === "string" ? row["label"] : "";
          if (!label) return [];
          return [
            {
              label,
              sentiment: typeof row["sentiment"] === "string" ? row["sentiment"] : "neutral",
              detail: typeof row["detail"] === "string" ? row["detail"] : "",
            },
          ];
        })
      : [];

    return [
      {
        id: survey.id,
        title: survey.title,
        respondents: survey.respondent_count,
        questions: survey.question_count,
        anonymous: survey.anonymous,
        summary_md: summary.edited_md?.trim() ? summary.edited_md : summary.draft_md,
        themes,
        sentiment,
        highlights,
      },
    ];
  });
}

export async function buildReport(supabase: Client, clientId: string, period: string) {
  const priorPeriod = priorPeriodOf(period);
  const end = periodEnd(period);

  const [clientResult, metricsResult, planResult, insightResult, noteResult, baselineResult, pointResult, peerResult, activeClientsResult, people, priorPeople] = await Promise.all([
    supabase.from("clients").select("id, name, code, logo_url").eq("id", clientId).maybeSingle(),
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
    // Analyst-authored insights pinned to this client and period from the Ask screen.
    supabase
      .from("saved_insights")
      .select("id, title, question, answer_md, table_json, sources, created_at")
      .eq("client_id", clientId)
      .eq("period", period)
      .eq("include_in_report", true)
      .order("created_at"),
    // Free-text comments written on the Plan screen and marked for the report.
    supabase
      .from("period_notes")
      .select("id, position, heading, body")
      .eq("client_id", clientId)
      .eq("period", period)
      .eq("include_in_report", true)
      .order("position"),
    supabase
      .from("historical_baselines")
      .select("metric_key, value_numeric, label, source, source_note")
      .eq("client_id", clientId)
      .eq("period", period),
    supabase
      .from("recognition_points")
      .select("manager_name, manager_title, department_raw, points_allocated, points_given")
      .eq("client_id", clientId)
      .eq("period", period)
      .order("points_given", { ascending: true }),
    supabase
      .from("published_metrics")
      .select("client_id, metric_key, definition_version, value_numeric")
      .eq("period", period)
      .eq("scope", "company")
      .in("metric_key", ["headcount_active", "turnover_pct", "mood_per_employee", "checked_in_pct", "engagement_recognitions_per_employee"])
      .limit(20000),
    supabase.from("clients").select("id").eq("active", true),
    loadPeople(supabase, clientId, period),
    loadPeople(supabase, clientId, priorPeriod),
  ]);

  const surveys = await loadSurveys(supabase, clientId, period);

  if (clientResult.error) throw new Error(clientResult.error.message);
  if (metricsResult.error) throw new Error(metricsResult.error.message);
  if (planResult.error) throw new Error(planResult.error.message);
  if (insightResult.error) throw new Error(insightResult.error.message);
  if (noteResult.error) throw new Error(noteResult.error.message);
  if (baselineResult.error) throw new Error(baselineResult.error.message);
  if (pointResult.error) throw new Error(pointResult.error.message);
  if (peerResult.error) throw new Error(peerResult.error.message);
  if (activeClientsResult.error) throw new Error(activeClientsResult.error.message);
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

  const nextMonth = periodMonth === 12 ? 1 : periodMonth + 1;
  const nextMonthYear = periodMonth === 12 ? periodYear + 1 : periodYear;
  const upcomingAnniversaries: AnniversaryRow[] = activePeople
    .filter((person) => person.hire_date !== null)
    .map((person) => {
      const hireYear = Number(person.hire_date!.slice(0, 4));
      const hireMonth = Number(person.hire_date!.slice(5, 7));
      return { person, hireMonth, years: nextMonthYear - hireYear };
    })
    .filter((entry) => entry.hireMonth === nextMonth && entry.years >= 1)
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

  const peerLatest = new Map<string, { version: number; value: number }>();
  const activeClientIds = new Set((activeClientsResult.data ?? []).map((row) => row.id));
  for (const row of peerResult.data ?? []) {
    if (row.value_numeric === null || !activeClientIds.has(row.client_id)) continue;
    const key = `${row.client_id}::${row.metric_key}`;
    const current = peerLatest.get(key);
    if (!current || row.definition_version > current.version) {
      peerLatest.set(key, { version: row.definition_version, value: Number(row.value_numeric) });
    }
  }
  const peerGrouped = new Map<string, number[]>();
  for (const [composite, entry] of peerLatest) {
    const metricKey = composite.split("::")[1]!;
    peerGrouped.set(metricKey, [...(peerGrouped.get(metricKey) ?? []), entry.value]);
  }
  const peerAverages: PeerAverage[] = [...peerGrouped].map(([metric_key, values]) => ({
    metric_key,
    value_numeric: values.reduce((sum, value) => sum + value, 0) / values.length,
    client_count: values.length,
  }));

  return {
    client: clientResult.data,
    period,
    priorPeriod,
    metrics: (metricsResult.data ?? []) as MetricRow[],
    actionPlan: planResult.data ?? [],
    notes: (noteResult.data ?? []) as NoteBlock[],
    insights: (insightResult.data ?? []) as unknown as InsightBlock[],
    surveys,
    asPublished: (baselineResult.data ?? []) as PublishedBaseline[],
    recognitionPoints: (pointResult.data ?? []) as RecognitionPointDetail[],
    peerAverages,
    lists: {
      departures,
      invited,
      notCheckedIn,
      lowMood,
      anniversaries,
      upcomingAnniversaries,
      newStarters,
      moodThreshold: MOOD_THRESHOLD,
    },
  };
}

export type ReportData = Awaited<ReturnType<typeof buildReport>>;
