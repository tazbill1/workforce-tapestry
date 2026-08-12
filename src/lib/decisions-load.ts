// Reads and writes for the decisions review screen. Takes a Supabase client so
// the request-scoped authenticated client (RLS as the user) is used.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { RosterRow } from "./assembly-core";
import { listPartImports } from "./assembly-load";

type Client = SupabaseClient<Database>;

const PAGE = 1000;

async function fetchRecords(supabase: Client, importIds: string[], select: string) {
  if (importIds.length === 0) return [] as Record<string, unknown>[];
  const out: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("raw_records")
      .select(select)
      .in("import_id", importIds)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
    if (from > 100000) break;
  }
  return out;
}

/** The logical roster for a period: the union of every parsed, non-superseded part. */
export async function loadRosterUnion(supabase: Client, clientId: string, period: string) {
  const parts = await listPartImports(supabase, clientId, period, "roster");
  const rows = await fetchRecords(
    supabase,
    parts.map((part) => part.id),
    "import_id, normalized_email, email_raw, name_raw, employee_id_raw, title_raw, department_raw, status_raw, hire_date, created_at_src, modified_at_src",
  );
  return { parts, rosterRows: rows as unknown as RosterRow[] };
}

/**
 * Postgres/PostgREST rejects a freshly minted token with "JWT issued at future"
 * when the auth server clock is a second or two ahead of the database clock.
 * It is transient, so retry briefly instead of surfacing a blank screen.
 */
async function withClockSkewRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= 3 || !/issued at future/i.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export async function loadDecisionState(supabase: Client, clientId: string, period: string) {
  return withClockSkewRetry(() => loadDecisionStateOnce(supabase, clientId, period));
}

async function loadDecisionStateOnce(supabase: Client, clientId: string, period: string) {
  const [exclusions, merges, splits, departmentRules, roleMappings, dismissals, engagement, readiness] =
    await Promise.all([
      supabase
        .from("exclusions")
        .select(
          "id, match_type, match_value, category, reason, effective_from, active, superseded_by, confirmed_by, confirmed_at",
        )
        .eq("client_id", clientId)
        .order("confirmed_at", { ascending: false }),
      supabase
        .from("record_merges")
        .select("id, canonical_email, duplicate_email, reason, active, superseded_by, confirmed_at")
        .eq("client_id", clientId)
        .order("confirmed_at", { ascending: false }),
      supabase
        .from("record_splits")
        .select("id, normalized_email, discriminator, reason, active, superseded_by, confirmed_at")
        .eq("client_id", clientId)
        .order("confirmed_at", { ascending: false }),
      supabase
        .from("department_rules")
        .select("id, pattern, franchise_label, function_label, is_shared, active, superseded_by, confirmed_at")
        .eq("client_id", clientId)
        .order("confirmed_at", { ascending: false }),
      supabase
        .from("role_mappings")
        .select(
          "id, title_pattern, department_pattern, role_code, precedence, reason, active, superseded_by, confirmed_at",
        )
        .eq("client_id", clientId)
        .order("precedence"),
      supabase.from("review_dismissals").select("kind, candidate_key, note, reviewed_at").eq("client_id", clientId),
      supabase
        .from("engagement_totals")
        .select("id, likes, comments, logins, recognitions, entered_at")
        .eq("client_id", clientId)
        .eq("period", period)
        .maybeSingle(),
      supabase
        .from("period_readiness")
        .select("id, marked_ready_at")
        .eq("client_id", clientId)
        .eq("period", period)
        .maybeSingle(),
    ]);

  for (const result of [exclusions, merges, splits, departmentRules, roleMappings, dismissals]) {
    if (result.error) throw new Error(result.error.message);
  }

  return {
    exclusions: exclusions.data ?? [],
    merges: merges.data ?? [],
    splits: splits.data ?? [],
    departmentRules: departmentRules.data ?? [],
    roleMappings: roleMappings.data ?? [],
    dismissals: dismissals.data ?? [],
    engagement: engagement.data ?? null,
    readiness: readiness.data ?? null,
  };
}
