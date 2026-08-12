import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  departmentEntries,
  exclusionCandidates,
  groupRoster,
  mergeCandidates,
  roleCombos,
  validationGate,
  type DeptRuleRow,
  type MergeRow,
  type RoleMappingRow,
  type ActiveExclusion,
} from "./decisions-core";
import { loadDecisionState, loadRosterUnion } from "./decisions-load";

const scope = z.object({
  clientId: z.string().uuid(),
  period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const getDecisionsReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; period: string }) => scope.parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const [{ parts, rosterRows }, state, roles] = await Promise.all([
      loadRosterUnion(supabase, data.clientId, data.period),
      loadDecisionState(supabase, data.clientId, data.period),
      supabase.from("canonical_roles").select("code, label, sort_order").order("sort_order"),
    ]);

    const people = groupRoster(rosterRows);
    const dismissed = new Set(state.dismissals.map((item) => `${item.kind}:${item.candidate_key}`));
    const activeExclusions = (state.exclusions as ActiveExclusion[]).filter((item) => item.active);

    const candidates = exclusionCandidates(
      people,
      activeExclusions,
      new Set(
        [...dismissed]
          .filter((key) => key.startsWith("exclusion:"))
          .map((key) => key.slice("exclusion:".length)),
      ),
    );
    const splitEmails = new Set(
      state.splits.filter((row) => row.active).map((row) => row.normalized_email),
    );
    const merges = mergeCandidates(
      people,
      state.merges as MergeRow[],
      new Set(
        [...dismissed].filter((key) => key.startsWith("merge:")).map((key) => key.slice("merge:".length)),
      ),
      splitEmails,
    );
    const combos = roleCombos(people, state.roleMappings as RoleMappingRow[]);
    const departments = departmentEntries(people, state.departmentRules as DeptRuleRow[]);

    // How many people the active exclusion set currently removes.
    const excludedCount = people.filter((person) => {
      const email = person.normalized_email;
      const domain = email.split("@")[1] ?? "";
      return activeExclusions.some((item) => {
        const value = item.match_value.trim().toLowerCase();
        if (item.effective_from && item.effective_from.slice(0, 10) > data.period) return false;
        switch (item.match_type) {
          case "email":
            return email === value;
          case "email_domain":
            return domain === value.replace(/^@/, "");
          case "name":
            return (person.name ?? "").trim().toLowerCase() === value;
          case "employee_id":
            return (person.employee_id_raw ?? "").trim().toLowerCase() === value;
          case "keyword":
            return [person.name, email, person.title_raw, person.department_raw]
              .filter(Boolean)
              .some((field) => String(field).toLowerCase().includes(value));
          default:
            return false;
        }
      });
    }).length;

    const gate = validationGate({
      combos,
      departments,
      exclusionCandidates: candidates,
      mergeCandidates: merges,
      hasEngagementTotals: Boolean(state.engagement),
    });

    return {
      parts: parts.map((part) => ({ id: part.id, label: part.part_label ?? part.original_filename })),
      peopleCount: people.length,
      excludedCount,
      candidates,
      mergeSuggestions: merges,
      combos,
      departments,
      gate,
      roles: roles.data ?? [],
      history: {
        exclusions: state.exclusions,
        merges: state.merges,
        splits: state.splits,
        departmentRules: state.departmentRules,
        roleMappings: state.roleMappings,
        dismissals: state.dismissals,
      },
      engagement: state.engagement,
      readiness: state.readiness,
    };
  });

