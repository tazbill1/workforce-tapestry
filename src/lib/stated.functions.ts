import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractStatedFigures } from "./stated-figures";

const byImport = z.object({ importId: z.string().uuid() });

async function loadFigures(
  supabase: { from: (table: string) => any },
  importId: string,
) {
  const meta = await supabase
    .from("raw_imports")
    .select("id, client_id, period, original_filename, kind")
    .eq("id", importId)
    .maybeSingle();
  if (meta.error) throw new Error(meta.error.message);
  if (!meta.data) throw new Error("That import no longer exists.");

  const rows = await supabase
    .from("raw_records")
    .select("payload")
    .eq("import_id", importId)
    .order("row_number")
    .limit(200);
  if (rows.error) throw new Error(rows.error.message);

  const figures = extractStatedFigures(
    (rows.data ?? []).map((row: { payload: Record<string, unknown> }) => row.payload),
  );
  return { meta: meta.data, figures };
}

/** Show what headline numbers a summary-style file states, before saving anything. */
export const previewStatedFigures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { importId: string }) => byImport.parse(input))
  .handler(async ({ data, context }) => {
    const { meta, figures } = await loadFigures(context.supabase, data.importId);
    return {
      period: meta.period as string,
      filename: (meta.original_filename as string | null) ?? "this file",
      figures,
    };
  });

/** Store the stated numbers as figures with provenance. Never mixed into computed metrics. */
export const saveStatedFigures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { importId: string }) => byImport.parse(input))
  .handler(async ({ data, context }) => {
    const { meta, figures } = await loadFigures(context.supabase, data.importId);
    if (figures.length === 0) {
      return { ok: false as const, saved: 0, message: "No headline numbers were recognised in that file." };
    }

    const note = `Stated on ${meta.original_filename ?? "an uploaded summary sheet"}`;
    let saved = 0;
    for (const figure of figures) {
      const existing = await context.supabase
        .from("historical_baselines")
        .select("id")
        .eq("client_id", meta.client_id)
        .eq("period", meta.period)
        .eq("metric_key", figure.metric_key)
        .maybeSingle();
      if (existing.error) throw new Error(existing.error.message);

      const row = {
        client_id: meta.client_id,
        period: meta.period,
        metric_key: figure.metric_key,
        label: figure.label,
        value_numeric: figure.value,
        unit: figure.unit,
        source: "summary_sheet",
        source_note: `${note} — "${figure.raw_label}"`,
        entered_by: context.userId,
      };

      const result = existing.data
        ? await context.supabase.from("historical_baselines").update(row).eq("id", existing.data.id)
        : await context.supabase.from("historical_baselines").insert(row);
      if (result.error) throw new Error(result.error.message);
      saved += 1;
    }

    return {
      ok: true as const,
      saved,
      message: `Saved ${saved} stated figure${saved === 1 ? "" : "s"} for ${meta.period}. They show on the Metrics screen under "As published", next to what the tool works out.`,
    };
  });
