# Closed-browser workday reminders

Milo sends server-scheduled web push for signed-in users who enabled **Background notifications**. The Edge Function checks the device's local time every minute, sends due notifications, and records deliveries so the same event is not sent twice. The native app continues to use OS-local notifications.

## One-time Supabase setup

1. Apply `supabase/milo-workday-reminders.sql` in the Supabase SQL Editor.
2. In **Project Settings → Edge Functions → Secrets**, add `MILO_REMINDER_CRON_KEY`. Generate a unique value locally, for example with `openssl rand -hex 32`. Keep it private.
3. In **Database → Vault → Secrets**, add three secrets:
   - `milo_project_url`: `https://YOUR_PROJECT_REF.supabase.co`
   - `milo_anon_key`: the project's publishable/anon key
   - `milo_reminder_cron_key`: the same random value as `MILO_REMINDER_CRON_KEY`
4. Deploy the function from the repository root:

   ```sh
   supabase functions deploy process-workday-reminders
   ```

   `supabase/config.toml` disables gateway JWT verification for this function; the function itself checks the private cron key.

5. Run `supabase/milo-workday-reminders-schedule.sql` in the SQL Editor. It schedules one small worker run per minute.
6. Sign in to Milo, allow browser notifications, and enable **Background notifications** on each device. Reopen Milo once on existing subscribed devices so the device time zone is refreshed.

## What is scheduled

- Punch-in reminder on selected workdays at the configured time.
- Work-target alert while today's attendance record remains open.
- Break-end alert after a punch-out, using the configured expected break.
- Missing punch-out alert after a session has remained open for nine hours.
- Custom reminders at their selected times and weekdays.
- Optional repeat reminder every 1, 2, 3, 4, 5, 6, or 8 hours from the first punch-in until Office out.

Repeat reminders use the phone's default notification sound. For signed-in web users, the server checks them each minute and can deliver while the browser is closed. Native app reminders are scheduled locally by the operating system.

Office out closes that day's record, so the worker stops sending its workday reminders. Cloud schedules require a signed-in account, internet access when punch/settings changes are made, and a push subscription for that device. Offline guest attendance remains local and cannot be read by the server.

## Free usage

This uses Supabase Cron and Edge Functions, with one Edge Function invocation per minute (about 43,200 per 30-day month). Supabase currently includes 500,000 Edge Function invocations on the Free plan, so this fits within that allowance at present usage. Push providers may delay or suppress notifications, and free-tier quotas or project inactivity limits still apply. [Supabase Edge Function quotas](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations).
