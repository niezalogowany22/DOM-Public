-- =====================================================================
-- Dom — Grafik we wspólnej bazie (etap 13)
-- Każdy ma swój grafik i swoje kategorie; druga osoba widzi go w Dom (podgląd).
-- Zapis do Kalendarza Google przyciskiem „Zapisz”, przez ten sam Apps Script.
-- Supabase → SQL Editor → New query → wklej całość → Run. Można uruchomić ponownie.
-- =====================================================================

create table if not exists grafik_settings (
  household_id uuid primary key references households(id) on delete cascade,
  api_url      text,
  api_key      text,
  updated_at   timestamptz not null default now()
);

create table if not exists grafik_people (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  name         text not null,                 -- trafia do {osoba} w nazwie wydarzenia
  calendar_id  text,
  color        text not null default '#2563eb',
  daily_norm   numeric not null default 8,
  position     int not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists grafik_categories (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  person_id    uuid not null references grafik_people(id) on delete cascade,
  name         text not null default '',
  short        text not null default '',
  color        text not null default '#64748b',
  all_day      boolean not null default false,
  start_time   text,
  end_time     text,
  template     text not null default '{osoba} {od}-{do}',
  kind         text not null default 'work' check (kind in ('work','other','leave','off')),
  local        boolean not null default false,  -- tylko w Dom, nie trafia do kalendarza
  position     int not null default 0,
  created_at   timestamptz not null default now()
);

-- Dzień w grafiku. synced = false → zmiana jeszcze nie zapisana w Kalendarzu Google
create table if not exists grafik_days (
  household_id uuid not null references households(id) on delete cascade,
  person_id    uuid not null references grafik_people(id) on delete cascade,
  day          date not null,
  category_id  uuid references grafik_categories(id) on delete set null,
  raw          jsonb,                           -- wydarzenie z kalendarza bez pasującej kategorii
  synced       boolean not null default false,
  updated_by   uuid references auth.users(id) default auth.uid(),
  updated_at   timestamptz not null default now(),
  primary key (person_id, day)
);

-- właściciel grafiku = zalogowana osoba
create or replace function grafik_owner(p uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from grafik_people where id = p and user_id = auth.uid());
$$;

alter table grafik_settings   enable row level security;
alter table grafik_people     enable row level security;
alter table grafik_categories enable row level security;
alter table grafik_days       enable row level security;

drop policy if exists p_gs_all on grafik_settings;
create policy p_gs_all on grafik_settings for all using (is_member(household_id)) with check (is_member(household_id));

drop policy if exists p_gp_all on grafik_people;
create policy p_gp_all on grafik_people for all using (is_member(household_id)) with check (is_member(household_id));

-- kategorie: widzą wszyscy w domu; dodać może każdy (import), zmieniać/usuwać tylko właściciel
drop policy if exists p_gc_sel on grafik_categories;
drop policy if exists p_gc_ins on grafik_categories;
drop policy if exists p_gc_upd on grafik_categories;
drop policy if exists p_gc_del on grafik_categories;
create policy p_gc_sel on grafik_categories for select using (is_member(household_id));
create policy p_gc_ins on grafik_categories for insert with check (is_member(household_id));
create policy p_gc_upd on grafik_categories for update using (is_member(household_id) and grafik_owner(person_id)) with check (is_member(household_id));
create policy p_gc_del on grafik_categories for delete using (is_member(household_id) and grafik_owner(person_id));

-- dni: zmienia właściciel; druga osoba może tylko odświeżyć dane z kalendarza (synced = true)
drop policy if exists p_gd_sel on grafik_days;
drop policy if exists p_gd_ins on grafik_days;
drop policy if exists p_gd_upd on grafik_days;
drop policy if exists p_gd_del on grafik_days;
create policy p_gd_sel on grafik_days for select using (is_member(household_id));
create policy p_gd_ins on grafik_days for insert with check (is_member(household_id) and (grafik_owner(person_id) or synced));
create policy p_gd_upd on grafik_days for update using (is_member(household_id) and (grafik_owner(person_id) or synced))
  with check (is_member(household_id) and (grafik_owner(person_id) or synced));
create policy p_gd_del on grafik_days for delete using (is_member(household_id) and (grafik_owner(person_id) or synced));

do $$ begin
  begin alter publication supabase_realtime add table grafik_settings;   exception when others then null; end;
  begin alter publication supabase_realtime add table grafik_people;     exception when others then null; end;
  begin alter publication supabase_realtime add table grafik_categories; exception when others then null; end;
  begin alter publication supabase_realtime add table grafik_days;       exception when others then null; end;
end $$;
