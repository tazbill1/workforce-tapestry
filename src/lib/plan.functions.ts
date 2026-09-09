import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "openai/gpt-6-astra";

const period = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const scope = z.object({ clientId: z.string().uuid(), period });

export type PlanItem = {
  id: string;
  position: number;
  headline: string;
  problem: string | null;
  solution: string | null;
};

export type PlanNote = {
  id: string;
  position: number;
  heading: string | null;
  body: string;
  include_in_report: boolean;
};

/** Everything written for one client and month: the action plan and the extra comments. */
export const listPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => scope.parse(input))
  .handler(async ({ data, context }): Promise<{ items: PlanItem[]; notes: PlanNote[] }> => {
    const [items, notes] = await Promise.all([
      context.supabase
        .from("action_plan_items")
        .select("id, position, headline, problem, solution")
        .eq("client_id", data.clientId)
        .eq("period", data.period)
        .order("position"),
      context.supabase
        .from("period_notes")
        .select("id, position, heading, body, include_in_report")
        .eq("client_id", data.clientId)
        .eq("period", data.period)
        .order("position"),
    ]);
    if (items.error) throw new Error(items.error.message);
    if (notes.error) throw new Error(notes.error.message);
    return { items: items.data ?? [], notes: notes.data ?? [] };
  });

const itemInput = z.object({
  id: z.string().uuid().optional(),
  clientId: z.string().uuid(),
  period,
  headline: z.string().min(2).max(200),
  problem: z.string().max(4000).optional().default(""),
  solution: z.string().max(4000).optional().default(""),
});

/** Creates a new action plan item, or saves edits to an existing one. */
export const savePlanItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => itemInput.parse(input))
  .handler(async ({ data, context }) => {
    if (data.id) {
      const { error } = await context.supabase
        .from("action_plan_items")
        .update({
          headline: data.headline,
          problem: data.problem || null,
          solution: data.solution || null,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    const { data: last, error: readError } = await context.supabase
      .from("action_plan_items")
      .select("position")
      .eq("client_id", data.clientId)
      .eq("period", data.period)
      .order("position", { ascending: false })
      .limit(1);
    if (readError) throw new Error(readError.message);

    const { data: row, error } = await context.supabase
      .from("action_plan_items")
      .insert({
        client_id: data.clientId,
        period: data.period,
        position: (last?.[0]?.position ?? 0) + 1,
        headline: data.headline,
        problem: data.problem || null,
        solution: data.solution || null,
        authored_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deletePlanItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("action_plan_items")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Swaps an item with its neighbour so the analyst can order the pages. */
export const movePlanItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), direction: z.enum(["up", "down"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: item, error } = await context.supabase
      .from("action_plan_items")
      .select("id, client_id, period, position")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!item) throw new Error("That item no longer exists.");

    const { data: neighbours, error: neighbourError } = await context.supabase
      .from("action_plan_items")
      .select("id, position")
      .eq("client_id", item.client_id)
      .eq("period", item.period)
      .order("position");
    if (neighbourError) throw new Error(neighbourError.message);

    const list = neighbours ?? [];
    const index = list.findIndex((entry) => entry.id === item.id);
    const swapIndex = data.direction === "up" ? index - 1 : index + 1;
    const other = list[swapIndex];
    if (index < 0 || !other) return { ok: true };

    await context.supabase
      .from("action_plan_items")
      .update({ position: 1000 + index })
      .eq("id", item.id);
    await context.supabase
      .from("action_plan_items")
      .update({ position: item.position })
      .eq("id", other.id);
    await context.supabase
      .from("action_plan_items")
      .update({ position: other.position })
      .eq("id", item.id);
    return { ok: true };
  });

const noteInput = z.object({
  id: z.string().uuid().optional(),
  clientId: z.string().uuid(),
  period,
  heading: z.string().max(200).optional().default(""),
  body: z.string().max(8000),
  includeInReport: z.boolean(),
});

/** Creates or updates one extra written comment. */
export const saveNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => noteInput.parse(input))
  .handler(async ({ data, context }) => {
    if (data.id) {
      const { error } = await context.supabase
        .from("period_notes")
        .update({
          heading: data.heading || null,
          body: data.body,
          include_in_report: data.includeInReport,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    const { data: last, error: readError } = await context.supabase
      .from("period_notes")
      .select("position")
      .eq("client_id", data.clientId)
      .eq("period", data.period)
      .order("position", { ascending: false })
      .limit(1);
    if (readError) throw new Error(readError.message);

    const { data: row, error } = await context.supabase
      .from("period_notes")
      .insert({
        client_id: data.clientId,
        period: data.period,
        position: (last?.[0]?.position ?? 0) + 1,
        heading: data.heading || null,
        body: data.body,
        include_in_report: data.includeInReport,
        authored_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("period_notes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type DraftedItem = { headline: string; problem: string; solution: string };

/** Reads this period's published numbers and drafts action plan items the analyst can edit. */
export const draftPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    scope.extend({ steer: z.string().max(1000).optional().default("") }).parse(input),
  )
  .handler(async ({ data, context }): Promise<DraftedItem[]> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not set up for this workspace.");

    const [client, metrics] = await Promise.all([
      context.supabase.from("clients").select("name").eq("id", data.clientId).maybeSingle(),
      context.supabase
        .from("published_metrics")
        .select("metric_key, scope, value_numeric, value_text")
        .eq("client_id", data.clientId)
        .eq("period", data.period)
        .limit(600),
    ]);
    if (metrics.error) throw new Error(metrics.error.message);
    const rows = metrics.data ?? [];
    if (rows.length === 0) {
      throw new Error("There are no published numbers for this month yet — rebuild metrics first.");
    }

    const figures = rows
      .map(
        (row) =>
          `${row.metric_key} [${row.scope}] = ${row.value_numeric ?? row.value_text ?? "n/a"}`,
      )
      .join("\n");

    const response = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: MODEL,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You write the action plan pages of a monthly dealership culture report.",
              "Reply with JSON only, shaped as",
              '{"items":[{"headline":"...","problem":"...","solution":"..."}]}',
              "Give three items, ordered by how much they matter.",
              "Headline: under 90 characters, plain English, no jargon.",
              "Problem: two or three sentences quoting the actual figures given.",
              "Solution: two or three sentences of concrete, doable steps for a dealership leader this month.",
              "Never invent a number that is not in the figures provided.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Client: ${client.data?.name ?? "this client"} · month: ${data.period}`,
              data.steer ? `What the analyst wants covered: ${data.steer}` : "",
              "Published figures:",
              figures,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      }),
    });

    if (response.status === 402) throw new Error("AI credits are used up.");
    if (response.status === 429) throw new Error("The AI service is busy — try again shortly.");
    if (!response.ok) throw new Error(`The AI service returned an error (${response.status}).`);

    const body = (await response.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.choices?.[0]?.message?.content ?? "");
    } catch {
      throw new Error("The AI reply could not be read. Try again.");
    }
    const list = (parsed as { items?: unknown })?.items;
    if (!Array.isArray(list)) return [];
    return list
      .map((entry) => entry as Record<string, unknown>)
      .filter((entry) => typeof entry["headline"] === "string")
      .map((entry) => ({
        headline: String(entry["headline"]).slice(0, 200),
        problem: typeof entry["problem"] === "string" ? entry["problem"].slice(0, 4000) : "",
        solution: typeof entry["solution"] === "string" ? entry["solution"].slice(0, 4000) : "",
      }));
  });
