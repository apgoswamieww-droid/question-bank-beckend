-- ============================================================================
-- Question Bank — Tests & Test Questions (Phase 7)
-- Test creation & management: stores test metadata and the questions that
-- make up a test.
-- Apply this in the Supabase SQL editor (or via psql).
-- ============================================================================

-- 1. Tests
create table if not exists public.tests (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  description       text,
  standard_id       uuid references public.standards(id),
  subject_id        uuid references public.subjects(id),
  exam_type_id      uuid references public.exam_types(id),
  language_id       uuid references public.languages(id),
  duration_min      int default 60,
  total_marks       numeric default 0,
  passing_marks     numeric default 0,
  shuffle_questions boolean default true,
  shuffle_options   boolean default true,
  show_results      boolean default true,
  show_answers      boolean default false,
  status            text not null default 'draft' check (status in ('draft','published','archived')),
  created_by        uuid references public.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 2. Test Questions (link table: which questions belong to a test)
create table if not exists public.test_questions (
  id            uuid primary key default gen_random_uuid(),
  test_id       uuid not null references public.tests(id) on delete cascade,
  question_id   uuid not null references public.questions(id) on delete cascade,
  sort_order    int default 0,
  marks         numeric default 0,
  unique(test_id, question_id)
);

-- 3. auto-update updated_at on tests
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_tests_updated_at on public.tests;
create trigger trg_tests_updated_at
  before update on public.tests
  for each row execute function public.set_updated_at();

-- 4. Indexes
create index if not exists idx_tests_standard on public.tests(standard_id);
create index if not exists idx_tests_subject on public.tests(subject_id);
create index if not exists idx_tests_status on public.tests(status);
create index if not exists idx_test_questions_test on public.test_questions(test_id);
create index if not exists idx_test_questions_question on public.test_questions(question_id);

-- 5. Row Level Security (enabled; default deny, admin service role bypasses)
alter table public.tests enable row level security;
alter table public.test_questions enable row level security;
