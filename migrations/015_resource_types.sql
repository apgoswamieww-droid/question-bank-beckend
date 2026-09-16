-- 015: Resource Types master table + link to chapters
-- Resource types: NCERT, JEE, NEET, GUJCET, etc.

-- 1. Create resource_types table
create table if not exists public.resource_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  code        text,                       -- "NCERT", "JEE", etc.
  description text,
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2. Add resource_type_id FK to chapters (nullable — existing rows get NULL)
alter table public.chapters
  add column if not exists resource_type_id uuid references public.resource_types(id) on delete set null;

-- 3. Relax unique constraint: same chapter name can exist under different resource types
-- Drop old constraint (subject_id, standard_id, name) if it exists
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'chapters_subject_id_standard_id_name_key'
      and conrelid = 'public.chapters'::regclass
  ) then
    alter table public.chapters drop constraint chapters_subject_id_standard_id_name_key;
  end if;
end $$;

-- Add new constraint including resource_type_id
-- We use a conditional unique constraint: when resource_type_id is NULL, treat it as a unique combo
-- Simplified: just add the new composite unique (allows duplicates across resource types)
alter table public.chapters
  add constraint chapters_subject_standard_resource_name_key
  unique (subject_id, standard_id, resource_type_id, name);

-- 4. updated_at trigger for resource_types
create or replace function update_resource_types_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_resource_types_updated_at on public.resource_types;
create trigger set_resource_types_updated_at
  before update on public.resource_types
  for each row execute function update_resource_types_updated_at();
