import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ClipboardCheck, Loader2, ShieldAlert, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

import { listMyClients } from "@/lib/imports.functions";
import { listAssemblyPeriods } from "@/lib/assembly.functions";
import {
  confirmExclusion,
  confirmMerge,
  dismissCandidate,
  getDecisionsReview,
  markPeriodReady,
  retireExclusion,
  saveDepartmentRule,
  saveEngagementTotals,
  saveRoleMapping,
} from "@/lib/decisions.functions";

export const Route = createFileRoute("/_authenticated/decisions")({
  head: () => ({
    meta: [
      { title: "Decisions review | Client Reporting Console" },
      {
        name: "description",
        content:
          "Turn the import diff into confirmed decisions: exclusions, email-keyed merges, role mappings, department rules, and the validation gate before a period is marked ready.",
      },
      { property: "og:title", content: "Decisions review | Client Reporting Console" },
      {
        property: "og:description",
        content:
          "Confirm or dismiss every candidate, see which rule won and why, and gate the period until nothing is outstanding.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DecisionsScreen,
});

const CATEGORIES = ["test", "demo", "vendor", "platform", "internal", "legacy", "other"] as const;
const MATCH_TYPES = ["email", "email_domain", "name", "employee_id", "keyword"] as const;

function DecisionsScreen() {
  const [clientId, setClientId] = useState("");
  const [period, setPeriod] = useState("");
  const [tab, setTab] = useState("exclusions");

  const clientsFn = useServerFn(listMyClients);
  const periodsFn = useServerFn(listAssemblyPeriods);
  const reviewFn = useServerFn(getDecisionsReview);
  const confirmExclusionFn = useServerFn(confirmExclusion);
  const retireExclusionFn = useServerFn(retireExclusion);
  const dismissFn = useServerFn(dismissCandidate);
  const confirmMergeFn = useServerFn(confirmMerge);
  const saveRoleFn = useServerFn(saveRoleMapping);
  const saveDeptFn = useServerFn(saveDepartmentRule);
  const saveEngagementFn = useServerFn(saveEngagementTotals);
  const markReadyFn = useServerFn(markPeriodReady);

  const clients = useQuery({ queryKey: ["clients"], queryFn: () => clientsFn({}) });
  const periods = useQuery({
    queryKey: ["assembly-periods", clientId],
    enabled: Boolean(clientId),
    queryFn: () => periodsFn({ data: { clientId } }),
  });
  const review = useQuery({
    queryKey: ["decisions", clientId, period],
    enabled: Boolean(clientId && period),
    queryFn: () => reviewFn({ data: { clientId, period } }),
  });

  useEffect(() => {
    if (!clientId && clients.data?.length) setClientId(clients.data[0]!.id);
  }, [clients.data, clientId]);
  useEffect(() => {
    if (periods.data?.length && !periods.data.includes(period)) setPeriod(periods.data[0]!);
  }, [periods.data, period]);

  const run = <T,>(promise: Promise<T>, message: string) =>
    promise
      .then(() => {
        toast.success(message);
        review.refetch();
      })
      .catch((error: Error) => toast.error(error.message));

  const data = review.data;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <ClipboardCheck className="h-5 w-5" /> Decisions review
          </h1>
          <p className="text-sm text-muted-foreground">
            Where the import diff becomes confirmed, auditable decisions. Confirmed decisions apply
            automatically and are never re-proposed.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/imports">Imports</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/assembly">Assembly</Link>
          </Button>
        </div>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="min-w-56 space-y-2">
            <Label>Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger>
                <SelectValue placeholder="Select client" />
              </SelectTrigger>
              <SelectContent>
                {(clients.data ?? []).map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-44 space-y-2">
            <Label>Period</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger>
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                {(periods.data ?? []).map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {data ? (
            <div className="text-sm text-muted-foreground">
              {data.peopleCount} people in the roster union ·{" "}
              <span className="font-medium text-foreground">{data.excludedCount}</span> removed by the
              active exclusion set
            </div>
          ) : null}
        </CardContent>
      </Card>

      {review.isFetching && !data ? (
        <p className="text-sm text-muted-foreground">Loading review…</p>
      ) : null}

      {data ? (
        <>
          <GatePanel
            gate={data.gate}
            readiness={data.readiness}
            onJump={jumpToSection}
            onMarkReady={() =>
              run(markReadyFn({ data: { clientId, period } }), "Period marked ready")
            }
          />

          <Tabs ref={tabsRef} value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="exclusions">Exclusions ({data.candidates.length})</TabsTrigger>
              <TabsTrigger value="merges">Merges ({data.mergeSuggestions.length})</TabsTrigger>
              <TabsTrigger value="roles">
                Roles ({data.combos.filter((c) => c.unmapped).length} unmapped)
              </TabsTrigger>
              <TabsTrigger value="departments">
                Departments ({data.departments.filter((d) => d.unmapped).length} unresolved)
              </TabsTrigger>
              <TabsTrigger value="engagement">Engagement</TabsTrigger>
            </TabsList>

            <TabsContent value="exclusions" className="space-y-4 pt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Exclusion candidates</CardTitle>
                  <CardDescription>
                    {data.excludedCount} people are currently removed by the active exclusion set.
                    Confirming writes a new exclusion effective from {period}; reversing inserts a
                    superseding row and never edits the original.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.candidates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing awaiting review.</p>
                  ) : (
                    data.candidates.map((candidate) => (
                      <ExclusionCandidateRow
                        key={candidate.key}
                        candidate={candidate}
                        onConfirm={(payload) =>
                          run(
                            confirmExclusionFn({ data: { clientId, period, ...payload } }),
                            "Exclusion confirmed",
                          )
                        }
                        onDismiss={() =>
                          run(
                            dismissFn({
                              data: {
                                clientId,
                                period,
                                kind: "exclusion",
                                key: candidate.key,
                                note: "reviewed and kept",
                              },
                            }),
                            "Marked reviewed and kept",
                          )
                        }
                      />
                    ))
                  )}
                </CardContent>
              </Card>

              <HistoryCard title="Exclusion history">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Match</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>Confirmed</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.history.exclusions.map((row) => (
                      <TableRow key={row.id} className={row.active ? "" : "opacity-60"}>
                        <TableCell className="font-mono text-xs">
                          {row.match_type}={row.match_value}
                        </TableCell>
                        <TableCell>{row.category}</TableCell>
                        <TableCell className="max-w-72 text-xs">{row.reason ?? "—"}</TableCell>
                        <TableCell>{row.effective_from ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          {new Date(row.confirmed_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant={row.active ? "secondary" : "outline"}>
                            {row.active ? "active" : row.superseded_by ? "superseded" : "retired"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {row.active ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                run(
                                  retireExclusionFn({
                                    data: {
                                      clientId,
                                      period,
                                      id: row.id,
                                      reason: `Reversed during ${period} review`,
                                    },
                                  }),
                                  "Superseding row inserted",
                                )
                              }
                            >
                              Reverse
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </HistoryCard>
            </TabsContent>

            <TabsContent value="merges" className="space-y-4 pt-4">
              <Card className="border-amber-500/40">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-amber-600" /> Merges key on email only
                  </CardTitle>
                  <CardDescription>
                    Employee ID is never used to group or justify a merge. Shared placeholder IDs
                    exist in this data — six pairs of unrelated people share one at a single client —
                    and merging on them silently deletes real employees from headcount.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.mergeSuggestions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No merge candidates outstanding.</p>
                  ) : (
                    data.mergeSuggestions.map((candidate) => (
                      <MergeCandidateRow
                        key={candidate.key}
                        candidate={candidate}
                        onConfirm={(canonicalEmail, duplicates, reason) =>
                          run(
                            confirmMergeFn({
                              data: { clientId, period, canonicalEmail, duplicates, reason },
                            }),
                            "Merge confirmed",
                          )
                        }
                        onDismiss={() =>
                          run(
                            dismissFn({
                              data: {
                                clientId,
                                period,
                                kind: "merge",
                                key: candidate.key,
                                note: "reviewed, not the same person",
                              },
                            }),
                            "Marked reviewed — will not be re-proposed",
                          )
                        }
                      />
                    ))
                  )}
                </CardContent>
              </Card>

              <HistoryCard title="Merge history">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Canonical</TableHead>
                      <TableHead>Duplicate</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Confirmed</TableHead>
                      <TableHead>State</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.history.merges.map((row) => (
                      <TableRow key={row.id} className={row.active ? "" : "opacity-60"}>
                        <TableCell className="font-mono text-xs">{row.canonical_email}</TableCell>
                        <TableCell className="font-mono text-xs">{row.duplicate_email}</TableCell>
                        <TableCell className="text-xs">{row.reason ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          {new Date(row.confirmed_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant={row.active ? "secondary" : "outline"}>
                            {row.active ? "active" : "superseded"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </HistoryCard>
            </TabsContent>

            <TabsContent value="roles" className="space-y-4 pt-4">
              <RoleSection
                combos={data.combos}
                roles={data.roles}
                mappings={data.history.roleMappings}
                onSave={(payload) =>
                  run(saveRoleFn({ data: { clientId, period, ...payload } }), "Role mapping saved")
                }
              />
            </TabsContent>

            <TabsContent value="departments" className="space-y-4 pt-4">
              <DepartmentSection
                departments={data.departments}
                rules={data.history.departmentRules}
                onSave={(payload) =>
                  run(saveDeptFn({ data: { clientId, period, ...payload } }), "Department rule saved")
                }
              />
            </TabsContent>

            <TabsContent value="engagement" className="space-y-4 pt-4">
              <EngagementSection
                current={data.engagement}
                onSave={(payload) =>
                  run(
                    saveEngagementFn({ data: { clientId, period, ...payload } }),
                    "Engagement totals saved",
                  )
                }
              />
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}

type Review = Awaited<ReturnType<typeof getDecisionsReview>>;

function GatePanel({
  gate,
  readiness,
  onJump,
  onMarkReady,
}: {
  gate: Review["gate"];
  readiness: Review["readiness"];
  onJump: (section: string) => void;
  onMarkReady: () => void;
}) {
  return (
    <Card className={gate.ready ? "border-emerald-500/50" : "border-destructive/40"}>
      <CardHeader>
        <CardTitle>Validation gate</CardTitle>
        <CardDescription>
          {readiness
            ? `Marked ready ${new Date(readiness.marked_ready_at).toLocaleString()}`
            : "A period cannot be marked ready until everything below passes."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {gate.items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="flex items-start gap-2">
              {item.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
              )}
              <div>
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.detail}</p>
              </div>
            </div>
            {item.ok ? null : (
              <Button size="sm" variant="outline" onClick={() => onJump(item.section)}>
                Fix
              </Button>
            )}
          </div>
        ))}
        <Button className="mt-2" disabled={!gate.ready || Boolean(readiness)} onClick={onMarkReady}>
          {readiness ? "Period is ready" : "Mark period ready"}
        </Button>
      </CardContent>
    </Card>
  );
}

function HistoryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="history" className="rounded-lg border px-4">
        <AccordionTrigger className="text-sm font-medium">
          {title} — including superseded rows
        </AccordionTrigger>
        <AccordionContent className="overflow-x-auto pb-4">{children}</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function ExclusionCandidateRow({
  candidate,
  onConfirm,
  onDismiss,
}: {
  candidate: Review["candidates"][number];
  onConfirm: (payload: {
    matchType: (typeof MATCH_TYPES)[number];
    matchValue: string;
    category: (typeof CATEGORIES)[number];
    reason: string;
  }) => void;
  onDismiss: () => void;
}) {
  const [matchType, setMatchType] = useState<(typeof MATCH_TYPES)[number]>("email");
  const [matchValue, setMatchValue] = useState(candidate.normalized_email);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("other");
  const [reason, setReason] = useState("");

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">{candidate.name ?? "(no name)"}</p>
          <p className="font-mono text-xs text-muted-foreground">{candidate.normalized_email}</p>
          <p className="text-xs text-muted-foreground">
            {candidate.title_raw ?? "—"} · {candidate.department_raw ?? "—"} · hire{" "}
            {candidate.hire_date ?? "—"}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {candidate.reasons.map((reasonItem) => (
            <Badge key={reasonItem.code} variant="outline" className="text-[10px]">
              {reasonItem.detail}
            </Badge>
          ))}
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs">Match type</Label>
          <Select value={matchType} onValueChange={(value) => setMatchType(value as typeof matchType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MATCH_TYPES.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Match value</Label>
          <Input value={matchValue} onChange={(event) => setMatchValue(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Category</Label>
          <Select value={category} onValueChange={(value) => setCategory(value as typeof category)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Reason (required)</Label>
          <Input value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          disabled={reason.trim().length < 3 || matchValue.trim().length === 0}
          onClick={() => onConfirm({ matchType, matchValue: matchValue.trim(), category, reason })}
        >
          Confirm exclusion
        </Button>
        <Button size="sm" variant="outline" onClick={onDismiss}>
          Dismiss — reviewed and kept
        </Button>
      </div>
    </div>
  );
}

function MergeCandidateRow({
  candidate,
  onConfirm,
  onDismiss,
}: {
  candidate: Review["mergeSuggestions"][number];
  onConfirm: (canonicalEmail: string, duplicates: string[], reason: string) => void;
  onDismiss: () => void;
}) {
  const emails = candidate.members.map((member) => member.normalized_email);
  const [canonical, setCanonical] = useState(emails[0] ?? "");
  const [reason, setReason] = useState("same person, duplicate record");
  const duplicates = emails.filter((email) => email !== canonical);

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Badge variant="secondary" className="mb-1 text-[10px]">
            {candidate.kind.replaceAll("_", " ")}
          </Badge>
          <p className="text-sm">{candidate.detail}</p>
        </div>
      </div>
      <Table className="mt-2">
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Statuses</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidate.members.map((member) => (
            <TableRow key={member.normalized_email}>
              <TableCell className="font-mono text-xs">{member.normalized_email}</TableCell>
              <TableCell>{member.name ?? "—"}</TableCell>
              <TableCell className="text-xs">{member.title_raw ?? "—"}</TableCell>
              <TableCell className="text-xs">{member.statuses.join(", ")}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {duplicates.length > 0 ? (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Canonical email</Label>
            <Select value={canonical} onValueChange={setCanonical}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {emails.map((email) => (
                  <SelectItem key={email} value={email}>
                    {email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs">Reason (required)</Label>
            <Input value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Single email appearing more than once — already collapsed by the same-email rule (Active
          beats Invited beats Inactive). Dismiss once you have checked it.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        {duplicates.length > 0 ? (
          <Button
            size="sm"
            disabled={reason.trim().length < 3}
            onClick={() => onConfirm(canonical, duplicates, reason)}
          >
            Merge {duplicates.length} into {canonical}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={onDismiss}>
          Dismiss — reviewed, not a duplicate
        </Button>
      </div>
    </div>
  );
}

function RoleSection({
  combos,
  roles,
  mappings,
  onSave,
}: {
  combos: Review["combos"];
  roles: Review["roles"];
  mappings: Review["history"]["roleMappings"];
  onSave: (payload: {
    titlePattern: string;
    departmentPattern?: string | null;
    roleCode: string;
    precedence: number;
    reason?: string;
  }) => void;
}) {
  const [titlePattern, setTitlePattern] = useState("");
  const [departmentPattern, setDepartmentPattern] = useState("");
  const [roleCode, setRoleCode] = useState(roles[0]?.code ?? "");
  const [precedence, setPrecedence] = useState("20");

  const unmappedPeople = combos.filter((c) => c.unmapped).reduce((sum, c) => sum + c.headcount, 0);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Add or change a mapping</CardTitle>
          <CardDescription>
            Case-insensitive substring match on both patterns. Lower precedence wins: "parts manager"
            at 10 beats "manager" at 20 and "parts" at 40. Saving a rule inserts a new confirmed
            decision; it never edits an existing one.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <div className="space-y-1">
            <Label className="text-xs">Title pattern</Label>
            <Input value={titlePattern} onChange={(event) => setTitlePattern(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Department pattern (optional)</Label>
            <Input
              value={departmentPattern}
              onChange={(event) => setDepartmentPattern(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Role</Label>
            <Select value={roleCode} onValueChange={setRoleCode}>
              <SelectTrigger>
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.code} value={role.code}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Precedence</Label>
            <Input
              type="number"
              value={precedence}
              onChange={(event) => setPrecedence(event.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button
              disabled={!titlePattern.trim() || !roleCode}
              onClick={() =>
                onSave({
                  titlePattern: titlePattern.trim(),
                  departmentPattern: departmentPattern.trim() || null,
                  roleCode,
                  precedence: Number(precedence) || 0,
                })
              }
            >
              Save mapping
            </Button>
          </div>
        </CardContent>
      </Card>

      {unmappedPeople > 0 ? (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">
              {combos.filter((c) => c.unmapped).length} unmapped combinations · {unmappedPeople} people
            </CardTitle>
            <CardDescription>
              A catch-all rule counts as unmapped — anything reaching it is still surfaced here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Title + department combinations</CardTitle>
          <CardDescription>Expand a row to see the resolution order and which rule won.</CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple">
            {combos.map((combo) => (
              <AccordionItem key={combo.key} value={combo.key}>
                <AccordionTrigger>
                  <div className="flex w-full flex-wrap items-center justify-between gap-2 pr-3 text-left">
                    <span className="text-sm">
                      {combo.title_raw || <em>(no title)</em>} ·{" "}
                      <span className="text-muted-foreground">
                        {combo.department_raw || "(no department)"}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant="outline">{combo.headcount} people</Badge>
                      {combo.unmapped ? (
                        <Badge variant="destructive">unmapped</Badge>
                      ) : (
                        <Badge variant="secondary">{combo.role_code}</Badge>
                      )}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-1 text-xs">
                  {combo.order.length === 0 ? (
                    <p className="text-muted-foreground">No rule matches this combination.</p>
                  ) : (
                    combo.order.map((rule) => (
                      <p key={rule.id} className={rule.won ? "font-medium" : "text-muted-foreground"}>
                        {rule.won ? "✓ won" : "  lost"} · precedence {rule.precedence} · {rule.label}
                      </p>
                    ))
                  )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      <HistoryCard title="Role mapping history">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title pattern</TableHead>
              <TableHead>Department pattern</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Precedence</TableHead>
              <TableHead>Confirmed</TableHead>
              <TableHead>State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mappings.map((row) => (
              <TableRow key={row.id} className={row.active ? "" : "opacity-60"}>
                <TableCell className="font-mono text-xs">{row.title_pattern || "(catch-all)"}</TableCell>
                <TableCell className="font-mono text-xs">{row.department_pattern ?? "—"}</TableCell>
                <TableCell>{row.role_code}</TableCell>
                <TableCell className="tabular-nums">{row.precedence}</TableCell>
                <TableCell className="text-xs">{new Date(row.confirmed_at).toLocaleString()}</TableCell>
                <TableCell>
                  <Badge variant={row.active ? "secondary" : "outline"}>
                    {row.active ? "active" : "superseded"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </HistoryCard>
    </>
  );
}

function DepartmentSection({
  departments,
  rules,
  onSave,
}: {
  departments: Review["departments"];
  rules: Review["history"]["departmentRules"];
  onSave: (payload: {
    pattern: string;
    franchiseLabel?: string | null;
    functionLabel?: string | null;
    isShared: boolean;
  }) => void;
}) {
  const [pattern, setPattern] = useState("");
  const [franchise, setFranchise] = useState("");
  const [functionLabel, setFunctionLabel] = useState("");
  const [isShared, setIsShared] = useState(false);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Define a department rule</CardTitle>
          <CardDescription>
            Per-client config: some clients prefix departments by rooftop (TAA / SAA) with unprefixed
            departments treated as shared support; others are flat with the brand implied by email
            domain.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <div className="space-y-1">
            <Label className="text-xs">Pattern</Label>
            <Input value={pattern} onChange={(event) => setPattern(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Franchise label</Label>
            <Input value={franchise} onChange={(event) => setFranchise(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Function label</Label>
            <Input value={functionLabel} onChange={(event) => setFunctionLabel(event.target.value)} />
          </div>
          <div className="flex items-center gap-2 pt-5">
            <Switch checked={isShared} onCheckedChange={setIsShared} id="is-shared" />
            <Label htmlFor="is-shared" className="text-xs">
              Shared support
            </Label>
          </div>
          <div className="flex items-end">
            <Button
              disabled={!pattern.trim()}
              onClick={() =>
                onSave({
                  pattern: pattern.trim(),
                  franchiseLabel: franchise.trim() || null,
                  functionLabel: functionLabel.trim() || null,
                  isShared,
                })
              }
            >
              Save rule
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Department strings in this period</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead className="text-right">People</TableHead>
                <TableHead>Franchise</TableHead>
                <TableHead>Function</TableHead>
                <TableHead>Shared</TableHead>
                <TableHead>Resolved by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {departments.map((entry) => (
                <TableRow key={entry.department_raw ?? "(blank)"}>
                  <TableCell>{entry.department_raw ?? <em>(blank)</em>}</TableCell>
                  <TableCell className="text-right tabular-nums">{entry.headcount}</TableCell>
                  <TableCell>{entry.franchise_label ?? "—"}</TableCell>
                  <TableCell>{entry.function_label ?? "—"}</TableCell>
                  <TableCell>{entry.is_shared === null ? "—" : entry.is_shared ? "yes" : "no"}</TableCell>
                  <TableCell>
                    {entry.unmapped ? (
                      <Badge variant="destructive">unresolved</Badge>
                    ) : (
                      <span className="font-mono text-xs">{entry.resolvedBy}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <HistoryCard title="Department rule history">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pattern</TableHead>
              <TableHead>Franchise</TableHead>
              <TableHead>Function</TableHead>
              <TableHead>Shared</TableHead>
              <TableHead>Confirmed</TableHead>
              <TableHead>State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((row) => (
              <TableRow key={row.id} className={row.active ? "" : "opacity-60"}>
                <TableCell className="font-mono text-xs">{row.pattern}</TableCell>
                <TableCell>{row.franchise_label ?? "—"}</TableCell>
                <TableCell>{row.function_label ?? "—"}</TableCell>
                <TableCell>{row.is_shared ? "yes" : "no"}</TableCell>
                <TableCell className="text-xs">{new Date(row.confirmed_at).toLocaleString()}</TableCell>
                <TableCell>
                  <Badge variant={row.active ? "secondary" : "outline"}>
                    {row.active ? "active" : "superseded"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </HistoryCard>
    </>
  );
}

function EngagementSection({
  current,
  onSave,
}: {
  current: Review["engagement"];
  onSave: (payload: {
    likes?: number | null;
    comments?: number | null;
    logins?: number | null;
    recognitions?: number | null;
    sourceNote?: string;
  }) => void;
}) {
  const [likes, setLikes] = useState(String(current?.likes ?? ""));
  const [comments, setComments] = useState(String(current?.comments ?? ""));
  const [logins, setLogins] = useState(String(current?.logins ?? ""));
  const [recognitions, setRecognitions] = useState(String(current?.recognitions ?? ""));
  const [note, setNote] = useState("");

  const num = (value: string) => (value.trim() === "" ? null : Number(value));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Engagement totals</CardTitle>
        <CardDescription>
          Manual entry for the period. Required by the validation gate.
          {current ? ` Last entered ${new Date(current.entered_at).toLocaleString()}.` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-5">
        {[
          ["Likes", likes, setLikes],
          ["Comments", comments, setComments],
          ["Logins", logins, setLogins],
          ["Recognitions", recognitions, setRecognitions],
        ].map(([label, value, setter]) => (
          <div key={label as string} className="space-y-1">
            <Label className="text-xs">{label as string}</Label>
            <Input
              type="number"
              value={value as string}
              onChange={(event) => (setter as (v: string) => void)(event.target.value)}
            />
          </div>
        ))}
        <div className="space-y-1 md:col-span-5">
          <Label className="text-xs">Source note</Label>
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
        </div>
        <div>
          <Button
            onClick={() =>
              onSave({
                likes: num(likes),
                comments: num(comments),
                logins: num(logins),
                recognitions: num(recognitions),
                ...(note.trim() ? { sourceNote: note.trim() } : {}),
              })
            }
          >
            Save totals
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
