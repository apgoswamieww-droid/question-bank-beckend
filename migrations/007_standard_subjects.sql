-- ============================================================================
-- Question Bank — Standard ↔ Subject mapping (replaces earlier draft)
-- Explicit junction so a subject can be linked to one or more standards.
-- Apply this in the Supabase SQL editor (or via psql).
-- ============================================================================

-- 1. Junction table: which subjects are taught in which standard
create table if not exists public.standard_subjects (
  id          uuid primary key default gen_random_uuid(),
  standard_id uuid not null references public.standards(id) on delete cascade,
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(standard_id, subject_id)
);

-- 2. Indexes
create index if not exists idx_standard_subjects_standard
  on public.standard_subjects(standard_id);
create index if not exists idx_standard_subjects_subject
  on public.standard_subjects(subject_id);

-- 3. updated_at trigger (existing helper function)
drop trigger if exists set_standard_subjects_updated_at on public.standard_subjects;
create trigger set_standard_subjects_updated_at
  before update on public.standard_subjects
  for each row execute function public.set_updated_at();

-- 4. RLS (server-only writes via service role, matching master-data tables)
alter table public.standard_subjects enable row level security;

-- 5. Backfill: derive mappings from existing chapters so current data keeps
-- working (a chapter implies that standard+subject pair exists).
insert into public.standard_subjects (standard_id, subject_id, sort_order)
select distinct c.standard_id, c.subject_id, 0
from public.chapters c
where not exists (
  select 1 from public.standard_subjects ss
  where ss.standard_id = c.standard_id
    and ss.subject_id = c.subject_id
);
