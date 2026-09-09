import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withClockSkewRetry } from "./clock-skew";
import { normalizeName } from "./engagement-parse";
import type { QuestionKind, Sentiment } from "./survey-parse";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "openai/gpt-6-astra";

const KINDS = ["scale", "choice", "score", "names", "text"] as const;
const SENTIMENTS = ["positive", "neutral", "negative"] as const;

/** Shared JSON call to Lovable AI. Errors are surfaced to the screen, never swallowed. */
async function askModel(system: string, user: string): Promise<Record<string, unknown>> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI is not configured for this project.");

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
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (response.status === 402) {
    throw new Error("AI credits are used up. Add credits to keep using this.");
  }
  if (response.status === 429) {
    throw new Error("The AI service is busy right now. Try again in a moment.");
  }
  if (!response.ok) {
    throw new Error(`The AI service returned an error (${response.status}).`);
  }

  const body = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
  try {
    return JSON.parse(body.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;
  } catch {
    throw new Error("The AI reply could not be read. Try again.");
  }
}

// ---------------------------------------------------------------- import

export const createSurvey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        period: z.string(),
        title: z.string().min(1).max(200),
        importId: z.string().uuid().nullable().optional(),
        anonymous: z.boolean(),
        respondentCount: z.number().int().min(0),
        questions: z
          .array(
            z.object({
              position: z.number().int(),
              questionText: z.string().min(1).max(1000),
              kind: z.enum(KINDS),
              responseCount: z.number().int().min(0),
            }),
          )
          .min(1)
          .max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: survey, error } = await context.supabase
      .from("surveys")
      .insert({
        client_id: data.clientId,
        period: data.period,
        title: data.title,
        import_id: data.importId ?? null,
        anonymous: data.anonymous,
        respondent_count: data.respondentCount,
        question_count: data.questions.length,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { data: questions, error: questionError } = await context.supabase
      .from("survey_questions")
      .insert(
        data.questions.map((question) => ({
          survey_id: survey.id,
          client_id: data.clientId,
          position: question.position,
          question_text: question.questionText,
          kind: question.kind,
          response_count: question.responseCount,
        })),
      )
      .select("id, position");
    if (questionError) throw new Error(questionError.message);

    return {
      surveyId: survey.id as string,
      questionIds: Object.fromEntries(
        (questions ?? []).map((row) => [row.position, row.id as string]),
      ) as Record<number, string>,
    };
  });

export const insertSurveyResponses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        surveyId: z.string().uuid(),
        clientId: z.string().uuid(),
        period: z.string(),
        rows: z
          .array(
            z.object({
              questionId: z.string().uuid(),
              rowNumber: z.number().int(),
              participantRaw: z.string().max(300).nullable(),
              normalizedName: z.string().max(300).nullable(),
              answerText: z.string().max(4000),
              answerNumeric: z.number().nullable(),
              sentiment: z.enum(SENTIMENTS).nullable(),
              sentimentSource: z.string().max(20).nullable(),
            }),
          )
          .max(300),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("survey_responses").insert(
      data.rows.map((row) => ({
        survey_id: data.surveyId,
        question_id: row.questionId,
        client_id: data.clientId,
        period: data.period,
        row_number: row.rowNumber,
        participant_raw: row.participantRaw,
        normalized_name: row.normalizedName,
        answer_text: row.answerText,
        answer_numeric: row.answerNumeric,
        sentiment: row.sentiment,
        sentiment_source: row.sentimentSource,
      })),
    );
    if (error) throw new Error(error.message);
    return { inserted: data.rows.length };
  });

// ---------------------------------------------------------------- read

export type SurveyResponseRow = {
  id: string;
  question_id: string;
  row_number: number | null;
  participant_raw: string | null;
  normalized_name: string | null;
  answer_text: string | null;
  answer_numeric: number | string | null;
  sentiment: Sentiment | null;
  sentiment_reason: string | null;
  sentiment_source: string | null;
};

