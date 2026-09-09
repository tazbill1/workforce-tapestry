// Client-safe parsing for employee survey exports.
//
// Every survey export seen so far is a long table with one row per answer:
// Participant | Question | Answer. Question types vary wildly inside one file, so each question
// is typed from the answers it actually received rather than from its wording alone.

import { normalizeName } from "./engagement-parse";

export type QuestionKind = "scale" | "choice" | "score" | "names" | "text";

export type SurveyAnswer = {
  row_number: number;
  participant_raw: string | null;
  normalized_name: string | null;
  answer_text: string;
  answer_numeric: number | null;
  /** Set only where the answer type makes sentiment mechanical (Likert, 0-100 score). */
  sentiment: Sentiment | null;
  sentiment_source: "rule" | null;
  /** Filler like "." or "n/a": kept as a response, never sent for sentiment scoring. */
  junk: boolean;
};

export type SurveyQuestion = {
  position: number;
  question_text: string;
  kind: QuestionKind;
  answers: SurveyAnswer[];
};

export type ParsedSurvey = {
  title: string;
  questions: SurveyQuestion[];
  participants: string[];
  anonymous: boolean;
  columnNames: string[];
  responseCount: number;
};

export type Sentiment = "positive" | "neutral" | "negative";

const key = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const LIKERT: Record<string, Sentiment> = {
  stronglyagree: "positive",
  agree: "positive",
  somewhatagree: "positive",
  indifferent: "neutral",
  neutral: "neutral",
  neitheragreenordisagree: "neutral",
  notsure: "neutral",
  disagree: "negative",
  somewhatdisagree: "negative",
  stronglydisagree: "negative",
};

const JUNK = new Set(["", ".", "-", "--", "na", "n/a", "none", "no", "nothing", "nan", "n.a."]);

/** A filler answer someone typed to move past a required field. */
export function isJunkAnswer(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return JUNK.has(trimmed) || trimmed.replace(/[^a-z0-9]/g, "").length === 0;
}

function numericOf(text: string): number | null {
  const trimmed = text.trim();
  if (!/^-?\d+(\.\d+)?%?$/.test(trimmed)) return null;
  const value = Number(trimmed.replace("%", ""));
  return Number.isFinite(value) ? value : null;
}

/** 0-100 style ratings read the same way the pulse score does. */
export function scoreSentiment(value: number): Sentiment {
  if (value >= 70) return "positive";
  if (value >= 40) return "neutral";
  return "negative";
}

function looksLikePersonName(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return (
    words.length >= 2 &&
    words.length <= 4 &&
    words.every((word) => /^[A-Za-z][A-Za-z'.-]*$/.test(word))
  );
}

function classify(questionText: string, answers: string[]): QuestionKind {
  const real = answers.filter((a) => !isJunkAnswer(a));
  if (real.length === 0) return "text";

  const likert = real.filter((a) => LIKERT[key(a)] !== undefined).length;
  if (likert / real.length >= 0.6) return "scale";

  const numeric = real.filter((a) => numericOf(a) !== null).length;
  if (numeric / real.length >= 0.6) return "score";

  const nameHint = /nominat|employee of the month|who (would|do) you/i.test(questionText);
  const nameLike = real.filter(looksLikePersonName).length;
  if (nameHint && nameLike / real.length >= 0.5) return "names";

  const distinct = new Set(real.map((a) => a.trim().toLowerCase()));
  const shortish = real.every((a) => a.trim().length <= 60);
  if (shortish && distinct.size <= 8 && distinct.size < Math.max(2, real.length * 0.6)) {
    return "choice";
  }

  return "text";
}

/** Grid is the sheet as an array of arrays (XLSX `header: 1`). Never throws on row shape. */
export function parseSurveyGrid(filename: string, grid: unknown[][]): ParsedSurvey {
  let headerIndex = -1;
  for (let i = 0; i < Math.min(grid.length, 30); i += 1) {
    const cells = (grid[i] ?? []).map(key);
    if (cells.includes("question") && cells.includes("answer")) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) {
    throw new Error(
      "No survey header row found. The sheet needs columns named Question and Answer (Participant is optional).",
    );
  }

  const header = (grid[headerIndex] ?? []).map((cell) => String(cell ?? "").trim());
  const columnNames = header.filter(Boolean);
  const col = (want: string) => header.findIndex((cell) => key(cell) === want);
  const iParticipant = col("participant");
  const iQuestion = col("question");
  const iAnswer = col("answer");

  type Draft = { position: number; text: string; rows: { row: number; participant: string; answer: string }[] };
  const byQuestion = new Map<string, Draft>();
  const participants = new Set<string>();
  let responseCount = 0;

  for (let i = headerIndex + 1; i < grid.length; i += 1) {
    const row = grid[i] ?? [];
    const questionText = String(row[iQuestion] ?? "").trim();
    if (!questionText) continue;
    const answer = String(row[iAnswer] ?? "").trim();
    const participant = iParticipant === -1 ? "" : String(row[iParticipant] ?? "").trim();
    if (participant) participants.add(participant);

    const questionKey = questionText.toLowerCase();
    const draft =
      byQuestion.get(questionKey) ??
      (() => {
        const created: Draft = { position: byQuestion.size + 1, text: questionText, rows: [] };
        byQuestion.set(questionKey, created);
        return created;
      })();
    draft.rows.push({ row: i + 1, participant, answer });
    responseCount += 1;
  }

  const questions: SurveyQuestion[] = [...byQuestion.values()].map((draft) => {
    const kind = classify(
      draft.text,
      draft.rows.map((r) => r.answer),
    );
    return {
      position: draft.position,
      question_text: draft.text.slice(0, 1000),
      kind,
      answers: draft.rows.map((entry) => {
        const junk = isJunkAnswer(entry.answer);
        const numeric = numericOf(entry.answer);
        let sentiment: Sentiment | null = null;
        if (!junk && kind === "scale") sentiment = LIKERT[key(entry.answer)] ?? null;
        if (!junk && kind === "score" && numeric !== null) sentiment = scoreSentiment(numeric);
        return {
          row_number: entry.row,
          participant_raw: entry.participant ? entry.participant.slice(0, 300) : null,
          normalized_name: entry.participant ? normalizeName(entry.participant).slice(0, 300) : null,
          answer_text: entry.answer.slice(0, 4000),
          answer_numeric: numeric,
          sentiment,
          sentiment_source: sentiment ? ("rule" as const) : null,
          junk,
        };
      }),
    };
  });

  const cleanedTitle = filename
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/^SurveyAnswers[-_]?/i, "")
    .replace(/[-_]\d{6,}.*$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();

  return {
    title: (cleanedTitle || "Survey").slice(0, 200),
    questions,
    participants: [...participants],
    anonymous: participants.size === 0,
    columnNames,
    responseCount,
  };
}

export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  scale: "Agreement scale",
  choice: "Multiple choice",
  score: "Rating out of 100",
  names: "Nominations",
  text: "Written answer",
};
