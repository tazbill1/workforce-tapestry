import { supabase } from "@/integrations/supabase/client";
import { sha256Hex } from "@/lib/roster-parse";
import { parseSurveyGrid } from "@/lib/survey-parse";

const BATCH_SIZE = 200;

type Fns = {
  checkDuplicate: (args: { data: { clientId: string; period: string; kind: string; sha256: string } }) => Promise<{
    duplicate: { uploaded_at: string } | null;
  }>;
  createImport: (args: {
    data: {
      clientId: string;
      period: string;
      kind: string;
      sha256: string;
      filename: string;
      storagePath: string;
    };
  }) => Promise<{ duplicate?: boolean; id?: string | null }>;
  createSurvey: (args: {
    data: {
      clientId: string;
      period: string;
      title: string;
      importId: string;
      anonymous: boolean;
      respondentCount: number;
      questions: { position: number; questionText: string; kind: string; responseCount: number }[];
    };
  }) => Promise<{ surveyId: string; questionIds: Record<number, string> }>;
  insertSurveyResponses: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  finalizeImport: (args: { data: Record<string, unknown> }) => Promise<unknown>;
};

/**
 * Uploads one survey workbook: stores the original, records the import, parses the
 * Participant/Question/Answer grid and writes the survey, its questions and answers.
 */
export async function uploadSurveyFile(options: {
  file: File;
  clientId: string;
  /** YYYY-MM */
  period: string;
  sheetName?: string | null;
  fns: Fns;
  onProgress?: (label: string, value: number) => void;
}): Promise<{ surveyId: string; title: string; answers: number }> {
  const { file, clientId, fns } = options;
  const periodDate = `${options.period}-01`;
  const progress = options.onProgress ?? (() => undefined);

  progress("Reading file", 5);
  const buffer = await file.arrayBuffer();
  const sha256 = await sha256Hex(buffer);

  const { duplicate } = await fns.checkDuplicate({
    data: { clientId, period: periodDate, kind: "survey", sha256 },
  });
  if (duplicate) {
    throw new Error(
      `This exact file was already uploaded on ${new Date(duplicate.uploaded_at).toLocaleString()}.`,
    );
  }

  progress("Storing the original", 18);
  const storagePath = `${clientId}/${periodDate}/${sha256.slice(0, 12)}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from("raw-imports")
    .upload(storagePath, file, { upsert: false });
  if (uploadError && !uploadError.message.toLowerCase().includes("already exists")) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  progress("Recording the upload", 30);
  const created = await fns.createImport({
    data: {
      clientId,
      period: periodDate,
      kind: "survey",
      sha256,
      filename: file.name,
      storagePath,
    },
  });
  if (created.duplicate || !created.id) {
    throw new Error("An identical survey file already exists for this client and month.");
  }
  const importId = created.id;

  progress("Reading the answers", 45);
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const chosen =
    (options.sheetName && workbook.SheetNames.includes(options.sheetName)
      ? options.sheetName
      : null) ?? workbook.SheetNames[0];
  if (!chosen) throw new Error("The workbook has no sheets.");
  const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[chosen]!, {
    header: 1,
    defval: null,
    raw: false,
  }) as unknown[][];

  const parsed = parseSurveyGrid(file.name, grid);

  progress("Saving the questions", 58);
  const survey = await fns.createSurvey({
    data: {
      clientId,
      period: periodDate,
      title: parsed.title,
      importId,
      anonymous: parsed.anonymous,
      respondentCount: parsed.participants.length,
      questions: parsed.questions.map((question) => ({
        position: question.position,
        questionText: question.question_text,
        kind: question.kind,
        responseCount: question.answers.length,
      })),
    },
  });

  const answers = parsed.questions.flatMap((question) =>
    question.answers.map((answer) => ({
      questionId: survey.questionIds[question.position]!,
      rowNumber: answer.row_number,
      participantRaw: answer.participant_raw,
      normalizedName: answer.normalized_name,
      answerText: answer.answer_text,
      answerNumeric: answer.answer_numeric,
      sentiment: answer.sentiment,
      sentimentSource: answer.sentiment_source,
    })),
  );

  for (let i = 0; i < answers.length; i += BATCH_SIZE) {
    progress(
      `Saving answers ${i + 1}–${Math.min(i + BATCH_SIZE, answers.length)} of ${answers.length}`,
      60 + Math.round((i / Math.max(answers.length, 1)) * 30),
    );
    await fns.insertSurveyResponses({
      data: {
        surveyId: survey.surveyId,
        clientId,
        period: periodDate,
        rows: answers.slice(i, i + BATCH_SIZE),
      },
    });
  }

  progress("Finishing up", 95);
  await fns.finalizeImport({
    data: {
      importId,
      rowCount: answers.length,
      columnNames: parsed.columnNames,
      state: "parsed",
    },
  });

  return { surveyId: survey.surveyId, title: parsed.title, answers: answers.length };
}
