import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type BaseRow = {
  normalized_email: string | null;
  email_raw: string | null;
  name_raw: string | null;
  title_raw: string | null;
  department_raw: string | null;
  status_raw: string | null;
};

export type DiffResult = {
  current: { id: string; period: string; rowCount: number };
  prior: { id: string; period: string; filename: string | null } | null;
  newPeople: BaseRow[];
  newlyInactive: (BaseRow & { prior_status: string | null })[];
  unmapped: {
    title: string | null;
    department: string | null;
    count: number;
    titleMapped: boolean;
    departmentMapped: boolean;
  }[];
  handled: (BaseRow & { decision: string; detail: string })[];
};

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

function PersonTable({
  rows,
  extraHeader,
  extraCell,
}: {
  rows: BaseRow[];
  extraHeader?: string;
  extraCell?: (row: BaseRow, index: number) => React.ReactNode;
}) {
  return (
    <div className="max-h-[28rem] overflow-auto rounded-md border">
      <Table>
        <TableHeader className="sticky top-0 bg-background">
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Department</TableHead>
            {extraHeader ? <TableHead>{extraHeader}</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={`${row.normalized_email ?? row.email_raw ?? "row"}-${index}`}>
              <TableCell className="font-medium">{row.name_raw ?? "—"}</TableCell>
              <TableCell className="font-mono text-xs">
                {row.normalized_email ?? row.email_raw ?? "—"}
              </TableCell>
              <TableCell>{row.title_raw ?? "—"}</TableCell>
              <TableCell>{row.department_raw ?? "—"}</TableCell>
              {extraCell ? <TableCell>{extraCell(row, index)}</TableCell> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function DiffPanel({ diff }: { diff: DiffResult }) {
  const [tab, setTab] = useState("new");
  const counts = useMemo(
    () => ({
      new: diff.newPeople.length,
      inactive: diff.newlyInactive.length,
      unmapped: diff.unmapped.length,
      handled: diff.handled.length,
    }),
    [diff],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Period diff</CardTitle>
        <CardDescription>
          {diff.prior ? (
            <>
              Comparing <strong>{diff.current.period}</strong> ({diff.current.rowCount} rows) against
              the last parsed roster from <strong>{diff.prior.period}</strong>.
            </>
          ) : (
            <>
              No earlier parsed roster for this client — everyone in {diff.current.period} counts as
              new.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
            <TabsTrigger value="new">New people ({counts.new})</TabsTrigger>
            <TabsTrigger value="inactive">Newly inactive ({counts.inactive})</TabsTrigger>
            <TabsTrigger value="unmapped">New titles/depts ({counts.unmapped})</TabsTrigger>
            <TabsTrigger value="handled">Already handled ({counts.handled})</TabsTrigger>
          </TabsList>

          <TabsContent value="new" className="mt-4">
            {counts.new === 0 ? (
              <Empty>No new people this period.</Empty>
            ) : (
              <PersonTable rows={diff.newPeople} />
            )}
          </TabsContent>

          <TabsContent value="inactive" className="mt-4">
            {counts.inactive === 0 ? (
              <Empty>Nobody went from Active to Inactive.</Empty>
            ) : (
              <PersonTable
                rows={diff.newlyInactive}
                extraHeader="Status change"
                extraCell={(_row, index) => (
                  <span className="text-xs">
                    {diff.newlyInactive[index]?.prior_status ?? "Active"} →{" "}
                    <strong>{diff.newlyInactive[index]?.status_raw ?? "Inactive"}</strong>
                  </span>
                )}
              />
            )}
          </TabsContent>

          <TabsContent value="unmapped" className="mt-4">
            {counts.unmapped === 0 ? (
              <Empty>Every title and department combination is already covered by a rule.</Empty>
            ) : (
              <div className="max-h-[28rem] overflow-auto rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>People</TableHead>
                      <TableHead>Missing</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {diff.unmapped.map((combo, index) => (
                      <TableRow key={`${combo.title}-${combo.department}-${index}`}>
                        <TableCell className="font-medium">{combo.title ?? "—"}</TableCell>
                        <TableCell>{combo.department ?? "—"}</TableCell>
                        <TableCell>{combo.count}</TableCell>
                        <TableCell className="space-x-1">
                          {!combo.titleMapped ? (
                            <Badge variant="secondary">No role mapping</Badge>
                          ) : null}
                          {!combo.departmentMapped ? (
                            <Badge variant="secondary">No department rule</Badge>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="handled" className="mt-4">
            <p className="mb-3 text-sm text-muted-foreground">
              These rows are caught by a previously confirmed exclusion or merge. Shown for
              information only — no action needed.
            </p>
            {counts.handled === 0 ? (
              <Empty>No rows matched an existing decision.</Empty>
            ) : (
              <PersonTable
                rows={diff.handled}
                extraHeader="Decision"
                extraCell={(_row, index) => (
                  <span className="text-xs">
                    <Badge variant="outline">{diff.handled[index]?.decision}</Badge>{" "}
                    <span className="text-muted-foreground">{diff.handled[index]?.detail}</span>
                  </span>
                )}
              />
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
