# OfficeTime

Responsive office attendance app built with React Native, Expo SDK 57, TypeScript, and Supabase. The same interface runs on iOS, Android, and the web. The role-gated HR view uses Supabase RLS and protected database functions for cross-employee reports and late-arrival approvals.

## Features

- Email/password sign-up and sign-in with persistent Supabase Auth sessions, plus local-only mode.
- One-tap daily punch-in and punch-out, current session tracking, and day/month history.
- Elapsed time, configurable break deduction, net recorded hours, progress, and remaining target time.
- 9:00 AM standard start, 10:00 AM flexible limit, and late-login flags.
- Monthly late-arrival count, prior manager approval request, and a monthly allowance setting.
- HR/manager dashboard for recent attendance reports and approval decisions.
- Local reminder at 8:50 AM, missing punch-out reminder after punch-in, and an optional target-completion reminder.
- Per-user local persistence and queued Supabase sync when connectivity returns.
- Supabase RLS, trusted role provisioning, server-checked HR RPCs, and protected approval fields.
- Responsive Expo Web build configured for Vercel static hosting.

## HR policy interpretation

The source document is `Updated HR Policy 2026_8701.pdf`, dated 25 September 2026. The attendance clauses say:

- Page 1: Monday–Friday; standard timing 9:00 AM–6:00 PM; flex timing should not extend beyond 10:00 AM. Employees may arrive “a little late” up to four times per month with prior management approval. Arrivals after 10:00 AM beyond the four allowed occasions are treated as a half-day. The standard full-time workday is 9 hours including breaks, and the office biometric system is the required electronic attendance record.
- Page 2: 8 hours of work must be recorded in the attendance system and Epic portal; the company provides a 1-hour break; morning tea/coffee breaks should be taken before 11:00 AM. Employees must also update their daily timesheet and Git commit status.

The app starts with an 8-hour recorded-work target and a fixed 60-minute deduction. Those settings can be changed from Today → Your workday settings. The half-day rule starts **disabled** and is only an informational/configurable preference; the app does not automatically classify a half-day. The late allowance is counted and displayed, but the app does not decide what qualifies as “a little late” or whether an approval consumes an allowance.

HR must confirm before official rollout:

1. Whether the target is 8 net working hours after a 1-hour deduction (9 elapsed hours), and whether the biometric system already deducts break time.
2. Whether punch times between 9:00 and 10:00 are late, flex-eligible, or both.
3. What “a little late” means, whether the four approved occasions are a monthly cap, and how prior approval is recorded.
4. Whether the half-day rule applies only after four approved occasions and how it applies to an arrival after 10:00 AM with pending, rejected, or missing approval.
5. Whether break time is a fixed hour or employee-recorded actual time. Fixed/actual/none deduction modes are available; in actual mode the employee can adjust today's break value before relying on the total.
6. Whether this app can be an official attendance channel. The source currently identifies the office biometric system as official. OfficeTime is presented as a companion tracker.
7. Approved notification times and behavior for leave, holidays, weekends, and work-from-home days. The current daily reminder is device-local and notifications are not proof of attendance.

No policy PDF was copied into the repository. The app and docs reflect the source clauses above; keep the source PDF in the team's policy records.

## Local setup

1. Install Node.js 22.13 or newer and npm (SDK 57 requirement).
2. Install dependencies:

   ```sh
   npm install
   ```

3. For cloud sync, create a Supabase project, copy `.env.example` to `.env`, and set:

   ```env
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
   ```

   The public anon key is safe for the client only because RLS is enabled. Never place the service-role key in the app.

4. In Supabase SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql). This creates tables, profile provisioning, row-level policies, and protected HR report/approval functions.
5. Start the app:

   ```sh
   npx expo start
   ```

   Use Expo Go for mobile UI iteration. Run `npm run web` to preview the browser layout locally.

With Supabase variables omitted, the app supports local attendance and history on that device. Supabase setup is needed for sign-in, cross-device sync, and HR features.

## Deploy the web app to Vercel

1. Push this project to a Git provider supported by Vercel, then import that repository into Vercel.
2. Vercel reads [`vercel.json`](vercel.json): install with `npm ci`, build with `npm run build:web`, and publish `dist/`.
3. Add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in Vercel Project Settings → Environment Variables for Preview and Production. Redeploy after changing variables. Do not add a Supabase service-role key.
4. In Supabase Authentication URL Configuration, set the production Vercel URL as the Site URL and add the Preview URLs you intend to use as allowed redirect URLs.
5. Run `npm run build:web` locally before deploying if you want to validate the production export.

The web layout adapts to phone and desktop widths. Web attendance persists in browser storage and syncs to Supabase when configured; local-only web records stay in that browser. Browser work-target notifications require permission and the tab to remain open. The weekday morning reminder is scheduled by the native iOS/Android apps.

## HR account setup

New accounts receive the `employee` role. A project owner must verify the HR/manager identity and assign a role through the trusted SQL editor or a protected server-side admin workflow:

```sql
update public.profiles
set role = 'hr_admin'
where id = '<verified-auth-user-uuid>';
```

The mobile client has no profile update permission, so users cannot promote themselves. HR reports and approval RPCs check the stored profile role on the server. Do not expose service-role credentials in Expo variables.

## Run checks

```sh
npm run typecheck
npm test
```

Tests cover start/flex boundaries, late flags, 9-hour elapsed/8-hour net calculations, incomplete sessions, configurable break modes, and month-scoped late counts.

## iOS and Android builds

For local simulator/device development:

```sh
npx expo run:ios
npx expo run:android
```

For store builds, install/configure EAS CLI and an Expo account, replace `com.example.officetime` in `app.json` with organization-owned identifiers, then run:

```sh
npx eas-cli build:configure
npx eas-cli build --platform ios
npx eas-cli build --platform android
```

Use Apple signing/TestFlight for iOS distribution and a Play Console signing key for Android. Test notification permissions, background scheduling, offline sync, timezone changes, and Supabase policies on physical devices before release. The Supabase schema must be deployed before enabling company accounts.

## Known boundaries

- A single punch-in/out session per employee per local work date is supported; lunch is represented by a configurable deduction, not separate punch events.
- Offline changes persist and sync as attendance-day upserts. For official payroll use, add server-trusted event timestamps, audited correction requests, retention rules, backups, and policy-approved conflict handling.
- Reminder delivery is best-effort device-local scheduling and depends on notification permission and OS background behavior.
- Web work-target reminders are foreground-tab timers and are not push notifications; browser storage is local to that browser unless Supabase sync is configured.
- `halfDayRule` remains disabled by default and is not enforced. Local settings are employee-device preferences, not organization-wide policy configuration.
- No timesheet/Git integration, leave calendar, public holiday calendar, CSV export, or employee/team directory is included.
