import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { withClockSkewRetry } from "./clock-skew";
import { normalizeName } from "./engagement-parse";

/**
 * Per-person recognition engagement.
 *
 * The import stores whatever the export said, keyed by name. Names are matched to roster
 * people at read time — never frozen into the stored row — so confirming a name link in the
 * decisions review immediately re-resolves every period without rewriting import history.
 */

const rowSchema = z.object({
  row_number: z.number().int(),
  name_raw: z.string().min(1).max(300),
  normalized_name: z.string().min(1).max(300),
  posts: z.number().int().min(0),
  comments: z.number().int().min(0),
  likes: z.number().int().min(0),
});

export const insertRecognitionActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        importId: z.string().uuid(),
        clientId: z.string().uuid(),
        period: z.string(),
        windowFrom: z.string().nullable().optional(),
        windowTo: z.string().nullable().optional(),
        rows: z.array(rowSchema).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const payload = data.rows.map((row) => ({
      import_id: data.importId,
      client_id: data.clientId,
      period: data.period,
      row_number: row.row_number,
      name_raw: row.name_raw,
      normalized_name: row.normalized_name,
      posts: row.posts,
      comments: row.comments,
      likes: row.likes,
      window_from: data.windowFrom ?? null,
      window_to: data.windowTo ?? null,
    }));
    const { error } = await context.supabase.from("recognition_activity").insert(payload);
    if (error) throw new Error(error.message);
    return { inserted: payload.length };
  });

type Person = { email: string; name: string | null; excluded: boolean };

/** Token overlap, used only to order suggestions in the review queue. */
function similarity(a: string, b: string): number {
  const left = new Set(a.split(" ").filter(Boolean));
  const right = b.split(" ").filter(Boolean);
  if (left.size === 0 || right.length === 0) return 0;
  const hits = right.filter((token) => left.has(token)).length;
  return hits / Math.max(left.size, right.length);
}

export const getEngagementReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; period: string }) =>
    z.object({ clientId: z.string().uuid(), period: z.string() }).parse(input),
  )
  .handler(async ({ data, context }) =>
    withClockSkewRetry(async () => {
      const [activity, people, links] = await Promise.all([
        context.supabase
          .from("recognition_activity")
          .select("id, name_raw, normalized_name, posts, comments, likes, window_from, window_to")
          .eq("client_id", data.clientId)
          .eq("period", data.period),
        context.supabase
          .from("person_period")
          .select("normalized_email, name, is_excluded")
          .eq("client_id", data.clientId)
          .eq("period", data.period),
        context.supabase
          .from("name_links")
          .select("id, normalized_name, normalized_email, reason, confirmed_at")
          .eq("client_id", data.clientId)
          .eq("active", true),
      ]);

      for (const result of [activity, people, links]) {
        if (result.error) throw new Error(result.error.message);
      }

      const roster: Person[] = (people.data ?? []).map((row) => ({
        email: row.normalized_email,
        name: row.name,
        excluded: Boolean(row.is_excluded),
      }));

      // Roster index by canonical name. A name held by two people is ambiguous, never guessed.
      const byName = new Map<string, Person[]>();
      for (const person of roster) {
        if (!person.name) continue;
        const key = normalizeName(person.name);
        if (!key) continue;
        byName.set(key, [...(byName.get(key) ?? []), person]);
      }

      const linkMap = new Map((links.data ?? []).map((row) => [row.normalized_name, row]));

      const rows = (activity.data ?? []).map((row) => {
        const link = linkMap.get(row.normalized_name);
        const candidates = byName.get(row.normalized_name) ?? [];

        let status: "confirmed" | "matched" | "ambiguous" | "unmatched";
        let email: string | null = null;
        if (link) {
          status = "confirmed";
          email = link.normalized_email;
        } else if (candidates.length === 1) {
          status = "matched";
          email = candidates[0]!.email;
        } else if (candidates.length > 1) {
          status = "ambiguous";
        } else {
          status = "unmatched";
        }

        const suggestions =
          status === "confirmed" || status === "matched"
            ? []
            : roster
                .map((person) => ({
                  email: person.email,
                  name: person.name,
                  score: person.name ? similarity(normalizeName(person.name), row.normalized_name) : 0,
                }))
                .filter((s) => s.score > 0.34)
                .sort((a, b) => b.score - a.score)
                .slice(0, 5);

        return {
          ...row,
          total: row.posts + row.comments + row.likes,
          status,
          matched_email: email,
          matched_excluded: email
            ? Boolean(roster.find((p) => p.email === email)?.excluded)
            : false,
          suggestions,
        };
      });

      const resolved = rows.filter((r) => r.matched_email && !r.matched_excluded);
      const activePeople = roster.filter((p) => !p.excluded);

      return {
        rows: rows.sort((a, b) => b.total - a.total),
        links: links.data ?? [],
        window: {
          from: rows[0]?.window_from ?? null,
          to: rows[0]?.window_to ?? null,
        },
        summary: {
          rowCount: rows.length,
          unresolved: rows.filter((r) => r.status === "ambiguous" || r.status === "unmatched").length,
          posts: resolved.reduce((sum, r) => sum + r.posts, 0),
          comments: resolved.reduce((sum, r) => sum + r.comments, 0),
          likes: resolved.reduce((sum, r) => sum + r.likes, 0),
          participants: resolved.filter((r) => r.total > 0).length,
          activeHeadcount: activePeople.length,
        },
      };
    }),
  );

export const confirmNameLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        period: z.string(),
        normalizedName: z.string().min(1).max(300),
        normalizedEmail: z.string().email().max(320),
        reason: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const email = data.normalizedEmail.trim().toLowerCase();
    const { data: existing, error: readError } = await context.supabase
      .from("name_links")
      .select("id, normalized_email")
      .eq("client_id", data.clientId)
      .eq("normalized_name", data.normalizedName)
      .eq("active", true)
      .maybeSingle();
    if (readError) throw new Error(readError.message);

    if (existing?.normalized_email === email) return { ok: true, unchanged: true };

    const { data: inserted, error } = await context.supabase
      .from("name_links")
      .insert({
        client_id: data.clientId,
        normalized_name: data.normalizedName,
        normalized_email: email,
        reason: data.reason ?? null,
        effective_from: data.period,
        confirmed_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    if (existing) {
      // Append-only: the prior link is superseded, never edited away.
      const { error: supersedeError } = await context.supabase
        .from("name_links")
        .update({ active: false, superseded_by: inserted.id })
        .eq("id", existing.id);
      if (supersedeError) throw new Error(supersedeError.message);
    }
    return { ok: true, unchanged: false };
  });

export const retireNameLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("name_links")
      .update({ active: false })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
