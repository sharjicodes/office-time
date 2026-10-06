# OfficeTime

Responsive office attendance app built with React Native, Expo SDK 57, TypeScript, and Supabase. The same interface runs on iOS, Android, and the web. The role-gated HR view uses Supabase RLS and protected database functions for cross-employee reports and late-arrival approvals.

## Features

- Email/password sign-up and sign-in with persistent Supabase Auth sessions, plus local-only mode.
- One-tap punch-in and punch-out with any number of work sessions per local calendar day, accumulated into day/month totals.
- Manual punch correction from Today or History, with exact local-time entry, 15-minute increase/decrease controls, and support for adding a missed session or day.
- Live `HH:MM:SS` net-work timer that runs during a punch-in session and freezes at punch-out, plus a red break timer that runs until the next punch-in.
- Clear a selected day’s attendance from Today or History, with offline deletion queued for Supabase sync.
- Expand any day in History to review every punch-in and punch-out interval, including an active session.
- Export the selected month’s daily net work, taken breaks, status, and individual punch history as a PDF. On web, choose “Save as PDF” in the print dialog; on iOS/Android, save or share the generated PDF from the system share sheet.
- Two-player Memory Match mini-game for short breaks with 8-, 16-, and 24-pair board sizes; it uses the supplied team portraits and animal emoji pairs, and the player with the most matches wins.
- Net recorded work, tracked break time, progress, and remaining target time.
- 9:00 AM standard start, 10:00 AM flexible limit, and late-login flags.
- Monthly count of first punch-ins after 10:00 AM, with prior manager approval requests for late logins.
- A warning with a custom alert tone after a first punch-in later than 10:00 AM, showing monthly count and remaining allowance; the fourth and later qualifying dates show a half-day status.
- A congratulatory notification with a custom celebratory chime when the recorded-work target is reached.
- HR/manager dashboard for recent attendance reports and approval decisions.
- Local reminder at 8:50 AM, missing punch-out reminder after punch-in, and an optional target-completion reminder.
- Per-user local persistence and queued Supabase sync when connectivity returns.
- Supabase RLS, trusted role provisioning, server-checked HR RPCs, and protected approval fields.
- Responsive Expo Web build configured for Vercel static hosting.
- While the web app is open, it checks for deployments once per minute and shows a reload prompt with the deployment's commit title when a newer build is available.
- Team chat supports email/password accounts with unique usernames; users can discover groups, create password-protected rooms, and enter with the password. Room creators can invite users by username, manage passwords and members, moderate messages, or delete their room and shared media. A guest’s created groups and uploaded media are cleaned up when that guest signs out. Signed-in users can start private one-to-one chats by username. Room and direct messages stay private to their members and support live text, emoji reactions, replies, private media, voice notes, and view-once photos.
- Chat messages can be hidden for the current user or removed for everyone by their sender; row-level security enforces the sender-only removal rule.

## HR policy interpretation

The source document is `Updated HR Policy 2026_8701.pdf`, dated 25 September 2026. The attendance clauses say:

- Page 1: Monday–Friday; standard timing 9:00 AM–6:00 PM; flex timing should not extend beyond 10:00 AM. Employees may arrive “a little late” up to four times per month with prior management approval. Arrivals after 10:00 AM beyond the four allowed occasions are treated as a half-day. The standard full-time workday is 9 hours including breaks, and the office biometric system is the required electronic attendance record.
- Page 2: 8 hours of work must be recorded in the attendance system and Epic portal; the company provides a 1-hour break; morning tea/coffee breaks should be taken before 11:00 AM. Employees must also update their daily timesheet and Git commit status.

The app starts with an 8-hour recorded-work target and a 60-minute expected-break target. Punch-in intervals count as net work; time from punch-out until the next punch-in counts as taken break time. “Office out” records when the workday is finished and opens a summary of all work and break intervals. Per the latest requested app behavior, only a day's first punch-in after 10:00 AM counts toward the four-login monthly limit; the fourth and later qualifying dates are marked as half-days. This is an explicit app interpretation of the policy wording, which says arrivals after 10:00 AM “beyond the four allowed occasions” are treated as a half-day. HR should confirm whether the half-day should begin on the fourth or fifth occasion and whether the limit requires prior manager approval.

HR must confirm before official rollout:

