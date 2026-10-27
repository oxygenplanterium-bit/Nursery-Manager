# Nursery Daily Manager (Android)

Android app for Oxygen Planterium: stock, tasks, attendance, resources, customers and daily PDF reports for
Chalmatti and Raynal nurseries. Built with Capacitor, Firebase Auth and Firestore. Works offline and syncs when online.

## Get the APK
Every push to `main` builds the app on GitHub. Open the **Releases** page of this repository, open
**Nursery Daily Manager (latest)** and download `NurseryDailyManager.apk` on your phone. Allow "Install unknown apps" when asked.
(Or: Actions tab, latest run, Artifacts.)

## One-time Firebase setup
1. Firestore Database: Rules tab, paste the contents of `firestore.rules`, Publish.
2. Authentication, Users: add the owner (oxygenplanterium@gmail.com) and one user per supervisor (email + password).
3. Authentication, Settings, User actions: turn OFF "Enable create (sign-up)" so nobody else can register.

## Moving your old data
In the old Claude version use "Download all days backup", send the file to your phone, then in this app (Owner Mode) use "Import backup file".
