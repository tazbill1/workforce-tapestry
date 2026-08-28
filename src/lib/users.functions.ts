import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ConsoleUser = {
  id: string;
  email: string;
  roles: string[];
  createdAt: string | null;
  lastSignInAt: string | null;
  provider: string | null;
};

/** Supabase caps listUsers at one page, so walk every page. */
async function listAllUsers(admin: any) {
  const all: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const batch = data?.users ?? [];
    all.push(...batch);
    if (batch.length < 1000) break;
  }
  return all;
}

export const listConsoleUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ isAnalyst: boolean; currentUserId: string; users: ConsoleUser[] }> => {
    const { data: isAnalyst } = await context.supabase.rpc("is_analyst", {
      _user_id: context.userId,
    });
    if (!isAnalyst) return { isAnalyst: false, currentUserId: context.userId, users: [] };

    const { data: roleRows, error: roleError } = await context.supabase
      .from("user_roles")
      .select("user_id, role");
    if (roleError) throw new Error(roleError.message);

    const rolesByUser = new Map<string, string[]>();
    for (const row of roleRows ?? []) {
      rolesByUser.set(row.user_id, [...(rolesByUser.get(row.user_id) ?? []), row.role]);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const users = await listAllUsers(supabaseAdmin);

    const mapped: ConsoleUser[] = users.map((u) => ({
      id: u.id,
      email: u.email ?? u.id,
      roles: rolesByUser.get(u.id) ?? [],
      createdAt: u.created_at ?? null,
      lastSignInAt: u.last_sign_in_at ?? null,
      provider: u.app_metadata?.provider ?? null,
    }));

    mapped.sort((a, b) => {
      const at = a.lastSignInAt ? Date.parse(a.lastSignInAt) : 0;
      const bt = b.lastSignInAt ? Date.parse(b.lastSignInAt) : 0;
      if (bt !== at) return bt - at;
      return a.email.localeCompare(b.email);
    });

    return { isAnalyst: true, currentUserId: context.userId, users: mapped };
  });

const ROLES = ["analyst", "coach", "viewer"] as const;
type Role = (typeof ROLES)[number];

async function assertAnalyst(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("is_analyst", { _user_id: context.userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Analyst role required");
}

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; role: string | null }) => {
    if (typeof input?.userId !== "string" || !input.userId) throw new Error("userId required");
    if (input.role !== null && !ROLES.includes(input.role as Role)) throw new Error("Invalid role");
    return input as { userId: string; role: Role | null };
  })
  .handler(async ({ data, context }) => {
    await assertAnalyst(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Never let the last analyst demote themselves out of the console.
    if (data.role !== "analyst") {
      const { data: analysts, error } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .eq("role", "analyst");
      if (error) throw new Error(error.message);
      const ids = (analysts ?? []).map((r: { user_id: string }) => r.user_id);
      if (ids.length <= 1 && ids.includes(data.userId)) {
        throw new Error("This is the last analyst — promote someone else first.");
      }
    }

    const { error: delError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId);
    if (delError) throw new Error(delError.message);

    if (data.role) {
      const { error: insError } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: data.userId, role: data.role });
      if (insError) throw new Error(insError.message);
    }

    return { ok: true };
  });

export const deleteConsoleUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    if (typeof input?.userId !== "string" || !input.userId) throw new Error("userId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAnalyst(context);
    if (data.userId === context.userId) throw new Error("You cannot remove your own account.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: analysts, error } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "analyst");
    if (error) throw new Error(error.message);
    const ids = (analysts ?? []).map((r: { user_id: string }) => r.user_id);
    if (ids.length <= 1 && ids.includes(data.userId)) {
      throw new Error("This is the last analyst — promote someone else first.");
    }

    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    const { error: delError } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (delError) throw new Error(delError.message);

    return { ok: true };
  });
