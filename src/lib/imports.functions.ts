import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const importKind = z.enum([
  "roster",
  "mood_matrix",
  "login_report",
  "engagement_totals",
  "recognition_counts",
  "screenshot",
]);

export const listMyClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("clients")
      .select("id, name, code, active")
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listImports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string }) =>
    z.object({ clientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("raw_imports")
      .select(
        "id, period, kind, original_filename, part_label, state, row_count, column_names, parse_error, uploaded_at, superseded_by",
      )
      .eq("client_id", data.clientId)
      .order("uploaded_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Checks the duplicate fingerprint before anything is uploaded. */
export const checkDuplicate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; period: string; kind: string; sha256: string }) =>
    z
      .object({
        clientId: z.string().uuid(),
        period: z.string(),
        kind: importKind,
        sha256: z.string().length(64),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: existing, error } = await context.supabase
      .from("raw_imports")
      .select("id, original_filename, uploaded_at, state")
      .eq("client_id", data.clientId)
      .eq("period", data.period)
      .eq("kind", data.kind)
      .eq("content_sha256", data.sha256)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { duplicate: existing ?? null };
  });

export const createImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      clientId: string;
      period: string;
      kind: string;
      sha256: string;
      filename: string;
      storagePath: string;
    }) =>
      z
        .object({
          clientId: z.string().uuid(),
          period: z.string(),
          kind: importKind,
          sha256: z.string().length(64),
          filename: z.string().min(1).max(400),
          storagePath: z.string().min(1).max(1000),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("raw_imports")
      .insert({
        client_id: data.clientId,
        period: data.period,
        kind: data.kind,
        content_sha256: data.sha256,
        original_filename: data.filename,
        storage_path: data.storagePath,
        state: "uploaded",
        uploaded_by: context.userId,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") {
        return { id: null as string | null, duplicate: true };
      }
      throw new Error(error.message);
    }
    return { id: row.id as string, duplicate: false };
  });

const recordSchema = z.object({
  row_number: z.number().int(),
  payload: z.record(z.unknown()),
  name_raw: z.string().nullable(),
  email_raw: z.string().nullable(),
  employee_id_raw: z.string().nullable(),
  title_raw: z.string().nullable(),
  department_raw: z.string().nullable(),
  status_raw: z.string().nullable(),
  user_type_raw: z.string().nullable(),
  hire_date_raw: z.string().nullable(),
  hire_date: z.string().nullable(),
  created_raw: z.string().nullable(),
  created_at_src: z.string().nullable(),
  modified_raw: z.string().nullable(),
  modified_at_src: z.string().nullable(),
  last_login_raw: z.string().nullable(),
  last_login_at: z.string().nullable(),
  parse_flags: z.array(z.string()),
});

export const insertRawRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        importId: z.string().uuid(),
        clientId: z.string().uuid(),
        period: z.string(),
        rows: z.array(recordSchema).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const payload = data.rows.map((row) => ({
      ...row,
      payload: row.payload as never,
      import_id: data.importId,
      client_id: data.clientId,
      period: data.period,
    }));
    const { error } = await context.supabase.from("raw_records").insert(payload);
    if (error) throw new Error(error.message);
    return { inserted: payload.length };
  });

export const finalizeImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        importId: z.string().uuid(),
        rowCount: z.number().int().min(0),
        columnNames: z.array(z.string()),
        state: z.enum(["parsed", "failed"]),
        parseError: z.string().max(2000).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("raw_imports")
      .update({
        row_count: data.rowCount,
        column_names: data.columnNames,
        state: data.state,
        parse_error: data.parseError ?? null,
      })
      .eq("id", data.importId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getFlagSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { importId: string }) =>
    z.object({ importId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("raw_records")
      .select("row_number, name_raw, email_raw, parse_flags")
      .eq("import_id", data.importId)
      .not("parse_flags", "eq", "{}")
      .order("row_number")
      .limit(1000);
    if (error) throw new Error(error.message);

    const counts = new Map<string, number>();
    for (const row of rows ?? []) {
      for (const flag of row.parse_flags ?? []) {
        counts.set(flag, (counts.get(flag) ?? 0) + 1);
      }
    }
    return {
      flaggedRowCount: rows?.length ?? 0,
      counts: [...counts.entries()]
        .map(([flag, count]) => ({ flag, count }))
        .sort((a, b) => b.count - a.count),
      sample: (rows ?? []).slice(0, 50),
    };
  });

type DiffRow = {
  normalized_email: string | null;
  email_raw: string | null;
  name_raw: string | null;
  title_raw: string | null;
  department_raw: string | null;
  status_raw: string | null;
  employee_id_raw: string | null;
};

const isActive = (status: string | null) =>
  (status ?? "").trim().toLowerCase().startsWith("active");
const isInactive = (status: string | null) => {
  const value = (status ?? "").trim().toLowerCase();
  return value.startsWith("inactive") || value === "terminated" || value === "disabled";
};

/** Loose, case-insensitive pattern match — exact, substring, or regex when the pattern looks like one. */
function patternMatches(pattern: string, value: string | null): boolean {
  if (!value) return false;
  const p = pattern.trim().toLowerCase();
  const v = value.trim().toLowerCase();
  if (!p) return false;
  if (p === v || v.includes(p)) return true;
  if (/[\\^$.*+?()[\]{}|]/.test(pattern)) {
    try {
      return new RegExp(pattern, "i").test(value);
    } catch {
      return false;
    }
  }
  return false;
}