1. Whether the 8-hour target is net time inside punch-in intervals, and whether the biometric system already deducts break time.
2. Whether punch times between 9:00 and 10:00 are late, flex-eligible, or both. The app currently counts only first punch-ins after 10:00 AM toward the four-login limit.
3. What “a little late” means, whether the four approved occasions are a monthly cap, and how prior approval is recorded.
4. Whether the half-day rule begins on the fourth or fifth after-10:00 AM occasion, and how pending, rejected, or missing manager approval affects the count.
5. Whether the 60-minute break is a required minimum or an expected duration. OfficeTime records actual off-clock breaks from punch events and does not deduct the configured break target a second time.
6. Whether this app can be an official attendance channel. The source currently identifies the office biometric system as official. OfficeTime is presented as a companion tracker.
7. Approved notification behavior for leave, holidays, weekends, and work-from-home days. Late-login and work-goal notices use device-local notifications; delivery and sound depend on device permission/settings.

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
5. To enable chat, enable **Anonymous sign-ins** in Supabase Authentication → Providers, then run [`supabase/chat-schema.sql`](supabase/chat-schema.sql) in the Supabase SQL Editor. It adds unique usernames to profiles, creates the chat lobby, password-protected groups, group invitations and private-chat RPCs, and migrates existing shared messages into the open Office Lobby. Room creators can rename their groups and manage their password and members. Existing accounts receive a generated `user_…` username. Rerun this idempotent script after chat database changes to install policy updates. Install the Supabase CLI, run `npx supabase link --project-ref YOUR_PROJECT_REF`, then deploy the protected media-link function with `npx supabase functions deploy chat-media-url`. The function uses Supabase's server-side service-role secret; never add it to the app or Vercel client environment.
6. For multiplayer Memory Match, run [`supabase/memory-game-online.sql`](supabase/memory-game-online.sql) in Supabase SQL Editor after `schema.sql` and `chat-schema.sql`. Enable **Anonymous sign-ins** in Supabase Authentication → Providers. A user continuing offline can choose **Create guest username** in Online play; Supabase creates a persistent anonymous guest profile with a generated unique username, which they can share for invitations. Regular accounts can use their existing username. Online invitations and moves use Supabase Realtime. Invitations appear in the Games tab while the recipient is signed in. A match URL opens Games directly; automatic push notifications when the site/app is fully closed are not configured.
7. To enable Milo, run [`supabase/milo-policy-schema.sql`](supabase/milo-policy-schema.sql) in the Supabase SQL Editor. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey), then add `GEMINI_API_KEY` under Supabase **Project Settings → Edge Functions → Secrets**. Optionally set `GEMINI_MODEL` to a model available to your API key; the default is `gemini-3.1-flash-lite`. Never add the Gemini key to `.env`, Vercel client variables, or app code. Deploy the functions with `npx supabase functions deploy milo-policy-ingest` and `npx supabase functions deploy milo-policy-answer`. Sign in using an account with the `hr_admin` role, open the HR tab, and upload the current policy PDF (up to 5 MB). Milo appears in Chat → **Ask Milo** and in the floating Milo button on web. The PDF is transcribed server-side through Gemini (including scanned pages), and the active policy text is stored in a table unavailable to client roles. Reuploading replaces the current active policy. Google’s unpaid Gemini tier has usage limits and may use submitted content to improve products; obtain company approval before uploading internal HR documents.
8. Start the app:

   ```sh
   npx expo start
   ```

   Use Expo Go for mobile UI iteration. Run `npm run web` to preview the browser layout locally.

With Supabase variables omitted, the app supports local attendance and history on that device. Supabase setup is needed for sign-in, cross-device sync, chat, and HR features. Guest chat sign-in requires Anonymous sign-ins to be enabled in Supabase. Guest attendance remains local to the device and is not uploaded under the chat-only account.

## Deploy the web app to Vercel

1. Push this project to a Git provider supported by Vercel, then import that repository into Vercel.
2. Vercel reads [`vercel.json`](vercel.json): install with `npm ci`, build with `npm run build:web`, and publish `dist/`.
3. Add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in Vercel Project Settings → Environment Variables for Preview and Production. Redeploy after changing variables. Do not add a Supabase service-role key.
4. In Supabase Authentication URL Configuration, set the production Vercel URL as the Site URL and add the Preview URLs you intend to use as allowed redirect URLs.
5. Run `npm run build:web` locally before deploying if you want to validate the production export.

The web layout adapts to phone and desktop widths. Web attendance persists in browser storage and syncs to Supabase when configured; local-only web records stay in that browser. Chat media uploads, voice recording, and playback are supported in the HTTPS web app; microphone access requires browser permission. View-once means each signed-in viewer can open the image once in OfficeTime, using a one-minute private link. Recipients can still capture or copy media while it is visible. Browser work-target notifications require permission and the tab to remain open. The weekday morning reminder is scheduled by the native iOS/Android apps.

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

Vercel web builds create `release.json` from the deployment ID and Git commit title. An open browser session checks it every minute (and when returning to the tab); selecting **Reload to update** loads the new deployment. This is an in-app prompt and only appears while the site is open; OS-level push notifications for a web page would require browser notification permission and a push subscription service.

For store builds, install/configure EAS CLI and an Expo account, replace `com.example.officetime` in `app.json` with organization-owned identifiers, then run:

```sh
npx eas-cli build:configure
npx eas-cli build --platform ios
npx eas-cli build --platform android
```

Use Apple signing/TestFlight for iOS distribution and a Play Console signing key for Android. Test notification permissions, background scheduling, offline sync, timezone changes, and Supabase policies on physical devices before release. The Supabase schema must be deployed before enabling company accounts.

## Known boundaries

- Employees may record multiple punch-in/out sessions on the same local calendar day. Optional break hours/minutes entered on a session are deducted from that session's net work; off-clock gaps count toward taken break time, and an active break timer runs until the next punch-in. A new local calendar day starts with a zero daily total. The HR policy's nine-hour day and one-hour break interpretation still needs confirmation.
- Existing one-session records migrate as a single session. Supabase deployments must rerun `supabase/schema.sql` to add the `sessions` JSONB and `office_out_at` columns before syncing multi-session days and Office out status, and to refresh the HR report's net-work calculation for session-level breaks.
- Offline changes persist and sync as attendance-day upserts. For official payroll use, add server-trusted event timestamps, audited correction requests, retention rules, backups, and policy-approved conflict handling.
- Reminder delivery is best-effort device-local scheduling and depends on notification permission and OS background behavior.
- Web work-target reminders are foreground-tab timers and are not push notifications; browser storage is local to that browser unless Supabase sync is configured.
- Custom native late-login and goal-achievement sounds are bundled through the Expo notifications config plugin. Rebuild and reinstall the iOS/Android app after changing notification sound assets or app config. Expo Go does not contain this project's custom sound files; use an EAS/development build to hear them. Focus/silent modes and device volume can suppress or reduce notification sounds.
- No timesheet/Git integration, leave calendar, public holiday calendar, CSV export, or employee/team directory is included.
