import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * One-click backup of everything the console holds for a single client.
 * Returns plain JSON the browser saves to a file — no storage writes.
 */
export const exportClientData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string }) => {
    if (typeof input?.clientId !== "string" || !input.clientId) throw new Error("clientId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { clientId } = data;

    const { data: client, error } = await supabase
      .from("clients")
      .select("*")
      .eq("id", clientId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!client) throw new Error("Client not found");

    const tables = [
      "raw_imports",
      "person_period",
      "published_metrics",
      "report_runs",
      "exclusions",
      "record_merges",
      "record_splits",
      "role_mappings",
      "department_rules",
      "name_links",
      "engagement_totals",
      "recognition_counts",
      "recognition_activity",
      "historical_baselines",
      "action_plan_items",
      "period_notes",
      "saved_insights",
      "period_readiness",
    ] as const;

    const sections: Record<string, any[]> = {};
    for (const table of tables) {
      const { data: rows, error: tableError } = await (supabase as any)
        .from(table)
        .select("*")
        .eq("client_id", clientId);
      if (tableError) throw new Error(`${table}: ${tableError.message}`);
      sections[table] = rows ?? [];
    }

    return {
      exportedAt: new Date().toISOString(),
      client,
      counts: Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.length])),
      data: sections,
    };
  });
