import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Loader2, Send, Sparkles, Table2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { listMyClients } from "@/lib/imports.functions";
import { listMetricPeriods } from "@/lib/metrics.functions";
import {
  addActionPlanItem,
  askQuestion,
  deleteInsight,
  listInsights,
  saveInsight,
  setInsightInReport,
  type AskAnswer,
  type AskStep,
} from "@/lib/ask.functions";

export const Route = createFileRoute("/_authenticated/ask")({
  head: () => ({
    meta: [
      { title: "Ask the data | Client Reporting Console" },
      {
        name: "description",
        content:
          "Ask questions across dealership clients and periods, see the underlying rows, and pin the answer to a client report or action plan.",
      },
      { property: "og:title", content: "Ask the data | Client Reporting Console" },
      {
        property: "og:description",
        content:
          "Cross-client questions answered from published metrics and assembled people data, scoped to the clients you are assigned.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AskScreen,
});

type Turn = { question: string; answer: AskAnswer };

const EXAMPLES = [
  "Compare turnover across every client for the latest period",
  "Which client has the lowest mood this month, and how did it move?",
  "Show headcount by role for each dealership side by side",
  "Where is check-in participation weakest across clients?",
];

function StepTable({ step }: { step: AskStep }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <Table2 className="h-3.5 w-3.5" />
        <span className="font-mono">{step.tool}</span>
        <span className="truncate">{step.summary}</span>
        <span className="ml-auto">{open ? "hide" : "show"}</span>
      </button>
      {open ? (
        <div className="max-h-72 overflow-auto border-t">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                {step.columns.map((column) => (
                  <th key={column} className="px-2 py-1 text-left font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {step.rows.slice(0, 100).map((row, index) => (
                <tr key={index} className="border-t">
                  {step.columns.map((column) => (
                    <td key={column} className="px-2 py-1">
                      {row[column] === null || row[column] === undefined ? "—" : String(row[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function UsePanel({
  turn,
  clients,
}: {
  turn: Turn;
  clients: { id: string; name: string }[];
}) {
  const queryClient = useQueryClient();
  const periodsFn = useServerFn(listMetricPeriods);
  const saveFn = useServerFn(saveInsight);
  const actionFn = useServerFn(addActionPlanItem);

  const [mode, setMode] = useState<"none" | "insight" | "action">("none");
  const [clientId, setClientId] = useState<string>(clients[0]?.id ?? "");
  const [period, setPeriod] = useState<string>("");
  const [title, setTitle] = useState<string>(turn.question.slice(0, 90));
  const [includeInReport, setIncludeInReport] = useState(true);
  const [attachStep, setAttachStep] = useState<string>(
    turn.answer.steps.length > 0 ? String(turn.answer.steps.length - 1) : "none",
  );
  const [headline, setHeadline] = useState<string>(turn.question.slice(0, 90));
  const [problem, setProblem] = useState<string>(turn.answer.answer);
  const [solution, setSolution] = useState<string>("");

  const periods = useQuery({
    queryKey: ["metric-periods", clientId],
    queryFn: () => periodsFn({ data: { clientId } }),
    enabled: Boolean(clientId) && mode !== "none",
  });

  const periodList = periods.data ?? [];
  const effectivePeriod = period || periodList[0] || "";

  const save = useMutation({
    mutationFn: async () => {
      const step = attachStep === "none" ? null : turn.answer.steps[Number(attachStep)];
      return saveFn({
        data: {
          title,
          question: turn.question,
          answerMd: turn.answer.answer,
          clientId: clientId || null,
          period: effectivePeriod || null,
          includeInReport,
          table: step ? { columns: step.columns, rows: step.rows.slice(0, 40) } : null,
          sources: [...new Set(turn.answer.steps.map((entry) => entry.tool))],
        },
      });
    },
    onSuccess: () => {
      toast.success(includeInReport ? "Saved and added to the report" : "Insight saved");
      setMode("none");
      queryClient.invalidateQueries({ queryKey: ["insights"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const push = useMutation({
    mutationFn: async () =>
      actionFn({
        data: { clientId, period: effectivePeriod, headline, problem, solution },
      }),
    onSuccess: (result) => {
      toast.success(`Added as action plan item ${result.position}`);
      setMode("none");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (mode === "none") {
    return (
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="text-xs text-muted-foreground">Use this answer:</span>
        <Button size="sm" variant="outline" onClick={() => setMode("insight")}>
          Save as insight
        </Button>
        <Button size="sm" variant="outline" onClick={() => setMode("action")}>
          Add to action plan
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border bg-card p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Client</Label>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a client" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  {client.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Period</Label>
          <Select value={effectivePeriod} onValueChange={setPeriod}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a period" />
            </SelectTrigger>
            <SelectContent>
              {periodList.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {mode === "insight" ? (
        <>
          <div className="space-y-1">
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          {turn.answer.steps.length > 0 ? (
            <div className="space-y-1">
              <Label className="text-xs">Attach a result table</Label>
              <Select value={attachStep} onValueChange={setAttachStep}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No table</SelectItem>
                  {turn.answer.steps.map((step, index) => (
                    <SelectItem key={index} value={String(index)}>
                      {step.tool} — {step.summary}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={includeInReport}
              onCheckedChange={(value) => setIncludeInReport(value === true)}
            />
            Include as a page in this client&apos;s report for the period
          </label>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Save insight
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("none")}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1">
            <Label className="text-xs">Headline</Label>
            <Input value={headline} onChange={(event) => setHeadline(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Problem</Label>
            <Textarea rows={4} value={problem} onChange={(event) => setProblem(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Solution</Label>
            <Textarea
              rows={3}
              value={solution}
              onChange={(event) => setSolution(event.target.value)}
              placeholder="What the client should do about it"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => push.mutate()} disabled={push.isPending}>
              {push.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Add to action plan
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("none")}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function SavedInsights({ clients }: { clients: { id: string; name: string }[] }) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listInsights);
  const toggleFn = useServerFn(setInsightInReport);
  const removeFn = useServerFn(deleteInsight);

  const insights = useQuery({ queryKey: ["insights"], queryFn: () => listFn({ data: {} }) });
  const nameOf = useMemo(
    () => new Map(clients.map((client) => [client.id, client.name])),
    [clients],
  );

  const toggle = useMutation({
    mutationFn: (input: { id: string; include: boolean }) => toggleFn({ data: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["insights"] }),
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["insights"] }),
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = insights.data ?? [];

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold">Saved insights</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing saved yet. Ask a question, then choose “Save as insight”.
        </p>
      ) : null}
      {rows.map((insight) => (
        <div key={insight.id} className="rounded-md border p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{insight.title}</p>
              <p className="text-xs text-muted-foreground">
                {insight.client_id ? (nameOf.get(insight.client_id) ?? "Client") : "Cross-client"}
                {insight.period ? ` · ${insight.period}` : ""}
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => remove.mutate(insight.id)}
              title="Delete insight"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">
            {insight.answer_md}
          </p>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <Checkbox
              checked={insight.include_in_report}
              disabled={!insight.client_id || !insight.period}
              onCheckedChange={(value) =>
                toggle.mutate({ id: insight.id, include: value === true })
              }
            />
            In report
          </label>
        </div>
      ))}
    </div>
  );
}

function AskScreen() {
  const clientsFn = useServerFn(listMyClients);
  const askFn = useServerFn(askQuestion);

  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);

  const clients = useQuery({ queryKey: ["my-clients"], queryFn: () => clientsFn() });

  const ask = useMutation({
    mutationFn: async (text: string) =>
      askFn({
        data: {
          question: text,
          history: turns.flatMap((turn) => [
            { role: "user" as const, content: turn.question },
            { role: "assistant" as const, content: turn.answer.answer },
          ]),
        },
      }),
    onSuccess: (answer, text) => setTurns((prev) => [...prev, { question: text, answer }]),
    onError: (error: Error) => toast.error(error.message),
  });

  const submit = () => {
    const text = question.trim();
    if (!text || ask.isPending) return;
    setQuestion("");
    ask.mutate(text);
  };

  return (
    <main className="mx-auto grid max-w-7xl gap-6 p-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <header className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Sparkles className="h-5 w-5" />
            Ask the data
          </h1>
          <p className="text-sm text-muted-foreground">
            Questions are answered from published metrics, assembled people rows and raw imports —
            only for the clients you are assigned to. Every answer shows the rows it read.
          </p>
        </header>

        {turns.length === 0 ? (
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setQuestion(example)}
                className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {example}
              </button>
            ))}
          </div>
        ) : null}

        <div className="space-y-6">
          {turns.map((turn, index) => (
            <div key={index} className="space-y-3">
              <p className="rounded-md bg-muted px-3 py-2 text-sm font-medium">{turn.question}</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{turn.answer.answer}</p>
              {turn.answer.steps.length > 0 ? (
                <div className="space-y-1">
                  {turn.answer.steps.map((step, stepIndex) => (
                    <StepTable key={stepIndex} step={step} />
                  ))}
                </div>
              ) : null}
              <UsePanel turn={turn} clients={clients.data ?? []} />
            </div>
          ))}
          {ask.isPending ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Querying the warehouse…
            </p>
          ) : null}
        </div>

        <div className="sticky bottom-4 flex gap-2 rounded-md border bg-background p-2 shadow-sm">
          <Textarea
            rows={2}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Ask about a client, compare dealerships, or check a number…"
            className="resize-none border-0 shadow-none focus-visible:ring-0"
          />
          <Button onClick={submit} disabled={ask.isPending || question.trim().length === 0}>
            {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <aside className="lg:border-l lg:pl-6">
        <SavedInsights clients={clients.data ?? []} />
      </aside>
    </main>
  );
}
