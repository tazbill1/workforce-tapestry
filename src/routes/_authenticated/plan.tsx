import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ClipboardList, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
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

import { useActiveClient } from "@/lib/active-client";
import { listMyClients } from "@/lib/imports.functions";
import { listMetricPeriods } from "@/lib/metrics.functions";
import {
  deleteNote,
  deletePlanItem,
  draftPlan,
  listPlan,
  movePlanItem,
  saveNote,
  savePlanItem,
  type DraftedItem,
  type PlanItem,
  type PlanNote,
} from "@/lib/plan.functions";

export const Route = createFileRoute("/_authenticated/plan")({
  head: () => ({
    meta: [
      { title: "Action plan and notes | Client Reporting Console" },
      {
        name: "description",
        content:
          "Write the action plan pages and extra comments that print on a client's monthly culture report.",
      },
      { property: "og:title", content: "Action plan and notes | Client Reporting Console" },
      {
        property: "og:description",
        content:
          "Draft, edit and order the action plan items and written comments for each client and month.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PlanScreen,
});

function ItemCard({
  item,
  clientId,
  period,
  onChanged,
}: {
  item: PlanItem;
  clientId: string;
  period: string;
  onChanged: () => void;
}) {
  const saveFn = useServerFn(savePlanItem);
  const deleteFn = useServerFn(deletePlanItem);
  const moveFn = useServerFn(movePlanItem);

  const [headline, setHeadline] = useState(item.headline);
  const [problem, setProblem] = useState(item.problem ?? "");
  const [solution, setSolution] = useState(item.solution ?? "");

  useEffect(() => {
    setHeadline(item.headline);
    setProblem(item.problem ?? "");
    setSolution(item.solution ?? "");
  }, [item.id, item.headline, item.problem, item.solution]);

  const save = useMutation({
    mutationFn: () =>
      saveFn({ data: { id: item.id, clientId, period, headline, problem, solution } }),
    onSuccess: () => {
      toast.success("Saved");
      onChanged();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { id: item.id } }),
    onSuccess: onChanged,
    onError: (error: Error) => toast.error(error.message),
  });
  const move = useMutation({
    mutationFn: (direction: "up" | "down") => moveFn({ data: { id: item.id, direction } }),
    onSuccess: onChanged,
    onError: (error: Error) => toast.error(error.message),
  });

  const dirty =
    headline !== item.headline ||
    problem !== (item.problem ?? "") ||
    solution !== (item.solution ?? "");

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Item {item.position}</span>
        <div className="ml-auto flex gap-1">
          <Button size="icon" variant="ghost" title="Move up" onClick={() => move.mutate("up")}>
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" title="Move down" onClick={() => move.mutate("down")}>
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" title="Delete" onClick={() => remove.mutate()}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
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
        <Textarea rows={4} value={solution} onChange={(event) => setSolution(event.target.value)} />
      </div>
      <Button
        size="sm"
        onClick={() => save.mutate()}
        disabled={save.isPending || !dirty || headline.trim().length < 2}
      >
        {save.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
        {dirty ? "Save changes" : "Saved"}
      </Button>
    </div>
  );
}

function NoteCard({
  note,
  clientId,
  period,
  onChanged,
}: {
  note: PlanNote;
  clientId: string;
  period: string;
  onChanged: () => void;
}) {
  const saveFn = useServerFn(saveNote);
  const deleteFn = useServerFn(deleteNote);

  const [heading, setHeading] = useState(note.heading ?? "");
  const [body, setBody] = useState(note.body);
  const [include, setInclude] = useState(note.include_in_report);

  useEffect(() => {
    setHeading(note.heading ?? "");
    setBody(note.body);
    setInclude(note.include_in_report);
  }, [note.id, note.heading, note.body, note.include_in_report]);

  const save = useMutation({
    mutationFn: () =>
      saveFn({ data: { id: note.id, clientId, period, heading, body, includeInReport: include } }),
    onSuccess: () => {
      toast.success("Saved");
      onChanged();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { id: note.id } }),
    onSuccess: onChanged,
    onError: (error: Error) => toast.error(error.message),
  });

  const dirty =
    heading !== (note.heading ?? "") || body !== note.body || include !== note.include_in_report;

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex items-center gap-2">
        <Input
          value={heading}
          placeholder="Heading (optional)"
          onChange={(event) => setHeading(event.target.value)}
        />
        <Button size="icon" variant="ghost" title="Delete" onClick={() => remove.mutate()}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <Textarea
        rows={5}
        value={body}
        placeholder="Anything else worth saying about this month…"
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={include} onCheckedChange={(value) => setInclude(value === true)} />
          Print this on the report
        </label>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => save.mutate()}
          disabled={save.isPending || !dirty || body.trim().length === 0}
        >
          {save.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          {dirty ? "Save changes" : "Saved"}
        </Button>
      </div>
    </div>
  );
}

function PlanScreen() {
  const queryClient = useQueryClient();
  const { clientId, setClientId } = useActiveClient();

  const clientsFn = useServerFn(listMyClients);
  const periodsFn = useServerFn(listMetricPeriods);
  const listFn = useServerFn(listPlan);
  const saveItemFn = useServerFn(savePlanItem);
  const saveNoteFn = useServerFn(saveNote);
  const draftFn = useServerFn(draftPlan);

  const [period, setPeriod] = useState("");
  const [steer, setSteer] = useState("");
  const [drafts, setDrafts] = useState<DraftedItem[]>([]);

  const clients = useQuery({ queryKey: ["my-clients"], queryFn: () => clientsFn() });
  const periods = useQuery({
    queryKey: ["metric-periods", clientId],
    queryFn: () => periodsFn({ data: { clientId } }),
    enabled: Boolean(clientId),
  });

  const periodList = periods.data ?? [];
  const activePeriod = period || periodList[0] || "";

  const plan = useQuery({
    queryKey: ["plan", clientId, activePeriod],
    queryFn: () => listFn({ data: { clientId, period: activePeriod } }),
    enabled: Boolean(clientId && activePeriod),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["plan", clientId, activePeriod] });

  const addItem = useMutation({
    mutationFn: () =>
      saveItemFn({
        data: {
          clientId,
          period: activePeriod,
          headline: "New action plan item",
          problem: "",
          solution: "",
        },
      }),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });

  const addNote = useMutation({
    mutationFn: () =>
      saveNoteFn({
        data: { clientId, period: activePeriod, heading: "", body: " ", includeInReport: true },
      }),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });

  const draft = useMutation({
    mutationFn: () => draftFn({ data: { clientId, period: activePeriod, steer } }),
    onSuccess: (result) => {
      setDrafts(result);
      if (result.length === 0) toast.error("The AI came back empty — try again.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const acceptDraft = useMutation({
    mutationFn: (entry: DraftedItem) =>
      saveItemFn({
        data: {
          clientId,
          period: activePeriod,
          headline: entry.headline,
          problem: entry.problem,
          solution: entry.solution,
        },
      }),
    onSuccess: (_result, entry) => {
      setDrafts((prev) => prev.filter((item) => item !== entry));
      refresh();
      toast.success("Added to the action plan");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const items = plan.data?.items ?? [];
  const notes = plan.data?.notes ?? [];

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <ClipboardList className="h-5 w-5" />
          Action plan and notes
        </h1>
        <p className="text-sm text-muted-foreground">
          Write the action plan pages for a client&apos;s month, plus any extra comments. Anything
          saved here shows up on that month&apos;s report.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Client</Label>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a client" />
            </SelectTrigger>
            <SelectContent>
              {(clients.data ?? []).map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  {client.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Month</Label>
          <Select value={activePeriod} onValueChange={setPeriod}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a month" />
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

      {!clientId || !activePeriod ? (
        <p className="text-sm text-muted-foreground">Pick a client and a month to start writing.</p>
      ) : (
        <>
          <section className="space-y-3 rounded-md border bg-muted/30 p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4" />
              Let the app draft it
            </h2>
            <p className="text-xs text-muted-foreground">
              Reads this month&apos;s published numbers and proposes three items. Nothing is saved
              until you add it.
            </p>
            <Textarea
              rows={2}
              value={steer}
              placeholder="Optional: anything you want it to focus on (service turnover, check-ins, a specific store…)"
              onChange={(event) => setSteer(event.target.value)}
            />
            <Button size="sm" onClick={() => draft.mutate()} disabled={draft.isPending}>
              {draft.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-3.5 w-3.5" />
              )}
              Draft items
            </Button>
            {drafts.map((entry, index) => (
              <div key={index} className="space-y-2 rounded-md border bg-background p-3">
                <p className="text-sm font-medium">{entry.headline}</p>
                <p className="whitespace-pre-wrap text-xs text-muted-foreground">{entry.problem}</p>
                <p className="whitespace-pre-wrap text-xs text-muted-foreground">{entry.solution}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => acceptDraft.mutate(entry)}
                    disabled={acceptDraft.isPending}
                  >
                    Add to plan
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDrafts((prev) => prev.filter((item) => item !== entry))}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            ))}
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Action plan</h2>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => addItem.mutate()}
                disabled={addItem.isPending}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add item
              </Button>
            </div>
            {plan.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No items yet — add one, or let the app draft them.
              </p>
            ) : (
              items.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  clientId={clientId}
                  period={activePeriod}
                  onChanged={refresh}
                />
              ))
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Additional comments</h2>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => addNote.mutate()}
                disabled={addNote.isPending}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add comment
              </Button>
            </div>
            {notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing written yet. Comments you tick print after the action plan.
              </p>
            ) : (
              notes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  clientId={clientId}
                  period={activePeriod}
                  onChanged={refresh}
                />
              ))
            )}
          </section>
        </>
      )}
    </main>
  );
}
