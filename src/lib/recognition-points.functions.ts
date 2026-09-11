import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const pointRow = z.object({
  row_number: z.number().int().positive(),
  manager_name: z.string().min(1).max(300),
  manager_title: z.string().max(300).nullable(),
  department_raw: z.string().max(300).nullable(),
  points_allocated: z.number().int().min(0).nullable(),
  points_given: z.number().int().min(0).nullable(),
  parse_flags: z.array(z.string().max(120)),
});

export const insertRecognitionPoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      importId: z.string().uuid(),
      clientId: z.string().uuid(),
      period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      rows: z.array(pointRow).max(500),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const payload = data.rows.map((row) => ({
      import_id: data.importId,
      client_id: data.clientId,
      period: data.period,
      ...row,
    }));
    const { error } = await context.supabase.from("recognition_points").insert(payload);
    if (error) throw new Error(error.message);
    return { inserted: payload.length };
  });