import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, MessageSquare, Sparkles, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useActiveClient } from "@/lib/active-client";
import {
  checkDuplicate,
  createImport,
  finalizeImport,
  listMyClients,
} from "@/lib/imports.functions";
import { QUESTION_KIND_LABELS, type QuestionKind, type Sentiment } from "@/lib/survey-parse";
import { uploadSurveyFile } from "@/lib/survey-upload";
import {
  createSurvey,
  deleteSurvey,
  draftSurveySummary,
  getSurvey,
  insertSurveyResponses,
  listSurveys,
  saveSurveySummary,
  scoreSurveyText,
  setResponseSentiment,
  setSurveyIncluded,
} from "@/lib/surveys.functions";

export const Route = createFileRoute("/_authenticated/surveys")({
  head: () => ({
    meta: [
      { title: "Employee surveys | Client Reporting Console" },
      {
        name: "description",
        content:
          "Read uploaded employee surveys question by question, check how each written answer was read, and approve the summary that prints on the report.",
      },
      { property: "og:title", content: "Employee surveys | Client Reporting Console" },
      {
        property: "og:description",
        content:
          "Survey results, sentiment for written answers, and an approved written summary for each client and month.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SurveysScreen,
});

const SENTIMENT_STYLE: Record<Sentiment, string> = {
  positive: "bg-emerald-100 text-emerald-900",
  neutral: "bg-slate-100 text-slate-900",
  negative: "bg-rose-100 text-rose-900",
};

function SentimentPill({ value }: { value: Sentiment | null }) {
  if (!value) return <span className="text-xs text-muted-foreground">not read</span>;
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${SENTIMENT_STYLE[value]}`}>
      {value}
    </span>
  );
}

function SurveysScreen() {
  const queryClient = useQueryClient();
  const { clientId } = useActiveClient();

  const clientsFn = useServerFn(listMyClients);
  const listFn = useServerFn(listSurveys);
  const getFn = useServerFn(getSurvey);
  const scoreFn = useServerFn(scoreSurveyText);
  const overrideFn = useServerFn(setResponseSentiment);
  const draftFn = useServerFn(draftSurveySummary);
  const saveFn = useServerFn(saveSurveySummary);
  const includeFn = useServerFn(setSurveyIncluded);
  const deleteFn = useServerFn(deleteSurvey);
  const checkDuplicateFn = useServerFn(checkDuplicate);
  const createImportFn = useServerFn(createImport);
  const finalizeFn = useServerFn(finalizeImport);
  const createSurveyFn = useServerFn(createSurvey);
  const insertResponsesFn = useServerFn(insertSurveyResponses);

  const [selected, setSelected] = useState<string | null>(null);
  const [draftText, setDraftText] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [progress, setProgressState] = useState<{ label: string; value: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);


  useQuery({ queryKey: ["clients"], queryFn: () => clientsFn() });

  const surveys = useQuery({
    queryKey: ["surveys", clientId],
    queryFn: () => listFn({ data: { clientId } }),
    enabled: Boolean(clientId),
  });

  const activeId = selected ?? surveys.data?.[0]?.id ?? null;

  const detail = useQuery({
    queryKey: ["survey", activeId],
    queryFn: () => getFn({ data: { surveyId: activeId! } }),
    enabled: Boolean(activeId),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["surveys", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["survey", activeId] });
  };

  const score = useMutation({
    mutationFn: () => scoreFn({ data: { surveyId: activeId! } }),
    onSuccess: (result) => {
      toast.success(`Read ${result.scored} written answers.`);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const draft = useMutation({
    mutationFn: () => draftFn({ data: { surveyId: activeId! } }),
    onSuccess: () => {
      setDraftText(null);
      toast.success("Draft written. Read it, edit anything, then approve it.");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const save = useMutation({
    mutationFn: (input: { text: string; accept: boolean }) =>
      saveFn({ data: { surveyId: activeId!, editedMd: input.text, accept: input.accept } }),
    onSuccess: (_result, input) => {
      toast.success(input.accept ? "Approved — it will print on the report." : "Saved.");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (surveyId: string) => deleteFn({ data: { surveyId } }),
    onSuccess: () => {
      setSelected(null);
      toast.success("Survey removed.");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const include = useMutation({
    mutationFn: (input: { surveyId: string; include: boolean }) =>
      includeFn({ data: input }),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });

  const override = useMutation({
    mutationFn: (input: { responseId: string; sentiment: Sentiment }) =>
      overrideFn({ data: input }),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });

  const data = detail.data ?? null;
  const summaryText =
    draftText ?? data?.summary?.edited_md ?? data?.summary?.draft_md ?? "";

  const byQuestion = useMemo(() => {
    if (!data) return [];
    return data.questions.map((question) => {
      const answers = data.responses.filter((row) => row.question_id === question.id);
      const tally = new Map<string, number>();
      for (const row of answers) {
        const value = (row.answer_text ?? "").trim();
        if (value) tally.set(value, (tally.get(value) ?? 0) + 1);
      }
      const counts = { positive: 0, neutral: 0, negative: 0 };
      for (const row of answers) {
        if (row.sentiment) counts[row.sentiment] += 1;
      }
      return {
        question,
        answers,
        counts,
        tally: [...tally.entries()]
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => b.count - a.count),
      };
    });
  }, [data]);

  if (!clientId) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="text-xl font-semibold">Surveys</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick a client in the top bar to see its surveys.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <MessageSquare className="h-5 w-5" /> Surveys
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload survey files on the Imports screen. Here you can see how people answered, check
          how each written answer was read, and approve the wording that prints on the report.
        </p>
      </header>

      {surveys.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (surveys.data ?? []).length === 0 ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">
          No surveys uploaded for this client yet.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Select value={activeId ?? ""} onValueChange={(value) => { setSelected(value); setDraftText(null); }}>
            <SelectTrigger className="w-[420px]">
              <SelectValue placeholder="Pick a survey" />
            </SelectTrigger>
            <SelectContent>
              {(surveys.data ?? []).map((survey) => (
                <SelectItem key={survey.id} value={survey.id}>
                  {survey.title} · {survey.period.slice(0, 7)} · {survey.respondent_count} people
                  {survey.summary_accepted ? " · approved" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {data ? (
            <>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={data.survey.include_in_report}
                  onCheckedChange={(checked) =>
                    include.mutate({ surveyId: data.survey.id, include: checked === true })
                  }
                />
                Print on the report
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (confirm("Remove this survey and all of its answers?")) {
                    remove.mutate(data.survey.id);
                  }
                }}
              >
                <Trash2 className="mr-1.5 h-4 w-4" /> Remove
              </Button>
            </>
          ) : null}
        </div>
      )}

      {data ? (
        <>
          <section className="space-y-2 rounded-md border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-base font-semibold">{data.survey.title}</h2>
              <span className="text-sm text-muted-foreground">
                {data.survey.anonymous
                  ? "Anonymous"
                  : `${data.survey.respondent_count} people answered`}{" "}
                · {data.survey.question_count} questions
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => score.mutate()}
                disabled={score.isPending}
              >
                {score.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-4 w-4" />
                )}
                Read written answers
              </Button>
            </div>
            {data.unmatchedParticipants.length > 0 ? (
              <p className="text-sm text-amber-700">
                {data.unmatchedParticipants.length} people who answered are not on this month's
                roster: {data.unmatchedParticipants.slice(0, 6).join(", ")}
                {data.unmatchedParticipants.length > 6 ? "…" : ""}
              </p>
            ) : null}
          </section>

          <section className="space-y-4">
            {byQuestion.map(({ question, answers, counts, tally }) => (
              <div key={question.id} className="space-y-2 rounded-md border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold">{question.question_text}</h3>
                  <span className="text-xs text-muted-foreground">
                    {QUESTION_KIND_LABELS[question.kind as QuestionKind] ?? question.kind} ·{" "}
                    {answers.length} answers · {counts.positive} positive, {counts.neutral}{" "}
                    neutral, {counts.negative} negative
                  </span>
                </div>

                {question.kind === "text" ? (
                  <ul className="space-y-1.5">
                    {answers
                      .filter((row) => (row.answer_text ?? "").trim().length > 1)
                      .map((row) => (
                        <li
                          key={row.id}
                          className="flex flex-wrap items-center gap-2 border-b py-1 text-sm last:border-0"
                        >
                          <span className="flex-1">{row.answer_text}</span>
                          {row.participant_raw ? (
                            <span className="text-xs text-muted-foreground">
                              {row.participant_raw}
                            </span>
                          ) : null}
                          <SentimentPill value={row.sentiment} />
                          <span className="flex gap-1">
                            {(["positive", "neutral", "negative"] as Sentiment[]).map((value) => (
                              <button
                                key={value}
                                type="button"
                                className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-accent"
                                onClick={() =>
                                  override.mutate({ responseId: row.id, sentiment: value })
                                }
                              >
                                {value[0]!.toUpperCase()}
                              </button>
                            ))}
                          </span>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {tally.map((entry) => (
                        <tr key={entry.label} className="border-b last:border-0">
                          <td className="py-1">{entry.label}</td>
                          <td className="w-16 py-1 text-right tabular-nums">{entry.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </section>

          <section className="space-y-3 rounded-md border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Report summary</h2>
              <div className="flex items-center gap-2">
                {data.summary?.accepted_at ? (
                  <span className="flex items-center gap-1 text-sm text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> Approved
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">Not approved yet</span>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => draft.mutate()}
                  disabled={draft.isPending}
                >
                  {draft.isPending ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1.5 h-4 w-4" />
                  )}
                  {data.summary ? "Write a new draft" : "Draft summary"}
                </Button>
              </div>
            </div>

            {data.summary ? (
              <>
                <Textarea
                  rows={10}
                  value={summaryText}
                  onChange={(event) => setDraftText(event.target.value)}
                />
                {Array.isArray(data.summary.themes) && data.summary.themes.length > 0 ? (
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {(data.summary.themes as { label: string; sentiment: string; detail: string }[]).map(
                      (theme) => (
                        <li key={theme.label}>
                          <strong className="text-foreground">{theme.label}</strong> ({theme.sentiment}) —{" "}
                          {theme.detail}
                        </li>
                      ),
                    )}
                  </ul>
                ) : null}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => save.mutate({ text: summaryText, accept: false })}
                    disabled={save.isPending}
                  >
                    Save edits
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => save.mutate({ text: summaryText, accept: true })}
                    disabled={save.isPending || !summaryText.trim()}
                  >
                    Approve for the report
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Nothing from a survey prints until you approve it here.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No summary yet. Read the written answers first, then draft a summary.
              </p>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
