-- =====================================================================
-- Dom — gwarancje i spiżarnia (etap 9)
-- Supabase → SQL Editor → New query → wklej całość → Run. Można uruchomić ponownie.
-- =====================================================================

create table if not exists warranties (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name         text not null,
  shop         text,
  bought_on    date not null default current_date,
  months       int not null default 24,
  price        numeric,
  receipt_path text,                 -- zdjęcie paragonu/karty gwarancyjnej (bucket receipts)
  expense_id   uuid references split_expenses(id) on delete set null,
  note         text,
  created_at   timestamptz not null default now()
);

create table if not exists pantry (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name         text not null,
  qty          text,
  place        text not null default 'Szafka',   -- Lodówka, Zamrażarka, Szafka, Chemia…
  expires      date,
  created_at   timestamptz not null default now()
);

alter table warranties enable row level security;
alter table pantry     enable row level security;
drop policy if exists p_warranties_all on warranties;
create policy p_warranties_all on warranties for all
  using (is_member(household_id)) with check (is_member(household_id));
drop policy if exists p_pantry_all on pantry;
create policy p_pantry_all on pantry for all
  using (is_member(household_id)) with check (is_member(household_id));

do $$ begin
  begin alter publication supabase_realtime add table warranties; exception when others then null; end;
  begin alter publication supabase_realtime add table pantry;     exception when others then null; end;
end $$;