export const listSurveys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; period?: string | null }) =>
    z
      .object({ clientId: z.string().uuid(), period: z.string().nullable().optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    withClockSkewRetry(async () => {
      let query = context.supabase
        .from("surveys")
        .select(
          "id, title, period, respondent_count, question_count, anonymous, include_in_report, created_at",
        )
        .eq("client_id", data.clientId)
        .order("created_at", { ascending: false });
      if (data.period) query = query.eq("period", data.period);
      const { data: rows, error } = await query;
      if (error) throw new Error(error.message);

      const ids = (rows ?? []).map((row) => row.id);
      const summaries = ids.length
        ? await context.supabase
            .from("survey_summaries")
            .select("survey_id, accepted_at")
            .in("survey_id", ids)
        : { data: [], error: null };
      if (summaries.error) throw new Error(summaries.error.message);
      const accepted = new Map(
        (summaries.data ?? []).map((row) => [row.survey_id, Boolean(row.accepted_at)]),
      );

      return (rows ?? []).map((row) => ({
        ...row,
        has_summary: accepted.has(row.id),
        summary_accepted: accepted.get(row.id) ?? false,
      }));
    }),
  );

export const getSurvey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { surveyId: string }) =>
    z.object({ surveyId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) =>
    withClockSkewRetry(async () => {
      const { data: survey, error } = await context.supabase
        .from("surveys")
        .select(
          "id, client_id, period, title, respondent_count, question_count, anonymous, include_in_report, created_at",
        )
        .eq("id", data.surveyId)
        .single();
      if (error) throw new Error(error.message);

      const [questions, responses, summary, people, links] = await Promise.all([
        context.supabase
          .from("survey_questions")
          .select("id, position, question_text, kind, response_count")
          .eq("survey_id", survey.id)
          .order("position"),
        context.supabase
          .from("survey_responses")
          .select(
            "id, question_id, row_number, participant_raw, normalized_name, answer_text, answer_numeric, sentiment, sentiment_reason, sentiment_source",
          )
          .eq("survey_id", survey.id)
          .order("row_number")
          .limit(10000),
        context.supabase
          .from("survey_summaries")
          .select("id, draft_md, edited_md, themes, accepted_at")
          .eq("survey_id", survey.id)
          .maybeSingle(),
        context.supabase
          .from("person_period")
          .select("normalized_email, name")
          .eq("client_id", survey.client_id)
          .eq("period", survey.period),
        context.supabase
          .from("name_links")
          .select("normalized_name, normalized_email")
          .eq("client_id", survey.client_id)
          .eq("active", true),
      ]);
      for (const result of [questions, responses, summary, people, links]) {
        if (result.error) throw new Error(result.error.message);
      }

      // Names are resolved at read time so a confirmed name link applies immediately.
      const byName = new Map<string, string[]>();
      for (const person of people.data ?? []) {
        if (!person.name) continue;
        const nameKey = normalizeName(person.name);
        if (!nameKey) continue;
        byName.set(nameKey, [...(byName.get(nameKey) ?? []), person.normalized_email]);
      }
      const linkMap = new Map(
        (links.data ?? []).map((row) => [row.normalized_name, row.normalized_email]),
      );
      const matchOf = (name: string | null) => {
        if (!name) return null;
        const linked = linkMap.get(name);
        if (linked) return linked;
        const candidates = byName.get(name) ?? [];
        return candidates.length === 1 ? candidates[0]! : null;
      };

      const rows = (responses.data ?? []) as SurveyResponseRow[];
      const unmatched = new Set<string>();
      for (const row of rows) {
        if (row.participant_raw && !matchOf(row.normalized_name)) {
          unmatched.add(row.participant_raw);
        }
      }

      return {
        survey,
        questions: questions.data ?? [],
        responses: rows.map((row) => ({ ...row, matched_email: matchOf(row.normalized_name) })),
        summary: summary.data ?? null,
        unmatchedParticipants: [...unmatched].sort(),
      };
    }),
  );

