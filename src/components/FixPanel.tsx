/**
 * "Fix it" side panel for the report preview.
 *
 * The analyst describes what looks wrong; the assistant traces it read-only and returns one
 * proposed change. Nothing is written until Apply is pressed here.
 */

import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Undo2, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  applyFixProposal,
  diagnoseReportIssue,
  listFixActions,
  undoFixAction,
  type FixDiagnosisResult,
} from "@/lib/fix.functions";

const ACTION_LABELS: Record<string, string> = {
  none: "No automatic change",
  exclude_person: "Exclude from the report",
  reverse_exclusion: "Put someone back in",
  merge_people: "Merge duplicate people",
  add_role_mapping: "Add a role mapping",
  add_department_rule: "Add a department rule",
  set_engagement_totals: "Correct the engagement totals",
};

export function FixPanel({
  clientId,
  period,
  onClose,
}: {
  clientId: string;
  period: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const diagnoseFn = useServerFn(diagnoseReportIssue);
  const applyFn = useServerFn(applyFixProposal);
  const historyFn = useServerFn(listFixActions);
  const undoFn = useServerFn(undoFixAction);

  const [request, setRequest] = useState("");
  const [result, setResult] = useState<FixDiagnosisResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const history = useQuery({
    queryKey: ["fix-actions", clientId, period],
    queryFn: () => historyFn({ data: { clientId, period } }),
    enabled: Boolean(clientId && period),
  });

  const diagnose = useMutation({
    mutationFn: () => diagnoseFn({ data: { clientId, period, request } }),
    onSuccess: (value) => {
      setResult(value);
      setConfirmed(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["fix-actions", clientId, period] });
    void queryClient.invalidateQueries({ queryKey: ["report", clientId, period] });
    void queryClient.invalidateQueries({ queryKey: ["metrics", clientId, period] });
  };

  const apply = useMutation({
    mutationFn: () =>
      applyFn({
        data: {
          clientId,
          period,
          request,
          diagnosis: result?.diagnosis ?? "",
          proposal: result!.proposal,
        },
      }),
    onSuccess: (value) => {
      toast.success(
        value.rebuilt ? `${value.description} The report has been rebuilt.` : value.description,
      );
      setResult(null);
      setRequest("");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const undo = useMutation({
    mutationFn: (id: string) => undoFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Change undone and the report rebuilt.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const proposal = result?.proposal;
  const canApply = Boolean(proposal && proposal.action !== "none");
  const needsConfirm = Boolean(result?.highImpact) && !confirmed;

  return (
    <aside className="rp-no-print fixed bottom-0 right-0 top-0 z-40 flex w-full max-w-md flex-col border-l bg-background shadow-xl">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Wrench className="h-4 w-4" /> Fix something on this report
        </span>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="fix-request">
            Describe what looks wrong
          </label>
          <Textarea
            id="fix-request"
            rows={3}
            value={request}
            placeholder="e.g. Jane Doe left in May, she should not be counted this month"
            onChange={(event) => setRequest(event.target.value)}
          />
          <Button
            size="sm"
            className="w-full"
            disabled={request.trim().length < 4 || diagnose.isPending}
            onClick={() => diagnose.mutate()}
          >
            {diagnose.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Tracing it through the data…
              </>
            ) : (
              "Find the cause"
            )}
          </Button>
        </div>

        {result && (
          <div className="space-y-3 rounded border bg-muted/40 p-3">
            <p className="whitespace-pre-wrap text-sm">{result.diagnosis}</p>

            <div className="rounded border bg-background p-2 text-xs">
              <p className="font-semibold">
                {ACTION_LABELS[proposal?.action ?? "none"] ?? proposal?.action}
              </p>
              {proposal && proposal.action !== "none" && (
                <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                  {Object.entries(proposal)
                    .filter(([key]) => key !== "action")
                    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value ?? "—")}`)
                    .join("\n")}
                </pre>
              )}
              {result.manualSteps && (
                <p className="mt-1 text-[11px] text-muted-foreground">{result.manualSteps}</p>
              )}
            </div>

            {result.affectedPeople.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Affects {result.affectedCount || result.affectedPeople.length}:{" "}
                {result.affectedPeople.slice(0, 8).join(", ")}
                {result.affectedPeople.length > 8 ? "…" : ""}
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Confidence: {result.confidence}
              {result.unverified ? ` · Not confirmed: ${result.unverified}` : ""}
            </p>

            {result.highImpact && canApply && (
              <label className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  This is a wide change. Tick to confirm you want it applied.
                </span>
              </label>
            )}

            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!canApply || needsConfirm || apply.isPending}
                onClick={() => apply.mutate()}
              >
                {apply.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Applying…
                  </>
                ) : (
                  "Apply and rebuild"
                )}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recent fixes
          </p>
          {history.data && history.data.length > 0 ? (
            <ul className="space-y-1.5">
              {history.data.map((item) => (
                <li key={item.id} className="rounded border p-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <span>
                      <strong className="font-medium">{item.description}</strong>
                      <span className="block text-muted-foreground">“{item.request}”</span>
                      <span className="block text-muted-foreground">
                        {new Date(item.appliedAt).toLocaleString("en-US")}
                        {item.status === "undone" ? " · undone" : ""}
                      </span>
                    </span>
                    {item.canUndo && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 shrink-0 px-1"
                        title="Undo this change"
                        onClick={() => undo.mutate(item.id)}
                        disabled={undo.isPending}
                      >
                        <Undo2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No fixes applied for this month yet.</p>
          )}
        </div>
      </div>
    </aside>
  );
}
