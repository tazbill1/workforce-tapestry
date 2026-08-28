/**
 * The query layer behind the Ask screen.
 *
 * The model never writes SQL. It picks a tool and a set of parameters from the fixed vocabulary
 * declared here, and this module turns that into a typed Supabase query. Two consequences that
 * matter: the model cannot reach a table it was not given, and every read runs through the
 * caller's own Supabase client, so row level security scopes results to the clients that user is
 * assigned to without any filtering logic of our own.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

export type ToolResult = {
  summary: string;
  columns: string[];
  rows: Record<string, string | number | null>[];
  truncated?: boolean;
};

const MAX_ROWS = 500;
const SCAN_CAP = 20000;

const num = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const round = (value: number, digits = 2) => Number(value.toFixed(digits));

/** The tool vocabulary handed to the model. Keep descriptions concrete: they are the docs. */
export const ASK_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_clients",
      description:
        "List the dealership clients the current user can see, with id, name and code. Always call this first when a question names a dealership or asks to compare clients.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_periods",
      description:
        "List the reporting periods (month start dates) that have assembled people data, optionally for one client.",
      parameters: {
        type: "object",
        properties: { client_id: { type: "string", description: "Optional client uuid." } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_metric_keys",
      description:
        "List published metric keys with their descriptions and formula notes. Use it to pick the right key before calling query_metrics.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "query_metrics",
      description:
        "Read published metrics — the same numbers the PDF reports print. Prefer this over raw people data whenever a published metric answers the question. Returns client, period, metric_key, scope, value and definition version.",
      parameters: {
        type: "object",
        properties: {
          client_ids: { type: "array", items: { type: "string" }, description: "Client uuids; omit for all visible clients." },
          periods: { type: "array", items: { type: "string" }, description: "Period month starts, e.g. 2026-07-01." },
          metric_keys: { type: "array", items: { type: "string" } },
          scope: { type: "string", description: "Exact scope, e.g. 'company'." },
          scope_prefix: { type: "string", description: "Scope prefix, e.g. 'role:' or 'franchise:'." },
          limit: { type: "number" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_people",
      description:
        "Query assembled person rows (person_period): one resolved person per client per period, with status, role, franchise, department, tenure, mood and check-in. Use aggregate='count'|'avg_tenure'|'avg_mood'|'list' and an optional group_by for cross-client comparisons.",
      parameters: {
        type: "object",
        properties: {
          client_ids: { type: "array", items: { type: "string" } },
          periods: { type: "array", items: { type: "string" } },
          status: { type: "string", description: "e.g. Active, Inactive, Invited." },
          role_code: { type: "string" },
          franchise: { type: "string" },
          department_contains: { type: "string" },
          include_excluded: { type: "boolean", description: "Default false: excluded people are dropped." },
          checked_in: { type: "boolean" },
          group_by: {
            type: "string",
            enum: ["client", "period", "status", "role_code", "franchise_label", "department_raw"],
          },
          aggregate: { type: "string", enum: ["count", "avg_tenure", "avg_mood", "list"] },
          limit: { type: "number" },
        },
        required: ["aggregate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_raw_records",
      description:
        "Read raw imported spreadsheet rows for one client and period, before assembly. Use only when a question is about source data quality or a value that assembly does not keep.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string" },
          period: { type: "string" },
          search: { type: "string", description: "Case-insensitive match on name or email." },
          limit: { type: "number", description: "Max 100." },
        },
        required: ["client_id", "period"],
      },
    },
  },
] as const;

const PEOPLE_COLUMNS =
  "client_id, period, normalized_email, name, title_raw, department_raw, franchise_label, role_code, status, hire_date, departure_date_proxy, tenure_years, is_excluded, checkin_count, mood_avg, checked_in";

type PersonRow = {
  client_id: string;
  period: string;
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
};

async function clientNames(supabase: Client): Promise<Map<string, string>> {
  const { data } = await supabase.from("clients").select("id, name");
  return new Map((data ?? []).map((row) => [row.id, row.name]));
}

async function runListClients(supabase: Client): Promise<ToolResult> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, code, active")
    .order("name");
  if (error) throw new Error(error.message);
  return {
    summary: `${data?.length ?? 0} client(s) visible to you.`,
    columns: ["id", "name", "code", "active"],
    rows: (data ?? []).map((row) => ({ ...row, active: row.active ? "yes" : "no" })),
  };
}

