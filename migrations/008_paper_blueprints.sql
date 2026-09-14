-- ============================================================================
-- Question Bank — Paper Blueprint Engine (Paper Generator Phase 2)
-- Adds an embedded, nullable blueprint to existing papers. Fully additive:
-- papers without a blueprint behave exactly as before.
-- Apply this in the Supabase SQL editor (or via psql).
-- ============================================================================

-- Blueprint JSON document (versioned, so future shapes stay parseable):
-- {
--   "version": 1,
--   "totalQuestions": 50,
--   "mode": "count" | "percent",
--   "sections": [
--     { "id": "sec-1", "name": "Section A", "instructions": "", "marksPerQuestion": 1,
--       "negativeMarks": 0, "ruleIds": ["r1","r2"], "questionCount": 0 }
--   ],
--   "rules": [
--     { "id": "r1", "sectionId": "sec-1", "scope": "paper"|"chapter"|"topic",
--       "chapterId": null, "topicId": null,
--       "type": null|"mcq_single"|..., "difficulty": null|"easy"|...,
--       "count": 0, "percent": 0 }
--   ]
-- }
alter table public.papers
  add column if not exists blueprint jsonb;

-- Partial index: only blueprint-bearing papers are indexed (cheap for legacy rows).
create index if not exists idx_papers_blueprint
  on public.papers (id)
  where blueprint is not null;

-- ---------------------------------------------------------------------------
-- Paper Generator Phase 4 — Section & Paper Structure Engine
-- Assigns each paper_families row to a blueprint section. Nullable: papers
-- created before sections existed (and blueprint-less papers) keep working —
-- unassigned families render in a trailing implicit section.
-- ---------------------------------------------------------------------------
alter table public.paper_families
  add column if not exists section_key text;

create index if not exists idx_paper_families_section
  on public.paper_families (paper_id, section_key);

-- ---------------------------------------------------------------------------
-- Paper Generator Phase 5 — Paper Editor
-- Locked questions are pinned: regeneration keeps them and only refills the
-- unlocked slots. Default false keeps every existing row unchanged.
-- ---------------------------------------------------------------------------
alter table public.paper_families
  add column if not exists locked boolean not null default false;

-- ---------------------------------------------------------------------------
-- Paper Generator Phase 7 — Paper Sets & Randomization
-- Embedded, versioned sets document on the master paper:
-- {
--   "schemaVersion": 1,
--   "baseSeed": "paper:<id>", "version": 1,
--   "shuffleQuestions": true, "shuffleOptions": true,
--   "generatedAt": "...", "count": 4,
--   "sets": [
--     { "key": "A", "name": "Set A", "seed": "paper:<id>:setA:v1", "version": 1,
--       "questionCount": 10, "totalMarks": 20,
--       "questions": [
--         { "familyId": "<master question family>", "number": 1, "marks": 2,
--           "sectionKey": "sec-1", "optionPermutation": [2,0,3,1] }
--       ] }
--   ]
-- }
-- `optionPermutation` maps display positions -> original option indexes; the
-- master question and its correct answer are never modified. Nullable: papers
-- without sets behave exactly as before.
-- ---------------------------------------------------------------------------
alter table public.papers
  add column if not exists sets jsonb;
