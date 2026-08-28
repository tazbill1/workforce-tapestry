import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ASK_SYSTEM_PROMPT, ASK_TOOLS, runAskTool, type ToolResult } from "./ask-core";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.7-flash";
const MAX_STEPS = 8;

const turnSchema = z.object({
  question: z.string().min(2).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .max(20)
    .default([]),
});

export type AskStep = { tool: string; args: Record<string, unknown> } & ToolResult;

export type AskAnswer = {
  answer: string;
  steps: AskStep[];
};

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
    body: JSON.stringify({ model: MODEL, messages, tools: ASK_TOOLS }),
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 429)
      throw new Error("The AI service is rate limited right now. Try again in a moment.");
    if (response.status === 402)
      throw new Error("AI credits are exhausted for this workspace. Add credits in Lovable to keep asking.");
    if (response.status === 403)
      throw new Error("AI access is blocked by workspace policy. An admin needs to re-enable it.");
    throw new Error(`AI request failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return (await response.json()) as {
    choices: { message: GatewayMessage; finish_reason: string }[];
  };
}

/**
 * One question, answered against the warehouse.
 *
 * The model may only reach data through the tools in `ask-core`, and every one of those reads
 * uses the caller's Supabase client, so results are scoped by row level security to the clients
 * this user is assigned to. Analysts see everything; a coach asking to "compare all dealerships"
 * gets a comparison of their own.
 */
export const askQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { question: string; history?: { role: "user" | "assistant"; content: string }[] }) =>
    turnSchema.parse(input),
  )
  .handler(async ({ data, context }): Promise<AskAnswer> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured for this project.");

    const messages: GatewayMessage[] = [
      { role: "system", content: ASK_SYSTEM_PROMPT },
      ...data.history.map((entry) => ({ role: entry.role, content: entry.content })),
      { role: "user", content: data.question },
    ];

    const steps: AskStep[] = [];

    for (let step = 0; step < MAX_STEPS; step += 1) {
      const result = await callGateway(messages, apiKey);
      const message = result.choices[0]?.message;
      if (!message) throw new Error("The AI returned an empty response.");

      const calls = message.tool_calls ?? [];
      if (calls.length === 0) {
        return { answer: message.content?.trim() || "No answer was produced.", steps };
      }

      messages.push({ role: "assistant", content: message.content ?? "", tool_calls: calls });

      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          args = {};
        }
        try {
          const toolResult = await runAskTool(context.supabase, call.function.name, args);
          steps.push({ tool: call.function.name, args, ...toolResult });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              summary: toolResult.summary,
              truncated: toolResult.truncated ?? false,
              columns: toolResult.columns,
              rows: toolResult.rows.slice(0, 200),
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

    return {
      answer:
        "I ran out of query steps before reaching an answer. Try narrowing the question to specific clients or periods.",
      steps,
    };
  });

const saveSchema = z.object({
  title: z.string().min(2).max(120),
  question: z.string().min(2),
  answerMd: z.string().min(1),
  clientId: z.string().uuid().nullable().default(null),
  period: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  includeInReport: z.boolean().default(false),
  table: z
    .object({ columns: z.array(z.string()), rows: z.array(z.record(z.string(), z.any())) })
    .nullable()
    .default(null),
  sources: z.array(z.string()).default([]),
});

export const saveInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => saveSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (data.includeInReport && (!data.clientId || !data.period)) {
      throw new Error("Pick a client and period before adding an insight to a report.");
    }
    const { data: row, error } = await context.supabase
      .from("saved_insights")
      .insert({
        title: data.title,
        question: data.question,
        answer_md: data.answerMd,
        client_id: data.clientId,
        period: data.period,
        include_in_report: data.includeInReport,
        table_json: data.table,
        sources: data.sources,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId?: string | null; period?: string | null }) =>
    z
      .object({
        clientId: z.string().uuid().nullable().optional(),
        period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("saved_insights")
      .select("id, client_id, period, title, question, answer_md, table_json, sources, include_in_report, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.clientId) query = query.eq("client_id", data.clientId);
    if (data.period) query = query.eq("period", data.period);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const setInsightInReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; include: boolean }) =>
    z.object({ id: z.string().uuid(), include: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("saved_insights")
      .update({ include_in_report: data.include })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("saved_insights").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Push an answer into a client's action plan for a period, appended at the end of the list. */
export const addActionPlanItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { clientId: string; period: string; headline: string; problem?: string; solution?: string }) =>
      z
        .object({
          clientId: z.string().uuid(),
          period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          headline: z.string().min(2).max(200),
          problem: z.string().max(4000).optional(),
          solution: z.string().max(4000).optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: existing, error: readError } = await context.supabase
      .from("action_plan_items")
      .select("position")
      .eq("client_id", data.clientId)
      .eq("period", data.period)
      .order("position", { ascending: false })
      .limit(1);
    if (readError) throw new Error(readError.message);
    const position = (existing?.[0]?.position ?? 0) + 1;

    const { error } = await context.supabase.from("action_plan_items").insert({
      client_id: data.clientId,
      period: data.period,
      position,
      headline: data.headline,
      problem: data.problem ?? null,
      solution: data.solution ?? null,
      authored_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { position };
  });
