import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Info,
  Link2,
  Link2Off,
  Loader2,
  Printer,
  RefreshCw,
  Share2,
  X,
} from "lucide-react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
  checkReport,
  createReportShare,
  generateReport,
  getFormatSections,
  getReport,
  getReportDownloadUrl,
  getReportVersion,
  isRendererConfigured,
  listReportRuns,
  listReportShares,
  revokeReportShare,
  snapshotReport,
} from "@/lib/report.functions";



import { FORMAT_SPECS, REPORT_FORMATS, type ReportFormat } from "@/lib/report-formats";
import { ReportDocument, SECTIONS } from "@/components/report/ReportDocument";
import "@/styles/report.css";


export const Route = createFileRoute("/_authenticated/report")({
  head: () => ({
    meta: [
      { title: "Culture report preview | Client Reporting Console" },
      {
        name: "description",
        content:
          "Preview the landscape letter culture report for a client and period, page by page, exactly as it prints.",
      },
      { property: "og:title", content: "Culture report preview | Client Reporting Console" },
      {
        property: "og:description",
        content:
          "Paged HTML report rendered from published metrics only, with section navigation and print-ready page proportions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    client: typeof search["client"] === "string" ? (search["client"] as string) : undefined,
    period: typeof search["period"] === "string" ? (search["period"] as string) : undefined,
  }),
  component: ReportPreview,
});

function ReportPreview() {
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const clientsFn = useServerFn(listMyClients);
  const periodsFn = useServerFn(listMetricPeriods);
  const reportFn = useServerFn(getReport);
  const sectionsFn = useServerFn(getFormatSections);
  const runsFn = useServerFn(listReportRuns);
  const generateFn = useServerFn(generateReport);
  const snapshotFn = useServerFn(snapshotReport);
  const versionFn = useServerFn(getReportVersion);
  const downloadFn = useServerFn(getReportDownloadUrl);
  const rendererConfiguredFn = useServerFn(isRendererConfigured);
  const sharesFn = useServerFn(listReportShares);
  const createShareFn = useServerFn(createReportShare);
  const revokeShareFn = useServerFn(revokeReportShare);



  const [clientId, setClientId] = useState<string>(search.client ?? "");
  const [period, setPeriod] = useState<string>(search.period ?? "");
  const [format, setFormat] = useState<ReportFormat>("landscape");
  const [activeSection, setActiveSection] = useState<string>("cover");
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);


  const clients = useQuery({ queryKey: ["my-clients"], queryFn: () => clientsFn() });

  useEffect(() => {
    if (!clientId && clients.data?.[0]) setClientId(clients.data[0].id);
  }, [clients.data, clientId]);

  const periods = useQuery({
    queryKey: ["metric-periods", clientId],
    queryFn: () => periodsFn({ data: { clientId } }),
    enabled: Boolean(clientId),
  });

  useEffect(() => {
    const list = periods.data ?? [];
    if (list.length > 0 && !list.includes(period)) setPeriod(list[0]!);
  }, [periods.data, period]);

  const report = useQuery({
    queryKey: ["report", clientId, period],
    queryFn: () => reportFn({ data: { clientId, period } }),
    enabled: Boolean(clientId && period),
  });

  const formatSections = useQuery({
    queryKey: ["report-format-sections", clientId],
    queryFn: () => sectionsFn({ data: { clientId } }),
    enabled: Boolean(clientId),
  });

  const rendererConfigured = useQuery({
    queryKey: ["report-renderer-configured"],
    queryFn: () => rendererConfiguredFn(),
  });

  const runs = useQuery({
    queryKey: ["report-runs", clientId, period],
    queryFn: () => runsFn({ data: { clientId, period } }),
    enabled: Boolean(clientId && period),
  });

  const shares = useQuery({
    queryKey: ["report-shares", clientId, period],
    queryFn: () => sharesFn({ data: { clientId, period } }),
    enabled: Boolean(clientId && period),
  });

  const shareByRun = useMemo(() => {
    const map = new Map<string, NonNullable<typeof shares.data>[number]>();
    for (const share of shares.data ?? []) {
      if (!map.has(share.report_run_id)) map.set(share.report_run_id, share);
    }
    return map;
  }, [shares.data]);

  const copyShareLink = async (token: string) => {
    const url = `${window.location.origin}/shared/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied — only people assigned to this client can open it");
    } catch {
      toast.message(url);
    }
  };

  const share = useMutation({
    mutationFn: (runId: string) => createShareFn({ data: { runId, expiresInDays: 90 } }),
    onSuccess: async (result) => {
      void queryClient.invalidateQueries({ queryKey: ["report-shares", clientId, period] });
      await copyShareLink(result.token);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const revokeShare = useMutation({
    mutationFn: (shareId: string) => revokeShareFn({ data: { shareId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["report-shares", clientId, period] });
      toast.success("Link revoked");
    },
    onError: (error: Error) => toast.error(error.message),
  });


  // Reopening a stored version renders its frozen snapshot, not today's recomputed numbers.
  const version = useQuery({
    queryKey: ["report-version", viewingRunId],
    queryFn: () => versionFn({ data: { runId: viewingRunId as string } }),
    enabled: Boolean(viewingRunId),
  });

  useEffect(() => {
    setViewingRunId(null);
  }, [clientId, period]);


  const generate = useMutation({
    mutationFn: (target: ReportFormat) =>
      generateFn({ data: { clientId, period, format: target } }),
    onSuccess: (result) => {
      toast.success(
        `Saved v${result.version} · ${result.pageCount ?? "?"} pages · ${(result.byteSize / 1024).toFixed(0)} KB`,
      );
      void queryClient.invalidateQueries({ queryKey: ["report-runs", clientId, period] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const download = useMutation({
    mutationFn: (runId: string) => downloadFn({ data: { runId } }),
    onSuccess: ({ url }) => window.open(url, "_blank", "noopener"),
    onError: (error: Error) => toast.error(error.message),
  });

  const [exporting, setExporting] = useState(false);

  const exportPdf = async () => {
    if (!report.data || exporting) return;
    setExporting(true);
    try {
      if (rendererConfigured.data) {
        const result = await generateFn({ data: { clientId, period, format } });
        void queryClient.invalidateQueries({ queryKey: ["report-runs", clientId, period] });
        const { url } = await downloadFn({ data: { runId: result.runId } });
        window.open(url, "_blank", "noopener");
        toast.success(`v${result.version} ready · ${(result.byteSize / 1024).toFixed(0)} KB`);
      } else {
        // No server renderer: still record the version so the printed numbers are retained.
        const result = await snapshotFn({ data: { clientId, period, format } });
        void queryClient.invalidateQueries({ queryKey: ["report-runs", clientId, period] });
        toast.success(`Snapshot saved as v${result.version}`);
        window.print();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const snapshotData = (version.data?.snapshot ?? null) as typeof report.data | null;
  const viewing = viewingRunId ? version.data ?? null : null;
  const displayFormat = (viewing?.format as ReportFormat | undefined) ?? format;
  const displayData = viewingRunId ? snapshotData : report.data;

  const liveSections = formatSections.data?.[format];
  const activeSections =
    viewing && viewing.sections.length > 0 ? viewing.sections : liveSections;
  const sections = useMemo(
    () =>
      activeSections && activeSections.length > 0
        ? SECTIONS.filter((section) => activeSections.includes(section.id))
        : SECTIONS.slice(),
    [activeSections],
  );

  const runsByFormat = useMemo(() => {
    const map = new Map<string, NonNullable<typeof runs.data>>();
    for (const run of runs.data ?? []) {
      const list = map.get(run.format) ?? [];
      list.push(run);
      map.set(run.format, list);
    }
    return map;
  }, [runs.data]);



  return (
    <div className="min-h-screen bg-muted/40">
      <header className="rp-no-print sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="flex flex-wrap items-end gap-4 px-6 py-3">
          <div className="flex items-center gap-2 pb-1">
            <FileText className="h-5 w-5 text-primary" />
            <span className="font-semibold">Culture report</span>
            <span className="text-xs text-muted-foreground">{FORMAT_SPECS[format].label}</span>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Select client" />
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
          <div className="grid gap-1">
            <Label className="text-xs">Period</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                {(periods.data ?? []).map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Format</Label>
            <Select value={format} onValueChange={(value) => setFormat(value as ReportFormat)}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPORT_FORMATS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {FORMAT_SPECS[value].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {rendererConfigured.data && (
            <Button
              className="mb-0.5"
              onClick={() => generate.mutate(format)}
              disabled={!report.data || generate.isPending}
            >
              {generate.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Generate PDF
            </Button>
          )}
          <Button
            variant="outline"
            className="mb-0.5"
            onClick={() => window.print()}
            disabled={!report.data}
          >
            <Printer className="mr-2 h-4 w-4" />
            Save as PDF
          </Button>

        </div>

        {viewingRunId && (
          <div className="flex items-center gap-3 border-t bg-amber-50 px-6 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <Eye className="h-3.5 w-3.5" />
            <span>
              Viewing stored version {viewing ? `v${viewing.version}` : "…"}
              {viewing ? ` · ${new Date(viewing.created_at).toLocaleString("en-US")}` : ""} — frozen
              snapshot, not current data.
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => setViewingRunId(null)}
            >
              <X className="mr-1 h-3 w-3" />
              Back to current
            </Button>
          </div>
        )}

        <div className="grid gap-2 border-t px-6 py-3 md:grid-cols-4">
          {REPORT_FORMATS.map((value) => {
            const list = runsByFormat.get(value) ?? [];
            const latest = list[0];
            return (
              <div key={value} className="rounded border bg-background p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">
                    {FORMAT_SPECS[value].label}
                    {latest ? ` · v${latest.version}` : ""}
                  </span>
                  {rendererConfigured.data && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={() => generate.mutate(value)}
                      disabled={!report.data || generate.isPending}
                    >
                      {latest ? "New version" : "Generate"}
                    </Button>
                  )}
                </div>
                {list.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">No versions yet.</p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {list.map((run) => (
                      <li key={run.id} className="flex items-center justify-between gap-1">
                        <span className="truncate text-xs text-muted-foreground">
                          v{run.version} · {new Date(run.created_at).toLocaleDateString("en-US")}
                          {run.page_count ? ` · ${run.page_count}p` : ""}
                        </span>
                        <span className="flex shrink-0 items-center">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1"
                            title="View this stored version"
                            onClick={() => setViewingRunId(run.id)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {shareByRun.has(run.id) ? (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-1 text-primary"
                                title="Copy the share link"
                                onClick={() =>
                                  void copyShareLink(shareByRun.get(run.id)!.token)
                                }
                              >
                                <Link2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-1 text-muted-foreground"
                                title="Revoke the share link"
                                onClick={() => revokeShare.mutate(shareByRun.get(run.id)!.id)}
                                disabled={revokeShare.isPending}
                              >
                                <Link2Off className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1"
                              title="Create a share link (90 days, client-scoped)"
                              onClick={() => share.mutate(run.id)}
                              disabled={share.isPending}
                            >
                              <Share2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {run.storage_path && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1"
                              title="Download the PDF"
                              onClick={() => download.mutate(run.id)}
                              disabled={download.isPending}
                            >
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                          )}

                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>


      </header>


      <div className="flex gap-6 px-6 py-6">
        <nav className="rp-no-print sticky top-24 hidden h-fit w-56 shrink-0 lg:block">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Sections
          </p>
          <ol className="space-y-1 text-sm">
            {sections.map((section) => (
              <li key={section.id}>
                <button
                  type="button"
                  className={`w-full rounded px-2 py-1 text-left transition-colors hover:bg-accent ${
                    activeSection === section.id ? "bg-accent font-medium" : ""
                  }`}
                  onClick={() => {
                    setActiveSection(section.id);
                    document
                      .getElementById(`rp-${section.id}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  {section.label}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <main className="min-w-0 flex-1">
          {report.isLoading || version.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading published metrics…
            </div>
          ) : report.error || version.error ? (
            <p className="text-sm text-destructive">
              {((report.error ?? version.error) as Error).message}
            </p>
          ) : displayData ? (
            <div
              className="origin-top"
              style={{ zoom: "var(--rp-zoom, 0.82)" } as React.CSSProperties}
            >
              <ReportDocument
                data={displayData}
                format={displayFormat}
                {...(activeSections ? { sections: activeSections } : {})}
              />

            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a client and period with published metrics.
            </p>
          )}
        </main>

        {displayData && !viewingRunId && (

          <Button
            size="lg"
            className="rp-no-print fixed bottom-6 right-6 z-30 shadow-lg"
            onClick={() => void exportPdf()}
            disabled={exporting}
            title={
              rendererConfigured.data
                ? "Generate the PDF on the server and download it"
                : "Open the print dialog to save as PDF"
            }
          >
            {exporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {exporting ? "Exporting…" : "Export PDF"}
          </Button>
        )}
      </div>
    </div>
  );
}
