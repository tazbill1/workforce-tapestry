import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "openai/gpt-6-astra";

const KINDS = [
  "roster",
  "mood_matrix",
  "login_report",
  "engagement_totals",
  "recognition_counts",
  "recognition_activity",
  "survey",
] as const;

const inputSchema = z.object({
  filename: z.string().max(400),
  columns: z.array(z.string().max(200)).max(80),
  sampleRows: z.array(z.array(z.string().max(200)).max(12)).max(5),
  preamble: z.array(z.string().max(300)).max(4),
  emails: z.array(z.string().max(320)).max(60),
  rowCount: z.number().int().min(0),
  periodHint: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  heuristicKind: z.enum(KINDS).nullable(),
  signals: z.array(z.object({ id: z.string().max(40), label: z.string().max(120) })).max(6).default([]),
  selectedClientId: z.string().uuid().nullable(),
  selectedPeriod: z.string().regex(/^\d{4}-\d{2}$/),
});

export type UploadAdvice = {
  suggestedKind: (typeof KINDS)[number] | null;
  suggestedPeriod: string | null;
  clientMatches: { clientId: string; name: string; matched: number }[];
  suggestedClientId: string | null;
  aiNote: string | null;
  warnings: string[];
  combinedNote: string | null;
};

/**
 * Advisory read of a file the user has picked but not yet imported.
 *
 * Everything returned is a suggestion. The screen still requires the user to confirm client,
 * period and kind before a single row is written.
 */
