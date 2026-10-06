-- Milo policy assistant source. HR uploads one current policy document at a time.
-- This table is accessed only by Edge Functions using the Supabase service role.
create table if not exists public.milo_policy_documents (
  singleton boolean primary key default true check (singleton),
  document_name text not null,
  policy_text text not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (char_length(policy_text) between 20 and 100000)
);

alter table public.milo_policy_documents enable row level security;
revoke all on public.milo_policy_documents from public, anon, authenticated;
grant all on public.milo_policy_documents to service_role;
