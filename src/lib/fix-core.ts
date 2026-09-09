/**
 * The "Fix it from the report" layer.
 *
 * The model gets read-only tools (the Ask tools plus a decision reader) and must answer with a
 * single structured proposal. It never writes: `fix.functions.ts` applies an approved proposal
 * through the same decision-layer rules the Decisions screen uses.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import { ASK_TOOLS, runAskTool, type ToolResult } from "./ask-core";

type Client = SupabaseClient<Database>;

export const FIX_TOOLS = [
  ...ASK_TOOLS,
  {
    type: "function",
    function: {
      name: "list_decisions",
      description:
        "List the active decision rules for one client: exclusions, merges, role mappings and department rules. Call this before proposing a change so you do not duplicate a rule that already exists, and so you can reference an existing rule id when reversing one.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "Client uuid." },
          kind: {
            type: "string",
            enum: ["exclusions", "merges", "role_mappings", "department_rules", "all"],
          },
        },
        required: ["client_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_person",
      description:
        "Find assembled people for one client by partial name or email across periods. Use it to resolve a person named in the request into an exact normalized email before proposing a change.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string" },
          search: { type: "string", description: "Partial name or email." },
          period: { type: "string", description: "Optional period month start." },
        },
        required: ["client_id", "search"],
      },
    },
  },
] as const;

async function runListDecisions(
  supabase: Client,
  args: { client_id: string; kind?: string },
): Promise<ToolResult> {
  const kind = args.kind ?? "all";
  const rows: Record<string, string | number | null>[] = [];

  if (kind === "all" || kind === "exclusions") {
    const { data } = await supabase
      .from("exclusions")
      .select("id, match_type, match_value, category, reason, effective_from")
      .eq("client_id", args.client_id)
      .eq("active", true)
      .limit(300);
    for (const row of data ?? [])
      rows.push({
        kind: "exclusion",
        id: row.id,
        a: row.match_type,
        b: row.match_value,
        c: row.category,
        note: row.reason,
        effective_from: row.effective_from,
      });
  }
  if (kind === "all" || kind === "merges") {
    const { data } = await supabase
      .from("record_merges")
      .select("id, canonical_email, duplicate_email, reason, effective_from")
      .eq("client_id", args.client_id)
      .eq("active", true)
      .limit(300);
    for (const row of data ?? [])
      rows.push({
        kind: "merge",
        id: row.id,
        a: row.canonical_email,
        b: row.duplicate_email,
        c: null,
        note: row.reason,
        effective_from: row.effective_from,
      });
  }
  if (kind === "all" || kind === "role_mappings") {
    const { data } = await supabase
      .from("role_mappings")
      .select("id, title_pattern, department_pattern, role_code, precedence, effective_from")
      .eq("client_id", args.client_id)
      .eq("active", true)
      .limit(300);
    for (const row of data ?? [])
      rows.push({
        kind: "role_mapping",
        id: row.id,
        a: row.title_pattern,
        b: row.department_pattern,
        c: row.role_code,
        note: `precedence ${row.precedence}`,
        effective_from: row.effective_from,
      });
  }
  if (kind === "all" || kind === "department_rules") {
    const { data } = await supabase
      .from("department_rules")
      .select("id, pattern, franchise_label, function_label, is_shared, effective_from")
      .eq("client_id", args.client_id)
      .eq("active", true)
      .limit(300);
    for (const row of data ?? [])
      rows.push({
        kind: "department_rule",
        id: row.id,
        a: row.pattern,
        b: row.franchise_label,
        c: row.function_label,
        note: row.is_shared ? "shared" : "",
        effective_from: row.effective_from,
      });
  }

  return {
    summary: `${rows.length} active decision rule(s).`,
    columns: ["kind", "id", "a", "b", "c", "note", "effective_from"],
    rows,
  };
}

async function runFindPerson(
  supabase: Client,
  args: { client_id: string; search: string; period?: string },
): Promise<ToolResult> {
  const term = `%${args.search.trim()}%`;
  let query = supabase
    .from("person_period")
    .select(
      "period, normalized_email, name, title_raw, department_raw, role_code, status, is_excluded, hire_date",
    )
    .eq("client_id", args.client_id)
    .or(`name.ilike.${term},normalized_email.ilike.${term}`)
    .limit(100);
  if (args.period) query = query.eq("period", args.period);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return {
    summary: `${data?.length ?? 0} matching person row(s).`,
    columns: [
      "period",
      "normalized_email",
      "name",
      "title_raw",
      "department_raw",
      "role_code",
      "status",
      "is_excluded",
      "hire_date",
    ],
    rows: (data ?? []).map((row) => ({ ...row, is_excluded: row.is_excluded ? "yes" : "no" })),
  };
}

export async function runFixTool(
  supabase: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (name === "list_decisions") return runListDecisions(supabase, args as never);
  if (name === "find_person") return runFindPerson(supabase, args as never);
  return runAskTool(supabase, name, args);
}

/** One approved change. Anything outside this vocabulary can only be advised, never applied. */
export const proposalSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("none"),
  }),
  z.object({
    action: z.literal("exclude_person"),
    matchType: z.enum(["email", "name", "email_domain", "keyword"]),
    matchValue: z.string().min(1),
    category: z.enum(["test", "demo", "vendor", "platform", "internal", "legacy", "other"]),
    reason: z.string().min(3),
  }),
  z.object({
    action: z.literal("reverse_exclusion"),
    exclusionId: z.string().uuid(),
    reason: z.string().min(3),
  }),
  z.object({
    action: z.literal("merge_people"),
    canonicalEmail: z.string().min(3),
    duplicateEmails: z.array(z.string().min(3)).min(1).max(20),
    reason: z.string().min(3),
  }),
  z.object({
    action: z.literal("add_role_mapping"),
    titlePattern: z.string().min(1),
    departmentPattern: z.string().nullable().default(null),
    roleCode: z.string().min(1),
    precedence: z.number().int().min(0).max(100).default(50),
    reason: z.string().min(3),
  }),
  z.object({
    action: z.literal("add_department_rule"),
    pattern: z.string().min(1),
    franchiseLabel: z.string().nullable().default(null),
    functionLabel: z.string().nullable().default(null),
    isShared: z.boolean().default(false),
    reason: z.string().min(3),
  }),
  z.object({
    action: z.literal("set_engagement_totals"),
    likes: z.number().int().nullable().default(null),
    comments: z.number().int().nullable().default(null),
    logins: z.number().int().nullable().default(null),
    recognitions: z.number().int().nullable().default(null),
    reason: z.string().min(3),
  }),
]);

