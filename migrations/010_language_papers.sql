-- ============================================================================
-- Question Bank — Separate Language Paper Generation (Paper Generator Phase 9)
-- One master paper is rendered into concrete per-language paper artifacts.
-- A language paper is DERIVED from the master — it never re-selects questions.
-- It records which language variant was resolved for each logical question,
-- its generation version and its traceability back to the master paper.
--
-- Fully additive: NULL/empty on existing rows keeps every master paper
-- unchanged. Old single-language papers simply have no language papers.
-- Apply this in the Supabase SQL editor (or via psql).
-- ============================================================================

-- 1. Language papers — one row per generated (language, version) artifact.
create table if not exists public.paper_languages (
  id               uuid primary key default gen_random_uuid(),
  master_paper_id  uuid not null references public.papers(id) on delete cascade,
  language_id      uuid not null references public.languages(id) on delete cascade,
  version          int not null default 1,
  set_key          text,                       -- source randomization set, null = master order
  status           text not null default 'generated'
                     check (status in ('draft','generated','approved','archived')),
  generated_by     uuid references public.users(id) on delete set null,
  generated_at     timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Versioned JSON document capturing the RESOLVED paper representation at
  -- generation time (family ordering, sections, marks, per-question variant
  -- references and invariant integrity). Question content is NOT duplicated —
  -- variants stay the source of truth and render each time the artifact is
  -- viewed; the snapshot is what pins "this language paper was generated from
  -- this master at this version against these variants".
  snapshot         jsonb,
  unique(master_paper_id, language_id, version)
);

-- 2. Indexes
create index if not exists idx_paper_languages_master
  on public.paper_languages (master_paper_id);
create index if not exists idx_paper_languages_language
  on public.paper_languages (language_id);
create index if not exists idx_paper_languages_status
  on public.paper_languages (status);
create index if not exists idx_paper_languages_generated_at
  on public.paper_languages (generated_at);

-- 3. updated_at trigger
drop trigger if exists set_paper_languages_updated_at on public.paper_languages;
create trigger set_paper_languages_updated_at
  before update on public.paper_languages
  for each row execute function public.set_updated_at();

-- 4. Row Level Security (enabled; default deny, admin service role bypasses)
alter table public.paper_languages enable row level security;