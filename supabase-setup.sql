-- =========================================================================
-- D.H.S. Terminal — Supabase schema
-- À coller dans : Supabase Dashboard → SQL Editor → New query → Run
-- =========================================================================

-- 1) Table d'état partagé (une ligne par "room", on n'en utilise qu'une)
create table if not exists public.dhs_state (
  room        text primary key,
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- 2) Ligne par défaut (la room que le front utilise)
insert into public.dhs_state(room, state)
values ('default', '{}'::jsonb)
on conflict (room) do nothing;

-- 3) Row Level Security : tout le monde (clé anon) peut lire/écrire CETTE table,
--    et rien d'autre. La service_role key n'est jamais utilisée par le front.
alter table public.dhs_state enable row level security;

drop policy if exists "dhs_state_select_anon" on public.dhs_state;
create policy "dhs_state_select_anon"
  on public.dhs_state for select
  to anon, authenticated
  using (true);

drop policy if exists "dhs_state_upsert_anon" on public.dhs_state;
create policy "dhs_state_upsert_anon"
  on public.dhs_state for insert
  to anon, authenticated
  with check (true);

drop policy if exists "dhs_state_update_anon" on public.dhs_state;
create policy "dhs_state_update_anon"
  on public.dhs_state for update
  to anon, authenticated
  using (true) with check (true);

-- 4) Realtime : publier les changements de cette table
--    (équivalent UI : Database → Replication → cocher dhs_state)
alter publication supabase_realtime add table public.dhs_state;
