-- ============================================================================
-- Question Bank — History & Analytics tables (Phase 0)
-- Usage logging, edit history, performance tracking, aggregations
-- Apply this in the Supabase SQL editor (or via psql).
-- ============================================================================

-- 1. Question Usage Log (every time a question appears in a test)
create table if not exists public.question_usage_log (
  id            uuid primary key default gen_random_uuid(),
  question_id   uuid not null references public.questions(id) on delete cascade,
  test_id       uuid not null,
  used_by       uuid not null references public.users(id),
  school_id     uuid references public.schools(id),
  class_name    text,                       -- "Std 10 A", "Std 12 B"
  usage_type    text not null check (usage_type in (
    'test', 'quiz', 'practice', 'assignment', 'mock_exam'
  )),
  student_count int default 0,
  created_at    timestamptz not null default now()
);

-- 2. Question Edit History (every change to a question)
create table if not exists public.question_edit_history (
  id              uuid primary key default gen_random_uuid(),
  question_id     uuid not null references public.questions(id) on delete cascade,
  edited_by       uuid not null references public.users(id),
  field_changed   text not null,            -- 'content', 'answer', 'marks', etc.
  old_value       jsonb,                    -- previous value
  new_value       jsonb,                    -- new value
  change_summary  text,                     -- human-readable: "Changed answer from B to C"
  created_at      timestamptz not null default now()
);

-- 3. Question Performance (aggregated student performance per question)
create table if not exists public.question_performance (
  question_id       uuid primary key references public.questions(id) on delete cascade,
  total_attempts    int default 0,
  correct_count     int default 0,
  incorrect_count   int default 0,
  skipped_count     int default 0,
  avg_time_sec      float default 0,
  success_rate      float default 0,        -- percentage (0-100)
  difficulty_rating text,                   -- calculated from success_rate
  last_calculated   timestamptz default now()
);

-- 4. Question Teacher Usage (per-teacher aggregation)
create table if not exists public.question_teacher_usage (
  id            uuid primary key default gen_random_uuid(),
  question_id   uuid not null references public.questions(id) on delete cascade,
  teacher_id    uuid not null references public.users(id),
  usage_count   int not null default 1,
  first_used    timestamptz not null default now(),
  last_used     timestamptz not null default now(),
  unique(question_id, teacher_id)
);

-- 5. Question School Usage (per-school aggregation)
create table if not exists public.question_school_usage (
  id            uuid primary key default gen_random_uuid(),
  question_id   uuid not null references public.questions(id) on delete cascade,
  school_id     uuid not null references public.schools(id),
  teacher_id    uuid not null references public.users(id),
  usage_count   int not null default 1,
  first_used    timestamptz not null default now(),
  last_used     timestamptz not null default now(),
  unique(question_id, school_id, teacher_id)
);

-- ============================================================================
-- Function: Auto-update question performance after student answer
-- ============================================================================

create or replace function public.update_question_performance()
returns trigger language plpgsql as $$
begin
  -- Upsert performance record
  insert into public.question_performance (question_id, total_attempts, correct_count, incorrect_count, skipped_count, success_rate, last_calculated)
  values (
    NEW.question_id,
    1,
    case when NEW.is_correct = true then 1 else 0 end,
    case when NEW.is_correct = false then 1 else 0 end,
    case when NEW.is_correct is null then 1 else 0 end,
    0,
    now()
  )
  on conflict (question_id) do update set
    total_attempts = public.question_performance.total_attempts + 1,
    correct_count = public.question_performance.correct_count + case when NEW.is_correct = true then 1 else 0 end,
    incorrect_count = public.question_performance.incorrect_count + case when NEW.is_correct = false then 1 else 0 end,
    skipped_count = public.question_performance.skipped_count + case when NEW.is_correct is null then 1 else 0 end,
    avg_time_sec = (
      (public.question_performance.avg_time_sec * public.question_performance.total_attempts + coalesce(NEW.time_spent_sec, 0))
      / (public.question_performance.total_attempts + 1)
    ),
    success_rate = round(
      ((public.question_performance.correct_count + case when NEW.is_correct = true then 1 else 0 end)::float
      / (public.question_performance.total_attempts + 1) * 100), 2
    ),
    difficulty_rating = case
      when ((public.question_performance.correct_count + case when NEW.is_correct = true then 1 else 0 end)::float
            / (public.question_performance.total_attempts + 1) * 100) >= 80 then 'easy'
      when ((public.question_performance.correct_count + case when NEW.is_correct = true then 1 else 0 end)::float
            / (public.question_performance.total_attempts + 1) * 100) >= 50 then 'medium'
      when ((public.question_performance.correct_count + case when NEW.is_correct = true then 1 else 0 end)::float
            / (public.question_performance.total_attempts + 1) * 100) >= 20 then 'hard'
      else 'expert'
    end,
    last_calculated = now();

  return NEW;
