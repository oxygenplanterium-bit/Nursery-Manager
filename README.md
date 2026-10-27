# Nursery Daily Manager (Android)

Android app for Oxygen Planterium: stock, tasks, attendance, resources, customers and daily PDF reports for
Chalmatti and Raynal nurseries. Built with Capacitor and Supabase (login + shared database).

## Get the APK
Every push to `main` builds the app on GitHub. Open the **Releases** page, open **Nursery Daily Manager (latest)**
and download `NurseryDailyManager.apk` on your phone. Allow "Install unknown apps" when asked.

## One-time Supabase setup
1. Create a free project at supabase.com.
2. SQL Editor, New query: paste the whole of `supabase.sql`, Run.
3. Authentication, Users: add the owner (oxygenplanterium@gmail.com) and one user per supervisor (tick Auto Confirm User).
4. Authentication, Sign In / Providers: turn off "Allow new users to sign up".
5. Put the Project URL and anon key in `src/config.js`.

## Moving your old data
In the old Claude version use "Download all days backup", send the file to your phone, then in this app (Owner Mode) use "Import backup file".
