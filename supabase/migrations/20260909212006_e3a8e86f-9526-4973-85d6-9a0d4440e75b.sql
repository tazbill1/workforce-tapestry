ALTER TYPE import_kind ADD VALUE IF NOT EXISTS 'survey';

CREATE TABLE public.surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period date NOT NULL,
  title text NOT NULL,
  import_id uuid REFERENCES public.raw_imports(id),
  respondent_count integer NOT NULL DEFAULT 0,
  question_count integer NOT NULL DEFAULT 0,
  anonymous boolean NOT NULL DEFAULT false,
  include_in_report boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.surveys TO authenticated;
GRANT ALL ON public.surveys TO service_role;
ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "surveys_select" ON public.surveys FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "surveys_insert" ON public.surveys FOR INSERT TO authenticated
  WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "surveys_update" ON public.surveys FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "surveys_delete" ON public.surveys FOR DELETE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id));
CREATE INDEX surveys_client_period_idx ON public.surveys (client_id, period);

CREATE TABLE public.survey_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  position integer NOT NULL,
  question_text text NOT NULL,
  kind text NOT NULL DEFAULT 'text',
  response_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (survey_id, position)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.survey_questions TO authenticated;
GRANT ALL ON public.survey_questions TO service_role;
ALTER TABLE public.survey_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "survey_questions_select" ON public.survey_questions FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "survey_questions_insert" ON public.survey_questions FOR INSERT TO authenticated
  WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "survey_questions_update" ON public.survey_questions FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "survey_questions_delete" ON public.survey_questions FOR DELETE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id));
CREATE INDEX survey_questions_survey_idx ON public.survey_questions (survey_id);

CREATE TABLE public.survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.survey_questions(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period date NOT NULL,
  row_number integer,
  participant_raw text,
  normalized_name text,
  matched_email text,
  answer_text text,
  answer_numeric numeric,
  sentiment text,
  sentiment_reason text,
  sentiment_confidence numeric,
  sentiment_source text,
  overridden_by uuid REFERENCES auth.users(id),
  overridden_at timestamptz,
  inserted_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.survey_responses TO authenticated;
GRANT ALL ON public.survey_responses TO service_role;
ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "survey_responses_select" ON public.survey_responses FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "survey_responses_insert" ON public.survey_responses FOR INSERT TO authenticated
  WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "survey_responses_update" ON public.survey_responses FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "survey_responses_delete" ON public.survey_responses FOR DELETE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id));
CREATE INDEX survey_responses_survey_idx ON public.survey_responses (survey_id);
CREATE INDEX survey_responses_question_idx ON public.survey_responses (question_id);

CREATE OR REPLACE FUNCTION public.guard_survey_response_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.survey_id IS DISTINCT FROM OLD.survey_id
     OR NEW.question_id IS DISTINCT FROM OLD.question_id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.period IS DISTINCT FROM OLD.period
     OR NEW.participant_raw IS DISTINCT FROM OLD.participant_raw
     OR NEW.answer_text IS DISTINCT FROM OLD.answer_text
     OR NEW.answer_numeric IS DISTINCT FROM OLD.answer_numeric
  THEN
    RAISE EXCEPTION 'survey answers are immutable; only the sentiment fields may change';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_survey_response_update
BEFORE UPDATE ON public.survey_responses
FOR EACH ROW EXECUTE FUNCTION public.guard_survey_response_update();

CREATE TABLE public.survey_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  draft_md text NOT NULL,
  edited_md text,
  themes jsonb NOT NULL DEFAULT '[]'::jsonb,
  accepted_by uuid REFERENCES auth.users(id),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (survey_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.survey_summaries TO authenticated;
GRANT ALL ON public.survey_summaries TO service_role;
ALTER TABLE public.survey_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "survey_summaries_select" ON public.survey_summaries FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "survey_summaries_insert" ON public.survey_summaries FOR INSERT TO authenticated
  WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "survey_summaries_update" ON public.survey_summaries FOR UPDATE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id))
  WITH CHECK (public.can_write_client(auth.uid(), client_id));
CREATE POLICY "survey_summaries_delete" ON public.survey_summaries FOR DELETE TO authenticated
  USING (public.can_write_client(auth.uid(), client_id));

CREATE TRIGGER survey_summaries_set_updated_at
BEFORE UPDATE ON public.survey_summaries
FOR EACH ROW EXECUTE FUNCTION public.set_period_notes_updated_at();