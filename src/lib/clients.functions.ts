import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Supabase caps listUsers at one page, so walk every page before deciding a user is missing. */
async function listAllUsers(admin: {
  auth: { admin: { listUsers: (p: { page: number; perPage: number }) => Promise<any> } };
}) {
  const all: Array<{ id: string; email?: string | null }> = [];
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    const batch = data?.users ?? [];
    all.push(...batch);
    if (batch.length < 1000) break;
  }
  return all;
}

async function assertAnalyst(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("is_analyst", { _user_id: context.userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Analyst role required");
}

export const listClientsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAnalyst } = await context.supabase.rpc("is_analyst", {
      _user_id: context.userId,
    });
    const { data: clients, error } = await context.supabase
      .from("clients")
      .select("id, name, code, active, created_at, logo_url")
      .order("name");
    if (error) throw new Error(error.message);

    const { data: grants, error: grantError } = await context.supabase
      .from("user_clients")
      .select("id, user_id, client_id, granted_at");
    if (grantError) throw new Error(grantError.message);

    let emails: Record<string, string> = {};
    if (isAnalyst) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const users = await listAllUsers(supabaseAdmin);
      emails = Object.fromEntries(users.map((u) => [u.id, u.email ?? u.id]));
    }

    return {
      isAnalyst: Boolean(isAnalyst),
      clients: clients ?? [],
      grants: (grants ?? []).map((g) => ({ ...g, email: emails[g.user_id] ?? g.user_id })),
      users: Object.entries(emails).map(([id, email]) => ({ id, email })),
    };
  });

export const createClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string; code: string }) =>
    z
      .object({
        name: z.string().trim().min(1).max(120),
        code: z
          .string()
          .trim()
          .min(2)
          .max(40)
          .regex(/^[A-Za-z0-9_-]+$/, "Code may contain letters, numbers, _ and - only"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAnalyst(context);
    const { data: row, error } = await context.supabase
      .from("clients")
      .insert({ name: data.name, code: data.code.toUpperCase(), active: true })
      .select("id, name, code, active")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const setClientActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; active: boolean }) =>
    z.object({ clientId: z.string().uuid(), active: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAnalyst(context);
    const { error } = await context.supabase
      .from("clients")
      .update({ active: data.active })
      .eq("id", data.clientId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const grantClientAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; email: string }) =>
    z.object({ clientId: z.string().uuid(), email: z.string().trim().email() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAnalyst(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.toLowerCase();
    const users = await listAllUsers(supabaseAdmin);
    let targetId = users.find((u) => (u.email ?? "").toLowerCase() === email)?.id;

    // Pre-provision the account so access can be granted before their first sign-in.
    if (!targetId) {
      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
      });
      if (createError || !created?.user) {
        throw new Error(
          createError?.message ?? `Could not create an account for ${data.email}.`,
        );
      }
      targetId = created.user.id;
    }

    const { error } = await context.supabase
      .from("user_clients")
      .insert({ user_id: targetId, client_id: data.clientId });
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    return { ok: true };
  });

export const revokeClientAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { grantId: string }) =>
    z.object({ grantId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAnalyst(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("user_clients").delete().eq("id", data.grantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Store a client's logo. The browser has already scaled the image to report size, so what
 * arrives here is a small PNG data URL that we validate and persist on the client row.
 */
export const setClientLogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; logoUrl: string | null }) =>
    z
      .object({
        clientId: z.string().uuid(),
        logoUrl: z
          .string()
          .max(1_400_000)
          .regex(/^data:image\/(png|jpeg|webp);base64,/, "Logo must be an image")
          .nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAnalyst(context);
    const { error } = await context.supabase
      .from("clients")
      .update({ logo_url: data.logoUrl })
      .eq("id", data.clientId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
