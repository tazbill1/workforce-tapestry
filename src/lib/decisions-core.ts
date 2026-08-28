// Pure logic for the decisions review screen: candidate detection, role/department
// resolution order, and the validation gate. No I/O here.
import { canonicalStatus, norm, patternMatches, type RosterRow } from "./assembly-core";

export type ActiveExclusion = {
  id: string;
  match_type: string;
  match_value: string;
  category: string;
  reason: string | null;
  effective_from: string | null;
  active: boolean;
  superseded_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string;
};

export type MergeRow = {
  id: string;
  canonical_email: string;
  duplicate_email: string;
  reason: string | null;
  active: boolean;
  superseded_by: string | null;
  confirmed_at: string;
};

export type DeptRuleRow = {
  id: string;
  pattern: string;
  franchise_label: string | null;
  function_label: string | null;
  is_shared: boolean;
  active: boolean;
  superseded_by: string | null;
  confirmed_at: string;
};

export type RoleMappingRow = {
  id: string;
  title_pattern: string;
  department_pattern: string | null;
  role_code: string;
  precedence: number;
  reason: string | null;
  active: boolean;
  superseded_by: string | null;
  confirmed_at: string;
};

export type Dismissal = { kind: string; candidate_key: string };

const FREEMAIL = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "aol.com",
  "icloud.com",
  "live.com",
  "msn.com",
  "comcast.net",
  "me.com",
]);

const KEYWORDS = [
  "test",
  "testing",
  "demo",
  "dummy",
  "sample",
  "donotuse",
  "do not use",
  "placeholder",
  "training",
  "vendor",
  "noreply",
  "no-reply",
  "example.com",
];

const PLACEHOLDER_IDS = new Set(["", "0", "00", "000", "0000", "1", "123", "n/a", "na", "none", "-", "--", "x", "xx", "xxx"]);

export type CandidateReason = {
  code: "keyword" | "external_domain" | "blank_hire_date" | "suspicious_employee_id" | "name_pattern";
  detail: string;
};

export type ExclusionCandidate = {
  key: string;
  normalized_email: string;
  name: string | null;
  title_raw: string | null;
  department_raw: string | null;
  employee_id_raw: string | null;
  hire_date: string | null;
  reasons: CandidateReason[];
};

export type Person = {
  normalized_email: string;
  rows: RosterRow[];
  name: string | null;
  title_raw: string | null;
  department_raw: string | null;
  employee_id_raw: string | null;
  hire_date: string | null;
  statuses: string[];
};

/** Groups the roster union by normalized_email, keeping every source row. */
export function groupRoster(rosterRows: RosterRow[]): Person[] {
  const byEmail = new Map<string, RosterRow[]>();
  for (const row of rosterRows) {
    const email = row.normalized_email ?? norm(row.email_raw);
    if (!email) continue;
    byEmail.set(email, [...(byEmail.get(email) ?? []), row]);
  }
  return [...byEmail.entries()]
    .map(([normalized_email, rows]) => {
      const ranked = [...rows].sort(
        (a, b) => canonicalStatus(a.status_raw).rank - canonicalStatus(b.status_raw).rank,
      );
      const winner = ranked[0]!;
      return {
        normalized_email,
        rows,
        name: winner.name_raw,
        title_raw: winner.title_raw,
        department_raw: winner.department_raw,
        employee_id_raw: winner.employee_id_raw,
        hire_date: winner.hire_date,
        statuses: [...new Set(rows.map((r) => canonicalStatus(r.status_raw).label ?? "Unknown"))],
      };
    })
    .sort((a, b) => a.normalized_email.localeCompare(b.normalized_email));
}

