-- ============================================================================
-- Question Bank — Question tables (Phase 0)
-- Questions, Options, Payloads, Images
-- Apply this in the Supabase SQL editor (or via psql).
-- ============================================================================

-- 1. Question Banks (collection of questions)
create table if not exists public.question_banks (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  description     text,
  owner_id        uuid not null references public.users(id) on delete cascade,
  status          text not null default 'draft' check (status in ('draft','published','archived')),
  visibility      text not null default 'private' check (visibility in ('private','shared','public')),
  question_count  int not null default 0,
  total_marks     int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 2. Questions (core question table)
create table if not exists public.questions (
  id              uuid primary key default gen_random_uuid(),
  bank_id         uuid references public.question_banks(id) on delete cascade,
  created_by      uuid not null references public.users(id),

  -- Hierarchy references
  standard_id     uuid references public.standards(id) on delete set null,
  subject_id      uuid references public.subjects(id) on delete set null,
  chapter_id      uuid references public.chapters(id) on delete set null,
  topic_id        uuid references public.topics(id) on delete set null,

  -- Classification
  type            text not null check (type in (
    'mcq_single','mcq_multi','true_false','fill_blank',
    'short_answer','long_answer','match','ordering','image_based','numeric'
  )),
  exam_type_id    uuid references public.exam_types(id) on delete set null,
  language_id     uuid references public.languages(id) on delete set null,
  difficulty      text check (difficulty in ('easy','medium','hard','expert')),
  level_id        uuid references public.question_levels(id) on delete set null,
  exam_year       int,                     -- year question was used/designed for (e.g. 2024, 2025)

  -- Content
  content         jsonb not null,           -- Tiptap JSON (question stem)
  explanation     jsonb,                    -- Solution Tiptap JSON
  image_url       text,                     -- Optional question image

  -- Scoring
  marks           int not null default 1,
  negative_marks  int not null default 0,
  time_limit_sec  int,                      -- optional per-question time limit

  -- Quality & analytics (auto-calculated)
  quality_score   int default 0,            -- 0-100 auto-calculated score

  -- Metadata
  tags            text[] default '{}',
  status          text not null default 'draft' check (status in ('draft','published','archived')),
  sort_order      int not null default 0,

  -- Timestamps
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 3. Question Options (for MCQ types)
create table if not exists public.question_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  label       text not null,               -- "A", "B", "C", "D"
  content     jsonb not null,              -- Tiptap JSON (supports math, images)
  is_correct  boolean not null default false,
  sort_order  int not null default 0
);

-- 4. Question Payloads (type-specific data)
create table if not exists public.question_payloads (
  question_id   uuid primary key references public.questions(id) on delete cascade,
  payload       jsonb not null default '{}',
  -- Examples:
  -- mcq_single: { "correctIndex": 2 }
  -- mcq_multi:  { "correctIndexes": [0, 2] }
  -- true_false: { "correctAnswer": true }
  -- fill_blank: { "answers": ["20", "twenty"], "caseSensitive": false }
  -- short_answer: { "modelAnswer": "The value of A is 20." }
  -- long_answer: { "modelAnswer": "...", "rubric": { "total": 5, "criteria": [...] } }
  -- numeric:    { "value": 9.8, "tolerance": 0.1, "unit": "m/s²" }
  -- match:      { "pairs": [{ "left": "A", "right": "1" }, ...] }
  -- ordering:   { "correctOrder": ["item3", "item1", "item2"] }
  created_at    timestamptz not null default now()
);

-- 5. Question Images (multiple images per question)
create table if not exists public.question_images (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  url         text not null,
  alt_text    text,
  width       int,
  height      int,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- updated_at triggers
-- ============================================================================

drop trigger if exists set_question_banks_updated_at on public.question_banks;
create trigger set_question_banks_updated_at
  before update on public.question_banks
  for each row execute function public.set_updated_at();

drop trigger if exists set_questions_updated_at on public.questions;
create trigger set_questions_updated_at
  before update on public.questions
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Auto-update question_count on question_banks when questions change
-- ============================================================================

create or replace function public.update_bank_question_count()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    update public.question_banks
    set question_count = (
      select count(*) from public.questions where bank_id = NEW.bank_id
    ),
    total_marks = (
      select coalesce(sum(marks), 0) from public.questions where bank_id = NEW.bank_id
    )
    where id = NEW.bank_id;
    return NEW;
  elsif TG_OP = 'DELETE' then
    update public.question_banks
    set question_count = (
      select count(*) from public.questions where bank_id = OLD.bank_id
    ),
    total_marks = (
      select coalesce(sum(marks), 0) from public.questions where bank_id = OLD.bank_id
    )
    where id = OLD.bank_id;
    return OLD;
  elsif TG_OP = 'UPDATE' then
    -- If bank changed, update both old and new
    if OLD.bank_id is distinct from NEW.bank_id then
      update public.question_banks
      set question_count = (select count(*) from public.questions where bank_id = OLD.bank_id),
          total_marks = (select coalesce(sum(marks), 0) from public.questions where bank_id = OLD.bank_id)
      where id = OLD.bank_id;
      update public.question_banks
      set question_count = (select count(*) from public.questions where bank_id = NEW.bank_id),
          total_marks = (select coalesce(sum(marks), 0) from public.questions where bank_id = NEW.bank_id)
      where id = NEW.bank_id;
    else
      update public.question_banks
      set question_count = (select count(*) from public.questions where bank_id = NEW.bank_id),
          total_marks = (select coalesce(sum(marks), 0) from public.questions where bank_id = NEW.bank_id)
      where id = NEW.bank_id;
    end if;
    return NEW;
  end if;
end $$;

drop trigger if exists update_bank_count_on_question_change on public.questions;
create trigger update_bank_count_on_question_change
  after insert or update or delete on public.questions
  for each row execute function public.update_bank_question_count();

-- ============================================================================
-- RLS policies
-- ============================================================================

alter table public.question_banks enable row level security;
alter table public.questions enable row level security;
alter table public.question_options enable row level security;
alter table public.question_payloads enable row level security;
alter table public.question_images enable row level security;
