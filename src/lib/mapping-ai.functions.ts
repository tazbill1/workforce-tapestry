import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "openai/gpt-6-astra";

/** Advisory only: everything returned here is a suggestion the analyst still has to accept. */
export type RoleSuggestion = {
  key: string;
  titlePattern: string;
  departmentPattern: string | null;
  roleCode: string;
  precedence: number;
  why: string;
  confidence: "high" | "medium" | "low";
};

export type DepartmentSuggestion = {
  key: string;
  pattern: string;
  franchiseLabel: string | null;
  functionLabel: string | null;
  isShared: boolean;
  why: string;
  confidence: "high" | "medium" | "low";
};

const CONFIDENCE = new Set(["high", "medium", "low"]);

function normaliseConfidence(value: unknown): "high" | "medium" | "low" {
  return typeof value === "string" && CONFIDENCE.has(value)
    ? (value as "high" | "medium" | "low")
    : "low";
}

async function askModel(system: string, user: string): Promise<unknown[]> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI is not configured for this project.");

  const response = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: MODEL,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (response.status === 402) {
    throw new Error("AI credits are used up. Add credits to keep using the suggestions.");
  }
  if (response.status === 429) {
    throw new Error("The AI service is busy right now. Try again in a moment.");
  }
  if (!response.ok) {
    throw new Error(`The AI service returned an error (${response.status}).`);
  }

  const body = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
  const text = body.choices?.[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The AI reply could not be read. Try again.");
  }
  const list = (parsed as { suggestions?: unknown })?.suggestions;
  return Array.isArray(list) ? list : [];
}