/** Does one match rule (type + raw value) hit this person? */
export function matchesExclusionRule(
  person: Person,
  matchType: string,
  matchValue: string,
): boolean {
  const email = person.normalized_email;
  const domain = email.split("@")[1] ?? "";
  const value = matchValue.trim().toLowerCase();
  switch (matchType) {
    case "email":
      return email === value;
    case "email_domain":
      return domain === value.replace(/^@/, "");
    case "name":
      return norm(person.name) === value;
    case "employee_id":
      return norm(person.employee_id_raw) === value;
    case "keyword":
      return [person.name, email, person.title_raw, person.department_raw]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(value));
    default:
      return false;
  }
}

function matchesActiveExclusion(person: Person, exclusions: ActiveExclusion[]): boolean {
  return exclusions.some((item) => matchesExclusionRule(person, item.match_type, item.match_value));
}


export function exclusionCandidates(
  people: Person[],
  activeExclusions: ActiveExclusion[],
  dismissed: Set<string>,
): ExclusionCandidate[] {
  // Domain frequency tells us which domains are "the client" and which are outliers.
  const domainCounts = new Map<string, number>();
  for (const person of people) {
    const domain = person.normalized_email.split("@")[1] ?? "";
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }
  // Employee IDs shared by more than one person are placeholders, never identity.
  const idOwners = new Map<string, Set<string>>();
  for (const person of people) {
    const id = norm(person.employee_id_raw);
    if (!id) continue;
    const set = idOwners.get(id) ?? new Set<string>();
    set.add(person.normalized_email);
    idOwners.set(id, set);
  }

  const out: ExclusionCandidate[] = [];
  for (const person of people) {
    if (matchesActiveExclusion(person, activeExclusions)) continue;
    const key = `email:${person.normalized_email}`;
    if (dismissed.has(key)) continue;

    const reasons: CandidateReason[] = [];
    const haystack = [person.name, person.normalized_email, person.title_raw, person.department_raw]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const hitWord = KEYWORDS.find((word) => haystack.includes(word));
    if (hitWord) reasons.push({ code: "keyword", detail: `matched keyword "${hitWord}"` });

    const domain = person.normalized_email.split("@")[1] ?? "";
    const domainCount = domainCounts.get(domain) ?? 0;
    if (FREEMAIL.has(domain) || domainCount < 3) {
      reasons.push({
        code: "external_domain",
        detail: FREEMAIL.has(domain)
          ? `personal email domain ${domain}`
          : `domain ${domain} used by only ${domainCount} ${domainCount === 1 ? "person" : "people"}`,
      });
    }

    if (!person.hire_date) reasons.push({ code: "blank_hire_date", detail: "no hire date on the roster" });

    const id = norm(person.employee_id_raw) ?? "";
    if (PLACEHOLDER_IDS.has(id)) {
      reasons.push({ code: "suspicious_employee_id", detail: `placeholder employee ID "${person.employee_id_raw ?? ""}"` });
    } else if ((idOwners.get(id)?.size ?? 0) > 1) {
      reasons.push({
        code: "suspicious_employee_id",
        detail: `employee ID ${person.employee_id_raw} is shared by ${idOwners.get(id)!.size} different people — never treat it as identity`,
      });
    }

    const name = (person.name ?? "").trim();
    if (!name) {
      reasons.push({ code: "name_pattern", detail: "no name on the roster" });
    } else if (!/\s/.test(name)) {
      reasons.push({ code: "name_pattern", detail: `single-token name "${name}"` });
    } else if (/[0-9]|@|account|user\b/i.test(name)) {
      reasons.push({ code: "name_pattern", detail: `non-person name pattern "${name}"` });
    }

    if (reasons.length > 0) {
      out.push({
        key,
        normalized_email: person.normalized_email,
        name: person.name,
        title_raw: person.title_raw,
        department_raw: person.department_raw,
        employee_id_raw: person.employee_id_raw,
        hire_date: person.hire_date,
        reasons,
      });
    }
  }
  return out.sort((a, b) => b.reasons.length - a.reasons.length);
}

export type CandidateRow = {
  name: string | null;
  title_raw: string | null;
  department_raw: string | null;
  status: string | null;
  hire_date: string | null;
  employee_id_raw: string | null;
};

