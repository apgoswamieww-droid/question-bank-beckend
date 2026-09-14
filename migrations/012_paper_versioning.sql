-- ============================================================================
-- Question Bank — Paper Versioning & History (Paper Generator Phase 15)
-- A published paper is safely versioned. Every version is an IMMUTABLE,
-- INSERT-ONLY snapshot of the paper state (composition, blueprint, sets,
-- translations, template). Historical versions are never mutated: restoring
-- a version re-materialises its snapshot as a NEW version, preserving the
-- published timeline intact.
--
-- Fully additive: papers created before this migration are untouched. They
-- receive a lazy "baseline" version the first time their history is viewed.
-- Apply this in the Supabase SQL editor (or via psql).
-- ============================================================================

-- 1. Paper versions — one insert-only row per saved version of a paper.
create table if not exists public.paper_versions (
  id             uuid primary key default gen_random_uuid(),
  paper_id       uuid not null references public.papers(id) on delete cascade,
  version        int  not null check (version >= 1),
  reason         text not null default 'manual'
                   check (reason in ('created','baseline','manual','published','restore')),
  note           text,                       -- optional admin comment on this version
  summary        text,                       -- human-readable change summary vs previous
  changes        jsonb not null default '{}'::jsonb,  -- structured diff vs previous version
  snapshot       jsonb not null,             -- immutable paper state at this version
  parent_version int,                        -- set when this version was created by a restore
  created_by     uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique(paper_id, version)
);

-- 2. Indexes
create index if not exists idx_paper_versions_paper
  on public.paper_versions (paper_id, version desc);
create index if not exists idx_paper_versions_created_at
  on public.paper_versions (created_at desc);
create index if not exists idx_paper_versions_reason
  on public.paper_versions (reason);

-- 3. Row Level Security (enabled; default deny, admin service role bypasses)
alter table public.paper_versions enable row level security;