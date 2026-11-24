-- =====================================================================
-- Dom — przepisy i menu tygodniowe (etap 4)
-- Supabase → SQL Editor → New query → wklej całość → Run. Można uruchomić ponownie.
-- =====================================================================

create table if not exists recipes (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  title        text not null,
  servings     int not null default 2,
  time_min     int,
  ingredients  text not null default '',   -- jedna linia = jeden składnik, np. "200 g mąki"
  steps        text not null default '',   -- jedna linia = jeden krok
  tags         text[] not null default '{}',
  source_url   text,
  image_url    text,                       -- zdjęcie ze strony (import)
  photo_path   text,                       -- własne zdjęcie (bucket receipts)
  note         text,
  fav          boolean not null default false,
  created_by   uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Menu: dowolnie wiele pozycji na dzień (przepis albo zwykły tekst)
create table if not exists meal_plan (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  day          date not null,
  meal         text not null default 'Obiad',
  recipe_id    uuid references recipes(id) on delete set null,
  text         text,
  servings     int,
  created_at   timestamptz not null default now(),
  check (recipe_id is not null or coalesce(text, '') <> '')
);
create index if not exists meal_plan_day on meal_plan(household_id, day);

drop trigger if exists t_recipes_touch on recipes;
create trigger t_recipes_touch before update on recipes
  for each row execute function touch_updated_at();

alter table recipes   enable row level security;
alter table meal_plan enable row level security;
drop policy if exists p_recipes_all on recipes;
create policy p_recipes_all on recipes for all
  using (is_member(household_id)) with check (is_member(household_id));
drop policy if exists p_meal_plan_all on meal_plan;
create policy p_meal_plan_all on meal_plan for all
  using (is_member(household_id)) with check (is_member(household_id));

do $$ begin
  begin alter publication supabase_realtime add table recipes;   exception when others then null; end;
  begin alter publication supabase_realtime add table meal_plan; exception when others then null; end;
end $$;
