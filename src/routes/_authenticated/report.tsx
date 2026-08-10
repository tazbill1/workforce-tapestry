import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { FileText, Loader2, Printer } from "lucide-react";

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
import { getReport } from "@/lib/report.functions";
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
  component: ReportPreview,
});

function ReportPreview() {
  const clientsFn = useServerFn(listMyClients);
  const periodsFn = useServerFn(listMetricPeriods);
  const reportFn = useServerFn(getReport);

  const [clientId, setClientId] = useState<string>("");
  const [period, setPeriod] = useState<string>("");
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

  const sections = useMemo(() => SECTIONS, []);

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="rp-no-print sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="flex flex-wrap items-end gap-4 px-6 py-3">
          <div className="flex items-center gap-2 pb-1">
            <FileText className="h-5 w-5 text-primary" />
            <span className="font-semibold">Culture report</span>
            <span className="text-xs text-muted-foreground">Landscape letter</span>
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
          <Button
            variant="outline"
            className="mb-0.5"
            onClick={() => window.print()}
            disabled={!report.data}
          >
            <Printer className="mr-2 h-4 w-4" />
            Print / save as PDF
          </Button>
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
              <ReportDocument data={report.data} />
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
