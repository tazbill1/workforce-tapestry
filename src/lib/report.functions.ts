import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildReport } from "./report-load";

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
