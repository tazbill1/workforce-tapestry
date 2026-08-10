import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { UploadCloud, FileSpreadsheet, LogOut, Loader2 } from "lucide-react";

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
] as const;

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

type Step = { label: string; progress: number } | null;

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

  const [clientId, setClientId] = useState<string>("");
  const [period, setPeriod] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [kind, setKind] = useState<string>("roster");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [step, setStep] = useState<Step>(null);
  const [flagSummary, setFlagSummary] = useState<(FlagSummary & { totalRows: number }) | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);

  const clients = useQuery({ queryKey: ["clients"], queryFn: () => clientsFn() });

  const imports = useQuery({
    queryKey: ["imports", clientId],
    queryFn: () => listImportsFn({ data: { clientId } }),
    enabled: Boolean(clientId),
  });

  const run = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("Pick a client first.");
      if (!file) throw new Error("Choose a file first.");
      const periodDate = `${period}-01`;

      setDiff(null);
      setFlagSummary(null);

      setStep({ label: "Fingerprinting file", progress: 5 });
      const buffer = await file.arrayBuffer();
      const sha256 = await sha256Hex(buffer);

      const { duplicate } = await checkDuplicateFn({
        data: { clientId, period: periodDate, kind, sha256 },
      });
      if (duplicate) {
        throw new Error(
          `This exact file was already imported for this client, period and kind on ${new Date(
            duplicate.uploaded_at,
          ).toLocaleString()} (${duplicate.original_filename ?? "unnamed"}). Nothing was imported.`,
        );
      }

      setStep({ label: "Uploading original to storage", progress: 20 });
      const storagePath = `${clientId}/${periodDate}/${sha256.slice(0, 12)}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("raw-imports")
        .upload(storagePath, file, { upsert: false });
      if (uploadError && !uploadError.message.toLowerCase().includes("already exists")) {
        throw new Error(`Upload failed: ${uploadError.message}`);
      }

      setStep({ label: "Recording import", progress: 32 });
      const created = await createImportFn({
        data: { clientId, period: periodDate, kind, sha256, filename: file.name, storagePath },
      });
      if (created.duplicate || !created.id) {
        throw new Error(
          "An identical file already exists for this client, period and kind. Nothing was imported.",
        );
      }
      const importId = created.id;

      try {
        setStep({ label: "Reading spreadsheet", progress: 42 });
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) throw new Error("The workbook has no sheets.");
        const sheet = workbook.Sheets[sheetName]!;
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
          setStep({
            label: `Writing rows ${i + 1}–${Math.min(i + BATCH_SIZE, extracted.length)} of ${extracted.length}`,
            progress: 45 + Math.round((i / Math.max(extracted.length, 1)) * 40),
          });
          await insertRecordsFn({
            data: { importId, clientId, period: periodDate, rows: batch },
          });
        }

        setStep({ label: "Finalising import", progress: 88 });
        await finalizeFn({
          data: {
            importId,
            rowCount: extracted.length,
            columnNames,
            state: "parsed",
          },
        });

        setStep({ label: "Summarising flags and diffing", progress: 94 });
        const [summary, diffResult] = await Promise.all([
          flagSummaryFn({ data: { importId } }),
          diffFn({ data: { importId } }),
        ]);
        return { summary: { ...summary, totalRows: extracted.length }, diff: diffResult, importId };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Parse failed";
        await finalizeFn({
          data: { importId, rowCount: 0, columnNames: [], state: "failed", parseError: message.slice(0, 2000) },
        }).catch(() => undefined);
        throw error;
      }
    },
    onSuccess: (result) => {
      setStep(null);
      setFlagSummary(result.summary as FlagSummary & { totalRows: number });
      setDiff(result.diff as DiffResult);
      toast.success(`Imported ${result.summary.totalRows} rows.`);
      queryClient.invalidateQueries({ queryKey: ["imports", clientId] });
    },
    onError: (error: Error) => {
      setStep(null);
      toast.error(error.message);
    },
  });

  const acceptFile = useCallback((candidate: File | null | undefined) => {
    if (!candidate) return;
    const ok = /\.(xlsx|xls|csv)$/i.test(candidate.name);
    if (!ok) {
      toast.error("Only .xlsx, .xls or .csv files can be imported.");
      return;
    }
    setFile(candidate);
    setFlagSummary(null);
    setDiff(null);
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDragging(false);
      const dt = event.dataTransfer;
      const dropped =
        dt.files?.[0] ??
        Array.from(dt.items ?? [])
          .filter((i) => i.kind === "file")
          .map((i) => i.getAsFile())
          .find(Boolean) ??
        null;
      acceptFile(dropped);
    },
    [acceptFile],
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

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const busy = run.isPending;

  return (
    <main className="min-h-screen bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Import</h1>
            <p className="text-sm text-muted-foreground">
              Upload a source file, parse it into raw records, and review what changed.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/assembly">Assembly layer</Link>
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
            <CardTitle>New import</CardTitle>
            <CardDescription>
              The original file is stored untouched in private storage. An identical file for the
              same client, period and kind is rejected rather than imported twice.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="client">Client</Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger id="client">
                    <SelectValue
                      placeholder={clients.isLoading ? "Loading…" : "Select a client"}
                    />
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
                <Label htmlFor="period">Reporting period</Label>
                <Input
                  id="period"
                  type="month"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="kind">File kind</Label>
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger id="kind">
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
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
                dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25"
              }`}
            >
              <UploadCloud className="mb-3 h-8 w-8 text-muted-foreground" />
              {file ? (
                <p className="text-sm font-medium">
                  <FileSpreadsheet className="mr-1 inline h-4 w-4" />
                  {file.name}{" "}
                  <span className="text-muted-foreground">
                    ({(file.size / 1024).toFixed(0)} KB)
                  </span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Drop an .xlsx or .csv file here, or choose one below.
                </p>
              )}
              <Input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="mt-4 max-w-xs"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            {step ? (
              <div className="space-y-2">
                <p className="flex items-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {step.label}
                </p>
                <Progress value={step.progress} />
              </div>
            ) : null}

            <Button onClick={() => run.mutate()} disabled={busy || !clientId || !file}>
              {busy ? "Importing…" : "Upload and parse"}
            </Button>
          </CardContent>
        </Card>

        {flagSummary ? (
          <FlagSummaryPanel summary={flagSummary} totalRows={flagSummary.totalRows} />
        ) : null}

        {diff ? <DiffPanel diff={diff} /> : null}

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
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(imports.data ?? []).map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{row.period}</TableCell>
                          <TableCell>{row.kind}</TableCell>
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
