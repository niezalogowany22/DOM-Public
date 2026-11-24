-- =====================================================================
-- Powiadomienia push — wyzwalacze w bazie (opcjonalne)
-- 1. Skopiuj ten plik POZA repozytorium.
-- 2. Podmień adres aplikacji i sekret (ta sama wartość co WEBHOOK_SECRET w Vercelu).
-- 3. Uruchom w Supabase → SQL Editor.
-- Nigdy nie commituj wersji z prawdziwym sekretem.
-- =====================================================================
create extension if not exists pg_net;

create or replace function notify_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://TWOJA-APLIKACJA.vercel.app/api/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', 'ZMIEN-NA-SWOJ-WEBHOOK_SECRET'),
    body := jsonb_build_object('type', TG_OP, 'table', TG_TABLE_NAME, 'record', to_jsonb(NEW))
  );
  return NEW;
end $$;

drop trigger if exists push_shop on shop_items;
create trigger push_shop after insert on shop_items for each row execute function notify_push();
drop trigger if exists push_expense on split_expenses;
create trigger push_expense after insert on split_expenses for each row execute function notify_push();
