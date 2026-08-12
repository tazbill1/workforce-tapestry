import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { buildPersonPeriod, summarize } from "./assembly-core";
import { withClockSkewRetry } from "./clock-skew";
import { loadAssemblyInputs, listPartImports, persistPersonPeriod } from "./assembly-load";

const scope = z.object({
  clientId: z.string().uuid(),
  period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const listAssemblyPeriods = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string }) =>
    z.object({ clientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) =>
    withClockSkewRetry(async () => {
    const { data: rows, error } = await context.supabase
      .from("raw_imports")
      .select("period, kind, state, superseded_by")
      .eq("client_id", data.clientId)
      .eq("state", "parsed")
      .is("superseded_by", null)
      .order("period", { ascending: false });
    if (error) throw new Error(error.message);
    return [...new Set((rows ?? []).map((row) => row.period))];
    }),
  );

export const rebuildPersonPeriod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; period: string }) => scope.parse(input))
  .handler(async ({ data, context }) => {
    const { input, parts } = await loadAssemblyInputs(
      context.supabase,
      data.clientId,
      data.period,
    );
    if (parts.length === 0) {
      throw new Error("No parsed, non-superseded roster import exists for that client and period.");
    }
    const built = buildPersonPeriod(input);
    const inserted = await persistPersonPeriod(
      context.supabase,
      data.clientId,
      data.period,
      built.rows,
    );
    return {
      inserted,
      skippedNoEmail: built.skippedNoEmail,
      overlaps: built.overlaps.map((overlap) => ({
        normalized_email: overlap.normalized_email,
        parts: overlap.import_ids.map(
          (id) =>
            parts.find((part) => part.id === id)?.part_label ??
            parts.find((part) => part.id === id)?.original_filename ??
            id,
        ),
      })),
      parts: parts.map((part) => ({
        id: part.id,
        label: part.part_label ?? part.original_filename,
        rowCount: part.row_count,
      })),
      summary: summarize(built.rows),
    };
  });

export const getPersonPeriodSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; period: string }) => scope.parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("person_period")
      .select(
        "normalized_email, name, title_raw, department_raw, role_code, status, is_excluded, exclusion_reason, checked_in, checkin_count, mood_avg, departure_date_proxy, last_login_at, merged_from, flags, built_at",
      )
      .eq("client_id", data.clientId)
      .eq("period", data.period)
      .order("normalized_email")
      .limit(20000);
    if (error) throw new Error(error.message);

    const parts = await listPartImports(context.supabase, data.clientId, data.period, "roster");
    const all = (rows ?? []) as Array<{
      is_excluded: boolean;
      exclusion_reason: string | null;
      role_code: string | null;
      checked_in: boolean | null;
      flags: string[];
      built_at: string;
    }>;
    return {
      summary: summarize(
        all as unknown as Parameters<typeof summarize>[0],
      ),
      parts: parts.map((part) => ({
        id: part.id,
        label: part.part_label ?? part.original_filename,
        rowCount: part.row_count,
      })),
      rows: (rows ?? []).slice(0, 500),
    };
  });
