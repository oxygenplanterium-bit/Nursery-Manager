# Phone notifications for chat (one-time setup)

Chat already shows notifications while the app is open or recently used. To get notifications when the app is fully closed, the Android web app (installed from Chrome) and the iPhone web app (added to Home Screen) use Web Push. This needs one small function in your Supabase project. The Android APK shows notifications only while the app is running in the background.

## 1. Create the function
1. Supabase dashboard > Edge Functions > Create a new function > "Via Editor". Name it `chat-push`.
2. Paste the whole content of `supabase/functions/chat-push/index.ts` and Deploy.

## 2. Add the secrets
Edge Functions > Secrets > add:
- `VAPID_PUBLIC_KEY`  = the public key (also inside www/index.html as VAPID_PUB)
- `VAPID_PRIVATE_KEY` = the private key you were given (keep it secret)
- `VAPID_SUBJECT`     = `mailto:oxygenplanterium@gmail.com`

## 3. Connect it to chat messages
SQL Editor > New query > paste, replace `ANON_KEY` with your project's public anon key (Project Settings > API), then Run:

```sql
create extension if not exists pg_net with schema extensions;
create or replace function public.chat_push_notify() returns trigger language plpgsql security definer as $$
begin
  perform net.http_post(
    url := 'https://jbcyzywfjvfihkuyrhqw.supabase.co/functions/v1/chat-push',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ANON_KEY'),
    body := jsonb_build_object('record', jsonb_build_object('path', new.path, 'data', new.data),
                               'old_record', case when tg_op = 'UPDATE' then jsonb_build_object('path', old.path, 'data', old.data) else null end));
  return new;
end $$;
drop trigger if exists chat_push on public.docs;
create trigger chat_push after insert or update on public.docs
  for each row when (new.path like 'chat/%') execute function public.chat_push_notify();
```

## 4. Turn it on in each phone
Open the Chat tab > "Turn on notifications" and allow notifications.
