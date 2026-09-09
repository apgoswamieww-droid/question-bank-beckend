-- ============================================================================
-- Question Bank — Master Data tables (Phase 0)
-- Standards, Subjects, Chapters, Topics, Exam Types, Languages, Schools
-- Apply this in the Supabase SQL editor (or via psql).
-- ============================================================================

-- 1. Standards (Std 1 through Std 12)
create table if not exists public.standards (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,       -- "Std 1", "Std 2", ... "Std 12"
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2. Subjects (Maths, Science, English, etc.)
create table if not exists public.subjects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,       -- "Mathematics", "Science", "English"
  icon        text,                        -- emoji or icon name
  color       text,                        -- hex color for UI
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 3. Chapters (linked to subject + standard)
create table if not exists public.chapters (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  standard_id uuid not null references public.standards(id) on delete cascade,
  name        text not null,              -- "Ch 1 - Real Numbers"
  number      int,                        -- chapter number for ordering
  description text,
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(subject_id, standard_id, name)
);

-- 4. Topics (linked to chapter)
create table if not exists public.topics (
  id          uuid primary key default gen_random_uuid(),
  chapter_id  uuid not null references public.chapters(id) on delete cascade,
  name        text not null,              -- "1.1 Euclid's Division Lemma"
  number      text,                       -- "1.1", "1.2", etc.
  description text,
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 5. Exam Types
create table if not exists public.exam_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,       -- "Board Exam (GSEB)", "Unit Test"
  category    text,                       -- "board", "unit", "competitive", "practice"
  description text,
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 6. Languages
create table if not exists public.languages (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,       -- "en", "gu", "hi"
  name        text not null,              -- "English", "Gujarati", "Hindi"
  native_name text,                       -- "ગુજરાતी", "हिन्दी"
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 7. Question Levels (Easy, Medium, Hard, Expert)
create table if not exists public.question_levels (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,       -- "easy", "medium", "hard", "expert"
  name        text not null,              -- "Easy", "Medium", "Hard", "Expert"
  color       text,                       -- hex color for UI badges
  icon        text,                       -- emoji or icon name
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 8. Schools (institutions)
create table if not exists public.schools (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  code            text unique,            -- school code/ID
  district        text,
  city            text,
  state           text,
  board           text,                   -- GSEB, CBSE, ICSE
  type            text,                   -- government, private, semi-govt
  contact_email   text,
  contact_phone   text,
  address         text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 9. Add school_id to users table (link teachers to schools)
alter table public.users add column if not exists school_id uuid references public.schools(id);

-- ============================================================================
-- updated_at triggers for all new tables
-- ============================================================================

drop trigger if exists set_standards_updated_at on public.standards;
create trigger set_standards_updated_at
  before update on public.standards
  for each row execute function public.set_updated_at();

drop trigger if exists set_subjects_updated_at on public.subjects;
create trigger set_subjects_updated_at
  before update on public.subjects
  for each row execute function public.set_updated_at();

drop trigger if exists set_chapters_updated_at on public.chapters;
create trigger set_chapters_updated_at
  before update on public.chapters
  for each row execute function public.set_updated_at();

drop trigger if exists set_topics_updated_at on public.topics;
create trigger set_topics_updated_at
  before update on public.topics
  for each row execute function public.set_updated_at();

drop trigger if exists set_exam_types_updated_at on public.exam_types;
create trigger set_exam_types_updated_at
  before update on public.exam_types
  for each row execute function public.set_updated_at();

drop trigger if exists set_languages_updated_at on public.languages;
create trigger set_languages_updated_at
  before update on public.languages
  for each row execute function public.set_updated_at();

drop trigger if exists set_question_levels_updated_at on public.question_levels;
create trigger set_question_levels_updated_at
  before update on public.question_levels
  for each row execute function public.set_updated_at();

drop trigger if exists set_schools_updated_at on public.schools;
create trigger set_schools_updated_at
  before update on public.schools
  for each row execute function public.set_updated_at();

-- ============================================================================
-- RLS policies (server-only writes via service role)
-- ============================================================================

alter table public.standards enable row level security;
alter table public.subjects enable row level security;
alter table public.chapters enable row level security;
alter table public.topics enable row level security;
alter table public.exam_types enable row level security;
alter table public.languages enable row level security;
alter table public.question_levels enable row level security;
alter table public.schools enable row level security;

-- ============================================================================
-- Seed data (idempotent)
-- ============================================================================

-- Standards
insert into public.standards (name, sort_order) values
  ('Std 1', 1), ('Std 2', 2), ('Std 3', 3), ('Std 4', 4),
  ('Std 5', 5), ('Std 6', 6), ('Std 7', 7), ('Std 8', 8),
  ('Std 9', 9), ('Std 10', 10), ('Std 11', 11), ('Std 12', 12)
on conflict (name) do nothing;

-- Subjects
insert into public.subjects (name, icon, color, sort_order) values
  ('Mathematics', '📐', '#3B82F6', 1),
  ('Science', '🔬', '#10B981', 2),
  ('English', '📚', '#8B5CF6', 3),
  ('Social Science', '🌍', '#F59E0B', 4),
  ('Gujarati', '📖', '#EF4444', 5),
  ('Hindi', '📝', '#F97316', 6),
  ('Computer Science', '💻', '#06B6D4', 7),
  ('Physical Education', '⚽', '#84CC16', 8)
on conflict (name) do nothing;

-- Exam Types
insert into public.exam_types (name, category, sort_order) values
  ('Board Exam (GSEB)', 'board', 1),
  ('Board Exam (CBSE)', 'board', 2),
  ('Board Exam (ICSE)', 'board', 3),
  ('Unit Test', 'unit', 4),
  ('Semester Exam', 'unit', 5),
  ('Mid-Term Exam', 'unit', 6),
  ('Final Exam', 'unit', 7),
  ('Practice / Homework', 'practice', 8),
  ('Competitive (JEE)', 'competitive', 9),
  ('Competitive (NEET)', 'competitive', 10),
  ('Competitive (GUJCET)', 'competitive', 11),
  ('Olympiad', 'competitive', 12)
on conflict (name) do nothing;

-- Languages
insert into public.languages (code, name, native_name) values
  ('en', 'English', 'English'),
  ('gu', 'Gujarati', 'ગુજરાતી'),
  ('hi', 'Hindi', 'हिन्दी'),
  ('bn', 'Bilingual (EN+GU)', 'Bilingual')
on conflict (code) do nothing;

-- Question Levels
insert into public.question_levels (code, name, color, icon, sort_order) values
  ('easy', 'Easy', '#10B981', '🟢', 1),
  ('medium', 'Medium', '#F59E0B', '🟡', 2),
  ('hard', 'Hard', '#EF4444', '🔴', 3),
  ('expert', 'Expert', '#6B21A8', '⚫', 4)
on conflict (code) do nothing;
