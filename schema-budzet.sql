-- =====================================================================
-- Dom — budżet konta wspólnego, wpłaty, wydatki cykliczne (etap 7)
-- Supabase → SQL Editor → New query → wklej całość → Run. Można uruchomić ponownie.
-- =====================================================================

-- Ustawienia budżetu (jedno na dom)
create table if not exists budget_settings (
  household_id    uuid primary key references households(id) on delete cascade,
  monthly_limit   numeric,                 -- limit wydatków z konta wspólnego na miesiąc
  opening_balance numeric not null default 0,  -- stan konta wspólnego w dniu opening_date
  opening_date    date not null default current_date,
  updated_at      timestamptz not null default now()
);

-- Wpłaty na konto wspólne (i ewentualne wypłaty: kwota ujemna)
create table if not exists joint_deposits (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  person_id    uuid references split_people(id) on delete set null,
  amount       numeric not null,
  day          date not null default current_date,
  note         text,
  created_by   uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now()
);

-- Wydatki cykliczne
--   auto = true  → aplikacja sama dodaje wydatek w dniu płatności
--   auto = false → przypomina na ekranie Start, dodajesz jednym przyciskiem
create table if not exists recurring (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  title        text not null,
  amount       numeric not null check (amount >= 0),
  category_id  uuid references split_categories(id) on delete set null,
  source       text not null default 'joint' check (source in ('joint','private')),
  paid_by      uuid references split_people(id) on delete set null,
  split_mode   text not null default 'equal',
  shares       jsonb not null default '[]',
  day_of_month int not null default 1 check (day_of_month between 1 and 31),
  every_months int not null default 1 check (every_months between 1 and 24),
  start_month  date not null default date_trunc('month', current_date),
  end_month    date,
  auto         boolean not null default false,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Powiązanie wydatku z cyklicznym: jeden wydatek na okres (chroni przed duplikatami z dwóch telefonów)
alter table split_expenses add column if not exists recurring_id uuid references recurring(id) on delete set null;
alter table split_expenses add column if not exists period text;
create unique index if not exists split_expenses_recurring_period on split_expenses(recurring_id, period) where recurring_id is not null;

drop trigger if exists t_recurring_touch on recurring;
create trigger t_recurring_touch before update on recurring
  for each row execute function touch_updated_at();

alter table budget_settings enable row level security;
alter table joint_deposits  enable row level security;
alter table recurring       enable row level security;
drop policy if exists p_budget_all on budget_settings;
create policy p_budget_all on budget_settings for all
  using (is_member(household_id)) with check (is_member(household_id));
drop policy if exists p_deposits_all on joint_deposits;
create policy p_deposits_all on joint_deposits for all
  using (is_member(household_id)) with check (is_member(household_id));
drop policy if exists p_recurring_all on recurring;
create policy p_recurring_all on recurring for all
  using (is_member(household_id)) with check (is_member(household_id));

do $$ begin
  begin alter publication supabase_realtime add table budget_settings; exception when others then null; end;
  begin alter publication supabase_realtime add table joint_deposits;  exception when others then null; end;
  begin alter publication supabase_realtime add table recurring;       exception when others then null; end;
end $$;
