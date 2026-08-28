import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LayoutDashboard, CheckCircle2, CircleDashed } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { getConsoleOverview } from "@/lib/dashboard.functions";

export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({
    meta: [
      { title: "Dashboard | Client Reporting Console" },
      {
        name: "description",
        content:
          "At-a-glance status for every client: latest period, headcount, readiness and last report.",
      },
      { property: "og:title", content: "Dashboard | Client Reporting Console" },
      {
        property: "og:description",
        content: "Per-client reporting status across periods, metrics and report runs.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: HomeScreen,
});

function fmtPeriod(period: string | null) {
  if (!period) return "No data yet";
  const [y, m] = period.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

function HomeScreen() {
  const load = useServerFn(getConsoleOverview);
  const { data, isLoading } = useQuery({
    queryKey: ["console-overview"],
    queryFn: () => load(),
  });

  const clients = data?.clients ?? [];

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <LayoutDashboard className="h-6 w-6" />
          Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Where each client stands right now — latest period built, whether it is signed off, and
          when the last report went out.
        </p>
      </header>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && clients.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No clients yet</CardTitle>
            <CardDescription>Add a client to start uploading data.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/clients">Add a client</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {clients.map((c) => (
          <Card key={c.id}>
            <CardHeader className="space-y-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">{c.name}</CardTitle>
                  <CardDescription>{c.code}</CardDescription>
                </div>
                {c.ready ? (
                  <Badge className="gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Ready
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1">
                    <CircleDashed className="h-3.5 w-3.5" />
                    In progress
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Latest period</dt>
                <dd className="text-right font-medium">{fmtPeriod(c.latestPeriod)}</dd>
                <dt className="text-muted-foreground">People included</dt>
                <dd className="text-right font-medium">{c.headcount || "—"}</dd>
                <dt className="text-muted-foreground">Metrics published</dt>
                <dd className="text-right font-medium">{c.metricCount || "—"}</dd>
                <dt className="text-muted-foreground">Last upload</dt>
                <dd className="text-right">{fmtDate(c.latestImportAt)}</dd>
                <dt className="text-muted-foreground">Last report</dt>
                <dd className="text-right">{fmtDate(c.latestReportAt)}</dd>
              </dl>
              <div className="flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to="/decisions">Review</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/metrics">Metrics</Link>
                </Button>
                <Button asChild size="sm">
                  <Link
                    to="/report"
                    search={{ client: c.id, period: c.latestPeriod ?? undefined }}
                  >
                    Report
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
