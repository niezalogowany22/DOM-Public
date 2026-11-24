-- =====================================================================
-- Dom — lista zakupów i karty lojalnościowe (etap 3)
-- Supabase → SQL Editor → New query → wklej całość → Run.
-- Wymaga wcześniej uruchomionego schema.sql z Liczników (households, is_member).
-- Skrypt można uruchomić ponownie.
-- =====================================================================

-- Lista zakupów (jedna wspólna na dom). id nadaje telefon — działa offline.
create table if not exists shop_items (
  id           uuid primary key,
  household_id uuid not null references households(id) on delete cascade,
  name         text not null,
  qty          text,
  aisle        text not null default 'Inne',
  done         boolean not null default false,
  done_at      timestamptz,
  created_by   uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists shop_items_hh on shop_items(household_id);

-- Zapamiętane produkty: podpowiedzi i dział przypisany przez was
create table if not exists shop_known (
  household_id uuid not null references households(id) on delete cascade,
  name_key     text not null,
  name         text not null,
  aisle        text not null default 'Inne',
  uses         int not null default 1,
  last_used    timestamptz not null default now(),
  primary key (household_id, name_key)
);

-- Karty lojalnościowe (wspólne)
create table if not exists loyalty_cards (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name         text not null,
  number       text not null,
  format       text not null default 'CODE128',
  color        text not null default '#2f6f62',
  note         text,
  position     int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists t_shop_items_touch on shop_items;
create trigger t_shop_items_touch before update on shop_items
  for each row execute function touch_updated_at();
drop trigger if exists t_loyalty_touch on loyalty_cards;
create trigger t_loyalty_touch before update on loyalty_cards
  for each row execute function touch_updated_at();

alter table shop_items    enable row level security;
alter table shop_known    enable row level security;
alter table loyalty_cards enable row level security;

drop policy if exists p_shop_items_all on shop_items;
create policy p_shop_items_all on shop_items for all
  using (is_member(household_id)) with check (is_member(household_id));
drop policy if exists p_shop_known_all on shop_known;
create policy p_shop_known_all on shop_known for all
  using (is_member(household_id)) with check (is_member(household_id));
drop policy if exists p_loyalty_all on loyalty_cards;
create policy p_loyalty_all on loyalty_cards for all
  using (is_member(household_id)) with check (is_member(household_id));

do $$ begin
  begin alter publication supabase_realtime add table shop_items;    exception when others then null; end;
  begin alter publication supabase_realtime add table loyalty_cards; exception when others then null; end;
end $$;
