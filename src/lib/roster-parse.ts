// Client-safe parsing helpers for roster / spreadsheet imports.
// Extraction is deliberately tolerant: a missing column yields null, never an error.

export type RawCell = string | number | boolean | Date | null | undefined;
export type SourceRow = Record<string, RawCell>;

export type ExtractedRow = {
  row_number: number;
  payload: Record<string, unknown>;
  name_raw: string | null;
  email_raw: string | null;
  employee_id_raw: string | null;
  title_raw: string | null;
  department_raw: string | null;
  status_raw: string | null;
  user_type_raw: string | null;
  hire_date_raw: string | null;
  hire_date: string | null;
  created_raw: string | null;
  created_at_src: string | null;
  modified_raw: string | null;
  modified_at_src: string | null;
  last_login_raw: string | null;
  last_login_at: string | null;
  parse_flags: string[];
};

const normalizeHeader = (header: string) =>
  header.toLowerCase().replace(/[^a-z0-9]/g, "");

// Ordered synonym lists. First match wins, so put the most specific first.
type FieldKey =
  | "name"
  | "email"
  | "employee_id"
  | "title"
  | "department"
  | "status"
  | "user_type"
  | "hire_date"
  | "created"
  | "modified"
  | "last_login";

const FIELD_SYNONYMS: Record<FieldKey, string[]> = {
  name: ["fullname", "employeename", "username", "name", "displayname", "lastfirst"],
  email: ["emailaddress", "email", "workemail", "useremail", "primaryemail"],
  employee_id: ["employeeid", "empid", "employeenumber", "empno", "personnelid", "badgeid", "id"],
  title: ["jobtitle", "title", "position", "role", "jobrole"],
  department: ["department", "dept", "departmentname", "division", "group", "team"],
  status: ["status", "employmentstatus", "userstatus", "accountstatus", "active"],
  user_type: ["usertype", "type", "employeetype", "employmenttype", "accounttype"],
  hire_date: ["hiredate", "datehired", "starthire", "startdate", "hired"],
  created: ["created", "createddate", "createdat", "datecreated", "createdon"],
  modified: ["modified", "modifieddate", "modifiedat", "datemodified", "lastmodified", "updated", "updatedat"],
  last_login: ["lastlogin", "lastlogindate", "lastloginat", "lastsignin", "lastaccess", "lastactivity"],
};

export type HeaderMap = Partial<Record<FieldKey, string>>;

/** Map logical field -> actual column name present in this file. Absent fields are simply omitted. */
export function buildHeaderMap(columns: string[]): HeaderMap {
  const normalized = columns.map((c) => ({ original: c, key: normalizeHeader(c) }));
  const map: HeaderMap = {};
  const taken = new Set<string>();

  for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS) as [FieldKey, string[]][]) {
    for (const synonym of synonyms) {
      const exact = normalized.find((c) => c.key === synonym && !taken.has(c.original));
      if (exact) {
        map[field] = exact.original;
        taken.add(exact.original);
        break;
      }
    }
    if (map[field]) continue;
    // Fall back to a contains match so "Employee Job Title (current)" still resolves.
    for (const synonym of synonyms) {
      const partial = normalized.find((c) => c.key.includes(synonym) && !taken.has(c.original));
      if (partial) {
        map[field] = partial.original;
        taken.add(partial.original);
        break;
      }
    }
  }
  return map;
}

function cellToText(value: RawCell): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  return text === "" ? null : text;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/** Returns an ISO date (YYYY-MM-DD) or null. Never throws. */
export function parseDateValue(value: RawCell): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    // Excel serial date. Anything outside a sane window is not a date.
    if (value < 1 || value > 80000) return null;
    return new Date(EXCEL_EPOCH_MS + value * 86400000).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (us) {
    const [, m, d, yRaw] = us;
    const year = yRaw!.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
    const month = Number(m);
    const day = Number(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

/** Returns an ISO timestamp or null. Never throws. */
export function parseTimestampValue(value: RawCell): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "number") {
    if (value < 1 || value > 80000) return null;
    return new Date(EXCEL_EPOCH_MS + value * 86400000).toISOString();
  }
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  const asDate = parseDateValue(text);
  return asDate ? `${asDate}T00:00:00.000Z` : null;
}

function jsonSafe(row: SourceRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) out[key] = Number.isNaN(value.getTime()) ? null : value.toISOString();
    else if (value === undefined) out[key] = null;
    else out[key] = value;
  }
  return out;
}

/**
 * Extract one raw_records row. The whole source row goes into payload untouched;
 * named fields are pulled out where present. Unparseable dates keep their raw text
 * and add a parse flag instead of failing.
 */
export function extractRow(row: SourceRow, headers: HeaderMap, rowNumber: number): ExtractedRow {
  const flags: string[] = [];
  const get = (field: FieldKey): RawCell => {
    const column = headers[field];
    return column === undefined ? null : row[column];
  };

  const dateField = (field: FieldKey, flag: string) => {
    const value = get(field);
    const raw = cellToText(value);
    const parsed = parseDateValue(value);
    if (raw !== null && parsed === null) flags.push(flag);
    return { raw, parsed };
  };

  const hire = dateField("hire_date", "hire_date_unparseable");
  const created = dateField("created", "created_unparseable");
  const modified = dateField("modified", "modified_unparseable");

  const lastLoginValue = get("last_login");
  const lastLoginRaw = cellToText(lastLoginValue);
  const lastLoginAt = parseTimestampValue(lastLoginValue);
  if (lastLoginRaw !== null && lastLoginAt === null) flags.push("last_login_unparseable");

  const emailRaw = cellToText(get("email"));
  if (emailRaw === null) flags.push("missing_email");
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) flags.push("malformed_email");

  if (cellToText(get("name")) === null) flags.push("missing_name");
  if (headers.status === undefined) flags.push("no_status_column");
  if (headers.department === undefined) flags.push("no_department_column");
  if (headers.title === undefined) flags.push("no_title_column");

  return {
    row_number: rowNumber,
    payload: jsonSafe(row),
    name_raw: cellToText(get("name")),
    email_raw: emailRaw,
    employee_id_raw: cellToText(get("employee_id")),
    title_raw: cellToText(get("title")),
    department_raw: cellToText(get("department")),
    status_raw: cellToText(get("status")),
    user_type_raw: cellToText(get("user_type")),
    hire_date_raw: hire.raw,
    hire_date: hire.parsed,
    created_raw: created.raw,
    created_at_src: created.parsed,
    modified_raw: modified.raw,
    modified_at_src: modified.parsed,
    last_login_raw: lastLoginRaw,
    last_login_at: lastLoginAt,
    parse_flags: flags,
  };
}

export const FLAG_LABELS: Record<string, string> = {
  hire_date_unparseable: "Hire date could not be parsed",
  created_unparseable: "Created date could not be parsed",
  modified_unparseable: "Modified date could not be parsed",
  last_login_unparseable: "Last login could not be parsed",
  missing_email: "No email value in the row",
  malformed_email: "Email is not a valid address",
  missing_name: "No name value in the row",
  no_status_column: "File has no status column",
  no_department_column: "File has no department column",
  no_title_column: "File has no title column",
};

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
