-- ============================================================================
-- Question Bank — Paper Lifecycle Management (Paper Generator Phase 16)
-- Adds the "validated" status to the Draft → Validated → Published →
-- Archived lifecycle, and lifecycle timestamps that record when each key
-- transition happened. Fully additive: existing rows get NULL timestamps;
-- published rows are backfilled with updated_at.
--
-- Apply this in the Supabase SQL editor (or via psql).
-- ============================================================================

-- 1. Extend the status check constraint to include 'validated'.
--    Postgres stores auto-generated constraints with an internal name, so we
--    must drop-and-re-add. Wrapped in a block that silently succeeds if the
--    old constraint is already gone (idempotent re-apply).
do $$
begin
  alter table public.papers drop constraint if exists papers_status_check;
  alter table public.papers add constraint papers_status_check
    check (status in ('draft','validated','published','archived'));
exception when undefined_object then null;
end $$;

-- 2. Lifecycle timestamp columns (nullable, set on transition).
alter table public.papers add column if not exists validated_at  timestamptz;
alter table public.papers add column if not exists published_at  timestamptz;
alter table public.papers add column if not exists archived_at   timestamptz;

-- 3. Backfill published_at for rows that are already published.
update public.papers
set published_at = updated_at
where status = 'published' and published_at is null;

-- 4. Index on status (already exists from migration 006, but add a composite
--    index useful for dashboard counts + filtered lists.
create index if not exists idx_papers_status_updated
  on public.papers (status, updated_at desc);