-- ============================================================================
-- Paper Generator Phase 8 — Multilingual Paper Engine
-- Translation workflow states for language variants + per-language readiness
-- for papers. Fully additive: NULL columns keep every existing row unchanged.
-- Apply this in the Supabase SQL editor (or via psql).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Translation state on a question variant (one row per language within a
-- question family). The variant ITSELF is the logical-identity-preserving
-- translation — no duplicate questions are created.
-- States: draft | translated | reviewed | approved
-- ("Missing" is NOT stored — it means no variant exists in that language and
-- is derived in reports. NULL on existing rows reads as "draft" so legacy
-- variants keep working without a data migration.)
-- ---------------------------------------------------------------------------
alter table public.questions
  add column if not exists translation_status text
    check (translation_status in ('draft','translated','reviewed','approved'));

create index if not exists idx_questions_translation_status
  on public.questions (translation_status)
  where translation_status is not null;

-- ---------------------------------------------------------------------------
-- Paper-level multilingual readiness. Versioned JSON document:
-- {
--   "schemaVersion": 1,
--   "languages": {
--     "<language_id>": {
--       "state": "missing"|"draft"|"translated"|"reviewed"|"approved",
--       "note": "reviewer comment",
--       "sections": { "<section_key>": "instructions in that language" },
--       "updatedAt": "..."
--     }
--   }
-- }
-- Nullable: papers without this document behave exactly as before.
-- ---------------------------------------------------------------------------
alter table public.papers
  add column if not exists translations jsonb;
