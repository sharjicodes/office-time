-- Server-scheduled PWA reminders. Apply in the Supabase SQL Editor.
-- Web-push delivery needs a real signed-in account and a push subscription.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

alter table public.milo_push_subscriptions
  add column if not exists time_zone text not null default 'UTC';

create table if not exists public.milo_reminder_deliveries (
  subscription_id uuid not null references public.milo_push_subscriptions(id) on delete cascade,
  occurrence_key text not null,
  delivered_at timestamptz not null default now(),
  primary key (subscription_id, occurrence_key)
);
alter table public.milo_reminder_deliveries enable row level security;
revoke all on public.milo_reminder_deliveries from anon, authenticated;

-- Keep the delivery ledger compact. Run this after the Edge Function is deployed.
create or replace function public.prune_milo_reminder_deliveries()
returns void language sql security definer set search_path = '' as $$
  delete from public.milo_reminder_deliveries where delivered_at < now() - interval '45 days';
$$;
revoke all on function public.prune_milo_reminder_deliveries() from public, anon, authenticated;

-- Create the two Vault secrets in the Dashboard's Vault UI:
--   name: milo_project_url       value: https://YOUR_PROJECT_REF.supabase.co
--   name: milo_reminder_cron_key value: a unique random secret (32+ characters)
--   name: milo_anon_key          value: your project's publishable/anon key
-- Also add MILO_REMINDER_CRON_KEY with the same random secret to the Edge
-- Function secrets. Then run the schedule SQL in WORKDAY_REMINDERS_SETUP.md.
