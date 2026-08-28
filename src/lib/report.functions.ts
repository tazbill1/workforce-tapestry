import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildReport } from "./report-load";
import { REPORT_FORMATS } from "./report-formats";

export const isRendererConfigured = createServerFn({ method: "GET" }).handler(
  () => Boolean(process.env["GOTENBERG_URL"]),
);

/** Advisory pre-flight: warns when a report looks like the wrong client or the wrong month. */
export const checkReport = createServerFn({ method: "POST" })
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
    const { runReportChecks } = await import("./report-checks");
    return runReportChecks(context.supabase, data.clientId, data.period);
  });




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

/**
 * Shareable links. The token is only a lookup key — access is still decided by RLS,
 * so a link opened by someone without access to that client resolves to nothing.
 */
export const listReportShares = createServerFn({ method: "POST" })
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
    const { data: runs, error: runsError } = await context.supabase
      .from("report_runs")
      .select("id")
      .eq("client_id", data.clientId)
      .eq("period", data.period);
    if (runsError) throw new Error(runsError.message);
    const runIds = (runs ?? []).map((run) => run.id);
    if (runIds.length === 0) return [];

    const { data: shares, error } = await context.supabase
      .from("report_shares")
      .select("id, report_run_id, token, label, expires_at, revoked_at, created_at")
      .in("report_run_id", runIds)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return shares ?? [];
  });

export const createReportShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { runId: string; expiresInDays?: number; label?: string }) =>
    z
      .object({
        runId: z.string().uuid(),
        expiresInDays: z.number().int().min(1).max(365).optional(),
        label: z.string().max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: run, error: runError } = await context.supabase
      .from("report_runs")
      .select("id, client_id, version, format")
      .eq("id", data.runId)
      .maybeSingle();
    if (runError) throw new Error(runError.message);
    if (!run) throw new Error("Report version not found");

    // Reuse a live link for the same version rather than minting duplicates.
    const { data: existing } = await context.supabase
      .from("report_shares")
      .select("id, token, expires_at")
      .eq("report_run_id", run.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const live = (existing ?? []).find(
      (share) => !share.expires_at || new Date(share.expires_at) > new Date(),
    );
    if (live) return { token: live.token, id: live.id, reused: true };

    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

    const expiresAt = data.expiresInDays
      ? new Date(Date.now() + data.expiresInDays * 86_400_000).toISOString()
      : null;

    const { data: inserted, error } = await context.supabase
      .from("report_shares")
      .insert({
        report_run_id: run.id,
        client_id: run.client_id,
        token,
        label: data.label ?? null,
        expires_at: expiresAt,
        created_by: context.userId,
      })
      .select("id, token")
      .single();
    if (error) throw new Error(error.message);
    return { token: inserted.token, id: inserted.id, reused: false };
  });

export const revokeReportShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { shareId: string }) =>
    z.object({ shareId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("report_shares")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.shareId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Resolves a share token to its frozen snapshot; RLS keeps it scoped to the client. */
export const getSharedReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { token: string }) =>
    z.object({ token: z.string().min(16).max(128) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: share, error } = await context.supabase
      .from("report_shares")
      .select("id, report_run_id, expires_at, revoked_at, label")
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!share) throw new Error("This link is not valid for your account");
    if (share.revoked_at) throw new Error("This link has been revoked");
    if (share.expires_at && new Date(share.expires_at) <= new Date()) {
      throw new Error("This link has expired");
    }

    const { data: run, error: runError } = await context.supabase
      .from("report_runs")
      .select("id, client_id, period, version, format, sections, snapshot, created_at")
      .eq("id", share.report_run_id)
      .maybeSingle();
    if (runError) throw new Error(runError.message);
    if (!run?.snapshot) throw new Error("This report version is no longer available");

    const { data: client } = await context.supabase
      .from("clients")
      .select("name")
      .eq("id", run.client_id)
      .maybeSingle();

    return { run, clientName: client?.name ?? "Client", label: share.label };
  });