export const getDiff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { importId: string }) =>
    z.object({ importId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;

    const { data: current, error: importError } = await supabase
      .from("raw_imports")
      .select("id, client_id, period, kind")
      .eq("id", data.importId)
      .single();
    if (importError) throw new Error(importError.message);

    const { data: prior } = await supabase
      .from("raw_imports")
      .select("id, period, original_filename")
      .eq("client_id", current.client_id)
      .eq("kind", current.kind)
      .eq("state", "parsed")
      .lt("period", current.period)
      .is("superseded_by", null)
      .order("period", { ascending: false })
      .limit(1)
      .maybeSingle();

    const select =
      "normalized_email, email_raw, name_raw, title_raw, department_raw, status_raw, employee_id_raw";

    const { data: currentRows, error: currentError } = await supabase
      .from("raw_records")
      .select(select)
      .eq("import_id", current.id)
      .limit(20000);
    if (currentError) throw new Error(currentError.message);

    let priorRows: DiffRow[] = [];
    if (prior) {
      const { data: rows, error } = await supabase
        .from("raw_records")
        .select(select)
        .eq("import_id", prior.id)
        .limit(20000);
      if (error) throw new Error(error.message);
      priorRows = (rows ?? []) as DiffRow[];
    }

    const [{ data: roleMappings }, { data: departmentRules }, { data: exclusions }, { data: merges }] =
      await Promise.all([
        supabase
          .from("role_mappings")
          .select("title_pattern, department_pattern, role_code")
          .eq("client_id", current.client_id)
          .eq("active", true),
        supabase
          .from("department_rules")
          .select("pattern, franchise_label, function_label")
          .eq("client_id", current.client_id)
          .eq("active", true),
        supabase
          .from("exclusions")
          .select("match_type, match_value, category, reason")
          .eq("client_id", current.client_id)
          .eq("active", true),
        supabase
          .from("record_merges")
          .select("canonical_email, duplicate_email, reason")
          .eq("client_id", current.client_id)
          .eq("active", true),
      ]);

    const rows = (currentRows ?? []) as DiffRow[];
    const priorByEmail = new Map<string, DiffRow>();
    for (const row of priorRows) {
      if (row.normalized_email) priorByEmail.set(row.normalized_email, row);
    }

    const newPeople = rows.filter(
      (row) => row.normalized_email && !priorByEmail.has(row.normalized_email),
    );

    const newlyInactive = rows.flatMap((row) => {
      if (!row.normalized_email) return [];
      const before = priorByEmail.get(row.normalized_email);
      if (!before) return [];
      if (isActive(before.status_raw) && isInactive(row.status_raw)) {
        return [{ ...row, prior_status: before.status_raw }];
      }
      return [];
    });

    // Unmapped title/department combinations.
    const combos = new Map<
      string,
      { title: string | null; department: string | null; count: number; titleMapped: boolean; departmentMapped: boolean }
    >();
    for (const row of rows) {
      const key = `${row.title_raw ?? ""}||${row.department_raw ?? ""}`;
      const existing = combos.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      const titleMapped = (roleMappings ?? []).some(
        (mapping) =>
          patternMatches(mapping.title_pattern, row.title_raw) &&
          (!mapping.department_pattern ||
            patternMatches(mapping.department_pattern, row.department_raw)),
      );
      const departmentMapped = (departmentRules ?? []).some((rule) =>
        patternMatches(rule.pattern, row.department_raw),
      );
      combos.set(key, {
        title: row.title_raw,
        department: row.department_raw,
        count: 1,
        titleMapped,
        departmentMapped,
      });
    }
    const unmapped = [...combos.values()]
      .filter((combo) => !combo.titleMapped || !combo.departmentMapped)
      .sort((a, b) => b.count - a.count);

    // Rows already handled by a confirmed decision.
    const mergeByDuplicate = new Map(
      (merges ?? []).map((merge) => [merge.duplicate_email.trim().toLowerCase(), merge]),
    );
    const handled = rows.flatMap((row) => {
      const email = row.normalized_email ?? row.email_raw?.trim().toLowerCase() ?? null;
      const domain = email?.split("@")[1] ?? null;

      const exclusion = (exclusions ?? []).find((item) => {
        const value = item.match_value.trim().toLowerCase();
        switch (item.match_type) {
          case "email":
            return email === value;
          case "email_domain":
            return domain === value.replace(/^@/, "");
          case "name":
            return (row.name_raw ?? "").trim().toLowerCase() === value;
          case "employee_id":
            return (row.employee_id_raw ?? "").trim().toLowerCase() === value;
          case "keyword":
            return [row.name_raw, row.email_raw, row.title_raw, row.department_raw]
              .filter(Boolean)
              .some((field) => field!.toLowerCase().includes(value));
          default:
            return false;
        }
      });
      if (exclusion) {
        return [
          {
            ...row,
            decision: `Excluded (${exclusion.category})`,
            detail: exclusion.reason ?? `${exclusion.match_type}: ${exclusion.match_value}`,
          },
        ];
      }
      const merge = email ? mergeByDuplicate.get(email) : undefined;
      if (merge) {
        return [
          {
            ...row,
            decision: "Merged",
            detail: merge.reason ?? `Merged into ${merge.canonical_email}`,
          },
        ];
      }
      return [];
    });

    return {
      current: { id: current.id, period: current.period, rowCount: rows.length },
      prior: prior
        ? { id: prior.id, period: prior.period, filename: prior.original_filename }
        : null,
      newPeople,
      newlyInactive,
      unmapped,
      handled,
    };
  });
