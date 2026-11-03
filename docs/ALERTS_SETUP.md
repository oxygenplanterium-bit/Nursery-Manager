# Task alarm push and the 8:00 PM report (one-time setup)

This extends the chat push setup (docs/PUSH_SETUP.md). Do that first: the same VAPID secrets are used.

## 1. Create the function
Supabase dashboard > Edge Functions > Create a new function > "Via Editor". Name it `daily-alerts`, paste `supabase/functions/daily-alerts/index.ts`, Deploy, and switch OFF "Verify JWT".

## 2. Secrets for sending the report (Edge Functions > Secrets)
Email (Resend, free at resend.com):
- `RESEND_API_KEY` = your Resend API key
- `REPORT_FROM` = for example `Oxygen Planterium <reports@your-domain.com>` (a domain you verified in Resend). Without a verified domain Resend only delivers to your own Resend account email.

WhatsApp (Twilio):
- `TWILIO_SID` and `TWILIO_TOKEN` = from your Twilio console
- `TWILIO_WA_FROM` = your Twilio WhatsApp number with country code, digits only, with a plus sign, for example `+14155238886` (the Twilio sandbox number works for testing; each receiver must first send the join code to it). For a real business number, WhatsApp requires an approved message template.

You can set only email, only WhatsApp, or both.

## 3. Run it every 5 minutes
SQL Editor > New query, replace `ANON_KEY` with your project's anon (public) key, then Run:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule('daily-alerts', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://jbcyzywfjvfihkuyrhqw.supabase.co/functions/v1/daily-alerts',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ANON_KEY'),
    body := '{}'::jsonb);
$$);
```

## 4. In the app
- Owner: Home > "Daily report send" > turn on, enter emails and WhatsApp numbers, Save.
- Every supervisor: Home > "Turn on phone alerts" and allow notifications.

To test the report at once, open `https://jbcyzywfjvfihkuyrhqw.supabase.co/functions/v1/daily-alerts?report=now` in a browser tab.
