-- Run after adding these Supabase Vault secrets:
-- milo_project_url       = https://YOUR_PROJECT_REF.supabase.co
-- milo_anon_key          = your project's publishable/anon key
-- milo_reminder_cron_key = the same random value as Edge Function secret
-- MILO_REMINDER_CRON_KEY

select cron.unschedule(jobid)
from cron.job
where jobname = 'milo-workday-reminders';

select cron.schedule(
  'milo-workday-reminders',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'milo_project_url')
        || '/functions/v1/process-workday-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'milo_anon_key'),
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'milo_reminder_cron_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  $job$
);