// ---------------------------------------------------------------- sentiment

export const scoreSurveyText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { surveyId: string }) =>
    z.object({ surveyId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: survey, error: surveyError } = await context.supabase
      .from("surveys")
      .select("id, title")
      .eq("id", data.surveyId)
      .single();
    if (surveyError) throw new Error(surveyError.message);

    const { data: questions, error: questionError } = await context.supabase
      .from("survey_questions")
      .select("id, question_text, kind")
      .eq("survey_id", survey.id);
    if (questionError) throw new Error(questionError.message);

    // Only free-text answers need a model; scales and scores are already scored by rule, and
    // nomination questions are a tally, not an opinion.
    const textQuestions = new Map(
      (questions ?? [])
        .filter((question) => question.kind === "text" || question.kind === "choice")
        .map((question) => [question.id, question.question_text]),
    );
    if (textQuestions.size === 0) return { scored: 0 };

    const { data: pending, error: pendingError } = await context.supabase
      .from("survey_responses")
      .select("id, question_id, answer_text")
      .eq("survey_id", survey.id)
      .in("question_id", [...textQuestions.keys()])
      .is("sentiment", null)
      .limit(600);
    if (pendingError) throw new Error(pendingError.message);

    const items = (pending ?? []).filter((row) => (row.answer_text ?? "").trim().length > 1);
    if (items.length === 0) return { scored: 0 };

    const system = [
      "You read short written answers from an employee survey and label the feeling in each one.",
      'Reply with JSON only, shaped as {"labels":[{"id":"<the id given>","sentiment":"positive"|"neutral"|"negative","confidence":0.0-1.0,"why":"<a few words>"}]}.',
      "Label exactly one entry per id you are given.",
      "Positive means the person sounds satisfied, appreciative or enthusiastic. Negative means frustrated, critical or discouraged. Neutral means factual, mixed or a plain suggestion with no clear feeling.",
      "Judge the feeling of the writer, not whether the topic is pleasant.",
    ].join(" ");

    let scored = 0;
    for (let i = 0; i < items.length; i += 40) {
      const batch = items.slice(i, i + 40);
      const user = batch
        .map(
          (row) =>
            `id: ${row.id} | question: ${textQuestions.get(row.question_id) ?? ""} | answer: ${(row.answer_text ?? "").slice(0, 600)}`,
        )
        .join("\n");
      const parsed = await askModel(system, user);
      const labels = Array.isArray(parsed["labels"]) ? (parsed["labels"] as unknown[]) : [];
      const allowed = new Set(batch.map((row) => row.id));

      for (const entry of labels) {
        const row = entry as Record<string, unknown>;
        const id = typeof row["id"] === "string" ? row["id"] : "";
        const sentiment = typeof row["sentiment"] === "string" ? row["sentiment"] : "";
        if (!allowed.has(id) || !SENTIMENTS.includes(sentiment as Sentiment)) continue;
        const confidence = Number(row["confidence"]);
        const { error } = await context.supabase
          .from("survey_responses")
          .update({
            sentiment,
            sentiment_reason: typeof row["why"] === "string" ? row["why"].slice(0, 240) : null,
            sentiment_confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null,
            sentiment_source: "ai",
          })
          .eq("id", id);
        if (error) throw new Error(error.message);
        scored += 1;
      }
    }
    return { scored };
  });

