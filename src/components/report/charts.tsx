import { TOKENS } from "@/lib/report-core";

/**
 * Inline SVG charts. No canvas, no chart library, no client-side measurement: everything is
 * laid out in viewBox units so the same markup prints at any page size and survives
 * serialisation to PDF.
 */

const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const W = 1000;

function niceMax(value: number): number {
  if (value <= 0) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const steps = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];
  for (const step of steps) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

type Series = { name: string; color: string };

export function GroupedBarChart({
  categories,
  series,
  values,
  height = 300,
  format = (n: number) => String(Math.round(n)),
  axisLabel,
}: {
  categories: string[];
  series: Series[];
  /** values[categoryIndex][seriesIndex]; null renders as an absent bar. */
  values: (number | null)[][];
  height?: number;
  format?: (n: number) => string;
  axisLabel?: string;
}) {
  const padLeft = 74;
  const padRight = 16;
  const padTop = 34;
  const padBottom = 46;
  const plotW = W - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const flat = values.flat().filter((v): v is number => v !== null);
  const max = niceMax(Math.max(1, ...flat));
  const y = (v: number) => padTop + plotH - (v / max) * plotH;
  const groupW = plotW / Math.max(categories.length, 1);
  const barW = Math.min(46, (groupW * 0.62) / Math.max(series.length, 1));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);

  return (
    <svg viewBox={`0 0 ${W} ${height}`} role="img" style={{ fontFamily: FONT }}>
      {axisLabel ? (
        <text x={0} y={14} fontSize={13} fill={TOKENS.muted}>
          {axisLabel}
        </text>
      ) : null}
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={padLeft}
            x2={W - padRight}
            y1={y(tick)}
            y2={y(tick)}
            stroke={tick === 0 ? TOKENS.axis : TOKENS.gridline}
            strokeWidth={tick === 0 ? 1.2 : 1}
          />
          <text x={padLeft - 10} y={y(tick) + 5} fontSize={13} fill={TOKENS.muted} textAnchor="end">
            {format(tick)}
          </text>
        </g>
      ))}
      {categories.map((category, ci) => {
        const groupStart = padLeft + ci * groupW;
        const clusterW = barW * series.length + 6 * (series.length - 1);
        const offset = groupStart + (groupW - clusterW) / 2;
        return (
          <g key={category}>
            {series.map((s, si) => {
              const value = values[ci]?.[si] ?? null;
              if (value === null) return null;
              const x = offset + si * (barW + 6);
              const barTop = y(Math.max(value, 0));
              return (
                <g key={s.name}>
                  <rect
                    x={x}
                    y={barTop}
                    width={barW}
                    height={Math.max(padTop + plotH - barTop, 1)}
                    fill={s.color}
                  />
                  <text
                    x={x + barW / 2}
                    y={barTop - 6}
                    fontSize={13}
                    fontWeight={700}
                    fill={TOKENS.navy}
                    textAnchor="middle"
                  >
                    {format(value)}
                  </text>
                </g>
              );
            })}
            <text
              x={groupStart + groupW / 2}
              y={padTop + plotH + 20}
              fontSize={13}
              fill={TOKENS.body}
              textAnchor="middle"
            >
              {category}
            </text>
          </g>
        );
      })}
      <g transform={`translate(${padLeft}, ${height - 8})`}>
        {series.map((s, i) => (
          <g key={s.name} transform={`translate(${i * 170}, 0)`}>
            <rect x={0} y={-10} width={12} height={12} fill={s.color} />
            <text x={18} y={0} fontSize={13} fill={TOKENS.body}>
              {s.name}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

export function RankedBarChart({
  data,
  height = 260,
  format = (n: number) => n.toFixed(1),
  average,
  averageLabel,
  color = TOKENS.blue,
  domainMax,
}: {
  data: { label: string; value: number | null }[];
  height?: number;
  format?: (n: number) => string;
  average?: number | null;
  averageLabel?: string;
  color?: string;
  domainMax?: number;
}) {
  const padLeft = 190;
  const padRight = 70;
  const padTop = 12;
  const padBottom = average != null ? 30 : 12;
  const plotW = W - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const rowH = plotH / Math.max(data.length, 1);
  const barH = Math.min(26, rowH * 0.6);
  const values = data.map((d) => d.value ?? 0);
  const max = domainMax ?? niceMax(Math.max(1, ...values));
  const x = (v: number) => padLeft + (v / max) * plotW;

  return (
    <svg viewBox={`0 0 ${W} ${height}`} role="img" style={{ fontFamily: FONT }}>
      <line x1={padLeft} x2={padLeft} y1={padTop} y2={padTop + plotH} stroke={TOKENS.axis} />
      {average != null ? (
        <g>
          <line
            x1={x(average)}
            x2={x(average)}
            y1={padTop}
            y2={padTop + plotH + 6}
            stroke={TOKENS.navy}
            strokeWidth={1.2}
            strokeDasharray="5 4"
          />
          <text
            x={x(average)}
            y={padTop + plotH + 22}
            fontSize={12}
            fill={TOKENS.navy}
            textAnchor="middle"
          >
            {averageLabel ?? `Average ${format(average)}`}
          </text>
        </g>
      ) : null}
      {data.map((row, i) => {
        const cy = padTop + i * rowH + rowH / 2;
        const value = row.value;
        return (
          <g key={row.label}>
            <text
              x={padLeft - 12}
              y={cy + 5}
              fontSize={13}
              fill={TOKENS.body}
              textAnchor="end"
            >
              {row.label}
            </text>
            {value === null ? (
              <text x={padLeft + 8} y={cy + 5} fontSize={13} fill={TOKENS.muted}>
                —
              </text>
            ) : (
              <>
                <rect x={padLeft} y={cy - barH / 2} width={Math.max(x(value) - padLeft, 1)} height={barH} fill={color} />
                <text
                  x={x(value) + 8}
                  y={cy + 5}
                  fontSize={13}
                  fontWeight={700}
                  fill={TOKENS.navy}
                >
                  {format(value)}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function BenchmarkBarChart({
  data,
  height = 300,
  format = (n: number) => `${n.toFixed(1)}%`,
}: {
  data: { label: string; value: number | null; benchmark: number | null }[];
  height?: number;
  format?: (n: number) => string;
}) {
  const padLeft = 74;
  const padRight = 16;
  const padTop = 26;
  const padBottom = 52;
  const plotW = W - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const all = data.flatMap((d) => [d.value, d.benchmark]).filter((v): v is number => v !== null);
  const max = niceMax(Math.max(1, ...all));
  const y = (v: number) => padTop + plotH - (v / max) * plotH;
  const slotW = plotW / Math.max(data.length, 1);
  const barW = Math.min(56, slotW * 0.42);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);

  return (
    <svg viewBox={`0 0 ${W} ${height}`} role="img" style={{ fontFamily: FONT }}>
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={padLeft}
            x2={W - padRight}
            y1={y(tick)}
            y2={y(tick)}
            stroke={tick === 0 ? TOKENS.axis : TOKENS.gridline}
          />
          <text x={padLeft - 10} y={y(tick) + 5} fontSize={13} fill={TOKENS.muted} textAnchor="end">
            {format(tick)}
          </text>
        </g>
      ))}
      {data.map((row, i) => {
        const cx = padLeft + i * slotW + slotW / 2;
        const barX = cx - barW / 2;
        // When the bar top sits within a label height of its benchmark line the two collide;
        // drop the bar's own label inside the bar instead.
        const inside =
          row.value !== null &&
          row.benchmark !== null &&
          Math.abs(y(row.value) - y(row.benchmark)) < 22;
        return (
          <g key={row.label}>
            {row.value !== null ? (
              <>
                <rect
                  x={barX}
                  y={y(row.value)}
                  width={barW}
                  height={Math.max(padTop + plotH - y(row.value), 1)}
                  fill={row.benchmark !== null ? TOKENS.cyan : TOKENS.blue}
                />
                <text
                  x={cx}
                  y={inside ? y(row.value) + 18 : y(row.value) - 7}
                  fontSize={13}
                  fontWeight={700}
                  fill={inside ? "#FFFFFF" : TOKENS.navy}
                  textAnchor="middle"
                >
                  {format(row.value)}
                </text>
              </>
            ) : null}
            {row.benchmark !== null ? (
              <>
                <line
                  x1={barX - 10}
                  x2={barX + barW + 10}
                  y1={y(row.benchmark)}
                  y2={y(row.benchmark)}
                  stroke={TOKENS.navy}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                />
                <text
                  x={barX + barW + 14}
                  y={y(row.benchmark) + 4}
                  fontSize={11}
                  fill={TOKENS.muted}
                >
                  {format(row.benchmark)}
                </text>
              </>
            ) : null}
            <text x={cx} y={padTop + plotH + 20} fontSize={13} fill={TOKENS.body} textAnchor="middle">
              {row.label}
            </text>
          </g>
        );
      })}
      <g transform={`translate(${padLeft}, ${height - 10})`}>
        <rect x={0} y={-10} width={12} height={12} fill={TOKENS.cyan} />
        <text x={18} y={0} fontSize={13} fill={TOKENS.body}>
          This period
        </text>
          This period
        </text>
        <line x1={170} x2={200} y1={-4} y2={-4} stroke={TOKENS.navy} strokeWidth={2} strokeDasharray="6 4" />
        <text x={208} y={0} fontSize={13} fill={TOKENS.body}>
          Industry benchmark (no benchmark published for unmarked roles)
        </text>
      </g>
    </svg>
  );
}

/** Participation split as a single stacked bar — a donut would need arc maths for no gain. */
export function StackedShareBar({
  segments,
  height = 110,
  total,
}: {
  segments: { label: string; value: number | null; color: string }[];
  height?: number;
  total: number | null;
}) {
  const padLeft = 0;
  const barY = 18;
  const barH = 40;
  const sum = total ?? segments.reduce((acc, s) => acc + (s.value ?? 0), 0);
  const usable = sum > 0 ? sum : 1;
  let cursor = padLeft;

  return (
    <svg viewBox={`0 0 ${W} ${height}`} role="img" style={{ fontFamily: FONT }}>
      {segments.map((segment) => {
        const value = segment.value ?? 0;
        const width = (value / usable) * W;
        const x = cursor;
        cursor += width;
        return (
          <g key={segment.label}>
            <rect x={x} y={barY} width={Math.max(width, 0)} height={barH} fill={segment.color} />
            {width > 60 ? (
              <text
                x={x + width / 2}
                y={barY + barH / 2 + 5}
                fontSize={14}
                fontWeight={700}
                fill="#fff"
                textAnchor="middle"
              >
                {Math.round(value)}
              </text>
            ) : null}
          </g>
        );
      })}
      <g transform={`translate(0, ${height - 8})`}>
        {segments.map((segment, i) => (
          <g key={segment.label} transform={`translate(${i * 260}, 0)`}>
            <rect x={0} y={-10} width={12} height={12} fill={segment.color} />
            <text x={18} y={0} fontSize={13} fill={TOKENS.body}>
              {segment.label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
