-- =====================================================================
-- Dom — wydatki i wyjazdy (dzielenie kosztów jak w Tricount)
-- Uruchom w TYM SAMYM projekcie Supabase co Liczniki:
-- SQL Editor → New query → wklej całość → Run.
-- Korzysta z tabel households / household_members i funkcji is_member()
-- z Liczników. Skrypt można uruchomić ponownie.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Grupy rozliczeń
--   kind = 'home'  → wspólne wydatki domowe (jedna na dom)
--   kind = 'trip'  → wyjazd, osobne saldo; share_token = link do podglądu
-- ---------------------------------------------------------------------
create table if not exists split_groups (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  kind         text not null check (kind in ('home','trip')),
  name         text not null,
  currency     text not null default 'PLN',
  start_date   date,
  end_date     date,
  share_token  text unique,
  archived     boolean not null default false,
  created_by   uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists split_groups_one_home on split_groups(household_id) where kind = 'home';

-- Uczestnicy grupy. user_id = null → osoba bez konta (np. znajomy na wyjeździe)
create table if not exists split_people (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references split_groups(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  name         text not null,
  position     int not null default 0,
  created_at   timestamptz not null default now()
);

-- Kategorie wydatków (wspólne dla domu i wyjazdów)
create table if not exists split_categories (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name         text not null,
  icon         text not null default '•',
  position     int not null default 0,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Wydatki i przelewy
--   kind = 'expense'  → wydatek; kind = 'transfer' → zwrot pieniędzy
--   paid_by = null i source = 'joint' → zapłacone z konta wspólnego (bez długu)
--   rate: kurs do waluty grupy (1 gdy ta sama waluta)
--   split_mode: equal | shares | amounts
--   shares: [{"p": person_id, "w": waga}] albo [{"p": person_id, "a": kwota}]
-- ---------------------------------------------------------------------
create table if not exists split_expenses (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references split_groups(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  kind         text not null default 'expense' check (kind in ('expense','transfer')),
  title        text not null default '',
  amount       numeric not null check (amount >= 0),
  currency     text not null default 'PLN',
  rate         numeric not null default 1,
  spent_on     date not null default current_date,
  category_id  uuid references split_categories(id) on delete set null,
  source       text not null default 'private' check (source in ('joint','private')),
  paid_by      uuid references split_people(id) on delete cascade,
  split_mode   text not null default 'equal' check (split_mode in ('equal','shares','amounts')),
  shares       jsonb not null default '[]',
  receipt_path text,
  note         text,
  created_by   uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (source = 'joint' or paid_by is not null)
);
create index if not exists split_expenses_group on split_expenses(group_id, spent_on);

drop trigger if exists t_split_groups_touch on split_groups;
create trigger t_split_groups_touch before update on split_groups
  for each row execute function touch_updated_at();
drop trigger if exists t_split_expenses_touch on split_expenses;
create trigger t_split_expenses_touch before update on split_expenses
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
-- Uprawnienia: tylko członkowie domu
-- ---------------------------------------------------------------------
alter table split_groups     enable row level security;
alter table split_people     enable row level security;
alter table split_categories enable row level security;
alter table split_expenses   enable row level security;

drop policy if exists p_split_groups_all on split_groups;
create policy p_split_groups_all on split_groups for all
  using (is_member(household_id)) with check (is_member(household_id));
drop policy if exists p_split_people_all on split_people;
create policy p_split_people_all on split_people for all
  using (is_member(household_id)) with check (is_member(household_id));
drop policy if exists p_split_categories_all on split_categories;
create policy p_split_categories_all on split_categories for all
  using (is_member(household_id)) with check (is_member(household_id));
drop policy if exists p_split_expenses_all on split_expenses;
create policy p_split_expenses_all on split_expenses for all
  using (is_member(household_id)) with check (is_member(household_id));

-- ---------------------------------------------------------------------
-- Zdjęcia paragonów: prywatny bucket, ścieżka <household_id>/<plik>.jpg
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('receipts', 'receipts', false) on conflict (id) do nothing;

drop policy if exists p_receipts_rw on storage.objects;
create policy p_receipts_rw on storage.objects for all to authenticated
  using (bucket_id = 'receipts' and is_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'receipts' and is_member(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------------------
-- Podgląd wyjazdu z linku (bez logowania, tylko odczyt).
-- Nie zwraca paragonów ani notatek.
-- ---------------------------------------------------------------------
create or replace function trip_public(p_token text)
returns json language plpgsql security definer stable set search_path = public as $$
declare g split_groups;
begin
  if p_token is null or length(p_token) < 16 then return null; end if;
  select * into g from split_groups where share_token = p_token and kind = 'trip';
  if g.id is null then return null; end if;
  return json_build_object(
    'group', json_build_object('name', g.name, 'currency', g.currency,
                               'start_date', g.start_date, 'end_date', g.end_date),
    'people', coalesce((select json_agg(json_build_object('id', id, 'name', name) order by position, created_at)
                        from split_people where group_id = g.id), '[]'::json),
    'expenses', coalesce((select json_agg(json_build_object(
                  'kind', e.kind, 'title', e.title, 'amount', e.amount, 'currency', e.currency,
                  'rate', e.rate, 'spent_on', e.spent_on, 'source', e.source, 'paid_by', e.paid_by,
                  'split_mode', e.split_mode, 'shares', e.shares,
                  'category', c.name, 'icon', c.icon) order by e.spent_on desc, e.created_at desc)
                  from split_expenses e left join split_categories c on c.id = e.category_id
                  where e.group_id = g.id), '[]'::json)
  );
end $$;
grant execute on function trip_public(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Zmiany na żywo
-- ---------------------------------------------------------------------
do $$ begin
  begin alter publication supabase_realtime add table split_groups;     exception when others then null; end;
  begin alter publication supabase_realtime add table split_people;     exception when others then null; end;
  begin alter publication supabase_realtime add table split_categories; exception when others then null; end;
  begin alter publication supabase_realtime add table split_expenses;   exception when others then null; end;
end $$;
