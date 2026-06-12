-- =========================================================================
-- BLACK VULTURE — Supabase schema (stocks + transactions + compteur msgs)
-- À coller dans : Supabase Dashboard → SQL Editor → New query → Run
-- (le même projet que dhs_state, ça cohabite sans problème)
-- =========================================================================

-- 1) Stock courant : une ligne par (stockage, item)
create table if not exists public.bv_items (
  storage     text not null,
  item        text not null,
  category    text not null default 'Divers',
  qty         integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (storage, item)
);

-- 2) Historique des mouvements (sert au résumé de minuit + feed du site)
create table if not exists public.bv_transactions (
  id      bigint generated always as identity primary key,
  ts      timestamptz not null default now(),
  day     text not null,            -- 'YYYY-MM-DD' en heure de Paris
  storage text not null,
  item    text not null,
  delta   integer not null,         -- +5 / -2
  author  text,
  raw     text                      -- message d'origine pour debug
);
create index if not exists bv_transactions_day_idx on public.bv_transactions(day);

-- 3) Compteur de messages par jour
create table if not exists public.bv_daily (
  day      text primary key,        -- 'YYYY-MM-DD'
  messages integer not null default 0
);

-- 4) RLS : la clé publishable peut lire/écrire ces 3 tables (et rien d'autre)
alter table public.bv_items enable row level security;
alter table public.bv_transactions enable row level security;
alter table public.bv_daily enable row level security;

drop policy if exists "bv_items_all" on public.bv_items;
create policy "bv_items_all" on public.bv_items
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "bv_transactions_all" on public.bv_transactions;
create policy "bv_transactions_all" on public.bv_transactions
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "bv_daily_all" on public.bv_daily;
create policy "bv_daily_all" on public.bv_daily
  for all to anon, authenticated using (true) with check (true);

-- 5) Realtime pour le site (ignore l'erreur "already member" si re-run)
do $$ begin
  alter publication supabase_realtime add table public.bv_items;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.bv_transactions;
exception when duplicate_object then null; end $$;
