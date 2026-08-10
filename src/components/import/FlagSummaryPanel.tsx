import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FLAG_LABELS } from "@/lib/roster-parse";

export type FlagSummary = {
  flaggedRowCount: number;
  counts: { flag: string; count: number }[];
  sample: { row_number: number | null; name_raw: string | null; email_raw: string | null; parse_flags: string[] }[];
};

export function FlagSummaryPanel({ summary, totalRows }: { summary: FlagSummary; totalRows: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Parse flags</CardTitle>
        <CardDescription>
          {summary.flaggedRowCount === 0
            ? `All ${totalRows} rows parsed cleanly.`
            : `${summary.flaggedRowCount} of ${totalRows} rows were imported with at least one flag. Nothing was dropped — raw text is preserved and the typed column is null.`}
        </CardDescription>
      </CardHeader>
      {summary.flaggedRowCount > 0 ? (
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {summary.counts.map((item) => (
              <Badge key={item.flag} variant="secondary">
                {FLAG_LABELS[item.flag] ?? item.flag} · {item.count}
              </Badge>
            ))}
          </div>
          <div className="max-h-72 overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="w-16">Row</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Flags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.sample.map((row) => (
                  <TableRow key={row.row_number ?? Math.random()}>
                    <TableCell className="font-mono text-xs">{row.row_number ?? "—"}</TableCell>
                    <TableCell>{row.name_raw ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{row.email_raw ?? "—"}</TableCell>
                    <TableCell className="space-x-1">
                      {row.parse_flags.map((flag) => (
                        <Badge key={flag} variant="outline" className="text-xs">
                          {FLAG_LABELS[flag] ?? flag}
                        </Badge>
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
