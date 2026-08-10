// Data loading + persistence for the assembly layer. Takes a Supabase client so
// it works with the request-scoped authenticated client (RLS applies).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  BuildInput,
  LoginRow,
  MoodRow,
  PersonPeriodRow,
  RosterRow,
} from "./assembly-core";

type Client = SupabaseClient<Database>;

const RECORD_PAGE = 1000;

async function fetchAllRecords(
  supabase: Client,
  importIds: string[],
  select: string,
): Promise<Record<string, unknown>[]> {
  if (importIds.length === 0) return [];
  const out: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("raw_records")
      .select(select)
      .in("import_id", importIds)
      .range(from, from + RECORD_PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < RECORD_PAGE) break;
    from += RECORD_PAGE;
    if (from > 100000) break;
  }
  return out;
}

/** All parsed, non-superseded imports of a kind for a client + period. */
export async function listPartImports(
  supabase: Client,
  clientId: string,
  period: string,
  kind: "roster" | "mood_matrix" | "login_report",
) {
  const { data, error } = await supabase
    .from("raw_imports")
    .select("id, original_filename, part_label, row_count, uploaded_at")
    .eq("client_id", clientId)
    .eq("period", period)
    .eq("kind", kind)
    .eq("state", "parsed")
    .is("superseded_by", null)
    .order("uploaded_at");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function loadAssemblyInputs(
  supabase: Client,
  clientId: string,
  period: string,
): Promise<{ input: BuildInput; parts: Awaited<ReturnType<typeof listPartImports>> }> {
  const [rosterImports, moodImports, loginImports] = await Promise.all([
    listPartImports(supabase, clientId, period, "roster"),
    listPartImports(supabase, clientId, period, "mood_matrix"),
    listPartImports(supabase, clientId, period, "login_report"),
  ]);

  const [rosterRaw, moodRaw, loginRaw] = await Promise.all([
    fetchAllRecords(
      supabase,
      rosterImports.map((i) => i.id),
      "import_id, normalized_email, email_raw, name_raw, employee_id_raw, title_raw, department_raw, status_raw, hire_date, created_at_src, modified_at_src",
    ),
    fetchAllRecords(
      supabase,
      moodImports.map((i) => i.id),
      "normalized_email, email_raw, payload",
    ),
    fetchAllRecords(
      supabase,
      loginImports.map((i) => i.id),
      "normalized_email, email_raw, last_login_at",
    ),
  ]);

  const [{ data: merges }, { data: exclusions }, { data: departmentRules }, { data: roleMappings }] =
    await Promise.all([
      supabase
        .from("record_merges")
        .select("canonical_email, duplicate_email, reason")
        .eq("client_id", clientId)
        .eq("active", true),
      supabase
        .from("exclusions")
        .select("match_type, match_value, category, reason, effective_from")
        .eq("client_id", clientId)
        .eq("active", true),
      supabase
        .from("department_rules")
        .select("pattern, franchise_label, function_label")
        .eq("client_id", clientId)
        .eq("active", true),
      supabase
        .from("role_mappings")
        .select("title_pattern, department_pattern, role_code, precedence")
        .eq("client_id", clientId)
        .eq("active", true),
    ]);

  return {
    parts: rosterImports,
    input: {
      clientId,
      period,
      rosterRows: rosterRaw as unknown as RosterRow[],
      moodRows: moodRaw as unknown as MoodRow[],
      loginRows: loginRaw as unknown as LoginRow[],
      merges: merges ?? [],
      exclusions: exclusions ?? [],
      departmentRules: departmentRules ?? [],
      roleMappings: roleMappings ?? [],
      hasMoodImport: moodImports.length > 0,
      hasLoginImport: loginImports.length > 0,
    },
  };
}

/** Replaces the whole period: person_period is a rebuildable materialisation. */
export async function persistPersonPeriod(
  supabase: Client,
  clientId: string,
  period: string,
  rows: PersonPeriodRow[],
) {
  const { error: deleteError } = await supabase
    .from("person_period")
    .delete()
    .eq("client_id", clientId)
    .eq("period", period);
  if (deleteError) throw new Error(deleteError.message);

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from("person_period").insert(rows.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
  return rows.length;
}