export type MergeCandidate = {
  key: string;
  kind:
    | "same_email_conflicting_status"
    | "identical_rows"
    | "similar_name"
    | "shared_mailbox";
  detail: string;
  members: Array<{
    normalized_email: string;
    name: string | null;
    statuses: string[];
    title_raw: string | null;
    department_raw: string | null;
    hire_date: string | null;
  }>;
  /** Present for same-email candidates: the individual roster rows behind the mailbox. */
  rows?: CandidateRow[];
  /** The mailbox itself, when the candidate is one email appearing several times. */
  sharedEmail?: string;
  /** How many distinct people names sit on that mailbox. More than one means split, not merge. */
  distinctNames?: number;
};

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/**
 * Identity key for a person's name: first + last only, order-insensitive so
 * "Smith, John" and "John Smith" collapse. Middle names, initials and suffixes
 * are dropped. Single-token names never key — one word is not evidence.
 */
function nameKey(name: string | null): string | null {
  const tokens = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !NAME_SUFFIXES.has(token));
  if (tokens.length < 2) return null;
  return [tokens[0]!, tokens[tokens.length - 1]!].sort().join(" ");
}


/**
 * Identity is email. Nothing else groups or merges people automatically.
 * Name and employee ID only ever raise a flag for a human to look at: names repeat
 * legitimately, and employee IDs are reused or left as placeholders, so acting on
 * either without review would delete real employees from headcount.
 */
export function mergeCandidates(
  allPeople: Person[],
  merges: MergeRow[],
  dismissed: Set<string>,
  splitEmails: Set<string> = new Set(),
  activeExclusions: ActiveExclusion[] = [],
): MergeCandidate[] {
  // An excluded person is out of the dataset entirely: never ask whether they are
  // a duplicate of anyone, and never surface them inside someone else's group.
  const people = activeExclusions.length
    ? allPeople.filter((person) => !matchesActiveExclusion(person, activeExclusions))
    : allPeople;
  const handled = new Set<string>();
  for (const merge of merges) {
    if (!merge.active) continue;
    handled.add(norm(merge.duplicate_email)!);
  }
  const out: MergeCandidate[] = [];

  for (const person of people) {
    if (person.rows.length < 2) continue;
    // Already resolved by a split decision: the mailbox is knowingly shared.
    if (splitEmails.has(person.normalized_email)) continue;
    const key = `dupe:${person.normalized_email}`;
    if (dismissed.has(key)) continue;

    const rows: CandidateRow[] = person.rows.map((row) => ({
      name: row.name_raw,
      title_raw: row.title_raw,
      department_raw: row.department_raw,
      status: canonicalStatus(row.status_raw).label,
      hire_date: row.hire_date,
    }));
    const names = new Set(
      rows.map((row) => nameKey(row.name)).filter((value): value is string => Boolean(value)),
    );
    const sharedMailbox = names.size > 1;

    const kind: MergeCandidate["kind"] = sharedMailbox
      ? "shared_mailbox"
      : person.statuses.length > 1
        ? "same_email_conflicting_status"
        : "identical_rows";

    const detail = sharedMailbox
      ? `${person.normalized_email} carries ${names.size} different names across ${person.rows.length} rows — one mailbox reused by several people, not a duplicate`
      : person.statuses.length > 1
        ? `${person.normalized_email} appears ${person.rows.length} times with conflicting statuses (${person.statuses.join(", ")}) — collapses to ${person.statuses.includes("Active") ? "Active" : person.statuses[0]}`
        : `${person.normalized_email} appears ${person.rows.length} times with matching fields`;

    out.push({
      key,
      kind,
      detail,
      sharedEmail: person.normalized_email,
      rows,
      distinctNames: names.size,
      distinctEmployeeIds: employeeIds.size,
      members: [
        {
          normalized_email: person.normalized_email,
          name: person.name,
          statuses: person.statuses,
          title_raw: person.title_raw,
          department_raw: person.department_raw,
          hire_date: person.hire_date,
        },
      ],
    });
  }

  // Group emails joined by active merges into one identity, so a pair that has
  // already been merged stops being offered for review. Union-find, because
  // merges can be reciprocal (A->B and B->A) or chained.
  const parent = new Map<string, string>();
  const findRoot = (email: string): string => {
    let current = email;
    while (parent.get(current) && parent.get(current) !== current) {
      current = parent.get(current)!;
    }
    parent.set(email, current);
    return current;
  };
  for (const merge of merges) {
    if (!merge.active) continue;
    const dup = norm(merge.duplicate_email);
    const canon = norm(merge.canonical_email);
    if (!dup || !canon) continue;
    if (!parent.has(dup)) parent.set(dup, dup);
    if (!parent.has(canon)) parent.set(canon, canon);
    const rootA = findRoot(dup);
    const rootB = findRoot(canon);
    if (rootA !== rootB) parent.set(rootA, rootB);
  }
  const resolveEmail = (email: string) => (parent.has(email) ? findRoot(email) : email);
  /** True once every email in the group collapses to the same person. */
  const fullyMerged = (emails: string[]) => new Set(emails.map(resolveEmail)).size < 2;

  const byName = new Map<string, Person[]>();
  for (const person of people) {
    const key = nameKey(person.name);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), person]);
  }
  for (const [name, group] of byName) {
    if (group.length < 2) continue;
    const emails = group.map((p) => p.normalized_email).sort();
    if (emails.every((email) => handled.has(email)) || fullyMerged(emails)) continue;
    const key = `name:${emails.join("|")}`;
    if (dismissed.has(key)) continue;
    out.push({
      key,
      kind: "similar_name",
      detail: `the same name "${name}" appears on ${emails.length} different email addresses`,
      members: group.map((p) => ({
        normalized_email: p.normalized_email,
        name: p.name,
        statuses: p.statuses,
        title_raw: p.title_raw,
        department_raw: p.department_raw,
        hire_date: p.hire_date,
        employee_id_raw: p.employee_id_raw,
      })),
    });
  }

  // Employee ID alone is deliberately NOT a duplicate signal: IDs get recycled
  // between a leaver and a new hire and placeholders are shared outright, so it
  // only ever produced noise. A shared ID is still shown as context on a
  // candidate raised by email or by a matching first + last name.


  return out;
}

