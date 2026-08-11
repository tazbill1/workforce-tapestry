/**
 * Page formats for the report.
 *
 * One template, four outputs. Everything that differs between formats lives here: page box,
 * how densely a page is packed, how many columns a long list runs in, and how tall a chart is
 * allowed to be. `wide` is an inch shorter than landscape letter, so its chart scale and
 * density are deliberately lower — a landscape-tuned page overflows there.
 */

export const REPORT_FORMATS = ["landscape", "portrait", "wide", "exec"] as const;

export type ReportFormat = (typeof REPORT_FORMATS)[number];

export type FormatSpec = {
  id: ReportFormat;
  label: string;
  /** Page box in inches. */
  width: number;
  height: number;
  margin: { x: number; top: number; bottom: number };
  /** Multiplier applied to every chart height declared in the template. */
  chartScale: number;
  /** Columns used by the long person lists. */
  listColumns: 1 | 2;
  /** Rows a long list shows per column before the overflow note appears. */
  listRowsPerColumn: number;
  /** Rows shown in the departures / anniversary tables. */
  tableRows: number;
  /** Compact paddings for the short formats. */
  dense: boolean;
};

export const FORMAT_SPECS: Record<ReportFormat, FormatSpec> = {
  landscape: {
    id: "landscape",
    label: "Landscape letter",
    width: 11,
    height: 8.5,
    margin: { x: 0.8, top: 0.8, bottom: 0.75 },
    chartScale: 1,
    listColumns: 2,
    listRowsPerColumn: 30,
    tableRows: 14,
    dense: false,
  },
  portrait: {
    id: "portrait",
    label: "Portrait letter",
    width: 8.5,
    height: 11,
    margin: { x: 0.8, top: 0.8, bottom: 0.75 },
    chartScale: 0.95,
    listColumns: 1,
    listRowsPerColumn: 42,
    tableRows: 20,
    dense: false,
  },
  wide: {
    id: "wide",
    label: "Wide 16:9",
    width: 13.333,
    height: 7.5,
    margin: { x: 0.8, top: 0.7, bottom: 0.6 },
    chartScale: 0.68,
    listColumns: 2,
    listRowsPerColumn: 26,
    tableRows: 11,
    dense: true,
  },
  exec: {
    id: "exec",
    label: "Executive cut (16:9)",
    width: 13.333,
    height: 7.5,
    margin: { x: 0.8, top: 0.7, bottom: 0.6 },
    chartScale: 0.68,
    listColumns: 2,
    listRowsPerColumn: 26,
    tableRows: 11,
    dense: true,
  },
};

export const contentWidth = (spec: FormatSpec) => spec.width - spec.margin.x * 2;

/** CSS custom properties that drive the page box for a format. */
export function formatVariables(spec: FormatSpec): Record<string, string> {
  return {
    "--rp-page-w": `${spec.width}in`,
    "--rp-page-h": `${spec.height}in`,
    "--rp-margin-x": `${spec.margin.x}in`,
    "--rp-margin-top": `${spec.margin.top}in`,
    "--rp-margin-bottom": `${spec.margin.bottom}in`,
    "--rp-content-w": `${contentWidth(spec)}in`,
  };
}

/** The `@page` rule for a format; injected per render because `@page` cannot be scoped. */
export function pageRule(spec: FormatSpec): string {
  return `@page { size: ${spec.width}in ${spec.height}in; margin: ${spec.margin.top}in ${spec.margin.x}in ${spec.margin.bottom}in; }`;
}

/**
 * Section order the template can render. The set of sections actually rendered for a format is
 * stored configuration (`report_format_sections`), never a hardcoded filter.
 */
export const ALL_SECTION_IDS = [
  "cover",
  "summary",
  "headcount",
  "turnover",
  "benchmark",
  "departures",
  "tenure",
  "participation",
  "mood",
  "watchlist",
  "lowmood",
  "recognition",
  "people",
  "action",
  "method",
] as const;
