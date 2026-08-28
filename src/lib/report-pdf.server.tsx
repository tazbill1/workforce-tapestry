/**
 * PDF rendering for the report.
 *
 * The template is CSS paged media, so the renderer has to be a real browser engine: only
 * Chromium honours `@page`, running headers, page counters and `break-inside: avoid`. We run a
 * self-hosted Gotenberg (headless Chromium) so the rendered page — which carries names, email
 * addresses and individual mood scores — never leaves infrastructure we control, and nothing is
 * retained by a third party.
 *
 * Server-only: this module is never reachable from the client bundle.
 */

import { renderToStaticMarkup } from "react-dom/server.browser";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ReportDocument } from "@/components/report/ReportDocument";
import reportCss from "@/styles/report.css?raw";
import type { Database } from "@/integrations/supabase/types";
import { buildReport, type ReportData } from "./report-load";
import { FORMAT_SPECS, pageRule, type ReportFormat } from "./report-formats";

type Client = SupabaseClient<Database>;

export const REPORTS_BUCKET = "reports";

/** Section cut for a format: per-client configuration first, then the stored default. */
export async function loadFormatSections(
  supabase: Client,
  clientId: string,
  format: ReportFormat,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("report_format_sections")
    .select("client_id, section_id, position")
    .eq("format", format)
    .or(`client_id.eq.${clientId},client_id.is.null`)
    .order("position");
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const scoped = rows.filter((row) => row.client_id === clientId);
  const use = scoped.length > 0 ? scoped : rows;
  return use
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((row) => row.section_id);
}

export function renderReportHtml(
  data: ReportData,
  format: ReportFormat,
  sections: string[],
): string {
  const spec = FORMAT_SPECS[format];
  const body = renderToStaticMarkup(
    <ReportDocument data={data} format={format} sections={sections} />,
  );
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8" />',
    `<title>${escapeHtml(data.client.name)} — ${data.period} — ${spec.label}</title>`,
    `<style>${reportCss}</style>`,
    `<style>${pageRule(spec)}
      html, body { margin: 0; padding: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .rp-page { box-shadow: none !important; border: 0 !important; }
    </style>`,
    "</head><body>",
    body,
    "</body></html>",
  ].join("");
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char,
  );
}

/** Best-effort page count read from the PDF object graph; purely informational. */
function countPages(bytes: Uint8Array): number | null {
  const text = new TextDecoder("latin1").decode(bytes);
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : null;
}

async function renderPdfWithGotenberg(html: string, format: ReportFormat): Promise<Uint8Array> {
  const base = process.env["GOTENBERG_URL"];
  if (!base) {
    throw new Error(
      "PDF rendering is not configured: GOTENBERG_URL is missing. Point it at the Chromium render service.",
    );
  }
  const spec = FORMAT_SPECS[format];

  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  // The template declares its own page box; preferCssPageSize keeps Chromium from overriding it.
  form.append("preferCssPageSize", "true");
  form.append("printBackground", "true");
  form.append("paperWidth", String(spec.width));
  form.append("paperHeight", String(spec.height));
  form.append("marginTop", "0");
  form.append("marginBottom", "0");
  form.append("marginLeft", "0");
  form.append("marginRight", "0");
  form.append("emulatedMediaType", "print");

  // Cloud Run runs the renderer with Gotenberg's built-in basic auth enabled, so every request
  // carries credentials. They live in backend secrets only and never reach the client bundle.
  const headers: Record<string, string> = {};
  const user = process.env["GOTENBERG_USERNAME"];
  const pass = process.env["GOTENBERG_PASSWORD"];
  if (user && pass) {
    headers["Authorization"] = `Basic ${btoa(`${user}:${pass}`)}`;
  }


  const response = await fetch(`${base.replace(/\/$/, "")}/forms/chromium/convert/html`, {
    method: "POST",
    headers,
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Render service returned ${response.status}: ${detail.slice(0, 400)}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export type GenerateResult = {
  runId: string;
  version: number;
  storagePath: string | null;
  byteSize: number;
  pageCount: number | null;
  metricsLinked: number;
};

/**
 * Next version number for a client/period. Versions are per period, not per format, so a
 * restatement is a single numbered revision of the period regardless of which cuts were rendered.
 */
async function nextVersion(supabase: Client, clientId: string, period: string): Promise<number> {
  const { data, error } = await supabase
    .from("report_runs")
    .select("version")
    .eq("client_id", clientId)
    .eq("period", period)
    .order("version", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0]?.version ?? 0) + 1;
}

/** Link every published metric row the run read, so any delivered figure traces back. */
async function linkMetrics(
  supabase: Client,
  runId: string,
  data: ReportData,
  period: string,
): Promise<number> {
  const metricIds = data.metrics
    .filter((row) => row.period === period && row.id)
    .map((row) => row.id as string);

  let metricsLinked = 0;
  for (let i = 0; i < metricIds.length; i += 500) {
    const chunk = metricIds.slice(i, i + 500).map((id) => ({
      report_run_id: runId,
      published_metric_id: id,
    }));
    const { error } = await supabase.from("report_run_metrics").insert(chunk);
    if (error) throw new Error(error.message);
    metricsLinked += chunk.length;
  }
  return metricsLinked;
}

/**
 * Inserts a run row, retrying once on the version unique index in case a concurrent generate
 * claimed the same number.
 */
async function insertRun(
  supabase: Client,
  row: {
    client_id: string;
    period: string;
    format: ReportFormat;
    storage_path: string | null;
    created_by: string;
    byte_size: number | null;
    page_count: number | null;
    sections: string[];
    snapshot: unknown;
    note: string | null;
  },
): Promise<{ id: string; version: number }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const version = await nextVersion(supabase, row.client_id, row.period);
    const { data, error } = await supabase
      .from("report_runs")
      // snapshot is jsonb; the generated type is Json and ReportData is plain serializable data.
      .insert({ ...row, version, snapshot: row.snapshot as never })
      .select("id, version")
      .single();
    if (!error && data) return { id: data.id, version: data.version };
    if (error && !error.message.includes("report_runs_client_period_version_key")) {
      throw new Error(error.message);
    }
  }
  throw new Error("Could not claim a report version number, please retry");
}