export type FixProposal = z.infer<typeof proposalSchema>;

export const diagnosisSchema = z.object({
  diagnosis: z.string().min(1),
  proposal: proposalSchema,
  affectedPeople: z.array(z.string()).max(200).default([]),
  affectedCount: z.number().int().min(0).default(0),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  unverified: z.string().default(""),
  manualSteps: z.string().default(""),
});

export type FixDiagnosis = z.infer<typeof diagnosisSchema>;

export const HIGH_IMPACT_THRESHOLD = 10;

export const PROPOSE_FIX_TOOL = {
  type: "function",
  function: {
    name: "propose_fix",
    description:
      "Return your finished diagnosis and at most one proposed change. Call this exactly once, as your final step. Use action 'none' when no allowed change would fix the problem, and put the human instructions in manualSteps.",
    parameters: {
      type: "object",
      properties: {
        diagnosis: {
          type: "string",
          description:
            "Plain-language explanation of what is causing the problem, naming the people, rules or files involved. No jargon.",
        },
        proposal: {
          type: "object",
          description:
            "The single change to make. Shape depends on 'action'. Allowed actions: none; exclude_person {matchType(email|name|email_domain|keyword), matchValue, category(test|demo|vendor|platform|internal|legacy|other), reason}; reverse_exclusion {exclusionId, reason}; merge_people {canonicalEmail, duplicateEmails[], reason}; add_role_mapping {titlePattern, departmentPattern|null, roleCode, precedence, reason}; add_department_rule {pattern, franchiseLabel|null, functionLabel|null, isShared, reason}; set_engagement_totals {likes|null, comments|null, logins|null, recognitions|null, reason}.",
          properties: { action: { type: "string" } },
          required: ["action"],
        },
        affectedPeople: {
          type: "array",
          items: { type: "string" },
          description: "Names or emails the change touches, as observed in tool results.",
        },
        affectedCount: { type: "number" },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        unverified: {
          type: "string",
          description: "Anything you could not confirm from the data. Empty string if none.",
        },
        manualSteps: {
          type: "string",
          description:
            "When action is 'none', what the analyst should do by hand and on which screen. Empty string otherwise.",
        },
      },
      required: ["diagnosis", "proposal"],
    },
  },
} as const;

export const FIX_SYSTEM_PROMPT = `You are the correction assistant for a multi-client workforce reporting console. An analyst is looking at a printed culture report and has told you something on it looks wrong. Your job is to trace the problem back through the data and propose exactly one change that fixes it.

How the data flows: imported spreadsheets (raw_records, never edited) -> decision rules (exclusions, merges, role mappings, department rules, engagement totals) -> assembled people (person_period) -> published metrics -> the report. Only decision rules can be changed. Source files are immutable.

Process:
1. Use the read tools to confirm what is actually in the data. Resolve names to exact normalized emails with find_person. Check list_decisions before proposing a rule so you never duplicate one that already exists.
2. Compare with the published metrics (query_metrics) so you know how the report's number was produced.
3. Call propose_fix exactly once as your last step.

Rules:
- Never guess an email, an id or a count. Every value in your proposal must have appeared in a tool result.
- Propose the narrowest change that fixes it. Prefer excluding one email over a whole domain, unless the analyst asked for the domain.
- If the cause is bad or missing source data, or anything outside the allowed actions, use action "none" and explain in manualSteps which screen to use.
- Write the diagnosis for a non-technical reader: names, numbers, plain sentences, no table or column names.
- Set confidence honestly and list anything you could not verify.`;