end $$;

-- ============================================================================
-- Function: Auto-update quality_score on questions
-- ============================================================================

create or replace function public.update_question_quality_score()
returns trigger language plpgsql as $$
declare
  v_usage_score float := 0;
  v_performance_score float := 50;
  v_recency_score float := 0;
  v_freshness_score float := 0;
  v_total_usage int := 0;
  v_success_rate float := 0;
  v_last_used timestamptz;
  v_created_at timestamptz;
  v_score int;
begin
  -- Get question stats
  select
    coalesce(qp.total_attempts, 0),
    coalesce(qp.success_rate, 50),
    (select max(created_at) from public.question_usage_log where question_id = NEW.question_id),
    NEW.created_at
  into v_total_usage, v_success_rate, v_last_used, v_created_at;

  -- Usage score: 0-100 based on usage count (capped at 20 uses)
  v_usage_score := least(100, v_total_usage * 5);

  -- Performance score: 100 if success_rate is 40-80% (ideal difficulty), else lower
  if v_success_rate >= 40 and v_success_rate <= 80 then
    v_performance_score := 100;
  elsif v_success_rate < 40 then
    v_performance_score := v_success_rate; -- too hard
  else
    v_performance_score := 100 - (v_success_rate - 80); -- too easy
  end if;

  -- Recency score: 100 if used in last 30 days, decays after
  if v_last_used is not null then
    v_recency_score := greatest(0, 100 - (extract(day from now() - v_last_used) * 3.33));
  end if;

  -- Freshness score: 100 if created in last 90 days, decays after
  v_freshness_score := greatest(0, 100 - (extract(day from now() - v_created_at) * 1.11));

  -- Weighted average
  v_score := round(
    (v_usage_score * 0.3) +
    (v_performance_score * 0.3) +
    (v_recency_score * 0.2) +
    (v_freshness_score * 0.2)
  );

  -- Update the question
  update public.questions
  set quality_score = v_score
  where id = NEW.question_id;

  return NEW;
end $$;

-- ============================================================================
-- Indexes for performance
-- ============================================================================

-- question_banks
create index if not exists idx_qbanks_owner on public.question_banks(owner_id);
create index if not exists idx_qbanks_status on public.question_banks(status);

-- questions
create index if not exists idx_questions_bank on public.questions(bank_id);
create index if not exists idx_questions_created_by on public.questions(created_by);
create index if not exists idx_questions_standard on public.questions(standard_id);
create index if not exists idx_questions_subject on public.questions(subject_id);
create index if not exists idx_questions_chapter on public.questions(chapter_id);
create index if not exists idx_questions_topic on public.questions(topic_id);
create index if not exists idx_questions_type on public.questions(type);
create index if not exists idx_questions_difficulty on public.questions(difficulty);
create index if not exists idx_questions_exam_type on public.questions(exam_type_id);
create index if not exists idx_questions_language on public.questions(language_id);
create index if not exists idx_questions_status on public.questions(status);
create index if not exists idx_questions_tags on public.questions using GIN(tags);
create index if not exists idx_questions_active on public.questions(status) where status = 'published';
create index if not exists idx_questions_quality on public.questions(quality_score desc);
create index if not exists idx_questions_exam_year on public.questions(exam_year);

-- question_options
create index if not exists idx_options_question on public.question_options(question_id);

-- question_images
create index if not exists idx_images_question on public.question_images(question_id);

-- history & analytics
create index if not exists idx_usage_log_question on public.question_usage_log(question_id);
create index if not exists idx_usage_log_teacher on public.question_usage_log(used_by);
create index if not exists idx_usage_log_school on public.question_usage_log(school_id);
create index if not exists idx_usage_log_test on public.question_usage_log(test_id);

create index if not exists idx_edit_history_question on public.question_edit_history(question_id);
create index if not exists idx_edit_history_user on public.question_edit_history(edited_by);

create index if not exists idx_teacher_usage_question on public.question_teacher_usage(question_id);
create index if not exists idx_teacher_usage_teacher on public.question_teacher_usage(teacher_id);

create index if not exists idx_school_usage_question on public.question_school_usage(question_id);
create index if not exists idx_school_usage_school on public.question_school_usage(school_id);

-- masters
create index if not exists idx_chapters_subject on public.chapters(subject_id);
create index if not exists idx_chapters_standard on public.chapters(standard_id);
create index if not exists idx_topics_chapter on public.topics(chapter_id);

-- ============================================================================
-- RLS policies (server-only writes via service role)
-- ============================================================================

alter table public.question_usage_log enable row level security;
alter table public.question_edit_history enable row level security;
alter table public.question_performance enable row level security;
alter table public.question_teacher_usage enable row level security;
alter table public.question_school_usage enable row level security;
