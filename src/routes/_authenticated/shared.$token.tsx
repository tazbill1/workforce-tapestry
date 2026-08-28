import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Lock, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getSharedReport } from "@/lib/report.functions";
import { FORMAT_SPECS, type ReportFormat } from "@/lib/report-formats";
import { ReportDocument } from "@/components/report/ReportDocument";
import "@/styles/report.css";

export const Route = createFileRoute("/_authenticated/shared/$token")({
  head: () => ({
    meta: [
      { title: "Shared culture report | Client Reporting Console" },
      {
        name: "description",
        content:
          "Read-only view of a saved culture report version, limited to people assigned to that client.",
      },
      { property: "og:title", content: "Shared culture report | Client Reporting Console" },
      {
        property: "og:description",
        content: "A frozen report version shared with the client team, view and print only.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SharedReportPage,
});

function SharedReportPage() {
  const { token } = Route.useParams();
  const sharedFn = useServerFn(getSharedReport);

  const shared = useQuery({
    queryKey: ["shared-report", token],
    queryFn: () => sharedFn({ data: { token } }),
    retry: false,
  });

  if (shared.isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Opening shared report…
      </div>
    );
  }

  if (shared.error || !shared.data) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <Lock className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Report unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {(shared.error as Error | null)?.message ??
            "This link is not valid for your account."}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Shared reports are limited to people assigned to that client.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/report" search={{ client: undefined, period: undefined }}>
            Go to reports
          </Link>

        </Button>
      </div>
    );
  }

  const { run, clientName, label } = shared.data;
  const sections = (run.sections ?? []) as string[];

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="rp-no-print sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b bg-background px-6 py-3">
        <div>
          <h1 className="text-sm font-semibold">
            {clientName} · {new Date(`${run.period}T00:00:00`).toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            })}
          </h1>
          <p className="text-xs text-muted-foreground">
            {label ? `${label} · ` : ""}v{run.version} ·{" "}
            {FORMAT_SPECS[run.format as ReportFormat]?.label ?? run.format} · shared read-only
            snapshot
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" />
          Save as PDF
        </Button>
      </header>

      <main className="p-6">
        <div className="origin-top" style={{ zoom: "var(--rp-zoom, 0.82)" }}>
          <ReportDocument
            data={run.snapshot as never}
            format={run.format as ReportFormat}
            {...(sections.length > 0 ? { sections } : {})}
          />
        </div>
      </main>
    </div>
  );
}
