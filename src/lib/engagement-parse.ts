// Client-safe parsing for the per-person recognition engagement export.
//
// The export is not a clean table: row 1 is a title, row 2 a window/source line, then a blank
// row, then the real header (Name / Posts / Comments / Likes). Parsing therefore scans for the
// header row rather than assuming it sits first, and tolerates any of the three count columns
// being absent.

export type EngagementRow = {
  row_number: number;
  name_raw: string;
  normalized_name: string;
  posts: number;
  comments: number;
  likes: number;
};

export type EngagementSheet = {
  rows: EngagementRow[];
  columnNames: string[];
  windowFrom: string | null;
  windowTo: string | null;
  duplicateNames: string[];
};

/**
 * Canonical form used to match a name against the roster: case and punctuation are dropped,
 * "Last, First" is flipped, and middle initials survive as ordinary tokens.
 */
export function normalizeName(value: string): string {
  let text = value.replace(/\s+/g, " ").trim();
  const comma = text.indexOf(",");
  if (comma > 0 && text.indexOf(",", comma + 1) === -1) {
    text = `${text.slice(comma + 1).trim()} ${text.slice(0, comma).trim()}`;
  }
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const key = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const toCount = (value: unknown): number => {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

const MDY = /(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/g;

/** Pulls "Window: 08-17-2026 through 08-27-2026" out of any preamble line. */
export function extractWindow(lines: string[]): { from: string | null; to: string | null } {
  for (const line of lines) {
    if (!/window|through|period|range/i.test(line)) continue;
    const found = [...line.matchAll(MDY)].map(([, m, d, y]) => {
      const year = y!.length === 2 ? 2000 + Number(y) : Number(y);
      return `${year}-${String(Number(m)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
    });
    if (found.length >= 2) return { from: found[0]!, to: found[1]! };
    if (found.length === 1) return { from: found[0]!, to: found[0]! };
  }
  return { from: null, to: null };
}

/** Grid is the sheet as an array of arrays (XLSX `header: 1`). Never throws on shape. */
export function parseEngagementSheet(grid: unknown[][]): EngagementSheet {
  let headerIndex = -1;
  for (let i = 0; i < Math.min(grid.length, 30); i += 1) {
    const cells = (grid[i] ?? []).map(key);
    if (cells.includes("name") && cells.some((c) => ["posts", "comments", "likes"].includes(c))) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) {
    throw new Error(
      "No engagement header row found. The sheet needs a row containing Name plus at least one of Posts, Comments or Likes.",
    );
  }

  const header = (grid[headerIndex] ?? []).map((cell) => String(cell ?? "").trim());
  const columnNames = header.filter(Boolean);
  const col = (want: string) => header.findIndex((cell) => key(cell) === want);
  const iName = col("name");
  const iPosts = col("posts");
  const iComments = col("comments");
  const iLikes = col("likes");

  const preamble = grid
    .slice(0, headerIndex)
    .map((row) => (row ?? []).map((c) => String(c ?? "")).join(" "));
  const window = extractWindow(preamble);

  const seen = new Map<string, EngagementRow>();
  const duplicateNames: string[] = [];

  for (let i = headerIndex + 1; i < grid.length; i += 1) {
    const row = grid[i] ?? [];
    const nameRaw = String(row[iName] ?? "").trim();
    if (!nameRaw) continue;
    if (key(nameRaw) === "total" || key(nameRaw) === "grandtotal") continue;

    const normalized = normalizeName(nameRaw);
    if (!normalized) continue;

    const parsed: EngagementRow = {
      row_number: i + 1,
      name_raw: nameRaw,
      normalized_name: normalized,
      posts: iPosts === -1 ? 0 : toCount(row[iPosts]),
      comments: iComments === -1 ? 0 : toCount(row[iComments]),
      likes: iLikes === -1 ? 0 : toCount(row[iLikes]),
    };

    const existing = seen.get(normalized);
    if (existing) {
      // The same person listed twice in one export: sum rather than drop, and surface it.
      existing.posts += parsed.posts;
      existing.comments += parsed.comments;
      existing.likes += parsed.likes;
      duplicateNames.push(nameRaw);
      continue;
    }
    seen.set(normalized, parsed);
  }

  return {
    rows: [...seen.values()],
    columnNames,
    windowFrom: window.from,
    windowTo: window.to,
    duplicateNames,
  };
}
