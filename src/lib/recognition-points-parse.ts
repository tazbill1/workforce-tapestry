const key = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const text = (value: unknown) => {
  const result = String(value ?? "").trim();
  return result || null;
};

const points = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
};

export type RecognitionPointRow = {
  row_number: number;
  manager_name: string;
  manager_title: string | null;
  department_raw: string | null;
  points_allocated: number | null;
  points_given: number | null;
  parse_flags: string[];
};

export function parseRecognitionPointsSheet(grid: unknown[][]) {
  let headerIndex = -1;
  for (let index = 0; index < Math.min(grid.length, 30); index += 1) {
    const cells = (grid[index] ?? []).map(key);
    const hasManager = cells.some((cell) => ["manager", "managername", "name", "leader"].includes(cell));
    const hasAllocation = cells.some((cell) => cell.includes("allocat") || cell.includes("budget") || cell === "availablepoints");
    const hasGiven = cells.some((cell) => cell.includes("given") || cell.includes("used") || cell.includes("awarded"));
    if (hasManager && (hasAllocation || hasGiven)) {
      headerIndex = index;
      break;
    }
  }
  if (headerIndex < 0) {
    throw new Error("No recognition-points header found. Include Manager plus Allocated or Given points.");
  }

  const header = (grid[headerIndex] ?? []).map((cell) => String(cell ?? "").trim());
  const keys = header.map(key);
  const find = (...tests: string[]) =>
    keys.findIndex((cell) => tests.some((test) => cell === test || cell.includes(test)));
  const nameIndex = find("managername", "manager", "leader", "name");
  const titleIndex = find("title", "position");
  const departmentIndex = find("department", "dept", "location");
  const allocatedIndex = find("allocated", "allocation", "budget", "availablepoints");
  const givenIndex = find("pointsgiven", "given", "used", "awarded");

  const rows: RecognitionPointRow[] = [];
  for (let index = headerIndex + 1; index < grid.length; index += 1) {
    const source = grid[index] ?? [];
    const name = text(source[nameIndex]);
    if (!name || ["total", "grand total"].includes(name.toLowerCase())) continue;
    const allocatedRaw = allocatedIndex >= 0 ? source[allocatedIndex] : null;
    const givenRaw = givenIndex >= 0 ? source[givenIndex] : null;
    const allocated = points(allocatedRaw);
    const given = points(givenRaw);
    const flags: string[] = [];
    if (allocatedIndex < 0 || allocated === null) flags.push("missing_or_invalid_points_allocated");
    if (givenIndex < 0 || given === null) flags.push("missing_or_invalid_points_given");
    rows.push({
      row_number: index + 1,
      manager_name: name.slice(0, 300),
      manager_title: titleIndex >= 0 ? text(source[titleIndex])?.slice(0, 300) ?? null : null,
      department_raw: departmentIndex >= 0 ? text(source[departmentIndex])?.slice(0, 300) ?? null : null,
      points_allocated: allocated,
      points_given: given,
      parse_flags: flags,
    });
  }
  if (rows.length === 0) throw new Error("No manager rows were found in this worksheet.");
  return { rows, columnNames: header.filter(Boolean) };
}