-- =====================================================================
-- Liczniki — schemat bazy dla Supabase
-- Wklej całość w Supabase → SQL Editor → New query → Run.
-- Skrypt można uruchomić ponownie (używa IF NOT EXISTS / OR REPLACE).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Gospodarstwo domowe i jego członkowie
-- ---------------------------------------------------------------------
create table if not exists households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Dom',
  invite_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  created_at  timestamptz not null default now()
);

create table if not exists household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- ---------------------------------------------------------------------
-- Odczyty liczników
--   kind:   prad | zw | cw | co
--   month:  pierwszy dzień miesiąca, który odczyt ZAMYKA
--           (odczyt zrobiony ~1 listopada = "za październik" = 2026-10-01)
--   Zużycie między dwoma kolejnymi odczytami dzieli się po równo
--   na miesiące pomiędzy nimi (np. rachunek za prąd za 2 miesiące).
--   Wymiana licznika: swap_old_final = ostatni stan starego licznika,
--                     swap_new_start = stan początkowy nowego,
--                     value          = stan nowego na koniec miesiąca.
-- ---------------------------------------------------------------------
create table if not exists readings (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references households(id) on delete cascade,
  kind           text not null check (kind in ('prad','zw','cw','co')),
  month          date not null check (extract(day from month) = 1),
  value          numeric not null,
  read_on        date,
  bill_amount    numeric,
  swap_old_final numeric,
  swap_new_start numeric,
  note           text,
  created_by     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (household_id, kind, month)
);

-- ---------------------------------------------------------------------
-- Stawki — każda wersja obowiązuje od valid_from do następnej wersji.
-- Wartości trzymane w jsonb (klucze opisane w js/calc.js → TARIFF_FIELDS),
-- dzięki temu dodanie nowej pozycji nie wymaga zmiany schematu.
-- ---------------------------------------------------------------------
create table if not exists tariffs (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  valid_from   date not null,
  vals         jsonb not null,
  note         text,
  created_by   uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (household_id, valid_from)
);

-- ---------------------------------------------------------------------
-- Okresy rozliczeniowe ze spółdzielnią
--   media:         które media obejmuje rozliczenie (zw, cw, co, smieci)
--   actual_amount: faktyczny wynik rozliczenia (+ zwrot, − dopłata)
-- ---------------------------------------------------------------------
create table if not exists settlement_periods (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  name          text not null,
  media         text[] not null default array['zw','cw','co','smieci'],
  start_month   date not null,
  end_month     date not null,
  actual_amount numeric,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_month >= start_month)
);

-- ---------------------------------------------------------------------
-- Wydatki jednorazowe (naprawa, zakup, dopłata itp.) przypisane do miesiąca
-- ---------------------------------------------------------------------
create table if not exists expenses (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  month        date not null check (extract(day from month) = 1),
  name         text not null,
  amount       numeric not null,
  note         text,
  created_by   uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists t_readings_touch on readings;
create trigger t_readings_touch before update on readings
  for each row execute function touch_updated_at();
drop trigger if exists t_tariffs_touch on tariffs;
create trigger t_tariffs_touch before update on tariffs
  for each row execute function touch_updated_at();
drop trigger if exists t_periods_touch on settlement_periods;
create trigger t_periods_touch before update on settlement_periods
  for each row execute function touch_updated_at();
drop trigger if exists t_expenses_touch on expenses;
create trigger t_expenses_touch before update on expenses
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
-- Uprawnienia (RLS): każdy widzi i edytuje tylko dane swojego domu
-- ---------------------------------------------------------------------
create or replace function is_member(h uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from household_members
                 where household_id = h and user_id = auth.uid());
$$;

alter table households         enable row level security;
alter table household_members  enable row level security;
alter table readings           enable row level security;
alter table tariffs            enable row level security;
alter table settlement_periods enable row level security;
alter table expenses           enable row level security;

drop policy if exists p_households_select on households;
create policy p_households_select on households for select using (is_member(id));
drop policy if exists p_households_update on households;
create policy p_households_update on households for update using (is_member(id));

drop policy if exists p_members_select on household_members;
create policy p_members_select on household_members for select using (is_member(household_id));
drop policy if exists p_members_update_self on household_members;
create policy p_members_update_self on household_members for update using (user_id = auth.uid());

drop policy if exists p_readings_all on readings;
create policy p_readings_all on readings for all
  using (is_member(household_id)) with check (is_member(household_id));
drop policy if exists p_tariffs_all on tariffs;
create policy p_tariffs_all on tariffs for all
  using (is_member(household_id)) with check (is_member(household_id));
drop policy if exists p_periods_all on settlement_periods;
create policy p_periods_all on settlement_periods for all
  using (is_member(household_id)) with check (is_member(household_id));
drop policy if exists p_expenses_all on expenses;
create policy p_expenses_all on expenses for all
  using (is_member(household_id)) with check (is_member(household_id));

-- ---------------------------------------------------------------------
-- Zakładanie domu i dołączanie kodem zaproszenia
-- ---------------------------------------------------------------------
create or replace function create_household(p_name text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'Brak zalogowanego użytkownika'; end if;
  insert into households(name) values (coalesce(nullif(p_name,''),'Dom')) returning id into h;
  insert into household_members(household_id, user_id, display_name)
    values (h, auth.uid(), p_display_name);
  return h;
end $$;

create or replace function join_household(p_code text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'Brak zalogowanego użytkownika'; end if;
  select id into h from households where invite_code = upper(trim(p_code));
  if h is null then raise exception 'Nieprawidłowy kod zaproszenia'; end if;
  insert into household_members(household_id, user_id, display_name)
    values (h, auth.uid(), p_display_name)
    on conflict (household_id, user_id) do update set display_name = excluded.display_name;
  return h;
end $$;

grant execute on function create_household(text, text) to authenticated;
grant execute on function join_household(text, text)   to authenticated;

-- ---------------------------------------------------------------------
-- Zmiany na żywo (druga osoba widzi wpisy od razu)
-- ---------------------------------------------------------------------
do $$ begin
  begin alter publication supabase_realtime add table readings;           exception when others then null; end;
  begin alter publication supabase_realtime add table tariffs;            exception when others then null; end;
  begin alter publication supabase_realtime add table settlement_periods; exception when others then null; end;
  begin alter publication supabase_realtime add table expenses;           exception when others then null; end;
end $$;
