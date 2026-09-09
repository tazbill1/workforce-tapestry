# Surveys: import, sentiment, and a report section

## What the three files show

All three exports share one simple shape — three columns: **Participant**, **Question**, **Answer** — one row per person per question. That is good news: one importer handles all of them.

What varies is the *kind* of answer inside that shape:

- **Scale answers** — "Strongly Agree … Strongly Disagree", "Indifferent" (Community Engagement)
- **Choice answers** — "During business hours", "Outside of business hours", "Not interested" (Community Engagement)
- **Score answers** — 0-100 numbers (Road to the Sale training)
- **Free text** — "What causes are you passionate about?", "What could we improve?", "Why are they the best candidate?"
- **Name answers** — nominations of another employee (Employee of the Month)

Names are real people, so answers can be tied back to the roster the same way recognition already is.

## What gets built

**1. Survey upload**
A new "Survey" file type on the Imports screen. Drop the file, the tool reads Participant/Question/Answer, shows a preview (survey title, how many people, how many questions), and you confirm client and month before it saves. Same duplicate protection as every other upload — the same file can't be loaded twice for the same month.

**2. Automatic question typing**
For each question the tool decides whether the answers are a scale, a choice, a score, names, or free text, and shows you that guess with the option to change it. Nothing is analysed until the type is settled.

**3. Sentiment on the answers that deserve it**
Scale answers are scored by rule (Strongly Agree = positive, Indifferent = neutral, Strongly Disagree = negative) — no AI needed, no cost, always consistent.
Free-text answers go to AI, which labels each one positive, neutral, or negative with a one-line reason and a confidence. Short junk answers like "." or "na" are marked "no answer" and left out of the split.
Name and choice questions get counted, not scored.

**4. Survey results screen**
A new **Surveys** tab: every survey loaded for the selected client and month, with per-question results — the positive/neutral/negative split, counts per choice, average score, nomination tallies, and the full list of written comments with their sentiment label. You can flip any sentiment label the AI got wrong, and your correction sticks.

**5. AI summary you approve**
A "Draft summary" button per survey writes a short paragraph of what people said plus the recurring themes. It saves nothing until you accept it, and you can edit the wording — same pattern as the role mapping suggestions.

**6. Report section**
A new section at the end of the report, per survey loaded for that month:
- survey title and how many people responded
- a positive / neutral / negative bar
- the question-by-question results
- the approved summary and themes
- a handful of representative comments

The section only prints when a survey exists for that month and you have accepted its summary — nothing AI-written reaches a client report unreviewed. Like the other sections, it's part of the saved snapshot so an old report keeps showing what it showed the day it was made.

## Two things to decide as we go

- **Anonymous surveys.** These three name the participant. If some clients export anonymous surveys, the importer handles them too — everything just rolls up to the whole client instead of linking to people.
- **Nominations.** Employee-of-the-Month style surveys are a vote count, not sentiment. I'll show them as a tally and leave them out of the sentiment split.

## Technical notes

- New tables: `surveys` (client, period, title, source import, question count, respondent count), `survey_questions` (question text, detected type, position), `survey_responses` (participant, normalized name, matched email, answer text/numeric, sentiment label, sentiment reason, confidence, whether a human overrode it), `survey_summaries` (AI draft, edited text, themes JSON, accepted-by/at). All client-scoped RLS matching the existing tables, with grants; responses immutable except the sentiment override.
- Parser extends the existing spreadsheet import path (`imports.functions.ts` + a new `survey-parse.ts`), reusing the sniffer so a Participant/Question/Answer sheet is auto-detected as a survey.
- Participant names match the roster through the existing exact-normalized-name rule and `name_links`, exactly as recognition does; unmatched names are listed, not guessed.
- Sentiment runs as one batched server function per survey through Lovable AI with a strict JSON schema (one label + reason + confidence per free-text answer), so a survey is one or two calls, not one per comment. Scale answers never hit AI.
- Summary drafting is a separate server function that reads the tallied results, never raw AI on the whole file.
- Report gets a `surveys` section id added to the format section lists, rendered in `ReportDocument.tsx`, and the survey data added to the report snapshot.