export function isCatchAll(rule: RoleMappingRow): boolean {
  const pattern = rule.title_pattern.trim();
  return pattern === "" || pattern === "*" || pattern === ".*" || pattern === "%";
}

export type RoleCombo = {
  key: string;
  title_raw: string | null;
  department_raw: string | null;
  headcount: number;
  role_code: string | null;
  resolvedBy: string | null;
  unmapped: boolean;
  order: Array<{ id: string; label: string; precedence: number; role_code: string; won: boolean }>;
};

export function roleCombos(people: Person[], mappings: RoleMappingRow[]): RoleCombo[] {
  const active = mappings.filter((m) => m.active).sort((a, b) => a.precedence - b.precedence);
  const combos = new Map<string, { title: string | null; department: string | null; count: number }>();
  for (const person of people) {
    const key = `${person.title_raw ?? ""}||${person.department_raw ?? ""}`;
    const entry = combos.get(key) ?? { title: person.title_raw, department: person.department_raw, count: 0 };
    entry.count += 1;
    combos.set(key, entry);
  }

  return [...combos.entries()]
    .map(([key, entry]) => {
      const matching = active.filter(
        (rule) =>
          (isCatchAll(rule) || patternMatches(rule.title_pattern, entry.title)) &&
          (!rule.department_pattern || patternMatches(rule.department_pattern, entry.department)),
      );
      const winner = matching[0] ?? null;
      const catchAllOnly = Boolean(winner && isCatchAll(winner));
      return {
        key,
        title_raw: entry.title,
        department_raw: entry.department,
        headcount: entry.count,
        role_code: winner?.role_code ?? null,
        resolvedBy: winner
          ? `${winner.title_pattern || "(catch-all)"}${winner.department_pattern ? ` + ${winner.department_pattern}` : ""} @ ${winner.precedence}`
          : null,
        unmapped: !winner || catchAllOnly,
        order: matching.map((rule, index) => ({
          id: rule.id,
          label: `${rule.title_pattern || "(catch-all)"}${rule.department_pattern ? ` + ${rule.department_pattern}` : ""} → ${rule.role_code}`,
          precedence: rule.precedence,
          role_code: rule.role_code,
          won: index === 0,
        })),
      };
    })
    .sort((a, b) => Number(b.unmapped) - Number(a.unmapped) || b.headcount - a.headcount);
}

