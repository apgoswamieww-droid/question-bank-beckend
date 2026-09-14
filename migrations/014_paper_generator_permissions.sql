-- ============================================================================
-- Question Bank — Paper Generator Permission Integration (Phase 17)
-- Gives the Paper Generator module its own permission codes inside the
-- EXISTING permissions/role_permissions architecture (no new system):
-- previously its routes borrowed question_banks.view/manage.
--
-- Fully additive and idempotent. Every existing role (including custom roles)
-- is granted the Paper Generator permissions matching its CURRENT effective
-- access via question_banks, so behavior does not change for anyone:
--   question_banks.view   → papers.view, papers.export, papers.reports.view
--   question_banks.manage → papers.manage, papers.generate, papers.publish,
--                           papers.templates.manage, papers.translations.manage,
--                           papers.delete (+ the view set)
-- Apply in the Supabase SQL editor (or via psql).
-- ============================================================================

-- 1. New permission rows (idempotent).
insert into public.permissions (code, label, description)
values
  ('papers.view', 'View papers', 'View papers, structure, versions, analysis and print data in the Paper Generator'),
  ('papers.manage', 'Manage papers', 'Create, edit, duplicate, validate, archive and restore papers'),
  ('papers.delete', 'Delete papers', 'Delete papers that are not published'),
  ('papers.publish', 'Publish papers', 'Validate and publish papers'),
  ('papers.generate', 'Generate papers', 'Generate paper questions from blueprints and randomization sets'),
  ('papers.export', 'Export paper PDFs', 'Export papers as PDF files'),
  ('papers.templates.manage', 'Manage paper templates', 'Create, edit and delete saved paper templates'),
  ('papers.translations.manage', 'Manage paper translations', 'Manage translation readiness and generate language papers'),
  ('papers.reports.view', 'View paper reports', 'View paper answer keys and solutions reports')
on conflict (code) do nothing;

-- 2. Preserve existing effective access for EVERY role (custom roles too).
--    Roles that could see papers keep seeing them; roles that could manage
--    them keep managing them. super_admin is bypassed in hasPermission() and
--    needs no rows.
insert into public.role_permissions (role_code, permission_code)
-- view-level: anyone who currently has question_banks.view
select distinct rp.role_code, new_perms.code
from public.role_permissions rp
join public.permissions seed
  on seed.code = 'question_banks.view' and rp.permission_code = seed.code
cross join (values
  ('papers.view'), ('papers.export'), ('papers.reports.view')
) as new_perms(code)
where not exists (
  select 1 from public.role_permissions existing
  where existing.role_code = rp.role_code
    and existing.permission_code = new_perms.code
)
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code)
-- manage-level: anyone who currently has question_banks.manage (also covers
-- the view rows above, which the where-not-exists already skipped).
select distinct rp.role_code, new_perms.code
from public.role_permissions rp
join public.permissions seed
  on seed.code = 'question_banks.manage' and rp.permission_code = seed.code
cross join (values
  ('papers.view'), ('papers.manage'), ('papers.delete'), ('papers.publish'),
  ('papers.generate'), ('papers.export'), ('papers.templates.manage'),
  ('papers.translations.manage'), ('papers.reports.view')
) as new_perms(code)
where not exists (
  select 1 from public.role_permissions existing
  where existing.role_code = rp.role_code
    and existing.permission_code = new_perms.code
)
on conflict do nothing;

-- 3. Composite index for permission lookups (same shape as existing ones).
create index if not exists idx_role_permissions_role
  on public.role_permissions (role_code, permission_code);
