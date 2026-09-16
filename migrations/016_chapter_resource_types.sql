-- 016: Convert chapters.resource_type_id (single FK) → chapter_resource_types (many-to-many)
-- A chapter can now belong to multiple resource types (e.g. NCERT + JEE)

-- 1. Create junction table
create table if not exists public.chapter_resource_types (
  id              uuid primary key default gen_random_uuid(),
  chapter_id      uuid not null references public.chapters(id) on delete cascade,
  resource_type_id uuid not null references public.resource_types(id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique(chapter_id, resource_type_id)
);

-- 2. Migrate existing data from chapters.resource_type_id → junction table
insert into public.chapter_resource_types (chapter_id, resource_type_id)
select id, resource_type_id from public.chapters
where resource_type_id is not null
on conflict do nothing;

-- 3. Drop the old single-FK column
alter table public.chapters drop column if exists resource_type_id;

-- 4. Drop the old unique constraint that included resource_type_id
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'chapters_subject_standard_resource_name_key'
      and conrelid = 'public.chapters'::regclass
  ) then
    alter table public.chapters drop constraint chapters_subject_standard_resource_name_key;
  end if;
end $$;

-- 5. Restore unique constraint on (subject_id, standard_id, name) — resource type is now separate
-- Only add if it doesn't already exist
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chapters_subject_id_standard_id_name_key'
      and conrelid = 'public.chapters'::regclass
  ) then
    alter table public.chapters
      add constraint chapters_subject_id_standard_id_name_key
      unique (subject_id, standard_id, name);
  end if;
end $$;

-- 6. Enable RLS on the junction table
alter table public.chapter_resource_types enable row level security;
