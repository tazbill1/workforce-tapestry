import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildReport } from "./report-load";
import { REPORT_FORMATS } from "./report-formats";

export const isRendererConfigured = createServerFn({ method: "GET" }).handler(
  () => Boolean(process.env["GOTENBERG_URL"]),
);


export const getReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; period: string }) =>
    z
      .object({
        clientId: z.string().uuid(),
        period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    buildReport(context.supabase, data.clientId, data.period),
  );

export const listReportRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; period: string }) =>
    z
      .object({
        clientId: z.string().uuid(),
        period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: runs, error } = await context.supabase
      .from("report_runs")
      .select(
        "id, version, format, storage_path, created_at, created_by, byte_size, page_count, note",
      )
      .eq("client_id", data.clientId)
      .eq("period", data.period)
      .order("version", { ascending: false });
    if (error) throw new Error(error.message);
    return runs ?? [];
  });

/** Frozen copy of a prior version: the numbers exactly as they were when that report went out. */
export const getReportVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { runId: string }) =>
    z.object({ runId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: run, error } = await context.supabase
      .from("report_runs")
      .select("id, version, format, sections, snapshot, created_at, note, storage_path")
      .eq("id", data.runId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!run) throw new Error("Report version not found");
    if (!run.snapshot) throw new Error("This version predates snapshots and cannot be reopened");
    return run;
  });

export const snapshotReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; period: string; format: string }) =>
    z
      .object({
        clientId: z.string().uuid(),
        period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        format: z.enum(REPORT_FORMATS),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { snapshotReportRun } = await import("./report-pdf.server");
    return snapshotReportRun(context.supabase, {
      clientId: data.clientId,
      period: data.period,
      format: data.format,
      userId: context.userId,
    });
  });


export const getFormatSections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string }) =>
    z.object({ clientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { loadFormatSections } = await import("./report-pdf.server");
    const entries = await Promise.all(
      REPORT_FORMATS.map(async (format) => [
        format,
        await loadFormatSections(context.supabase, data.clientId, format),
      ]),
    );
    return Object.fromEntries(entries) as Record<string, string[]>;
  });

export const generateReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; period: string; format: string }) =>
    z
      .object({
        clientId: z.string().uuid(),
        period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        format: z.enum(REPORT_FORMATS),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { generateReportRun } = await import("./report-pdf.server");
    return generateReportRun(context.supabase, {
      clientId: data.clientId,
      period: data.period,
      format: data.format,
      userId: context.userId,
    });
  });

/** Downloads are short-lived signed URLs against a private bucket; never public links. */
export const getReportDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { runId: string }) =>
    z.object({ runId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: run, error } = await context.supabase
      .from("report_runs")
      .select("id, storage_path")
      .eq("id", data.runId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!run?.storage_path) throw new Error("Report run not found");

    const signed = await context.supabase.storage
      .from("reports")
      .createSignedUrl(run.storage_path, 120);
    if (signed.error) throw new Error(signed.error.message);
    return { url: signed.data.signedUrl, expiresInSeconds: 120 };
  });
