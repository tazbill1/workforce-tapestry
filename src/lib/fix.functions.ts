import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  FIX_SYSTEM_PROMPT,
  FIX_TOOLS,
  HIGH_IMPACT_THRESHOLD,
  PROPOSE_FIX_TOOL,
  diagnosisSchema,
  proposalSchema,
  runFixTool,
  type FixDiagnosis,
  type FixProposal,
} from "./fix-core";
import { buildPersonPeriod, summarize } from "./assembly-core";
import { loadAssemblyInputs, persistPersonPeriod } from "./assembly-load";
import { computeMetrics } from "./metrics-core";
import {
  ensureDefinitions,
  loadManualInputs,
  loadPersonPeriod,
  loadRecognitionActivity,
  persistMetrics,
  priorPeriodOf,
} from "./metrics-load";

type Client = SupabaseClient<Database>;

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.7-flash";
const MAX_STEPS = 10;

const scope = z.object({
  clientId: z.string().uuid(),
  period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

type GatewayMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

async function callGateway(messages: GatewayMessage[], apiKey: string) {
  const response = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({ model: MODEL, messages, tools: [...FIX_TOOLS, PROPOSE_FIX_TOOL] }),
  });
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 429)
      throw new Error("The AI service is rate limited right now. Try again in a moment.");
    if (response.status === 402)
      throw new Error("AI credits are exhausted for this workspace. Add credits in Lovable to keep going.");
    if (response.status === 403)
      throw new Error("AI access is blocked by workspace policy. An admin needs to re-enable it.");
    throw new Error(`AI request failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return (await response.json()) as {
    choices: { message: GatewayMessage; finish_reason: string }[];
  };
}

export type FixStep = { tool: string; summary: string };

export type FixDiagnosisResult = FixDiagnosis & {
  highImpact: boolean;
  steps: FixStep[];
};

/** Read-only. Traces the reported problem and returns one proposal for the analyst to approve. */
export const diagnoseReportIssue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; period: string; request: string; context?: string }) =>
    scope
      .extend({ request: z.string().min(3).max(2000), context: z.string().max(500).optional() })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<FixDiagnosisResult> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured for this project.");

    const { data: client } = await context.supabase
      .from("clients")
      .select("name")
      .eq("id", data.clientId)
      .single();

    const messages: GatewayMessage[] = [
      { role: "system", content: FIX_SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Client: ${client?.name ?? "unknown"} (id ${data.clientId}). Period: ${data.period}.` +
          (data.context ? `\nThe analyst was looking at: ${data.context}.` : "") +
          `\n\nWhat looks wrong: ${data.request}`,
      },
    ];

    const steps: FixStep[] = [];

    for (let step = 0; step < MAX_STEPS; step += 1) {
      const result = await callGateway(messages, apiKey);
      const message = result.choices[0]?.message;
      if (!message) throw new Error("The AI returned an empty response.");
      const calls = message.tool_calls ?? [];

      if (calls.length === 0) {
        return {
          diagnosis: message.content?.trim() || "No diagnosis was produced.",
          proposal: { action: "none" },
          affectedPeople: [],
          affectedCount: 0,
          confidence: "low",
          unverified: "",
          manualSteps: "",
          highImpact: false,
          steps,
        };
      }

      messages.push({ role: "assistant", content: message.content ?? "", tool_calls: calls });

      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          args = {};
        }

        if (call.function.name === "propose_fix") {
          const parsed = diagnosisSchema.safeParse(args);
          if (!parsed.success) {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({
                error: `Proposal rejected: ${parsed.error.issues
                  .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                  .join("; ")}. Call propose_fix again with a valid shape.`,
              }),
            });
            continue;
          }
          const value = parsed.data;
          return {
            ...value,
            highImpact:
              value.affectedCount >= HIGH_IMPACT_THRESHOLD ||
              value.proposal.action === "add_department_rule" ||
              (value.proposal.action === "exclude_person" &&
                value.proposal.matchType !== "email"),
            steps,
          };
        }

        try {
          const toolResult = await runFixTool(context.supabase, call.function.name, args);
          steps.push({ tool: call.function.name, summary: toolResult.summary });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              summary: toolResult.summary,
              columns: toolResult.columns,
              rows: toolResult.rows.slice(0, 150),
            }),
          });
        } catch (error) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: (error as Error).message }),
          });
        }
      }
    }

    throw new Error("The AI could not finish tracing this problem. Try describing it more specifically.");
  });

type UndoRecord =
  | { table: "exclusions" | "record_merges" | "role_mappings" | "department_rules"; ids: string[] }
  | { table: "engagement_totals"; previous: Record<string, number | null> | null }
  | { table: "none" };