async function runListPeriods(supabase: Client, clientId?: string): Promise<ToolResult> {
  let query = supabase.from("person_period").select("client_id, period").limit(SCAN_CAP);
  if (clientId) query = query.eq("client_id", clientId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const names = await clientNames(supabase);
  const seen = new Map<string, { client: string; period: string }>();
  for (const row of data ?? []) {
    const key = `${row.client_id}::${row.period}`;
    if (!seen.has(key)) {
      seen.set(key, { client: names.get(row.client_id) ?? row.client_id, period: row.period });
    }
  }
  const rows = [...seen.values()].sort(
    (a, b) => a.client.localeCompare(b.client) || a.period.localeCompare(b.period),
  );
  return { summary: `${rows.length} client/period combination(s).`, columns: ["client", "period"], rows };
}

async function runListMetricKeys(supabase: Client): Promise<ToolResult> {
  const { data, error } = await supabase
    .from("metric_definitions")
    .select("key, version, description, formula_note")
    .order("key");
  if (error) throw new Error(error.message);
  return {
    summary: `${data?.length ?? 0} metric definition(s).`,
    columns: ["key", "version", "description", "formula_note"],
    rows: (data ?? []) as Record<string, string | number | null>[],
  };
}

async function runQueryMetrics(
  supabase: Client,
  args: {
    client_ids?: string[];
    periods?: string[];
    metric_keys?: string[];
    scope?: string;
    scope_prefix?: string;
    limit?: number;
  },
): Promise<ToolResult> {
  const limit = Math.min(args.limit ?? 200, MAX_ROWS);
  let query = supabase
    .from("published_metrics")
    .select("client_id, period, metric_key, scope, value_numeric, value_text, definition_version")
    .order("period", { ascending: false })
    .limit(limit + 1);
  if (args.client_ids?.length) query = query.in("client_id", args.client_ids);
  if (args.periods?.length) query = query.in("period", args.periods);
  if (args.metric_keys?.length) query = query.in("metric_key", args.metric_keys);
  if (args.scope) query = query.eq("scope", args.scope);
  if (args.scope_prefix) query = query.like("scope", `${args.scope_prefix}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const names = await clientNames(supabase);
  const all = data ?? [];
  const rows = all.slice(0, limit).map((row) => ({
    client: names.get(row.client_id) ?? row.client_id,
    period: row.period,
    metric_key: row.metric_key,
    scope: row.scope,
    value: num(row.value_numeric),
    text: row.value_text,
    version: row.definition_version,
  }));
  return {
    summary: `${rows.length} published metric row(s).`,
    columns: ["client", "period", "metric_key", "scope", "value", "text", "version"],
    rows,
    truncated: all.length > limit,
  };
}

async function loadPeople(
  supabase: Client,
  args: { client_ids?: string[]; periods?: string[] },
): Promise<PersonRow[]> {
  const rows: PersonRow[] = [];
  const pageSize = 1000;
  for (let from = 0; from < SCAN_CAP; from += pageSize) {
    let query = supabase
      .from("person_period")
      .select(PEOPLE_COLUMNS)
      .order("normalized_email")
      .range(from, from + pageSize - 1);
    if (args.client_ids?.length) query = query.in("client_id", args.client_ids);
    if (args.periods?.length) query = query.in("period", args.periods);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as PersonRow[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function runQueryPeople(
  supabase: Client,
  args: {
    client_ids?: string[];
    periods?: string[];
    status?: string;
    role_code?: string;
    franchise?: string;
    department_contains?: string;
    include_excluded?: boolean;
    checked_in?: boolean;
    group_by?: string;
    aggregate: string;
    limit?: number;
  },
): Promise<ToolResult> {
  const names = await clientNames(supabase);
  let people = await loadPeople(supabase, args);

  if (!args.include_excluded) people = people.filter((row) => !row.is_excluded);
  if (args.status) people = people.filter((row) => (row.status ?? "").toLowerCase() === args.status!.toLowerCase());
  if (args.role_code) people = people.filter((row) => row.role_code === args.role_code);
  if (args.franchise)
    people = people.filter(
      (row) => (row.franchise_label ?? "").toLowerCase() === args.franchise!.toLowerCase(),
    );
  if (args.department_contains)
    people = people.filter((row) =>
      (row.department_raw ?? "").toLowerCase().includes(args.department_contains!.toLowerCase()),
    );
  if (args.checked_in !== undefined)
    people = people.filter((row) => Boolean(row.checked_in) === args.checked_in);

  const limit = Math.min(args.limit ?? 100, MAX_ROWS);

  if (args.aggregate === "list") {
    const rows = people.slice(0, limit).map((row) => ({
      client: names.get(row.client_id) ?? row.client_id,
      period: row.period,
      name: row.name ?? row.normalized_email,
      email: row.normalized_email,
      title: row.title_raw,
      department: row.department_raw,
      franchise: row.franchise_label,
      role: row.role_code,
      status: row.status,
      tenure_years: num(row.tenure_years),
      mood_avg: num(row.mood_avg),
      checked_in: row.checked_in ? "yes" : "no",
    }));
    return {
      summary: `${people.length} matching person row(s); showing ${rows.length}.`,
      columns: [
        "client",
        "period",
        "name",
        "email",
        "title",
        "department",
        "franchise",
        "role",
        "status",
        "tenure_years",
        "mood_avg",
        "checked_in",
      ],
      rows,
      truncated: people.length > rows.length,
    };
  }

  const keyOf = (row: PersonRow): string => {
    switch (args.group_by) {
      case "client":
        return names.get(row.client_id) ?? row.client_id;
      case "period":
        return row.period;
      case "status":
        return row.status ?? "(none)";
      case "role_code":
        return row.role_code ?? "(unmapped)";
      case "franchise_label":
        return row.franchise_label ?? "(none)";
      case "department_raw":
        return row.department_raw ?? "(none)";
      default:
        return "all";
    }
  };

  const buckets = new Map<string, PersonRow[]>();
  for (const row of people) {
    const key = keyOf(row);
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }

  const label = args.group_by ?? "group";
  const rows = [...buckets.entries()]
    .map(([key, bucket]) => {
      if (args.aggregate === "avg_tenure") {
        const values = bucket.map((row) => num(row.tenure_years)).filter((v): v is number => v !== null && v >= 0);
        return {
          [label]: key,
          people: bucket.length,
          avg_tenure_years: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null,
        };
      }
      if (args.aggregate === "avg_mood") {
        const values = bucket.map((row) => num(row.mood_avg)).filter((v): v is number => v !== null);
        return {
          [label]: key,
          people: bucket.length,
          avg_mood: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, 1) : null,
        };
      }
      return { [label]: key, people: bucket.length };
    })
    .sort((a, b) => String(a[label]).localeCompare(String(b[label])))
    .slice(0, MAX_ROWS);

  const columns = Object.keys(rows[0] ?? { [label]: "", people: 0 });
  return { summary: `${people.length} person row(s) across ${rows.length} group(s).`, columns, rows };
}

async function runQueryRawRecords(
  supabase: Client,
  args: { client_id: string; period: string; search?: string; limit?: number },
): Promise<ToolResult> {
  const limit = Math.min(args.limit ?? 50, 100);
  let query = supabase
    .from("raw_records")
    .select(
      "period, name_raw, email_raw, normalized_email, title_raw, department_raw, status_raw, hire_date, last_login_at, parse_flags",
    )
    .eq("client_id", args.client_id)
    .eq("period", args.period)
    .limit(limit + 1);
  if (args.search) {
    const term = `%${args.search}%`;
    query = query.or(`name_raw.ilike.${term},email_raw.ilike.${term}`);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const all = data ?? [];
  const rows = all.slice(0, limit).map((row) => ({
    period: row.period,
    name: row.name_raw,
    email: row.normalized_email ?? row.email_raw,
    title: row.title_raw,
    department: row.department_raw,
    status: row.status_raw,
    hire_date: row.hire_date,
    last_login: row.last_login_at,
    parse_flags: (row.parse_flags ?? []).join(", "),
  }));
  return {
    summary: `${rows.length} raw record(s).`,
    columns: ["period", "name", "email", "title", "department", "status", "hire_date", "last_login", "parse_flags"],
    rows,
    truncated: all.length > limit,
  };
}

export async function runAskTool(
  supabase: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  switch (name) {
    case "list_clients":
      return runListClients(supabase);
    case "list_periods":
      return runListPeriods(supabase, args["client_id"] as string | undefined);
    case "list_metric_keys":
      return runListMetricKeys(supabase);
    case "query_metrics":
      return runQueryMetrics(supabase, args as never);
    case "query_people":
      return runQueryPeople(supabase, args as never);
    case "query_raw_records":
      return runQueryRawRecords(supabase, args as never);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export const ASK_SYSTEM_PROMPT = `You are the analyst assistant for a multi-client workforce reporting console.

You answer questions about dealership clients by calling the query tools. You never invent numbers: every figure in your answer must come from a tool result in this conversation. If the tools cannot answer, say so plainly and name what is missing.

Rules:
- Prefer published metrics (query_metrics) over recomputing from people rows, because published metrics are exactly what the client reports print. Say which source you used.
- Resolve client names to ids with list_clients before filtering, and check list_periods before assuming a period exists. Periods are month start dates like 2026-07-01.
- The user only ever sees the clients they are assigned to; if a named client is missing from list_clients, tell them it is not available to them rather than guessing.
- When comparing clients or periods, return a small comparison table in markdown, ordered sensibly, with units (% for rates, years for tenure).
- Be concise: a short direct answer, the table, then at most three bullets of interpretation. No preamble.
- End with a one-line "Source:" note listing the metric keys or tables you read.`;