const roleInput = z.object({
  combos: z
    .array(
      z.object({
        key: z.string().max(400),
        title: z.string().max(200).nullable(),
        department: z.string().max(200).nullable(),
        headcount: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(60),
});

/** Suggests a canonical role for each unmapped title + department combination. */
export const suggestRoleMappings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => roleInput.parse(input))
  .handler(async ({ data, context }): Promise<RoleSuggestion[]> => {
    const { data: roles } = await context.supabase
      .from("canonical_roles")
      .select("code, label, sort_order")
      .order("sort_order");
    const roleCodes = new Set((roles ?? []).map((role) => role.code));
    if (roleCodes.size === 0) return [];

    const system = [
      "You map automotive dealership job titles to a fixed list of canonical roles.",
      "Reply with JSON only, shaped as",
      '{"suggestions":[{"key":"<the key given>","role_code":"<one of the allowed codes>",',
      '"title_pattern":"<lowercase snippet of the job title to match on>",',
      '"department_pattern":"<lowercase snippet of the department, or null>",',
      '"precedence":10|20|40,"confidence":"high"|"medium"|"low",',
      '"why":"<one short sentence in plain English>"}]}',
      "Give exactly one suggestion per key you are given, in the same order.",
      "Precedence 10 = the pattern is an exact job title, 20 = a title plus a department, 40 = a broad keyword fallback.",
      "Patterns match on part of the text and ignore capitalisation.",
      "Use department_pattern only when the title alone is ambiguous.",
      `Allowed role codes: ${(roles ?? []).map((r) => `${r.code} (${r.label})`).join("; ")}`,
    ].join(" ");

    const user = data.combos
      .map(
        (combo) =>
          `key: ${combo.key} | title: ${combo.title ?? "(blank)"} | department: ${combo.department ?? "(blank)"} | people: ${combo.headcount}`,
      )
      .join("\n");

    const raw = await askModel(system, user);
    const byKey = new Map(data.combos.map((combo) => [combo.key, combo]));
    const out: RoleSuggestion[] = [];
    for (const item of raw) {
      const row = item as Record<string, unknown>;
      const key = typeof row["key"] === "string" ? row["key"] : "";
      const combo = byKey.get(key);
      const roleCode = typeof row["role_code"] === "string" ? row["role_code"] : "";
      if (!combo || !roleCodes.has(roleCode)) continue;
      const titlePattern =
        (typeof row["title_pattern"] === "string" && row["title_pattern"].trim()) ||
        (combo.title ?? "").trim();
      if (!titlePattern) continue;
      const departmentPattern =
        typeof row["department_pattern"] === "string" && row["department_pattern"].trim()
          ? row["department_pattern"].trim()
          : null;
      const precedenceValue = Number(row["precedence"]);
      const precedence = [10, 20, 40].includes(precedenceValue)
        ? precedenceValue
        : departmentPattern
          ? 20
          : 10;
      out.push({
        key,
        titlePattern: titlePattern.slice(0, 200),
        departmentPattern: departmentPattern ? departmentPattern.slice(0, 200) : null,
        roleCode,
        precedence,
        why: typeof row["why"] === "string" ? row["why"].slice(0, 240) : "",
        confidence: normaliseConfidence(row["confidence"]),
      });
    }
    return out;
  });

const deptInput = z.object({
  departments: z
    .array(
      z.object({
        department: z.string().max(200).nullable(),
        headcount: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(60),
  existing: z
    .array(
      z.object({
        pattern: z.string().max(200),
        franchiseLabel: z.string().max(200).nullable(),
        functionLabel: z.string().max(200).nullable(),
        isShared: z.boolean(),
      }),
    )
    .max(60)
    .default([]),
});

/** Suggests a franchise / function / shared-support reading for each unresolved department string. */
export const suggestDepartmentRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => deptInput.parse(input))
  .handler(async ({ data }): Promise<DepartmentSuggestion[]> => {
    const system = [
      "You read raw department strings from dealership HR exports and turn each into a rule.",
      "Reply with JSON only, shaped as",
      '{"suggestions":[{"pattern":"<lowercase snippet of the department to match on>",',
      '"franchise_label":"<rooftop or brand, or null>","function_label":"<Sales, Service, Parts, Finance, Admin, Management, ...>",',
      '"is_shared":true|false,"confidence":"high"|"medium"|"low","why":"<one short sentence in plain English>"}]}',
      "Give exactly one suggestion per department string you are given, in the same order.",
      "Some clients prefix departments by rooftop (for example TAA / SAA); unprefixed departments are usually shared support, so set is_shared true and franchise_label null.",
      "Follow the conventions of the rules already saved for this client where they apply.",
    ].join(" ");

    const user = [
      data.existing.length
        ? `Rules already saved: ${data.existing
            .map(
              (rule) =>
                `${rule.pattern} -> franchise ${rule.franchiseLabel ?? "none"}, function ${rule.functionLabel ?? "none"}, shared ${rule.isShared}`,
            )
            .join("; ")}`
        : "No rules saved yet for this client.",
      "Department strings to read:",
      ...data.departments.map(
        (entry) => `${entry.department ?? "(blank)"} | people: ${entry.headcount}`,
      ),
    ].join("\n");

    const raw = await askModel(system, user);
    const out: DepartmentSuggestion[] = [];
    for (const [index, item] of raw.entries()) {
      const row = item as Record<string, unknown>;
      const source = data.departments[index];
      const pattern =
        (typeof row["pattern"] === "string" && row["pattern"].trim()) ||
        (source?.department ?? "").trim();
      if (!pattern) continue;
      out.push({
        key: `${index}:${pattern}`,
        pattern: pattern.slice(0, 200),
        franchiseLabel:
          typeof row["franchise_label"] === "string" && row["franchise_label"].trim()
            ? row["franchise_label"].trim().slice(0, 200)
            : null,
        functionLabel:
          typeof row["function_label"] === "string" && row["function_label"].trim()
            ? row["function_label"].trim().slice(0, 200)
            : null,
        isShared: row["is_shared"] === true,
        why: typeof row["why"] === "string" ? row["why"].slice(0, 240) : "",
        confidence: normaliseConfidence(row["confidence"]),
      });
    }
    return out;
  });
