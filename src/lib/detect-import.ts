// Client-safe "what is this file?" sniffing.
//
// Purely advisory: it looks at the sheet the user just picked and proposes a file kind and a
// reporting period. Nothing here imports anything — the user still confirms before any write.

export type DetectedKind =
  | "roster"
  | "mood_matrix"
  | "login_report"
  | "engagement_totals"
  | "recognition_counts"
  | "recognition_activity";

export type SignalId = "people" | "mood" | "logins" | "recognition" | "totals";

/** A kind of data actually present in the sheet. One file can carry several. */
export type DataSignal = {
  id: SignalId;
  label: string;
  columns: string[];
};

export type Sniff = {
  columns: string[];
  headerRowIndex: number;
  sampleRows: string[][];
  emails: string[];
  domains: { domain: string; count: number }[];
  rowCount: number;
  guess: { kind: DetectedKind; confidence: number; reasons: string[] } | null;
  runnerUp: { kind: DetectedKind; confidence: number } | null;
  signals: DataSignal[];
  periodHint: string | null;
  preamble: string[];
};

const key = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** Finds the row that actually carries column headers (exports often start with a title line). */
function findHeaderRow(grid: unknown[][]): number {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(grid.length, 25); i += 1) {
    const cells = (grid[i] ?? []).map((c) => String(c ?? "").trim());
    const filled = cells.filter(Boolean).length;
    if (filled < 2) continue;
    const words = cells.filter((c) => c && c.length <= 40 && /[a-z]/i.test(c)).length;
    const score = words * 2 + filled;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function detectPeriod(text: string): string | null {
  const iso = text.match(/(20\d{2})[-_/](0?[1-9]|1[0-2])(?![0-9])/);
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}`;
  const lower = text.toLowerCase();
  for (let m = 0; m < MONTHS.length; m += 1) {
    const name = MONTHS[m]!;
    const short = name.slice(0, 3);
    const re = new RegExp(`\\b${short}[a-z]*\\b[^0-9]{0,10}(20\\d{2})`, "i");
    const hit = lower.match(re);
    if (hit) return `${hit[1]}-${String(m + 1).padStart(2, "0")}`;
  }
  const mdy = text.match(/\b(0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])[-/](20\d{2})\b/);
  if (mdy) return `${mdy[3]}-${String(Number(mdy[1])).padStart(2, "0")}`;
  return null;
}

type Score = { kind: DetectedKind; score: number; reasons: string[] };

export function sniffGrid(filename: string, grid: unknown[][]): Sniff {
  const headerRowIndex = findHeaderRow(grid);
  const header = (grid[headerRowIndex] ?? []).map((c) => String(c ?? "").trim());
  const columns = header.filter(Boolean);
  const keys = columns.map(key);
  const has = (...names: string[]) => names.some((n) => keys.includes(n));
  const hasLike = (fragment: string) => keys.some((k) => k.includes(fragment));

  const body = grid.slice(headerRowIndex + 1).filter((row) => (row ?? []).some((c) => String(c ?? "").trim()));
  const sampleRows = body.slice(0, 5).map((row) => (row ?? []).map((c) => String(c ?? "").trim()).slice(0, 12));
  const preamble = grid
    .slice(0, headerRowIndex)
    .map((row) => (row ?? []).map((c) => String(c ?? "")).join(" ").trim())
    .filter(Boolean);

  const emailSet = new Set<string>();
  for (const row of body.slice(0, 400)) {
    for (const cell of row ?? []) {
      const text = String(cell ?? "").trim().toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(text)) emailSet.add(text);
    }
  }
  const emails = [...emailSet];
  const domainCounts = new Map<string, number>();
  for (const email of emails) {
    const domain = email.split("@")[1]!;
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }
  const domains = [...domainCounts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // --- What data does this sheet actually carry? Several answers are allowed. ---
  const matchCols = (test: (k: string) => boolean) =>
    columns.filter((_, i) => test(keys[i] ?? ""));

  const signals: DataSignal[] = [];
  const addSignal = (id: SignalId, label: string, cols: string[]) => {
    if (cols.length) signals.push({ id, label, columns: cols.slice(0, 6) });
  };

  addSignal(
    "people",
    "People (identity and employment details)",
    matchCols(
      (k) =>
        k.includes("email") ||
        k === "name" ||
        k.includes("fullname") ||
        k.includes("status") ||
        k.includes("title") ||
        k.includes("department") ||
        k.includes("hire"),
    ),
  );
  addSignal(
    "mood",
    "Mood or check-in scores",
    matchCols((k) => k.includes("mood") || k.includes("checkin") || k.includes("pulse") || k.includes("sentiment")),
  );
  addSignal(
    "logins",
    "Login activity",
    matchCols((k) => k.includes("lastlogin") || k.includes("lastsignin") || k.includes("lastaccess") || k.includes("logins")),
  );
  addSignal(
    "recognition",
    "Recognition activity (posts, comments, likes)",
    matchCols((k) => ["posts", "comments", "likes"].includes(k) || k.includes("recognition")),
  );

  const scores: Score[] = [];
  const push = (kind: DetectedKind, score: number, reasons: string[]) => {
    if (score > 0) scores.push({ kind, score, reasons });
  };

  // Recognition activity: Name plus any of posts / comments / likes.
  {
    const reasons: string[] = [];
    let score = 0;
    if (has("name")) {
      const counts = ["posts", "comments", "likes"].filter((c) => keys.includes(c));
      if (counts.length) {
        score = 60 + counts.length * 12;
        reasons.push(`Name column plus ${counts.join(", ")}`);
      }
    }
    push("recognition_activity", score, reasons);
  }

  // Login report: a last-login style column.
  {
    const reasons: string[] = [];
    let score = 0;
    if (hasLike("lastlogin") || hasLike("lastsignin") || hasLike("lastaccess")) {
      score = 70;
      reasons.push("Has a last login column");
      if (columns.length <= 6) score += 10;
    }
    push("login_report", score, reasons);
  }

  // Mood matrix: check-in / mood / pulse columns.
  {
    const reasons: string[] = [];
    let score = 0;
    if (hasLike("mood") || hasLike("checkin") || hasLike("pulse") || hasLike("sentiment")) {
      score = 72;
      reasons.push("Has mood / check-in columns");
    }
    push("mood_matrix", score, reasons);
  }

  // Roster: people with employment attributes.
  {
    const reasons: string[] = [];
    let score = 0;
    if (hasLike("email")) {
      score += 35;
      reasons.push("Has an email column");
    }
    for (const [label, test] of [
      ["status", hasLike("status")],
      ["job title", hasLike("title") || keys.includes("position")],
      ["department", hasLike("department") || keys.includes("dept")],
      ["hire date", hasLike("hire") || hasLike("startdate")],
    ] as [string, boolean][]) {
      if (test) {
        score += 12;
        reasons.push(`Has ${label}`);
      }
    }
    if (body.length > 30) score += 8;
    push("roster", score, reasons);
  }

  // Recognition counts: department + a count column, short sheet.
  {
    const reasons: string[] = [];
    let score = 0;
    if ((hasLike("department") || keys.includes("dept")) && (has("count") || hasLike("recognition"))) {
      score = 66;
      reasons.push("Department with a recognition count");
    }
    push("recognition_counts", score, reasons);
  }

  // Engagement totals: a handful of rows of headline totals.
  {
    const reasons: string[] = [];
    let score = 0;
    const totalish = ["likes", "comments", "logins", "recognitions"].filter((c) => keys.includes(c));
    if (totalish.length >= 2 && body.length <= 5 && !has("name")) {
      score = 64;
      reasons.push("A few rows of headline totals");
    }
    push("engagement_totals", score, reasons);
  }

  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  const second = scores[1];

  const filePeriod = detectPeriod(filename);
  const preamblePeriod = detectPeriod(preamble.join(" "));
  const periodHint = preamblePeriod ?? filePeriod;

  return {
    columns,
    headerRowIndex,
    sampleRows,
    emails: emails.slice(0, 60),
    domains,
    rowCount: body.length,
    guess: top
      ? { kind: top.kind, confidence: Math.min(99, top.score), reasons: top.reasons }
      : null,
    runnerUp: second ? { kind: second.kind, confidence: Math.min(99, second.score) } : null,
    signals,
    periodHint,
    preamble: preamble.slice(0, 4),
  };
}

export const KIND_LABELS: Record<DetectedKind, string> = {
  roster: "Roster",
  mood_matrix: "Mood matrix",
  login_report: "Login report",
  engagement_totals: "Engagement totals",
  recognition_counts: "Recognition counts",
  recognition_activity: "Recognition activity (posts, comments, likes)",
};
