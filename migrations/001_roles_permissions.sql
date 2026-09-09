-- ============================================================================
-- Question Bank — Roles, Permissions & Users schema (Supabase/Postgres)
-- Apply this in the Supabase SQL editor (or via psql).
-- ============================================================================

-- 1. Role enum
do $$ begin
  create type public.user_role as enum ('super_admin', 'teacher', 'student');
exception when duplicate_object then null; end $$;

-- 2. users table (replaces server/data/users.json).
-- NOTE: the legacy `username` column is retained (populated with the email by
-- the server) purely for back-compat; username is no longer part of the product.
create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,
  email         text not null unique,
  password_hash text not null,
  full_name     text not null,
  role          public.user_role not null default 'student',
  active        boolean not null default true,
  profile_image text,
  -- Teacher registration fields (only meaningful for role = 'teacher')
  phone         text,
  gender        text,
  date_of_birth date,
  address       text,
  hire_date     date,
  subject       text,
  qualification text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Idempotent: add columns if upgrading an existing database.
alter table public.users add column if not exists profile_image text;
alter table public.users add column if not exists phone text;
alter table public.users add column if not exists gender text;
alter table public.users add column if not exists date_of_birth date;
alter table public.users add column if not exists address text;
alter table public.users add column if not exists hire_date date;
alter table public.users add column if not exists subject text;
alter table public.users add column if not exists qualification text;

-- 3. roles
create table if not exists public.roles (
  code        text primary key,
  name        text not null,
  description text
);

-- 4. permissions (flat, module-level codes)
create table if not exists public.permissions (
  code        text primary key,
  label       text not null,
  description text
);

-- 5. role_permissions (which permission each role has)
create table if not exists public.role_permissions (
  role_code       text not null references public.roles(code) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

-- Optional updated_at trigger keeps timestamps fresh on edits
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists set_users_updated_at on public.users;
create trigger set_users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- RLS: enforce server-only writes via service role / direct connection.
-- The Express server uses the service role key (bypasses RLS), so we enable
-- RLS but deny all direct public access by default.
alter table public.users enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;

-- ============================================================================
-- Seed data (idempotent)
-- ============================================================================

insert into public.roles (code, name, description)
values
  ('super_admin', 'Super Admin', 'Full access to all modules and settings'),
  ('teacher', 'Teacher', 'Manage question banks and their own content'),
  ('student', 'Student', 'View assigned question banks and take tests')
on conflict (code) do nothing;

insert into public.permissions (code, label, description)
values
  ('users.view', 'View users', 'View the list of users in the admin panel'),
  ('users.manage', 'Manage users', 'Create, edit and deactivate users'),
  ('roles.manage', 'Manage roles', 'View and edit role permissions'),
  ('question_banks.view', 'View question banks', 'View question bank contents'),
  ('question_banks.manage', 'Manage question banks', 'Create and edit question banks'),
  ('settings.view', 'View settings', 'View platform settings')
on conflict (code) do nothing;

-- Default permission matrix
insert into public.role_permissions (role_code, permission_code)
values
  -- super_admin: everything
  ('super_admin', 'users.view'),
  ('super_admin', 'users.manage'),
  ('super_admin', 'roles.manage'),
  ('super_admin', 'question_banks.view'),
  ('super_admin', 'question_banks.manage'),
  ('super_admin', 'settings.view'),
  -- teacher
  ('teacher', 'question_banks.view'),
  ('teacher', 'question_banks.manage'),
  -- student
  ('student', 'question_banks.view')
on conflict (role_code, permission_code) do nothing;
