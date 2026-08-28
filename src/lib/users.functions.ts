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
  .handler(async ({ context }): Promise<{ isAnalyst: boolean; users: ConsoleUser[] }> => {
    const { data: isAnalyst } = await context.supabase.rpc("is_analyst", {
      _user_id: context.userId,
    });
    if (!isAnalyst) return { isAnalyst: false, users: [] };

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

    return { isAnalyst: true, users: mapped };
  });
