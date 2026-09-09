import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActiveClient } from "@/lib/active-client";
import { toast } from "sonner";
import {
  UploadCloud,
  FileSpreadsheet,
  LogOut,
  Loader2,
  Sparkles,
  AlertTriangle,
  Check,
  X,
  ArrowRight,
  CircleDashed,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { DiffPanel, type DiffResult } from "@/components/import/DiffPanel";
import { FlagSummaryPanel, type FlagSummary } from "@/components/import/FlagSummaryPanel";
import { buildHeaderMap, extractRow, sha256Hex, type SourceRow } from "@/lib/roster-parse";
import { parseEngagementSheet } from "@/lib/engagement-parse";
import { insertRecognitionActivity } from "@/lib/engagement.functions";
import { sniffGrid, KIND_LABELS, type Sniff } from "@/lib/detect-import";
import { analyzeUpload, type UploadAdvice } from "@/lib/detect.functions";
import { previewStatedFigures, saveStatedFigures } from "@/lib/stated.functions";
import {
  checkDuplicate,
  createImport,
  finalizeImport,
  getDiff,
  getFlagSummary,
  insertRawRecords,
  listImports,
  listMyClients,
} from "@/lib/imports.functions";

const KINDS = [
  { value: "roster", label: "Roster" },
  { value: "mood_matrix", label: "Mood matrix" },
  { value: "login_report", label: "Login report" },
  { value: "engagement_totals", label: "Engagement totals" },
  { value: "recognition_counts", label: "Recognition counts" },
  { value: "recognition_activity", label: "Recognition activity" },
] as const;

/** Files are imported in this order so the roster exists before anything joins to it. */
const KIND_ORDER = [
  "roster",
  "mood_matrix",
  "login_report",
  "recognition_activity",
  "recognition_counts",
  "engagement_totals",
];

/** What a complete month looks like, shown as a checklist so nothing is forgotten. */
const CHECKLIST: { kind: string; label: string; hint: string; required: boolean }[] = [
  { kind: "roster", label: "Roster", hint: "People, status and hire dates", required: true },
  { kind: "mood_matrix", label: "Mood matrix", hint: "Check-in scores", required: true },
  { kind: "login_report", label: "Login report", hint: "Who logged in and when", required: true },
  {
    kind: "recognition_activity",
    label: "Recognition activity",
    hint: "Posts, comments and likes",
    required: true,
  },
  {
    kind: "engagement_totals",
    label: "Engagement totals",
    hint: "Optional headline totals",
    required: false,
  },
];

const BATCH_SIZE = 200;

export const Route = createFileRoute("/_authenticated/imports")({
  head: () => ({
    meta: [
      { title: "Import roster data | Client Reporting Console" },
      {
        name: "description",
        content:
          "Upload client roster and engagement files, parse them into raw records, and review what changed since the previous reporting period.",
      },
      { property: "og:title", content: "Import roster data | Client Reporting Console" },
      {
        property: "og:description",
        content:
          "Upload, parse and diff client reporting files period over period, with flagged rows surfaced instead of hidden.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ImportScreen,
});

type SheetOption = { name: string; rows: number; detail: boolean };

type QueueItem = {
  id: string;
  file: File;
  status: "reading" | "ready" | "importing" | "done" | "error" | "skipped";
  kind: string;
  period: string;
  sheetName: string;
  sheetOptions: SheetOption[];
  sheetSniffs: Record<string, Sniff>;
  sniff: Sniff | null;
  advice: UploadAdvice | null;
  applied: string[];
  message: string | null;
  progress: { label: string; value: number } | null;
  rows: number | null;
};

function kindLabel(kind: string) {
  return KINDS.find((option) => option.value === kind)?.label ?? kind;
}

function ImportScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const clientsFn = useServerFn(listMyClients);
  const listImportsFn = useServerFn(listImports);
  const checkDuplicateFn = useServerFn(checkDuplicate);
  const createImportFn = useServerFn(createImport);
  const insertRecordsFn = useServerFn(insertRawRecords);
  const finalizeFn = useServerFn(finalizeImport);
  const flagSummaryFn = useServerFn(getFlagSummary);
  const diffFn = useServerFn(getDiff);
  const analyzeFn = useServerFn(analyzeUpload);
  const insertRecognitionFn = useServerFn(insertRecognitionActivity);
  const previewStatedFn = useServerFn(previewStatedFigures);
  const saveStatedFn = useServerFn(saveStatedFigures);

  const { clientId, setClientId } = useActiveClient();
  const [period, setPeriod] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [justImported, setJustImported] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [flagSummary, setFlagSummary] = useState<(FlagSummary & { totalRows: number }) | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [statedFor, setStatedFor] = useState<string | null>(null);
  const [statedPreview, setStatedPreview] = useState<
    | {
        period: string;
        filename: string;
        figures: { metric_key: string; label: string; value: number; unit: string | null; raw_label: string }[];
      }
    | null
  >(null);

  const clients = useQuery({ queryKey: ["clients"], queryFn: () => clientsFn() });

  const imports = useQuery({
    queryKey: ["imports", clientId],
    queryFn: () => listImportsFn({ data: { clientId } }),
    enabled: Boolean(clientId),
  });

  const activeClient = (clients.data ?? []).find((entry) => entry.id === clientId) ?? null;

  const patch = useCallback((id: string, changes: Partial<QueueItem>) => {
    setQueue((current) =>
      current.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
  }, []);

  /** Reads one dropped file, works out what is in it, and fills in kind and month for you. */
  const inspect = useCallback(
    async (item: QueueItem) => {
      try {
        const XLSX = await import("xlsx");
        const buffer = await item.file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
        if (workbook.SheetNames.length === 0) throw new Error("The workbook has no sheets.");

        // Workbooks often hide the real per-person list on a later tab behind a
        // Summary tab. Look at every sheet and pick the one with actual records.
        const scanned = workbook.SheetNames.map((name) => {
          const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name]!, {
            header: 1,
            defval: null,
            raw: false,
          }) as unknown[][];
          const sniffed = sniffGrid(item.file.name, grid);
          const detail =
            sniffed.rowCount >= 5 &&
            sniffed.signals.some((signal) => signal.id === "people" || signal.id === "recognition");
          return { name, sniffed, detail };
        });
        const best =
          [...scanned].sort(
            (a, b) => Number(b.detail) - Number(a.detail) || b.sniffed.rowCount - a.sniffed.rowCount,
          )[0] ?? scanned[0]!;

        const result = best.sniffed;
        const detected = (await analyzeFn({
          data: {
            filename: item.file.name,
            columns: result.columns.slice(0, 80),
            sampleRows: result.sampleRows,
            preamble: result.preamble,
            emails: result.emails,
            rowCount: result.rowCount,
            periodHint: result.periodHint,
            heuristicKind: result.guess?.kind ?? null,
            signals: result.signals.map((signal) => ({ id: signal.id, label: signal.label })),
            selectedClientId: clientId || null,
            selectedPeriod: period,
          },
        })) as UploadAdvice;

        const applied: string[] = [];
        const nextKind = detected.suggestedKind ?? result.guess?.kind ?? item.kind;
        if (nextKind !== item.kind) applied.push(`kind set to ${kindLabel(nextKind)}`);
        const nextPeriod = detected.suggestedPeriod ?? item.period;
        if (nextPeriod !== item.period) applied.push(`month set to ${nextPeriod}`);

        patch(item.id, {
          status: "ready",
          kind: nextKind,
          period: nextPeriod,
          sheetName: best.name,
          sheetOptions: scanned.map((entry) => ({
            name: entry.name,
            rows: entry.sniffed.rowCount,
            detail: entry.detail,
          })),
          sheetSniffs: Object.fromEntries(scanned.map((entry) => [entry.name, entry.sniffed])),
          sniff: result,
          advice: detected,
          applied,
        });
      } catch (error) {
        patch(item.id, {
          status: "ready",
          message:
            error instanceof Error
              ? `Could not read the file for suggestions: ${error.message}`
              : "Could not read the file for suggestions.",
        });
      }
    },
    [analyzeFn, clientId, patch, period],
  );

  const acceptFiles = useCallback(
    (files: File[]) => {
      const usable = files.filter((file) => /\.(xlsx|xls|csv)$/i.test(file.name));
      if (usable.length !== files.length) {
        toast.error("Only .xlsx, .xls or .csv files can be imported.");
      }
      if (usable.length === 0) return;

      setFlagSummary(null);
      setDiff(null);

      const items: QueueItem[] = usable.map((file) => ({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        status: "reading",
        kind: "roster",
        period,
        sheetName: "",
        sheetOptions: [],
        sheetSniffs: {},
        sniff: null,
        advice: null,
        applied: [],
        message: null,
        progress: null,
        rows: null,
      }));
      setQueue((current) => [...current, ...items]);
      void (async () => {
        for (const item of items) await inspect(item);
      })();
    },
    [inspect, period],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDragging(false);
      const dt = event.dataTransfer;
      const dropped = dt.files?.length
        ? Array.from(dt.files)
        : Array.from(dt.items ?? [])
            .filter((entry) => entry.kind === "file")
            .map((entry) => entry.getAsFile())
            .filter((entry): entry is File => Boolean(entry));
      acceptFiles(dropped);
    },
    [acceptFiles],
  );

  const preventNav = useCallback((event: DragEvent) => {
    event.preventDefault();
  }, []);

  useEffect(() => {
    window.addEventListener("dragover", preventNav);
    window.addEventListener("drop", preventNav);
    return () => {
      window.removeEventListener("dragover", preventNav);
      window.removeEventListener("drop", preventNav);
    };
  }, [preventNav]);

  /** Imports one queued file end to end. Returns the flag summary and diff for rosters. */
  const importOne = useCallback(
    async (item: QueueItem) => {
      const periodDate = `${item.period}-01`;
      const setProgress = (label: string, value: number) =>
        patch(item.id, { progress: { label, value } });

      setProgress("Fingerprinting file", 5);
      const buffer = await item.file.arrayBuffer();
      const sha256 = await sha256Hex(buffer);

      const { duplicate } = await checkDuplicateFn({
        data: { clientId, period: periodDate, kind: item.kind, sha256 },
      });
      if (duplicate) {
        throw new Error(
          `Already imported on ${new Date(duplicate.uploaded_at).toLocaleString()} — nothing was imported again.`,
        );
      }

      setProgress("Uploading original to storage", 20);
      const storagePath = `${clientId}/${periodDate}/${sha256.slice(0, 12)}-${item.file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("raw-imports")
        .upload(storagePath, item.file, { upsert: false });
      if (uploadError && !uploadError.message.toLowerCase().includes("already exists")) {
        throw new Error(`Upload failed: ${uploadError.message}`);
      }

      setProgress("Recording import", 32);
      const created = await createImportFn({
        data: {
          clientId,
          period: periodDate,
          kind: item.kind,
          sha256,
          filename: item.file.name,
          storagePath,
        },
      });
      if (created.duplicate || !created.id) {
        throw new Error("An identical file already exists for this client, month and kind.");
      }
      const importId = created.id;

      try {
        setProgress("Reading spreadsheet", 42);
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
        const chosen =
          (item.sheetName && workbook.SheetNames.includes(item.sheetName) ? item.sheetName : null) ??
          workbook.SheetNames[0];
        if (!chosen) throw new Error("The workbook has no sheets.");
        const sheet = workbook.Sheets[chosen]!;

        if (item.kind === "recognition_activity") {
          const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            defval: null,
            raw: true,
          });
          const parsed = parseEngagementSheet(grid as unknown[][]);
          for (let i = 0; i < parsed.rows.length; i += BATCH_SIZE) {
            const batch = parsed.rows.slice(i, i + BATCH_SIZE);
            setProgress(
              `Writing rows ${i + 1}–${Math.min(i + BATCH_SIZE, parsed.rows.length)} of ${parsed.rows.length}`,
              45 + Math.round((i / Math.max(parsed.rows.length, 1)) * 40),
            );
            await insertRecognitionFn({
              data: {
                importId,
                clientId,
                period: periodDate,
                windowFrom: parsed.windowFrom,
                windowTo: parsed.windowTo,
                rows: batch,
              },
            });
          }
          setProgress("Finalising import", 90);
          await finalizeFn({
            data: {
              importId,
              rowCount: parsed.rows.length,
              columnNames: parsed.columnNames,
              state: "parsed",
            },
          });
          return { summary: null, diff: null, totalRows: parsed.rows.length };
        }

        const rows = XLSX.utils.sheet_to_json<SourceRow>(sheet, { defval: null, raw: true });
        const columnNames = Array.from(
          rows.reduce<Set<string>>((set, row) => {
            Object.keys(row).forEach((key) => set.add(key));
            return set;
          }, new Set<string>()),
        );
        const headerMap = buildHeaderMap(columnNames);
        const extracted = rows.map((row, index) => extractRow(row, headerMap, index + 2));

        for (let i = 0; i < extracted.length; i += BATCH_SIZE) {
          const batch = extracted.slice(i, i + BATCH_SIZE);
          setProgress(
            `Writing rows ${i + 1}–${Math.min(i + BATCH_SIZE, extracted.length)} of ${extracted.length}`,
            45 + Math.round((i / Math.max(extracted.length, 1)) * 40),
          );
          await insertRecordsFn({
            data: { importId, clientId, period: periodDate, rows: batch },
          });
        }

        setProgress("Finalising import", 88);
        await finalizeFn({
          data: { importId, rowCount: extracted.length, columnNames, state: "parsed" },
        });

        setProgress("Summarising flags and diffing", 94);
        const [summary, diffResult] = await Promise.all([
          flagSummaryFn({ data: { importId } }),
          diffFn({ data: { importId } }),
        ]);
        return {
          summary: { ...summary, totalRows: extracted.length },
          diff: diffResult,
          totalRows: extracted.length,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Parse failed";
        await finalizeFn({
          data: {
            importId,
            rowCount: 0,
            columnNames: [],
            state: "failed",
            parseError: message.slice(0, 2000),
          },
        }).catch(() => undefined);
        throw error;
      }
    },
    [
      checkDuplicateFn,
      clientId,
      createImportFn,
      diffFn,
      finalizeFn,
      flagSummaryFn,
      insertRecognitionFn,
      insertRecordsFn,
      patch,
    ],
  );

  const pending = queue.filter((item) => item.status === "ready");

  const runAll = useCallback(async () => {
    if (!clientId) {
      toast.error("Pick a client first.");
      return;
    }
    const todo = queue
      .filter((item) => item.status === "ready")
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    if (todo.length === 0) return;

    setRunning(true);
    setFlagSummary(null);
    setDiff(null);
    let done = 0;

    for (const item of todo) {
      patch(item.id, { status: "importing", message: null });
      try {
        const result = await importOne(item);
        done += 1;
        patch(item.id, {
          status: "done",
          progress: null,
          rows: result.totalRows,
          message: `${result.totalRows} rows imported`,
        });
        if (result.summary) {
          setFlagSummary(result.summary as FlagSummary & { totalRows: number });
        }
        if (result.diff) setDiff(result.diff as DiffResult);
      } catch (error) {
        patch(item.id, {
          status: "error",
          progress: null,
          message: error instanceof Error ? error.message : "Import failed",
        });
      }
    }

    setRunning(false);
    setJustImported((count) => count + done);
    queryClient.invalidateQueries({ queryKey: ["imports", clientId] });
    if (done > 0) toast.success(`Imported ${done} file${done === 1 ? "" : "s"}.`);
  }, [clientId, importOne, patch, queue, queryClient]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const stated = useMutation({
    mutationFn: (importId: string) => previewStatedFn({ data: { importId } }),
    onSuccess: (result) => {
      setStatedPreview(result);
      if (result.figures.length === 0) {
        toast.info("No headline numbers were recognised in that file.");
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveStated = useMutation({
    mutationFn: (importId: string) => saveStatedFn({ data: { importId } }),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success(result.message);
        setStatedPreview(null);
        setStatedFor(null);
      } else {
        toast.error(result.message);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  /** Which of this month's expected files are already in, so nothing is missed. */
  const checklist = useMemo(() => {
    const periodDate = `${period}-01`;
    const rows = (imports.data ?? []).filter(
      (row) => row.period === periodDate && row.state === "parsed",
    );
    return CHECKLIST.map((entry) => {
      const match = rows.find((row) => row.kind === entry.kind);
      const queued = queue.some(
        (item) =>
          item.kind === entry.kind &&
          item.period === period &&
          (item.status === "ready" || item.status === "importing"),
      );
      return { ...entry, done: Boolean(match), rows: match?.row_count ?? null, queued };
    });
  }, [imports.data, period, queue]);

  const missingRequired = checklist.filter((entry) => entry.required && !entry.done).length;

  return (
    <main className="min-h-screen bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Import</h1>
            <p className="text-sm text-muted-foreground">
              Drop this month's files in together — each one is read, labelled and imported for you.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/decisions">Decisions review</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/assembly">Assembly layer</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/metrics">Metrics layer</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Step 1 · Who and when</CardTitle>
            <CardDescription>
              Everything you drop below goes to this client. Each file's month is filled in from the
              file itself, and you can change it per file.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="client">Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger id="client">
                  <SelectValue placeholder={clients.isLoading ? "Loading…" : "Select a client"} />
                </SelectTrigger>
                <SelectContent>
                  {(clients.data ?? []).map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name} ({client.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {clients.data?.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  You are not assigned to any client yet.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="period">Month you are working on</Label>
              <Input
                id="period"
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {clientId ? (
          <Card>
            <CardHeader>
              <CardTitle>
                {activeClient?.name ?? "This client"} · {period}
              </CardTitle>
              <CardDescription>
                {missingRequired === 0
                  ? "Everything expected for this month is in."
                  : `${missingRequired} file${missingRequired === 1 ? "" : "s"} still missing for this month.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2 sm:grid-cols-2">
                {checklist.map((entry) => (
                  <li
                    key={entry.kind}
                    className="flex items-start gap-3 rounded-md border bg-background p-3"
                  >
                    {entry.done ? (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {entry.label}
                        {entry.required ? null : (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            optional
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {entry.done
                          ? `In · ${entry.rows ?? 0} rows`
                          : entry.queued
                            ? "Waiting in the list below"
                            : entry.hint}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Step 2 · Drop the files</CardTitle>
            <CardDescription>
              Drop the roster, mood, login and recognition files together. Originals are kept
              untouched, and the same file cannot be imported twice.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragging(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "copy";
                setDragging(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
              }}
              onDrop={onDrop}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
                dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25"
              }`}
            >
              <UploadCloud className="mb-3 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Drop one or several .xlsx or .csv files here, or click to browse.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                onChange={(e) => {
                  acceptFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                Choose files
              </Button>
            </div>

            {queue.map((item) => (
              <div key={item.id} className="space-y-3 rounded-lg border bg-background p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center text-sm font-medium">
                      <FileSpreadsheet className="mr-2 h-4 w-4 shrink-0" />
                      <span className="truncate">{item.file.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {(item.file.size / 1024).toFixed(0)} KB
                      </span>
                    </p>
                    {item.status === "reading" ? (
                      <p className="mt-1 flex items-center text-xs text-muted-foreground">
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Reading the file to see
                        what is in it…
                      </p>
                    ) : null}
                    {item.applied.length > 0 && item.status === "ready" ? (
                      <p className="mt-1 flex items-center text-xs text-muted-foreground">
                        <Sparkles className="mr-1 h-3 w-3 text-primary" /> Filled in for you:{" "}
                        {item.applied.join(", ")}.
                      </p>
                    ) : null}
                    {item.message ? (
                      <p
                        className={`mt-1 text-xs ${
                          item.status === "error" ? "text-destructive" : "text-muted-foreground"
                        }`}
                      >
                        {item.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    {item.status === "done" ? (
                      <Badge variant="secondary">
                        <Check className="mr-1 h-3 w-3" /> Imported
                      </Badge>
                    ) : null}
                    {item.status === "error" ? <Badge variant="destructive">Failed</Badge> : null}
                    {item.status !== "importing" ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Remove file"
                        onClick={() =>
                          setQueue((current) => current.filter((entry) => entry.id !== item.id))
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>

                {item.status === "ready" ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">What this file is</Label>
                        <Select
                          value={item.kind}
                          onValueChange={(value) => patch(item.id, { kind: value })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {KINDS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Month</Label>
                        <Input
                          type="month"
                          value={item.period}
                          onChange={(e) => patch(item.id, { period: e.target.value })}
                        />
                      </div>
                    </div>

                    {item.sheetOptions.length > 1 ? (
                      <div className="space-y-1">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          Tab to import
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {item.sheetOptions.map((option) => (
                            <Button
                              key={option.name}
                              type="button"
                              size="sm"
                              variant={option.name === item.sheetName ? "default" : "outline"}
                              onClick={() => {
                                const next = item.sheetSniffs[option.name];
                                patch(item.id, {
                                  sheetName: option.name,
                                  ...(next ? { sniff: next } : {}),
                                });
                              }}
                            >
                              {option.name}
                              <span className="ml-2 text-xs opacity-70">
                                {option.rows} rows{option.detail ? " • per person" : ""}
                              </span>
                            </Button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {item.sniff?.signals.length ? (
                      <p className="text-xs text-muted-foreground">
                        Found: {item.sniff.signals.map((signal) => signal.label).join(", ")} ·{" "}
                        {item.sniff.rowCount} rows
                      </p>
                    ) : null}

                    {item.advice?.combinedNote ? (
                      <p className="text-xs text-muted-foreground">{item.advice.combinedNote}</p>
                    ) : null}

                    {item.advice?.suggestedClientId &&
                    item.advice.suggestedClientId !== clientId ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-muted-foreground">
                          The people in this file look like another client:
                        </span>
                        <Badge variant="outline">
                          {item.advice.clientMatches?.find(
                            (match) => match.clientId === item.advice?.suggestedClientId,
                          )?.name ?? "another client"}
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setClientId(item.advice!.suggestedClientId!)}
                        >
                          Switch client
                        </Button>
                      </div>
                    ) : null}

                    {item.advice?.warnings?.length ? (
                      <ul className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                        {item.advice.warnings.map((warning) => (
                          <li key={warning} className="flex gap-2">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                            <span>{warning}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : null}

                {item.progress ? (
                  <div className="space-y-2">
                    <p className="flex items-center text-xs text-muted-foreground">
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      {item.progress.label}
                    </p>
                    <Progress value={item.progress.value} />
                  </div>
                ) : null}
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void runAll()} disabled={running || !clientId || pending.length === 0}>
                {running
                  ? "Importing…"
                  : `Import ${pending.length || ""} file${pending.length === 1 ? "" : "s"}`.trim()}
              </Button>
              {queue.length > 0 && !running ? (
                <Button variant="ghost" onClick={() => setQueue([])}>
                  Clear list
                </Button>
              ) : null}
              {!clientId ? (
                <span className="text-sm text-muted-foreground">Pick a client first.</span>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {justImported > 0 && !running ? (
          <Card className="border-primary/40">
            <CardHeader>
              <CardTitle>Step 3 · What to do next</CardTitle>
              <CardDescription>
                Files are stored. Work through these in order to turn them into a report.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/assembly">
                  Build the people list <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/decisions">Review decisions</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/metrics">Rebuild the numbers</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/report" search={{ client: clientId, period: `${period}-01` }}>
                  Open the report
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {flagSummary ? (
          <FlagSummaryPanel summary={flagSummary} totalRows={flagSummary.totalRows} />
        ) : null}

        {diff ? <DiffPanel diff={diff} /> : null}

        {statedPreview && statedPreview.figures.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Stated figures in {statedPreview.filename}</CardTitle>
              <CardDescription>
                This file is already summarised. Save these numbers as supplied figures for{" "}
                {statedPreview.period} — they sit beside what the tool works out, and the Metrics
                screen flags any that disagree.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Figure</TableHead>
                      <TableHead>As written on the sheet</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statedPreview.figures.map((figure) => (
                      <TableRow key={figure.metric_key}>
                        <TableCell>{figure.label}</TableCell>
                        <TableCell className="text-muted-foreground">{figure.raw_label}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {figure.value}
                          {figure.unit === "%" ? "%" : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => statedFor && saveStated.mutate(statedFor)}
                  disabled={saveStated.isPending}
                >
                  {saveStated.isPending ? "Saving…" : "Save these figures"}
                </Button>
                <Button variant="ghost" onClick={() => setStatedPreview(null)}>
                  Discard
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {clientId ? (
          <Card>
            <CardHeader>
              <CardTitle>Recent imports</CardTitle>
              <CardDescription>Most recent 25 imports for this client.</CardDescription>
            </CardHeader>
            <CardContent>
              {(imports.data ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No imports for this client yet.
                </p>
              ) : (
                <div className="overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Period</TableHead>
                        <TableHead>Kind</TableHead>
                        <TableHead>File</TableHead>
                        <TableHead>Rows</TableHead>
                        <TableHead>Columns</TableHead>
                        <TableHead>State</TableHead>
                        <TableHead className="text-right">Stated figures</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(imports.data ?? []).map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{row.period}</TableCell>
                          <TableCell>{kindLabel(row.kind)}</TableCell>
                          <TableCell className="max-w-64 truncate">
                            {row.original_filename ?? "—"}
                          </TableCell>
                          <TableCell>{row.row_count ?? "—"}</TableCell>
                          <TableCell>{row.column_names?.length ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant={row.state === "failed" ? "destructive" : "secondary"}>
                              {row.state}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {row.state === "parsed" ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={
                                  statedFor === row.id && (stated.isPending || saveStated.isPending)
                                }
                                onClick={() => {
                                  setStatedFor(row.id);
                                  stated.mutate(row.id);
                                }}
                              >
                                Read
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