export type DepartmentEntry = {
  department_raw: string | null;
  headcount: number;
  franchise_label: string | null;
  function_label: string | null;
  is_shared: boolean | null;
  resolvedBy: string | null;
  unmapped: boolean;
};

export function departmentEntries(people: Person[], rules: DeptRuleRow[]): DepartmentEntry[] {
  const active = rules.filter((r) => r.active);
  const counts = new Map<string, number>();
  for (const person of people) {
    const key = person.department_raw ?? "";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([department, headcount]) => {
      const rule = active.find((item) => patternMatches(item.pattern, department || null));
      return {
        department_raw: department || null,
        headcount,
        franchise_label: rule?.franchise_label ?? null,
        function_label: rule?.function_label ?? null,
        is_shared: rule?.is_shared ?? null,
        resolvedBy: rule?.pattern ?? null,
        unmapped: !rule,
      };
    })
    .sort((a, b) => Number(b.unmapped) - Number(a.unmapped) || b.headcount - a.headcount);
}

export type GateItem = { id: string; label: string; ok: boolean; detail: string; section: string };

export function validationGate(args: {
  combos: RoleCombo[];
  departments: DepartmentEntry[];
  exclusionCandidates: ExclusionCandidate[];
  mergeCandidates: MergeCandidate[];
  hasEngagementTotals: boolean;
}): { items: GateItem[]; ready: boolean } {
  const unmappedCombos = args.combos.filter((c) => c.unmapped);
  const unmappedPeople = unmappedCombos.reduce((sum, c) => sum + c.headcount, 0);
  const unmappedDepts = args.departments.filter((d) => d.unmapped);
  const openItems = args.exclusionCandidates.length + args.mergeCandidates.length;

  const items: GateItem[] = [
    {
      id: "roles",
      label: "Every title + department combination is mapped",
      ok: unmappedCombos.length === 0,
      detail:
        unmappedCombos.length === 0
          ? "all combinations resolve to a role"
          : `${unmappedCombos.length} unmapped combination${unmappedCombos.length === 1 ? "" : "s"} affecting ${unmappedPeople} people`,
      section: "roles",
    },
    {
      id: "departments",
      label: "Every department string is resolved",
      ok: unmappedDepts.length === 0,
      detail:
        unmappedDepts.length === 0
          ? "all department strings have a rule"
          : `${unmappedDepts.length} unresolved department string${unmappedDepts.length === 1 ? "" : "s"}`,
      section: "departments",
    },
    {
      id: "review",
      label: "Every diff item is confirmed or dismissed",
      ok: openItems === 0,
      detail:
        openItems === 0
          ? "nothing awaiting review"
          : `${args.exclusionCandidates.length} exclusion and ${args.mergeCandidates.length} merge candidates outstanding`,
      section: args.exclusionCandidates.length > 0 ? "exclusions" : "merges",
    },
    {
      id: "engagement",
      label: "Engagement totals entered for the period",
      ok: args.hasEngagementTotals,
      detail: args.hasEngagementTotals ? "totals recorded" : "no engagement_totals row for this period",
      section: "engagement",
    },
  ];

  return { items, ready: items.every((item) => item.ok) };
}