export async function generateReportRun(
  supabase: Client,
  input: { clientId: string; period: string; format: ReportFormat; userId: string },
): Promise<GenerateResult> {
  const { clientId, period, format, userId } = input;

  const [data, sections] = await Promise.all([
    buildReport(supabase, clientId, period),
    loadFormatSections(supabase, clientId, format),
  ]);

  const html = renderReportHtml(data, format, sections);
  const pdf = await renderPdfWithGotenberg(html, format);

  // Timestamped path: a delivered report is never overwritten, so a restated period keeps both
  // versions downloadable exactly as sent.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const storagePath = `${clientId}/${period}/${format}-${stamp}.pdf`;

  const upload = await supabase.storage
    .from(REPORTS_BUCKET)
    .upload(storagePath, pdf, { contentType: "application/pdf", upsert: false });
  if (upload.error) throw new Error(upload.error.message);

  const pageCount = countPages(pdf);

  // The snapshot freezes the exact numbers and people the PDF was rendered from, so an older
  // version stays viewable even after the period is reassembled or metrics are recomputed.
  const run = await insertRun(supabase, {
    client_id: clientId,
    period,
    format,
    storage_path: storagePath,
    created_by: userId,
    byte_size: pdf.byteLength,
    page_count: pageCount,
    sections,
    snapshot: data,
    note: null,
  });

  const metricsLinked = await linkMetrics(supabase, run.id, data, period);

  return {
    runId: run.id,
    version: run.version,
    storagePath,
    byteSize: pdf.byteLength,
    pageCount,
    metricsLinked,
  };
}

/**
 * Records a version without a PDF. Used by the browser print-to-PDF path so the delivered numbers
 * are still snapshotted and retained even when the server renderer is not configured.
 */
export async function snapshotReportRun(
  supabase: Client,
  input: { clientId: string; period: string; format: ReportFormat; userId: string; note?: string },
): Promise<GenerateResult> {
  const { clientId, period, format, userId } = input;

  const [data, sections] = await Promise.all([
    buildReport(supabase, clientId, period),
    loadFormatSections(supabase, clientId, format),
  ]);

  const run = await insertRun(supabase, {
    client_id: clientId,
    period,
    format,
    storage_path: null,
    created_by: userId,
    byte_size: null,
    page_count: null,
    sections,
    snapshot: data,
    note: input.note ?? "Snapshot only (printed from the browser)",
  });

  const metricsLinked = await linkMetrics(supabase, run.id, data, period);

  return {
    runId: run.id,
    version: run.version,
    storagePath: null,
    byteSize: 0,
    pageCount: null,
    metricsLinked,
  };
}

