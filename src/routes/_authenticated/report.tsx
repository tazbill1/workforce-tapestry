import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Loader2, Printer, RefreshCw } from "lucide-react";
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
  generateReport,
  getFormatSections,
  getReport,
  getReportDownloadUrl,
  isRendererConfigured,
  listReportRuns,
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
  const downloadFn = useServerFn(getReportDownloadUrl);
  const rendererConfiguredFn = useServerFn(isRendererConfigured);


  const [clientId, setClientId] = useState<string>(search.client ?? "");
  const [period, setPeriod] = useState<string>(search.period ?? "");
  const [format, setFormat] = useState<ReportFormat>("landscape");
  const [activeSection, setActiveSection] = useState<string>("cover");

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
    enabled: Boolean(clientId && period) && Boolean(rendererConfigured.data),
  });


  const generate = useMutation({
    mutationFn: (target: ReportFormat) =>
      generateFn({ data: { clientId, period, format: target } }),
    onSuccess: (result) => {
      toast.success(
        `Rendered ${result.pageCount ?? "?"} pages · ${(result.byteSize / 1024).toFixed(0)} KB`,
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

  const activeSections = formatSections.data?.[format];
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

        {rendererConfigured.data && (
          <div className="grid gap-2 border-t px-6 py-3 md:grid-cols-4">
            {REPORT_FORMATS.map((value) => {
              const list = runsByFormat.get(value) ?? [];
              const latest = list[0];
              return (
                <div key={value} className="rounded border bg-background p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">{FORMAT_SPECS[value].label}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={() => generate.mutate(value)}
                      disabled={!report.data || generate.isPending}
                    >
                      {latest ? "Regenerate" : "Generate"}
                    </Button>
                  </div>
                  {list.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">Not generated yet.</p>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {list.map((run) => (
                        <li key={run.id} className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-muted-foreground">
                            {new Date(run.created_at).toLocaleString("en-US")}
                            {run.page_count ? ` · ${run.page_count}p` : ""}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1"
                            onClick={() => download.mutate(run.id)}
                            disabled={download.isPending}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}

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
          {report.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading published metrics…
            </div>
          ) : report.error ? (
            <p className="text-sm text-destructive">{(report.error as Error).message}</p>
          ) : report.data ? (
            <div
              className="origin-top"
              style={{ zoom: "var(--rp-zoom, 0.82)" } as React.CSSProperties}
            >
              <ReportDocument
                data={report.data}
                format={format}
                {...(activeSections ? { sections: activeSections } : {})}
              />

            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a client and period with published metrics.
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
