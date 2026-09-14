-- ============================================================================
-- Paper Generator — Reusable Paper Templates (Phase 11)
-- One configurable, saved template drives the print engine for single-language
-- and bilingual papers. A template is a NAME + KIND + JSON CONFIG blob; it is
-- optional — a paper printed without a template uses the engine's built-in
-- safe defaults, so no branding is ever hard-coded in the PDF generator.
--
-- Fully additive: nothing changes on existing tables/rows.
-- Apply this in the Supabase SQL editor (or via psql).
-- ============================================================================

-- 1. Paper templates — one row per saved template.
create table if not exists public.paper_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  -- Which paper kinds the template may drive:
  --   single    = one language, single-column / custom layout
  --   bilingual = two languages side-by-side (two-column engine)
  --   custom    = any kind, exact config supplied by the admin
  kind          text not null default 'single'
                  check (kind in ('single','bilingual','custom')),
  -- JSON document with page, layout, typography, header/footer/branding,
  -- instructions, question spacing and section styling. Free-form so the
  -- engine stays the single interpretation layer (safe defaults first).
  config        jsonb not null default '{}'::jsonb,
  is_default    boolean not null default false,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 2. Indexes
create index if not exists idx_paper_templates_created_at
  on public.paper_templates (created_at desc);
create index if not exists idx_paper_templates_kind
  on public.paper_templates (kind);

-- Only ONE template per kind may be flagged as the default.
create unique index if not exists uq_paper_templates_default_per_kind
  on public.paper_templates (kind)
  where is_default;

-- 3. updated_at trigger
drop trigger if exists set_paper_templates_updated_at on public.paper_templates;
create trigger set_paper_templates_updated_at
  before update on public.paper_templates
  for each row execute function public.set_updated_at();

-- 4. Row Level Security (enabled; default deny, admin service role bypasses)
alter table public.paper_templates enable row level security;