-- ============================================================================
-- Question Bank — Question Families & Papers (Phase 8)
-- Translation-family model for multi-language question papers.
-- Apply this in the Supabase SQL editor (or via psql).
-- ============================================================================

-- 1. Question Families — groups language variants of one logical question
create table if not exists public.question_families (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- 2. Add family_id to questions table
alter table public.questions
  add column if not exists family_id uuid references public.question_families(id) on delete set null;

create index if not exists idx_questions_family_id on public.questions(family_id);

-- 3. Papers — a teacher's exam paper (language-agnostic, references families)
create table if not exists public.papers (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  standard_id   uuid references public.standards(id) on delete set null,
  subject_id    uuid references public.subjects(id) on delete set null,
  exam_type_id  uuid references public.exam_types(id) on delete set null,
  duration_min  int not null default 120,
  total_marks   numeric not null default 0,
  status        text not null default 'draft' check (status in ('draft','published','archived')),
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 4. Paper Families — which question families are in this paper (ordered)
create table if not exists public.paper_families (
  id          uuid primary key default gen_random_uuid(),
  paper_id    uuid not null references public.papers(id) on delete cascade,
  family_id   uuid not null references public.question_families(id) on delete cascade,
  sort_order  int not null default 0,
  marks       numeric not null default 0,
  unique(paper_id, family_id)
);

-- 5. Indexes
create index if not exists idx_papers_status on public.papers(status);
create index if not exists idx_papers_created_by on public.papers(created_by);
create index if not exists idx_paper_families_paper on public.paper_families(paper_id);
create index if not exists idx_paper_families_family on public.paper_families(family_id);

-- 6. updated_at trigger for papers
drop trigger if exists set_papers_updated_at on public.papers;
create trigger set_papers_updated_at
  before update on public.papers
  for each row execute function public.set_updated_at();

-- 7. RLS
alter table public.question_families enable row level security;
alter table public.papers enable row level security;
alter table public.paper_families enable row level security;
