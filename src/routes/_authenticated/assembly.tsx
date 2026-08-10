import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Layers, Loader2, RefreshCw, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

import { listMyClients } from "@/lib/imports.functions";
import {
  getPersonPeriodSummary,
  listAssemblyPeriods,
  rebuildPersonPeriod,
} from "@/lib/assembly.functions";

export const Route = createFileRoute("/_authenticated/assembly")({
  head: () => ({
    meta: [
      { title: "Assembly layer | Client Reporting Console" },
      {
        name: "description",
        content:
          "Rebuild the resolved person-period table for a client and reporting period, and review exclusions, unmapped roles, participation and departure-date quality.",
      },
      { property: "og:title", content: "Assembly layer | Client Reporting Console" },
      {
        property: "og:description",
        content:
          "One resolved row per person per period: merges collapsed, exclusions kept auditable, roles mapped, check-ins counted.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AssemblyScreen,
});

type Overlap = { normalized_email: string; parts: string[] };

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function AssemblyScreen() {
  const [clientId, setClientId] = useState<string>("");
  const [period, setPeriod] = useState<string>("");
  const [overlaps, setOverlaps] = useState<Overlap[]>([]);

  const clientsFn = useServerFn(listMyClients);
  const periodsFn = useServerFn(listAssemblyPeriods);
  const summaryFn = useServerFn(getPersonPeriodSummary);
  const rebuildFn = useServerFn(rebuildPersonPeriod);

  const clients = useQuery({ queryKey: ["clients"], queryFn: () => clientsFn({}) });

  const periods = useQuery({
    queryKey: ["assembly-periods", clientId],
    enabled: Boolean(clientId),
    queryFn: () => periodsFn({ data: { clientId } }),
  });

  const summary = useQuery({
    queryKey: ["person-period", clientId, period],
    enabled: Boolean(clientId && period),
    queryFn: () => summaryFn({ data: { clientId, period } }),
  });

  const rebuild = useMutation({
    mutationFn: () => rebuildFn({ data: { clientId, period } }),
    onSuccess: (result) => {
      setOverlaps(result.overlaps);
      toast.success(`Rebuilt ${result.inserted} rows for ${period}`);
      summary.refetch();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  useEffect(() => {
    if (!clientId && clients.data?.length) setClientId(clients.data[0]!.id);
  }, [clients.data, clientId]);

  useEffect(() => {
    if (periods.data?.length && !periods.data.includes(period)) setPeriod(periods.data[0]!);
  }, [periods.data, period]);

  const stats = summary.data?.summary;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Layers className="h-5 w-5" /> Assembly layer
          </h1>
          <p className="text-sm text-muted-foreground">
            One resolved row per person, per client, per period. Reports read only from here.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/imports">Back to imports</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/metrics">Metrics layer</Link>
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Rebuild a period</CardTitle>
          <CardDescription>
            Replaces person_period for the chosen client and period from the current roster union,
            merges, exclusions, department rules, role mappings, mood matrix and login report.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="min-w-56 space-y-2">
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
          <div className="min-w-44 space-y-2">
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
            Rebuild period
          </Button>
        </CardContent>
      </Card>

      {(summary.data?.parts.length ?? 0) > 0 ? (
        <div className="flex flex-wrap gap-2">
          {summary.data!.parts.map((part) => (
            <Badge key={part.id} variant="secondary">
              {part.label ?? "part"} · {part.rowCount ?? "?"} rows
            </Badge>
          ))}
        </div>
      ) : null}

      {overlaps.length > 0 ? (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" /> Overlapping roster parts
            </CardTitle>
            <CardDescription>
              These people appear in more than one part of the same period, which suggests the
              exports overlap rather than complement each other.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {overlaps.slice(0, 50).map((overlap) => (
              <p key={overlap.normalized_email}>
                <span className="font-medium">{overlap.normalized_email}</span> —{" "}
                {overlap.parts.join(", ")}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {stats ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
            <Stat label="Total rows" value={stats.total} />
            <Stat
              label="Flagged duplicates"
              value={stats.duplicateRows}
              hint="same email more than once in the roster"
            />
            <Stat label="Excluded" value={stats.excluded} hint="kept, flagged, never deleted" />
            <Stat label="Null role_code" value={stats.nullRoleCode} hint="unmapped, never guessed" />
            <Stat
              label="Checked in"
              value={stats.checkedIn}
              hint={`${stats.noMoodRow} with no mood row (null, not zero)`}
            />
            <Stat
              label="no_usable_departure_date"
              value={stats.noUsableDepartureDate}
              hint="modified = created on an inactive record"
            />
            <Stat
              label="negative_tenure"
              value={stats.negativeTenure}
              hint="departure proxy earlier than hire date — impossible, dropped from tenure"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Exclusions by reason</CardTitle>
              <CardDescription>
                Built {stats.builtAt ? new Date(stats.builtAt).toLocaleString() : "—"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {stats.exclusionReasons.length === 0 ? (
                <p className="text-sm text-muted-foreground">No excluded people this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reason</TableHead>
                      <TableHead className="w-24 text-right">People</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.exclusionReasons.map((item) => (
                      <TableRow key={item.reason}>
                        <TableCell>{item.reason}</TableCell>
                        <TableCell className="text-right tabular-nums">{item.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Resolved people</CardTitle>
              <CardDescription>First 500 rows of person_period.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Check-ins</TableHead>
                    <TableHead className="text-right">Mood</TableHead>
                    <TableHead>Departure</TableHead>
                    <TableHead>Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(summary.data?.rows ?? []).map((row) => (
                    <TableRow key={row.normalized_email}>
                      <TableCell className="font-mono text-xs">{row.normalized_email}</TableCell>
                      <TableCell>{row.name ?? "—"}</TableCell>
                      <TableCell>{row.role_code ?? <em className="text-muted-foreground">unmapped</em>}</TableCell>
                      <TableCell>{row.status ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.checkin_count ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.mood_avg ?? "—"}</TableCell>
                      <TableCell>{row.departure_date_proxy ?? "—"}</TableCell>
                      <TableCell className="space-x-1">
                        {(row.flags ?? []).map((flag) => (
                          <Badge key={flag} variant="outline" className="text-[10px]">
                            {flag}
                          </Badge>
                        ))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {summary.isFetching ? "Loading…" : "No assembled rows yet for this client and period."}
        </p>
      )}
    </div>
  );
}
