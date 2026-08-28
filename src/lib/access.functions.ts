import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const ALLOWED_EMAIL_DOMAIN = "werkandme.com";

/**
 * Gates the app to a single company domain and provisions the default role
 * for new company members on first sign-in.
 */
export const ensureDomainAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const claims = context.claims as { email?: string } | null;
    const email = (claims?.email ?? "").toLowerCase().trim();
    const allowed = email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);

    if (!allowed) {
      return { allowed: false as const, email, domain: ALLOWED_EMAIL_DOMAIN };
    }

    const { data: existing, error } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);

    if (!existing || existing.length === 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: insertError } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: context.userId, role: "analyst" });
      if (insertError && !insertError.message.includes("duplicate")) {
        throw new Error(insertError.message);
      }
      return { allowed: true as const, email, provisioned: true, role: "analyst" as const };
    }

    return {
      allowed: true as const,
      email,
      provisioned: false,
      role: existing[0]!.role,
    };
  });
