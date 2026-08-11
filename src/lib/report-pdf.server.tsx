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

  const headers: Record<string, string> = {};
  const token = process.env["GOTENBERG_TOKEN"];
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
    headers["Gotenberg-Api-Key"] = token;
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
  storagePath: string;
  byteSize: number;
  pageCount: number | null;
  metricsLinked: number;
};

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

  const { data: run, error: runError } = await supabase
    .from("report_runs")
    .insert({
      client_id: clientId,
      period,
      format,
      storage_path: storagePath,
      created_by: userId,
      byte_size: pdf.byteLength,
      page_count: pageCount,
    })
    .select("id")
    .single();
  if (runError) throw new Error(runError.message);

  // Provenance: every published metric row the run read is linked to it, so any figure in a
  // delivered PDF traces back to the definition version that produced it.
  const metricIds = data.metrics
    .filter((row) => row.period === period && row.id)
    .map((row) => row.id as string);

  let metricsLinked = 0;
  for (let i = 0; i < metricIds.length; i += 500) {
    const chunk = metricIds.slice(i, i + 500).map((id) => ({
      report_run_id: run.id,
      published_metric_id: id,
    }));
    const { error } = await supabase.from("report_run_metrics").insert(chunk);
    if (error) throw new Error(error.message);
    metricsLinked += chunk.length;
  }

  return {
    runId: run.id,
    storagePath,
    byteSize: pdf.byteLength,
    pageCount,
    metricsLinked,
  };
}
