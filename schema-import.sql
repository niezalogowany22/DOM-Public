-- =====================================================================
-- Dom — import wyciągu z banku (etap 8)
-- Supabase → SQL Editor → New query → wklej całość → Run. Można uruchomić ponownie.
-- =====================================================================

-- Odcisk transakcji z banku: ten sam wiersz z wyciągu nie zaimportuje się dwa razy
alter table split_expenses add column if not exists import_ref text;
alter table joint_deposits add column if not exists import_ref text;
-- pełny (nie częściowy) indeks — wymagany przez upsert z on conflict; puste import_ref się nie blokują
drop index if exists split_expenses_import_ref;
drop index if exists joint_deposits_import_ref;
create unique index split_expenses_import_ref on split_expenses(household_id, import_ref);
create unique index joint_deposits_import_ref on joint_deposits(household_id, import_ref);

-- Zapamiętane kategorie: fragment opisu z banku → kategoria (np. "LIDL" → Spożywcze)
create table if not exists import_rules (
  household_id uuid not null references households(id) on delete cascade,
  pattern      text not null,
  category_id  uuid references split_categories(id) on delete cascade,
  title        text,
  primary key (household_id, pattern)
);
alter table import_rules enable row level security;
drop policy if exists p_import_rules_all on import_rules;
create policy p_import_rules_all on import_rules for all
  using (is_member(household_id)) with check (is_member(household_id));
