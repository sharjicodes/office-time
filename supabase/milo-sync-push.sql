-- Cross-device preferences and PWA push subscriptions for Milo.
create table if not exists public.milo_user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.milo_user_settings enable row level security;
drop policy if exists milo_user_settings_own on public.milo_user_settings;
create policy milo_user_settings_own on public.milo_user_settings
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.milo_user_settings to authenticated;

create table if not exists public.milo_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists milo_push_subscriptions_user_idx on public.milo_push_subscriptions(user_id);
alter table public.milo_push_subscriptions enable row level security;
drop policy if exists milo_push_subscriptions_own on public.milo_push_subscriptions;
create policy milo_push_subscriptions_own on public.milo_push_subscriptions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.milo_push_subscriptions to authenticated;