async function applyProposal(
  supabase: Client,
  userId: string,
  clientId: string,
  period: string,
  proposal: FixProposal,
): Promise<{ description: string; undo: UndoRecord }> {
  switch (proposal.action) {
    case "none":
      throw new Error("There is nothing to apply for this suggestion.");

    case "exclude_person": {
      const { data: inserted, error } = await supabase
        .from("exclusions")
        .insert({
          client_id: clientId,
          match_type: proposal.matchType,
          match_value: proposal.matchValue.trim().toLowerCase(),
          category: proposal.category,
          reason: proposal.reason,
          effective_from: period,
          confirmed_by: userId,
          active: true,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return {
        description: `Excluded ${proposal.matchValue} (${proposal.matchType}).`,
        undo: { table: "exclusions", ids: [inserted.id] },
      };
    }

    case "reverse_exclusion": {
      const { data: original, error: readError } = await supabase
        .from("exclusions")
        .select("match_type, match_value, category")
        .eq("id", proposal.exclusionId)
        .single();
      if (readError) throw new Error(readError.message);
      const { data: inserted, error } = await supabase
        .from("exclusions")
        .insert({
          client_id: clientId,
          match_type: original.match_type,
          match_value: original.match_value,
          category: original.category,
          reason: proposal.reason,
          effective_from: period,
          confirmed_by: userId,
          active: false,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      const { error: supersedeError } = await supabase
        .from("exclusions")
        .update({ superseded_by: inserted.id, active: false })
        .eq("id", proposal.exclusionId);
      if (supersedeError) throw new Error(supersedeError.message);
      return {
        description: `Reversed the exclusion on ${original.match_value}.`,
        undo: { table: "none" },
      };
    }

    case "merge_people": {
      const canonical = proposal.canonicalEmail.trim().toLowerCase();
      const wanted = [
        ...new Set(proposal.duplicateEmails.map((email) => email.trim().toLowerCase())),
      ].filter((email) => email !== canonical);
      if (wanted.length === 0) throw new Error("The canonical email matches the duplicate.");

      const { data: existing } = await supabase
        .from("record_merges")
        .select("duplicate_email")
        .eq("client_id", clientId)
        .eq("active", true)
        .in("duplicate_email", wanted);
      const already = new Set((existing ?? []).map((row) => row.duplicate_email));
      const rows = wanted
        .filter((email) => !already.has(email))
        .map((email) => ({
          client_id: clientId,
          canonical_email: canonical,
          duplicate_email: email,
          reason: proposal.reason,
          effective_from: period,
          confirmed_by: userId,
          active: true,
        }));
      if (rows.length === 0)
        return { description: "Those people were already merged.", undo: { table: "none" } };
      const { data: inserted, error } = await supabase
        .from("record_merges")
        .insert(rows)
        .select("id");
      if (error) throw new Error(error.message);
      return {
        description: `Merged ${rows.length} record(s) into ${canonical}.`,
        undo: { table: "record_merges", ids: (inserted ?? []).map((row) => row.id) },
      };
    }

    case "add_role_mapping": {
      const { data: inserted, error } = await supabase
        .from("role_mappings")
        .insert({
          client_id: clientId,
          title_pattern: proposal.titlePattern,
          department_pattern: proposal.departmentPattern || null,
          role_code: proposal.roleCode,
          precedence: proposal.precedence,
          reason: proposal.reason,
          effective_from: period,
          confirmed_by: userId,
          active: true,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return {
        description: `Mapped "${proposal.titlePattern}" to ${proposal.roleCode}.`,
        undo: { table: "role_mappings", ids: [inserted.id] },
      };
    }

    case "add_department_rule": {
      const { data: inserted, error } = await supabase
        .from("department_rules")
        .insert({
          client_id: clientId,
          pattern: proposal.pattern,
          franchise_label: proposal.franchiseLabel || null,
          function_label: proposal.functionLabel || null,
          is_shared: proposal.isShared,
          effective_from: period,
          confirmed_by: userId,
          active: true,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return {
        description: `Added a department rule for "${proposal.pattern}".`,
        undo: { table: "department_rules", ids: [inserted.id] },
      };
    }

    case "set_engagement_totals": {
      const { data: previous } = await supabase
        .from("engagement_totals")
        .select("likes, comments, logins, recognitions")
        .eq("client_id", clientId)
        .eq("period", period)
        .maybeSingle();
      const { error } = await supabase.from("engagement_totals").upsert(
        {
          client_id: clientId,
          period,
          likes: proposal.likes,
          comments: proposal.comments,
          logins: proposal.logins,
          recognitions: proposal.recognitions,
          source_note: proposal.reason,
          entered_by: userId,
        },
        { onConflict: "client_id,period" },
      );
      if (error) throw new Error(error.message);
      return {
        description: "Updated the engagement totals for this month.",
        undo: { table: "engagement_totals", previous: previous ?? null },
      };
    }
  }
}

/** Rebuild the people layer and the published metrics so the report reflects the change. */
async function rebuild(supabase: Client, clientId: string, period: string) {
  const { input, parts } = await loadAssemblyInputs(supabase, clientId, period);
  if (parts.length === 0) {
    return { rebuilt: false as const, note: "No people file for this month, so nothing was rebuilt." };
  }
  const built = buildPersonPeriod(input);
  await persistPersonPeriod(supabase, clientId, period, built.rows);

  await ensureDefinitions(supabase);
  const rows = await loadPersonPeriod(supabase, clientId, period);
  if (rows.length === 0) {
    return { rebuilt: false as const, note: "No people remained after the change." };
  }
  const priorPeriod = priorPeriodOf(period);
  const priorRows = await loadPersonPeriod(supabase, clientId, priorPeriod);
  const { engagement, recognitions } = await loadManualInputs(supabase, clientId, period);
  const activity = await loadRecognitionActivity(supabase, clientId, period);
  const { data: benchmarkRows } = await supabase
    .from("role_benchmarks")
    .select("role_code, turnover_pct");
  const metrics = computeMetrics({
    period,
    rows,
    priorRows,
    engagement,
    recognitions,
    activity,
    benchmarks: benchmarkRows ?? [],
  });
  const written = await persistMetrics(supabase, clientId, period, metrics);
  return { rebuilt: true as const, note: null, summary: summarize(built.rows), written };
}

export const applyFixProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      clientId: string;
      period: string;
      request: string;
      diagnosis?: string;
      proposal: unknown;
    }) =>
      scope
        .extend({
          request: z.string().min(1).max(2000),
          diagnosis: z.string().max(4000).optional(),
          proposal: proposalSchema,
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const applied = await applyProposal(
      context.supabase,
      context.userId,
      data.clientId,
      data.period,
      data.proposal,
    );
    const rebuilt = await rebuild(context.supabase, data.clientId, data.period);

    const { data: logged, error } = await context.supabase
      .from("fix_actions")
      .insert({
        client_id: data.clientId,
        period: data.period,
        request_text: data.request,
        diagnosis: data.diagnosis ?? null,
        proposal: data.proposal as never,
        status: "applied",
        result: { description: applied.description, ...rebuilt } as never,
        undo: applied.undo as never,
        applied_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return {
      id: logged.id,
      description: applied.description,
      rebuilt: rebuilt.rebuilt,
      note: rebuilt.note,
      summary: "summary" in rebuilt ? rebuilt.summary : null,
    };
  });

export const listFixActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; period: string }) => scope.parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("fix_actions")
      .select("id, request_text, diagnosis, proposal, status, result, undo, applied_at")
      .eq("client_id", data.clientId)
      .eq("period", data.period)
      .order("applied_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((row) => ({
      id: row.id,
      request: row.request_text,
      status: row.status,
      appliedAt: row.applied_at,
      description:
        ((row.result as { description?: string } | null)?.description ?? "Change applied."),
      canUndo:
        row.status === "applied" && (row.undo as { table?: string } | null)?.table !== "none",
    }));
  });

export const undoFixAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("fix_actions")
      .select("id, client_id, period, undo, status")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    if (row.status !== "applied") throw new Error("That fix has already been undone.");

    const undo = row.undo as UndoRecord | null;
    if (!undo || undo.table === "none") throw new Error("That fix cannot be undone automatically.");

    if (undo.table === "engagement_totals") {
      const previous = undo.previous;
      const { error: undoError } = await context.supabase.from("engagement_totals").upsert(
        {
          client_id: row.client_id,
          period: row.period,
          likes: previous?.["likes"] ?? null,
          comments: previous?.["comments"] ?? null,
          logins: previous?.["logins"] ?? null,
          recognitions: previous?.["recognitions"] ?? null,
          entered_by: context.userId,
        },
        { onConflict: "client_id,period" },
      );
      if (undoError) throw new Error(undoError.message);
    } else {
      const { error: undoError } = await context.supabase
        .from(undo.table)
        .update({ active: false })
        .in("id", undo.ids);
      if (undoError) throw new Error(undoError.message);
    }

    const rebuilt = await rebuild(context.supabase, row.client_id, row.period);

    const { error: markError } = await context.supabase
      .from("fix_actions")
      .update({ status: "undone", undone_by: context.userId, undone_at: new Date().toISOString() })
      .eq("id", row.id);
    if (markError) throw new Error(markError.message);

    return { ok: true, rebuilt: rebuilt.rebuilt, note: rebuilt.note };
  });
