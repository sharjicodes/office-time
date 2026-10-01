-- Shared, guest-capable OfficeTime chat. Run after schema.sql.
-- Anonymous sign-ins must be enabled in Supabase Auth settings.
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  sender_name text not null check (char_length(sender_name) between 1 and 40),
  body text not null default '' check (char_length(body) <= 1000),
  media_path text,
  media_type text check (media_type in ('image','video','audio')),
  view_once boolean not null default false,
  sent_at timestamptz not null default now(),
  check ((body <> '') or media_path is not null),
  check (media_path is null or pg_catalog.split_part(media_path, '/', 1) = sender_id::text),
  check ((media_path is null and media_type is null and view_once = false) or (media_path is not null and media_type is not null)),
  check (view_once = false or media_type = 'image')
);
create index if not exists chat_messages_sent_at_idx on public.chat_messages (sent_at desc);

create table if not exists public.chat_media_views (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (message_id, viewer_id)
);

alter table public.chat_messages enable row level security;
alter table public.chat_media_views enable row level security;
drop policy if exists chat_messages_read on public.chat_messages;
drop policy if exists chat_messages_send on public.chat_messages;
create policy chat_messages_read on public.chat_messages for select to authenticated using (true);
create policy chat_messages_send on public.chat_messages for insert to authenticated
  with check (auth.uid() = sender_id and char_length(btrim(sender_name)) between 1 and 40);
revoke update, delete on public.chat_messages from anon, authenticated;
grant select, insert on public.chat_messages to authenticated;
revoke all on public.chat_media_views from anon, authenticated;

create or replace function public.limit_chat_message_rate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare recent_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.sender_id::text, 0));
  select count(*) into recent_count from public.chat_messages m
    where m.sender_id = new.sender_id and m.sent_at > now() - interval '1 minute';
  if recent_count >= 20 then raise exception 'Chat rate limit reached. Please wait a minute.'; end if;
  return new;
end; $$;
drop trigger if exists chat_message_rate_limit on public.chat_messages;
create trigger chat_message_rate_limit before insert on public.chat_messages
  for each row execute function public.limit_chat_message_rate();

create or replace function public.claim_chat_media_view(message_id_in uuid, viewer_id_in uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare target public.chat_messages%rowtype; inserted_count integer;
begin
  if viewer_id_in is null then raise exception 'A signed-in viewer is required.'; end if;
  select * into target from public.chat_messages where id = message_id_in and media_path is not null;
  if not found then raise exception 'Media not found.'; end if;
  if target.view_once and target.sender_id <> viewer_id_in then
    insert into public.chat_media_views(message_id, viewer_id) values (message_id_in, viewer_id_in) on conflict do nothing;
    get diagnostics inserted_count = row_count;
    if inserted_count = 0 then raise exception 'This photo has already been opened.'; end if;
  end if;
  return target.media_path;
end; $$;
revoke all on function public.claim_chat_media_view(uuid,uuid) from public, anon, authenticated;
grant execute on function public.claim_chat_media_view(uuid,uuid) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 52428800,
  array['image/jpeg','image/png','image/webp','image/gif','image/heic','video/mp4','video/quicktime','video/webm','audio/webm','audio/mp4','audio/mpeg','audio/wav','audio/ogg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists chat_media_upload_own on storage.objects;
create policy chat_media_upload_own on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-media' and (storage.foldername(name))[1] = auth.uid()::text);
-- No client read policy: media is delivered through the authenticated Edge Function only.

do $$ begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null;
end $$;