export const dismissCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { clientId: string; period: string; kind: string; key: string; note?: string }) =>
      scope
        .extend({ kind: z.enum(["exclusion", "merge", "diff"]), key: z.string().min(1), note: z.string().optional() })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("review_dismissals").upsert(
      {
        client_id: data.clientId,
        kind: data.kind,
        candidate_key: data.key,
        note: data.note ?? null,
        period_reviewed: data.period,
        reviewed_by: context.userId,
      },
      { onConflict: "client_id,kind,candidate_key" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const confirmExclusion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      clientId: string;
      period: string;
      matchType: string;
      matchValue: string;
      category: string;
      reason: string;
      supersedesId?: string;
    }) =>
      scope
        .extend({
          matchType: z.enum(["email", "name", "employee_id", "email_domain", "keyword"]),
          matchValue: z.string().min(1),
          category: z.enum(["test", "demo", "vendor", "platform", "internal", "legacy", "other"]),
          reason: z.string().min(3, "A reason is required"),
          supersedesId: z.string().uuid().optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: inserted, error } = await context.supabase
      .from("exclusions")
      .insert({
        client_id: data.clientId,
        match_type: data.matchType,
        match_value: data.matchValue,
        category: data.category,
        reason: data.reason,
        effective_from: data.period,
        confirmed_by: context.userId,
        active: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    if (data.supersedesId) {
      const { error: supersedeError } = await context.supabase
        .from("exclusions")
        .update({ superseded_by: inserted.id, active: false })
        .eq("id", data.supersedesId);
      if (supersedeError) throw new Error(supersedeError.message);
    }
    return { id: inserted.id };
  });

export const retireExclusion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; period: string; id: string; reason: string }) =>
    scope.extend({ id: z.string().uuid(), reason: z.string().min(3) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // Reversal is a superseding row, never an update or delete of the original.
    const { data: original, error: readError } = await context.supabase
      .from("exclusions")
      .select("match_type, match_value, category")
      .eq("id", data.id)
      .single();
    if (readError) throw new Error(readError.message);

    const { data: inserted, error } = await context.supabase
      .from("exclusions")
      .insert({
        client_id: data.clientId,
        match_type: original.match_type,
        match_value: original.match_value,
        category: original.category,
        reason: data.reason,
        effective_from: data.period,
        confirmed_by: context.userId,
        active: false,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { error: supersedeError } = await context.supabase
      .from("exclusions")
      .update({ superseded_by: inserted.id, active: false })
      .eq("id", data.id);
    if (supersedeError) throw new Error(supersedeError.message);
    return { id: inserted.id };
  });

export const confirmMerge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { clientId: string; period: string; canonicalEmail: string; duplicates: string[]; reason: string }) =>
      scope
        .extend({
          canonicalEmail: z.string().email(),
          duplicates: z.array(z.string().email()).min(1),
          reason: z.string().min(3, "A reason is required"),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const canonical = data.canonicalEmail.trim().toLowerCase();
    const wanted = [...new Set(data.duplicates.map((email) => email.trim().toLowerCase()))].filter(
      (email) => email !== canonical,
    );
    if (wanted.length === 0) throw new Error("Pick a canonical email different from the duplicates.");

    // An active merge already exists for some of these emails — skip them instead of colliding.
    const { data: existing, error: existingError } = await context.supabase
      .from("record_merges")
      .select("duplicate_email, canonical_email")
      .eq("client_id", data.clientId)
      .eq("active", true)
      .in("duplicate_email", wanted);
    if (existingError) throw new Error(existingError.message);

    const alreadyMerged = new Set((existing ?? []).map((row) => row.duplicate_email));
    const rows = wanted
      .filter((email) => !alreadyMerged.has(email))
      .map((email) => ({
        client_id: data.clientId,
        canonical_email: canonical,
        duplicate_email: email,
        reason: data.reason,
        effective_from: data.period,
        confirmed_by: context.userId,
        active: true,
      }));

    if (rows.length === 0) {
      return { inserted: 0, skipped: [...alreadyMerged] };
    }
    const { error } = await context.supabase.from("record_merges").insert(rows);
    if (error) throw new Error(error.message);
    return { inserted: rows.length, skipped: [...alreadyMerged] };
  });


export const saveRoleMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      clientId: string;
      period: string;
      titlePattern: string;
      departmentPattern?: string | null;
      roleCode: string;
      precedence: number;
      reason?: string;
      supersedesId?: string;
    }) =>
      scope
        .extend({
          titlePattern: z.string().min(1),
          departmentPattern: z.string().nullish(),
          roleCode: z.string().min(1),
          precedence: z.number().int().min(0),
          reason: z.string().optional(),
          supersedesId: z.string().uuid().optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: inserted, error } = await context.supabase
      .from("role_mappings")
      .insert({
        client_id: data.clientId,
        title_pattern: data.titlePattern,
        department_pattern: data.departmentPattern || null,
        role_code: data.roleCode,
        precedence: data.precedence,
        reason: data.reason ?? null,
        effective_from: data.period,
        confirmed_by: context.userId,
        active: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    if (data.supersedesId) {
      const { error: supersedeError } = await context.supabase
        .from("role_mappings")
        .update({ superseded_by: inserted.id, active: false })
        .eq("id", data.supersedesId);
      if (supersedeError) throw new Error(supersedeError.message);
    }
    return { id: inserted.id };
  });

export const saveDepartmentRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      clientId: string;
      period: string;
      pattern: string;
      franchiseLabel?: string | null;
      functionLabel?: string | null;
      isShared: boolean;
      supersedesId?: string;
    }) =>
      scope
        .extend({
          pattern: z.string().min(1),
          franchiseLabel: z.string().nullish(),
          functionLabel: z.string().nullish(),
          isShared: z.boolean(),
          supersedesId: z.string().uuid().optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: inserted, error } = await context.supabase
      .from("department_rules")
      .insert({
        client_id: data.clientId,
        pattern: data.pattern,
        franchise_label: data.franchiseLabel || null,
        function_label: data.functionLabel || null,
        is_shared: data.isShared,
        effective_from: data.period,
        confirmed_by: context.userId,
        active: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    if (data.supersedesId) {
      const { error: supersedeError } = await context.supabase
        .from("department_rules")
        .update({ superseded_by: inserted.id, active: false })
        .eq("id", data.supersedesId);
      if (supersedeError) throw new Error(supersedeError.message);
    }
    return { id: inserted.id };
  });

export const saveEngagementTotals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      clientId: string;
      period: string;
      likes?: number | null;
      comments?: number | null;
      logins?: number | null;
      recognitions?: number | null;
      sourceNote?: string;
    }) =>
      scope
        .extend({
          likes: z.number().int().nullish(),
          comments: z.number().int().nullish(),
          logins: z.number().int().nullish(),
          recognitions: z.number().int().nullish(),
          sourceNote: z.string().optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("engagement_totals").upsert(
      {
        client_id: data.clientId,
        period: data.period,
        likes: data.likes ?? null,
        comments: data.comments ?? null,
        logins: data.logins ?? null,
        recognitions: data.recognitions ?? null,
        source_note: data.sourceNote ?? null,
        entered_by: context.userId,
      },
      { onConflict: "client_id,period" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markPeriodReady = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; period: string }) => scope.parse(input))
  .handler(async ({ data, context }) => {
    const [{ parts, rosterRows }, state] = await Promise.all([
      loadRosterUnion(context.supabase, data.clientId, data.period),
      loadDecisionState(context.supabase, data.clientId, data.period),
    ]);
    if (parts.length === 0) throw new Error("No parsed roster import for this period.");
    const people = groupRoster(rosterRows);
    const dismissed = new Set(state.dismissals.map((item) => `${item.kind}:${item.candidate_key}`));
    const gate = validationGate({
      combos: roleCombos(people, state.roleMappings as RoleMappingRow[]),
      departments: departmentEntries(people, state.departmentRules as DeptRuleRow[]),
      exclusionCandidates: exclusionCandidates(
        people,
        (state.exclusions as ActiveExclusion[]).filter((item) => item.active),
        new Set(
          [...dismissed]
            .filter((key) => key.startsWith("exclusion:"))
            .map((key) => key.slice("exclusion:".length)),
        ),
      ),
      mergeCandidates: mergeCandidates(
        people,
        state.merges as MergeRow[],
        new Set(
          [...dismissed].filter((key) => key.startsWith("merge:")).map((key) => key.slice("merge:".length)),
        ),
        new Set(state.splits.filter((row) => row.active).map((row) => row.normalized_email)),
      ),
      hasEngagementTotals: Boolean(state.engagement),
    });
    if (!gate.ready) {
      throw new Error(
        `Period is not ready: ${gate.items
          .filter((item) => !item.ok)
          .map((item) => item.detail)
          .join("; ")}`,
      );
    }
    const { error } = await context.supabase.from("period_readiness").upsert(
      { client_id: data.clientId, period: data.period, marked_ready_by: context.userId },
      { onConflict: "client_id,period" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });


/**
 * The mirror image of a merge: one mailbox that several different people share.
 * Recording it keeps every person in headcount instead of collapsing them into one row.
 */
export const confirmSplit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      clientId: string;
      period: string;
      email: string;
      discriminator: "name" | "employee_id";
      reason: string;
    }) =>
      scope
        .extend({
          email: z.string().email(),
          discriminator: z.enum(["name", "employee_id"]),
          reason: z.string().min(3, "A reason is required"),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const email = data.email.trim().toLowerCase();
    const { data: existing, error: existingError } = await context.supabase
      .from("record_splits")
      .select("id, discriminator")
      .eq("client_id", data.clientId)
      .eq("normalized_email", email)
      .eq("active", true)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing && existing.discriminator === data.discriminator) {
      return { id: existing.id, unchanged: true };
    }

    // The unique index allows one active split per mailbox, so retire the old one first.
    if (existing) {
      const { error: retireError } = await context.supabase
        .from("record_splits")
        .update({ active: false })
        .eq("id", existing.id);
      if (retireError) throw new Error(retireError.message);
    }

    const { data: inserted, error } = await context.supabase
      .from("record_splits")
      .insert({
        client_id: data.clientId,
        normalized_email: email,
        discriminator: data.discriminator,
        reason: data.reason,
        effective_from: data.period,
        confirmed_by: context.userId,
        active: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    if (existing) {
      const { error: linkError } = await context.supabase
        .from("record_splits")
        .update({ superseded_by: inserted.id, active: false })
        .eq("id", existing.id);
      if (linkError) throw new Error(linkError.message);
    }
    return { id: inserted.id, unchanged: false };
  });

export const undoSplit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; period: string; id: string }) =>
    scope.extend({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("record_splits")
      .update({ active: false })
      .eq("id", data.id)
      .eq("client_id", data.clientId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