export const setResponseSentiment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ responseId: z.string().uuid(), sentiment: z.enum(SENTIMENTS).nullable() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("survey_responses")
      .update({
        sentiment: data.sentiment,
        sentiment_source: "human",
        sentiment_reason: null,
        sentiment_confidence: null,
        overridden_by: context.userId,
        overridden_at: new Date().toISOString(),
      })
      .eq("id", data.responseId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------- summary

export const draftSurveySummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { surveyId: string }) =>
    z.object({ surveyId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: survey, error } = await context.supabase
      .from("surveys")
      .select("id, client_id, title, respondent_count")
      .eq("id", data.surveyId)
      .single();
    if (error) throw new Error(error.message);

    const [questions, responses] = await Promise.all([
      context.supabase
        .from("survey_questions")
        .select("id, position, question_text, kind")
        .eq("survey_id", survey.id)
        .order("position"),
      context.supabase
        .from("survey_responses")
        .select("question_id, answer_text, sentiment")
        .eq("survey_id", survey.id)
        .limit(5000),
    ]);
    if (questions.error) throw new Error(questions.error.message);
    if (responses.error) throw new Error(responses.error.message);

    const lines: string[] = [`Survey: ${survey.title} — ${survey.respondent_count} respondents`];
    for (const question of questions.data ?? []) {
      const rows = (responses.data ?? []).filter((row) => row.question_id === question.id);
      const counts = { positive: 0, neutral: 0, negative: 0 } as Record<string, number>;
      for (const row of rows) if (row.sentiment) counts[row.sentiment] = (counts[row.sentiment] ?? 0) + 1;
      lines.push(
        `Q${question.position} (${question.kind}): ${question.question_text} — ${rows.length} answers; positive ${counts["positive"]}, neutral ${counts["neutral"]}, negative ${counts["negative"]}`,
      );
      if (question.kind === "text") {
        for (const row of rows.slice(0, 25)) {
          const text = (row.answer_text ?? "").trim();
          if (text.length > 2) lines.push(`  - ${text.slice(0, 300)}`);
        }
      } else {
        const tally = new Map<string, number>();
        for (const row of rows) {
          const value = (row.answer_text ?? "").trim();
          if (value) tally.set(value, (tally.get(value) ?? 0) + 1);
        }
        const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
        lines.push(`  answers: ${top.map(([value, count]) => `${value} (${count})`).join("; ")}`);
      }
    }

    const system = [
      "You write the survey section of a monthly workplace culture report for a dealership group.",
      'Reply with JSON only, shaped as {"summary_md":"<3 short paragraphs of markdown>","themes":[{"label":"<3-6 words>","sentiment":"positive"|"neutral"|"negative","detail":"<one sentence>"}]}.',
      "Give between two and five themes.",
      "Use only what the data below says. Never invent numbers, names or quotes.",
      "Write plainly for a dealership owner: no jargon, no bullet lists in the summary paragraphs.",
    ].join(" ");

    const parsed = await askModel(system, lines.join("\n").slice(0, 24000));
    const draft = typeof parsed["summary_md"] === "string" ? parsed["summary_md"] : "";
    if (!draft.trim()) throw new Error("The AI did not return a summary. Try again.");
    const themes = Array.isArray(parsed["themes"]) ? parsed["themes"].slice(0, 6) : [];

    const { error: upsertError } = await context.supabase.from("survey_summaries").upsert(
      {
        survey_id: survey.id,
        client_id: survey.client_id,
        draft_md: draft.slice(0, 8000),
        edited_md: null,
        themes: themes as never,
        accepted_by: null,
        accepted_at: null,
      },
      { onConflict: "survey_id" },
    );
    if (upsertError) throw new Error(upsertError.message);
    return { ok: true };
  });

export const saveSurveySummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        surveyId: z.string().uuid(),
        editedMd: z.string().max(8000),
        accept: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("survey_summaries")
      .update({
        edited_md: data.editedMd,
        accepted_by: data.accept ? context.userId : null,
        accepted_at: data.accept ? new Date().toISOString() : null,
      })
      .eq("survey_id", data.surveyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setSurveyIncluded = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ surveyId: z.string().uuid(), include: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("surveys")
      .update({ include_in_report: data.include })
      .eq("id", data.surveyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSurvey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { surveyId: string }) =>
    z.object({ surveyId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("surveys").delete().eq("id", data.surveyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type SurveyKindLabel = QuestionKind;