export const analyzeUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<UploadAdvice> => {
    const supabase = context.supabase;
    const warnings: string[] = [];

    // --- Which client do these people already belong to? ---
    const clientMatches: { clientId: string; name: string; matched: number }[] = [];
    if (data.emails.length > 0) {
      const { data: rows } = await supabase
        .from("raw_records")
        .select("client_id, normalized_email")
        .in("normalized_email", data.emails)
        .limit(5000);
      const tally = new Map<string, Set<string>>();
      for (const row of rows ?? []) {
        if (!row.client_id || !row.normalized_email) continue;
        const set = tally.get(row.client_id) ?? new Set<string>();
        set.add(row.normalized_email);
        tally.set(row.client_id, set);
      }
      if (tally.size > 0) {
        const { data: clients } = await supabase
          .from("clients")
          .select("id, name")
          .in("id", [...tally.keys()]);
        for (const client of clients ?? []) {
          clientMatches.push({
            clientId: client.id,
            name: client.name,
            matched: tally.get(client.id)?.size ?? 0,
          });
        }
        clientMatches.sort((a, b) => b.matched - a.matched);
      }
    }

    // --- Do the email domains belong to a client we already expect them for? ---
    let domainClientId: string | null = null;
    if (data.emails.length > 0) {
      const domainTally = new Map<string, number>();
      for (const email of data.emails) {
        const domain = email.split("@")[1]?.trim().toLowerCase();
        if (domain) domainTally.set(domain, (domainTally.get(domain) ?? 0) + 1);
      }
      const { data: allClients } = await supabase
        .from("clients")
        .select("id, name, expected_domains");
      let best: { id: string; name: string; hits: number } | null = null;
      for (const client of allClients ?? []) {
        const expected: string[] = client.expected_domains ?? [];
        if (expected.length === 0) continue;
        let hits = 0;
        for (const [domain, count] of domainTally) {
          if (expected.some((d) => domain === d || domain.endsWith(`.${d}`))) hits += count;
        }
        if (hits > 0 && (!best || hits > best.hits)) best = { id: client.id, name: client.name, hits };
      }
      if (best) {
        domainClientId = best.id;
        const existing = clientMatches.find((m) => m.clientId === best!.id);
        if (existing) existing.matched = Math.max(existing.matched, best.hits);
        else clientMatches.unshift({ clientId: best.id, name: best.name, matched: best.hits });
        if (data.selectedClientId && data.selectedClientId !== best.id) {
          warnings.push(
            `The email addresses in this file belong to ${best.name}'s expected domains (${best.hits} of them), not the client selected.`,
          );
        }
      } else if (domainTally.size > 0) {
        const unexpected = [...domainTally.keys()].slice(0, 4).join(", ");
        warnings.push(
          `None of the email domains in this file (${unexpected}) are listed as expected for any client. Add them on the Clients screen if they are correct.`,
        );
      }
    }

    const suggestedClientId = domainClientId ?? clientMatches[0]?.clientId ?? null;
    if (
      !domainClientId &&
      suggestedClientId &&
      data.selectedClientId &&
      suggestedClientId !== data.selectedClientId &&
      (clientMatches[0]?.matched ?? 0) >= 3
    ) {
      warnings.push(
        `The people in this file mostly match ${clientMatches[0]!.name} (${clientMatches[0]!.matched} known email addresses), not the client selected.`,
      );
    }
    if (data.emails.length >= 5 && clientMatches.length === 0) {
      warnings.push("None of the email addresses in this file have been seen before for any client.");
    }

    // --- Does the period look right? ---
    if (data.periodHint && data.periodHint !== data.selectedPeriod) {
      warnings.push(
        `The file itself points at ${data.periodHint}, but the selected reporting period is ${data.selectedPeriod}.`,
      );
    }

    // --- Has something like this already been imported? ---
    const clientForCheck = data.selectedClientId ?? suggestedClientId;
    if (clientForCheck && data.heuristicKind) {
      const { data: existing } = await supabase
        .from("raw_imports")
        .select("id, original_filename, uploaded_at, row_count")
        .eq("client_id", clientForCheck)
        .eq("period", `${data.selectedPeriod}-01`)
        .eq("kind", data.heuristicKind)
        .eq("state", "parsed")
        .is("superseded_by", null)
        .limit(1);
      if ((existing ?? []).length > 0) {
        const hit = existing![0]!;
        warnings.push(
          `A ${data.heuristicKind.replaceAll("_", " ")} file for this client and period was already imported (${hit.original_filename ?? "unnamed"}, ${hit.row_count ?? 0} rows).`,
        );
      }
    }

    // --- Ask the model to read the headers the way a person would ---
    let suggestedKind = data.heuristicKind;
    let suggestedPeriod = data.periodHint;
    let aiNote: string | null = null;

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (apiKey) {
      const prompt = [
        `File name: ${data.filename}`,
        data.preamble.length ? `Lines above the header: ${data.preamble.join(" | ")}` : "",
        `Columns: ${data.columns.join(" | ")}`,
        data.signals.length ? `Data present: ${data.signals.map((s) => s.label).join("; ")}` : "",
        `Data rows: ${data.rowCount}`,
        data.sampleRows.length
          ? `Sample rows:\n${data.sampleRows.map((r) => r.join(" | ")).join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      try {
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
              {
                role: "system",
                content:
                  "You classify workforce reporting spreadsheets for an internal tool. Reply with JSON only: " +
                  '{"kind": one of roster|mood_matrix|login_report|engagement_totals|recognition_counts|recognition_activity|unknown, ' +
                  '"period": "YYYY-MM" or null, "note": one short sentence explaining the call}. ' +
                  "roster = people with employment status/title/department. mood_matrix = per-person check-ins or mood scores. " +
                  "login_report = per-person last login times. recognition_activity = per-person posts/comments/likes. " +
                  "recognition_counts = counts per department. engagement_totals = a handful of headline totals.",
              },
              { role: "user", content: prompt },
            ],
          }),
        });
        if (response.ok) {
          const body = (await response.json()) as {
            choices?: { message?: { content?: string | null } }[];
          };
          const text = body.choices?.[0]?.message?.content ?? "";
          const parsed = JSON.parse(text) as { kind?: string; period?: string | null; note?: string };
          if (parsed.kind && (KINDS as readonly string[]).includes(parsed.kind)) {
            suggestedKind = parsed.kind as (typeof KINDS)[number];
          }
          if (parsed.period && /^\d{4}-\d{2}$/.test(parsed.period)) {
            suggestedPeriod = suggestedPeriod ?? parsed.period;
          }
          if (parsed.note) aiNote = parsed.note.slice(0, 300);
        } else if (response.status === 402) {
          aiNote = "AI credits are exhausted, so this reading is based on the column names alone.";
        } else if (response.status === 429) {
          aiNote = "The AI service is busy, so this reading is based on the column names alone.";
        }
      } catch {
        aiNote = "The AI check could not run, so this reading is based on the column names alone.";
      }
    }

    if (
      suggestedKind &&
      data.heuristicKind &&
      suggestedKind !== data.heuristicKind
    ) {
      warnings.push(
        `The column names look like a ${data.heuristicKind.replaceAll("_", " ")} file, but the AI read it as ${suggestedKind.replaceAll("_", " ")}. Check before importing.`,
      );
    }

    const combinedNote =
      data.signals.length > 1
        ? `This file carries ${data.signals.map((s) => s.label.toLowerCase()).join(" and ")}. Import it once under the kind that matters most; the other columns are still stored with the rows and stay available.`
        : null;

    return {
      suggestedKind: suggestedKind ?? null,
      suggestedPeriod: suggestedPeriod ?? null,
      clientMatches: clientMatches.slice(0, 4),
      suggestedClientId,
      aiNote,
      warnings,
      combinedNote,
    };
  });
