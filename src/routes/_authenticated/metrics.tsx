import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Gauge, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { listMyClients } from "@/lib/imports.functions";
import {
  listMetricDefinitions,
  listMetricPeriods,
  listMetrics,
  rebuildMetrics,
} from "@/lib/metrics.functions";

export const Route = createFileRoute("/_authenticated/metrics")({
  head: () => ({
    meta: [
      { title: "Metrics layer | Client Reporting Console" },
      {
        name: "description",
        content:
          "Compute and trace published metrics by scope, definition version and computed timestamp for a client and reporting period.",
      },
      { property: "og:title", content: "Metrics layer | Client Reporting Console" },
      {
        property: "og:description",
        content:
          "Every reported number traced back to the definition version that produced it, with prior-period comparison computed at read time.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MetricsScreen,
});

const fmt = (value: number | string | null) => {
  if (value === null) return "—";
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return String(value);
  return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/0$/, "");
};

function Delta({ current, prior }: { current: number | null; prior: number | null }) {
  if (current === null || prior === null) return <span className="text-muted-foreground">—</span>;
  const diff = Number(current) - Number(prior);
  if (Math.abs(diff) < 0.0001) return <span className="text-muted-foreground">0</span>;
  return (
    <span className={diff > 0 ? "text-emerald-600" : "text-destructive"}>
      {diff > 0 ? "+" : ""}
      {fmt(Math.round(diff * 100) / 100)}
    </span>
  );
}

function MetricsScreen() {
  const [clientId, setClientId] = useState("");
  const [period, setPeriod] = useState("");
  const [filter, setFilter] = useState("");

  const clientsFn = useServerFn(listMyClients);
  const periodsFn = useServerFn(listMetricPeriods);
  const metricsFn = useServerFn(listMetrics);
  const definitionsFn = useServerFn(listMetricDefinitions);
  const rebuildFn = useServerFn(rebuildMetrics);

  const clients = useQuery({ queryKey: ["clients"], queryFn: () => clientsFn({}) });
  const periods = useQuery({
    queryKey: ["metric-periods", clientId],
    enabled: Boolean(clientId),
    queryFn: () => periodsFn({ data: { clientId } }),
  });
  const metrics = useQuery({
    queryKey: ["metrics", clientId, period],
    enabled: Boolean(clientId && period),
    queryFn: () => metricsFn({ data: { clientId, period } }),
  });
  const definitions = useQuery({
    queryKey: ["metric-definitions"],
    queryFn: () => definitionsFn({}),
  });

  const rebuild = useMutation({
    mutationFn: () => rebuildFn({ data: { clientId, period } }),
    onSuccess: (result) => {
      toast.success(`Wrote ${result.written} metric rows for ${period}`);
      metrics.refetch();
      definitions.refetch();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  useEffect(() => {
    if (!clientId && clients.data?.length) setClientId(clients.data[0]!.id);
  }, [clients.data, clientId]);
  useEffect(() => {
    if (periods.data?.length && !periods.data.includes(period)) setPeriod(periods.data[0]!);
  }, [periods.data, period]);

  const rows = metrics.data?.rows ?? [];
  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) =>
        row.metric_key.toLowerCase().includes(needle) || row.scope.toLowerCase().includes(needle),
    );
  }, [rows, filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const row of filtered) {
      const group = row.scope.split(":")[0]!;
      const list = map.get(group) ?? [];
      list.push(row);
      map.set(group, list);
    }
    return [...map.entries()].sort((a, b) =>
      a[0] === "company" ? -1 : b[0] === "company" ? 1 : a[0].localeCompare(b[0]),
    );
  }, [filtered]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Gauge className="h-5 w-5" /> Metrics layer
          </h1>
          <p className="text-sm text-muted-foreground">
            Reads person_period, writes published_metrics. Reports read only from here.
          </p>
        </div>
        <nav className="flex gap-3 text-sm">
          <Link to="/imports" className="underline underline-offset-4">
            Imports
          </Link>
          <Link to="/assembly" className="underline underline-offset-4">
            Assembly
          </Link>
          <Link to="/decisions" className="underline underline-offset-4">
            Decisions review
          </Link>
        </nav>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Rebuild</CardTitle>
          <CardDescription>
            Recomputes every metric for one client and period under the current definition
            versions. Values stored under superseded versions or an earlier exclusion set are left
            untouched.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="min-w-56 space-y-1">
            <Label>Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger>
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
          <div className="min-w-44 space-y-1">
            <Label>Period</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger>
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
            onClick={() => rebuild.mutate()}
            disabled={!clientId || !period || rebuild.isPending}
          >
            {rebuild.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Rebuild metrics
          </Button>
        </CardContent>
      </Card>

      <Tabs defaultValue="values">
        <TabsList>
          <TabsTrigger value="values">Computed metrics</TabsTrigger>
          <TabsTrigger value="definitions">Definitions</TabsTrigger>
        </TabsList>

        <TabsContent value="values" className="space-y-4">
          <div className="flex items-center gap-3">
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter by metric key or scope"
              className="max-w-sm"
            />
            <span className="text-sm text-muted-foreground">
              {filtered.length} rows · prior period {metrics.data?.priorPeriod ?? "—"}
            </span>
          </div>

          {metrics.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          {!metrics.isLoading && rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No metrics stored for this period yet. Hit rebuild.
            </p>
          ) : null}

          {grouped.map(([group, groupRows]) => (
            <Card key={group}>
              <CardHeader>
                <CardTitle className="text-base capitalize">{group} scope</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Metric</TableHead>
                      <TableHead>Scope</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="text-right">Prior</TableHead>
                      <TableHead className="text-right">Δ</TableHead>
                      <TableHead>Def. version</TableHead>
                      <TableHead>Computed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupRows.map((row) => (
                      <TableRow key={`${row.metric_key}-${row.scope}-${row.definition_version}`}>
                        <TableCell className="font-medium">{row.metric_key}</TableCell>
                        <TableCell className="text-muted-foreground">{row.scope}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(row.value_numeric) }
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {fmt(row.prior_value)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <Delta
                            current={row.value_numeric === null ? null : Number(row.value_numeric)}
                            prior={row.prior_value === null ? null : Number(row.prior_value)}
                          />
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">v{row.definition_version}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(row.computed_at).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="definitions">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Metric definitions</CardTitle>
              <CardDescription>
                Superseded versions stay in place so historical values keep the definition that
                produced them.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Effective from</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Formula</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(definitions.data ?? []).map((definition) => (
                    <TableRow key={`${definition.key}-${definition.version}`}>
                      <TableCell className="font-medium">{definition.key}</TableCell>
                      <TableCell>
                        <Badge variant={definition.superseded ? "outline" : "secondary"}>
                          v{definition.version}
                          {definition.superseded ? " · superseded" : ""}
                        </Badge>
                      </TableCell>
                      <TableCell>{definition.effective_from}</TableCell>
                      <TableCell className="max-w-72 text-sm">{definition.description}</TableCell>
                      <TableCell className="max-w-96 text-xs text-muted-foreground">
                        {definition.formula_note}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
