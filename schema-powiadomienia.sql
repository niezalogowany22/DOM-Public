-- =====================================================================
-- Dom — powiadomienia + osobne listy zakupów (etap 10)
-- Supabase → SQL Editor → New query → wklej całość → Run. Można uruchomić ponownie.
-- =====================================================================

-- Telefony zapisane do powiadomień (jeden wiersz = jedna przeglądarka/telefon)
create table if not exists push_subs (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade default auth.uid(),
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  prefs        jsonb not null default '{"shop":true,"expense":true,"budget":true,"bills":true,"warranty":true,"pantry":true}',
  device       text,
  created_at   timestamptz not null default now()
);
alter table push_subs enable row level security;
drop policy if exists p_push_subs_all on push_subs;
create policy p_push_subs_all on push_subs for all
  using (is_member(household_id)) with check (is_member(household_id) and user_id = auth.uid());

-- Listy zakupów: ogólna (list = null) + własne (IKEA, internet, budowlany…)
create table if not exists shop_lists (
  household_id uuid not null references households(id) on delete cascade,
  name         text not null,
  icon         text not null default '🛍️',
  position     int not null default 0,
  primary key (household_id, name)
);
alter table shop_lists enable row level security;
drop policy if exists p_shop_lists_all on shop_lists;
create policy p_shop_lists_all on shop_lists for all
  using (is_member(household_id)) with check (is_member(household_id));
alter table shop_items add column if not exists list text;

do $$ begin
  begin alter publication supabase_realtime add table shop_lists; exception when others then null; end;
end $$;
