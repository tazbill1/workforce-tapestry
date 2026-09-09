import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TrendingUp } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTrends, type TrendPoint } from "@/lib/trends.functions";

export const Route = createFileRoute("/_authenticated/trends")({
  head: () => ({
    meta: [
      { title: "Trends | Client Reporting Console" },
      {
        name: "description",
        content:
          "Month-by-month turnover, mood, check-ins and recognition for every client in one view.",
      },
      { property: "og:title", content: "Trends | Client Reporting Console" },
      {
        property: "og:description",
        content: "Per-client trend charts across every published period.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TrendsScreen,
});

const SERIES: {
  field: keyof Omit<TrendPoint, "period">;
  label: string;
  suffix: string;
  color: string;
}[] = [
  { field: "turnoverPct", label: "Turnover", suffix: "%", color: "hsl(var(--destructive))" },
  { field: "moodPerEmployee", label: "Mood", suffix: "", color: "hsl(var(--primary))" },
  { field: "checkedInPct", label: "Checked in", suffix: "%", color: "hsl(var(--chart-2, 220 70% 50%))" },
  { field: "headcountActive", label: "Active people", suffix: "", color: "hsl(var(--chart-3, 160 60% 40%))" },
  { field: "recognitionsCount", label: "Recognitions", suffix: "", color: "hsl(var(--chart-4, 40 80% 50%))" },
];

function shortPeriod(period: string) {
  const [y, m] = period.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
  });
}

function Sparkline({
  points,
  field,
  color,
  suffix,
}: {
  points: TrendPoint[];
  field: keyof Omit<TrendPoint, "period">;
  color: string;
  suffix: string;
}) {
  const values = points.map((p) => p[field] as number | null);
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) {
    return <p className="text-xs text-muted-foreground">No data yet</p>;
  }

  const w = 260;
  const h = 70;
  const min = Math.min(...present);
  const max = Math.max(...present);
  const span = max - min || 1;
  const step = points.length > 1 ? w / (points.length - 1) : 0;

  const coords = values.map((v, i) =>
    v === null ? null : { x: i * step, y: h - ((v - min) / span) * (h - 12) - 6 },
  );
  const path = coords
    .filter((c): c is { x: number; y: number } => c !== null)
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");

  const last = present[present.length - 1]!;
  const first = present[0]!;
  const delta = last - first;

  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[70px] w-full" role="img" aria-label="Trend">
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        {coords.map((c, i) =>
          c === null ? null : <circle key={i} cx={c.x} cy={c.y} r={2.5} fill={color} />,
        )}
      </svg>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium">
          {last}
          {suffix}
        </span>
        <span className={delta === 0 ? "text-muted-foreground" : delta > 0 ? "text-foreground" : "text-muted-foreground"}>
          {delta > 0 ? "+" : ""}
          {Math.round(delta * 10) / 10}
          {suffix} since {shortPeriod(points.find((p) => p[field] !== null)!.period)}
        </span>
      </div>
    </div>
  );
}

function TrendsScreen() {
  const load = useServerFn(getTrends);
  const { data, isLoading } = useQuery({ queryKey: ["trends"], queryFn: () => load() });
  const clients = data?.clients ?? [];

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <TrendingUp className="h-6 w-6" />
          Trends
        </h1>
        <p className="text-sm text-muted-foreground">
          How each client has moved month to month, without opening a full report.
        </p>
      </header>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && clients.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing to chart yet — publish numbers for at least one month first.
        </p>
      )}

      {clients.map((c) => (
        <Card key={c.clientId}>
          <CardHeader>
            <CardTitle>{c.clientName}</CardTitle>
            <CardDescription>
              {c.points.length} month{c.points.length === 1 ? "" : "s"}:{" "}
              {c.points.map((p) => shortPeriod(p.period)).join(" · ")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {SERIES.map((s) => (
              <div key={s.field} className="space-y-1">
                <p className="text-sm font-medium">{s.label}</p>
                <Sparkline points={c.points} field={s.field} color={s.color} suffix={s.suffix} />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </main>
  );
}
