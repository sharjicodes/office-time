-- Shared, guest-capable OfficeTime chat. Run after schema.sql.
-- Anonymous sign-ins must be enabled in Supabase Auth settings.
create extension if not exists pgcrypto with schema extensions;

-- Username registry used for account discovery, room invitations and direct chats.
alter table public.profiles add column if not exists username text;
update public.profiles p set username = 'user_' || left(p.id::text, 8) where p.username is null or btrim(p.username) = '';
alter table public.profiles alter column username set not null;
create unique index if not exists profiles_username_unique_idx on public.profiles (lower(username));
create or replace function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  requested_username text;
  guest_adjectives text[] := array['bright','calm','clever','cool','happy','kind','lucky','quick','sunny','swift','tiny','wise'];
  guest_animals text[] := array['bear','bird','cat','deer','fox','koala','lion','otter','panda','tiger','wolf','zebra'];
  guest_seed bigint;
  suffix integer := 0;
begin
  if new.is_anonymous then
    guest_seed := abs(hashtext(new.id::text)::bigint);
    requested_username := 'guest_' || guest_adjectives[(guest_seed % array_length(guest_adjectives, 1))::integer + 1]
      || '_' || guest_animals[((guest_seed / array_length(guest_adjectives, 1)) % array_length(guest_animals, 1))::integer + 1]
      || '_' || lpad((guest_seed % 100)::text, 2, '0');
    while exists (select 1 from public.profiles where lower(username) = lower(requested_username)) loop
      suffix := suffix + 1;
      requested_username := left(requested_username, 21) || suffix::text;
    end loop;
  else
    requested_username := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', ''), '[^a-z0-9_]', '', 'g'));
    if char_length(requested_username) < 3 or char_length(requested_username) > 24 then
      requested_username := 'user_' || left(replace(new.id::text, '-', ''), 18);
    end if;
  end if;
  insert into public.profiles (id, display_name, username)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), requested_username), requested_username);
  return new;
end; $$;

create table if not exists public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 50),
  created_by uuid references auth.users(id) on delete set null,
  password_hash text,
  room_type text not null default 'group' check (room_type in ('group','direct')),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.chat_rooms add column if not exists room_type text not null default 'group' check (room_type in ('group','direct'));
create unique index if not exists chat_rooms_one_default_idx on public.chat_rooms (is_default) where is_default;
insert into public.chat_rooms (name, is_default)
select 'Office Lobby', true
where not exists (select 1 from public.chat_rooms where is_default);

create table if not exists public.chat_room_members (
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create table if not exists public.chat_direct_pairs (
  user_low uuid not null references auth.users(id) on delete cascade,
  user_high uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null unique references public.chat_rooms(id) on delete cascade,
  primary key (user_low, user_high),
  check (user_low < user_high)
);
create index if not exists chat_room_members_user_idx on public.chat_room_members (user_id, joined_at desc);

create table if not exists public.chat_room_join_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists chat_room_attempts_lookup_idx on public.chat_room_join_attempts (user_id, room_id, attempted_at desc);
alter table public.chat_room_join_attempts enable row level security;
revoke all on public.chat_rooms, public.chat_room_members, public.chat_direct_pairs, public.chat_room_join_attempts from public, anon, authenticated;

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
alter table public.chat_messages add column if not exists reply_to uuid references public.chat_messages(id) on delete set null;
alter table public.chat_messages add column if not exists room_id uuid;
update public.chat_messages set room_id = (select id from public.chat_rooms where is_default limit 1) where room_id is null;
alter table public.chat_messages alter column room_id set not null;
do $$ begin
  alter table public.chat_messages add constraint chat_messages_room_id_fkey foreign key (room_id) references public.chat_rooms(id) on delete cascade;
exception when duplicate_object then null;
end $$;
create index if not exists chat_messages_room_sent_idx on public.chat_messages (room_id, sent_at asc);
insert into public.chat_room_members (room_id, user_id)
select (select id from public.chat_rooms where is_default limit 1), sender_id
from public.chat_messages on conflict do nothing;
create index if not exists chat_messages_sent_at_idx on public.chat_messages (sent_at desc);

create table if not exists public.chat_message_reactions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (emoji in ('😊','❤️','👍','😂','🎉','🙏')),
  reacted_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table if not exists public.chat_media_views (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (message_id, viewer_id)
);

alter table public.chat_messages enable row level security;
alter table public.chat_media_views enable row level security;
alter table public.chat_message_reactions enable row level security;
alter table public.chat_rooms enable row level security;
alter table public.chat_room_members enable row level security;
alter table public.chat_direct_pairs enable row level security;
create table if not exists public.chat_message_hides (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (message_id, viewer_id)
);
alter table public.chat_message_hides enable row level security;
drop policy if exists chat_room_members_read_own on public.chat_room_members;
create policy chat_room_members_read_own on public.chat_room_members for select to authenticated using (auth.uid() = user_id);
grant select on public.chat_room_members to authenticated;
drop policy if exists chat_messages_read on public.chat_messages;
drop policy if exists chat_messages_send on public.chat_messages;
drop policy if exists chat_messages_delete_own on public.chat_messages;
create or replace function public.is_chat_room_member(room_id_in uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.chat_room_members rm where rm.room_id = room_id_in and rm.user_id = auth.uid()
  );
$$;
revoke all on function public.is_chat_room_member(uuid) from public, anon;
grant execute on function public.is_chat_room_member(uuid) to authenticated;
create or replace function public.is_chat_room_creator(room_id_in uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.chat_rooms r where r.id = room_id_in and r.room_type = 'group' and r.created_by = auth.uid()
  );
$$;
revoke all on function public.is_chat_room_creator(uuid) from public, anon;
grant execute on function public.is_chat_room_creator(uuid) to authenticated;
create policy chat_messages_read on public.chat_messages for select to authenticated
  using (public.is_chat_room_member(chat_messages.room_id));
create policy chat_messages_send on public.chat_messages for insert to authenticated
  with check (auth.uid() = sender_id and char_length(btrim(sender_name)) between 1 and 40
    and public.is_chat_room_member(chat_messages.room_id));
create policy chat_messages_delete_own on public.chat_messages for delete to authenticated
  using (public.is_chat_room_member(chat_messages.room_id)
    and (auth.uid() = sender_id or public.is_chat_room_creator(chat_messages.room_id)));
drop policy if exists chat_message_hides_read_own on public.chat_message_hides;
drop policy if exists chat_message_hides_insert_own on public.chat_message_hides;
drop policy if exists chat_message_hides_delete_own on public.chat_message_hides;
create policy chat_message_hides_read_own on public.chat_message_hides for select to authenticated
  using (auth.uid() = viewer_id);
create policy chat_message_hides_insert_own on public.chat_message_hides for insert to authenticated
  with check (auth.uid() = viewer_id);
create policy chat_message_hides_delete_own on public.chat_message_hides for delete to authenticated
  using (auth.uid() = viewer_id);
revoke update on public.chat_messages from anon, authenticated;
revoke delete on public.chat_messages from anon, authenticated;
grant select, insert, delete on public.chat_messages to authenticated;
revoke all on public.chat_message_hides from anon, authenticated;
grant select, insert, delete on public.chat_message_hides to authenticated;
drop policy if exists chat_message_reactions_read on public.chat_message_reactions;
drop policy if exists chat_message_reactions_insert_own on public.chat_message_reactions;
drop policy if exists chat_message_reactions_delete_own on public.chat_message_reactions;
create policy chat_message_reactions_read on public.chat_message_reactions for select to authenticated
  using (exists (select 1 from public.chat_messages m where m.id = chat_message_reactions.message_id));
create policy chat_message_reactions_insert_own on public.chat_message_reactions for insert to authenticated
  with check (auth.uid() = user_id and exists (select 1 from public.chat_messages m where m.id = chat_message_reactions.message_id));
create policy chat_message_reactions_delete_own on public.chat_message_reactions for delete to authenticated
  using (auth.uid() = user_id and exists (select 1 from public.chat_messages m where m.id = chat_message_reactions.message_id));
revoke all on public.chat_message_reactions from anon, authenticated;
grant select, insert, delete on public.chat_message_reactions to authenticated;
revoke all on public.chat_media_views from anon, authenticated;

drop function if exists public.list_chat_rooms();
create function public.list_chat_rooms()
returns table (
  room_id uuid, room_name text, creator_name text, created_at timestamptz,
  member_count bigint, password_protected boolean, joined boolean, is_creator boolean, room_type text
) language sql stable security definer set search_path = '' as $$
  select r.id, r.name,
    coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), 'OfficeTime member'),
    r.created_at, count(distinct rm.user_id), r.password_hash is not null,
    exists (select 1 from public.chat_room_members mine where mine.room_id = r.id and mine.user_id = auth.uid()),
    r.created_by = auth.uid(), r.room_type
  from public.chat_rooms r
  left join auth.users u on u.id = r.created_by
  left join public.chat_room_members rm on rm.room_id = r.id
  where auth.uid() is not null and r.room_type = 'group'
  group by r.id, u.raw_user_meta_data
  order by r.is_default desc, r.created_at desc;
$$;

create or replace function public.add_chat_room_member_by_username(room_id_in uuid, username_in text)
returns table (member_id uuid, member_name text, username text)
language plpgsql security definer set search_path = '' as $$
declare target_id uuid; target_name text; target_username text; owner_id uuid; target_type text;
begin
  select r.created_by, r.room_type into owner_id, target_type from public.chat_rooms r where r.id = room_id_in;
  if not found then raise exception 'Room not found.'; end if;
  if auth.uid() is null or owner_id is distinct from auth.uid() or target_type <> 'group' then
    raise exception 'Only the group creator can add members.';
  end if;
  select p.id, p.display_name, p.username into target_id, target_name, target_username
    from public.profiles p where lower(p.username) = lower(btrim(username_in));
  if not found then raise exception 'No OfficeTime account uses that username. Ask them to sign up first.'; end if;
  if target_id = auth.uid() then raise exception 'You are already the room creator.'; end if;
  insert into public.chat_room_members(room_id, user_id) values (room_id_in, target_id) on conflict do nothing;
  return query select target_id, coalesce(target_name, target_username), target_username;
end; $$;

create or replace function public.list_direct_chats()
returns table (room_id uuid, room_name text, peer_username text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, coalesce(nullif(p.display_name, ''), p.username), p.username, r.created_at
  from public.chat_direct_pairs dp
  join public.chat_rooms r on r.id = dp.room_id and r.room_type = 'direct'
  join public.profiles p on p.id = case when dp.user_low = auth.uid() then dp.user_high else dp.user_low end
  where auth.uid() is not null and auth.uid() in (dp.user_low, dp.user_high)
  order by r.created_at desc;
$$;

create or replace function public.get_direct_chat_peer(room_id_in uuid)
returns table (peer_id uuid, peer_name text)
language plpgsql stable security definer set search_path = '' as $$
declare target_type text;
begin
  if auth.uid() is null or not public.is_chat_room_member(room_id_in) then raise exception 'Join this chat to start a call.'; end if;
  select r.room_type into target_type from public.chat_rooms r where r.id = room_id_in;
  if target_type <> 'direct' then raise exception 'Calls are available in personal chats.'; end if;
  return query
    select rm.user_id, coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), p.username)
    from public.chat_room_members rm
    join auth.users u on u.id = rm.user_id
    join public.profiles p on p.id = rm.user_id
    where rm.room_id = room_id_in and rm.user_id <> auth.uid()
    limit 1;
end; $$;

create or replace function public.can_access_chat_call_topic(topic_in text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    exists (
      select 1 from public.chat_direct_pairs dp
      where topic_in = 'chat-call:' || dp.room_id::text
        and auth.uid() in (dp.user_low, dp.user_high)
    ) or exists (
      select 1 from public.chat_room_members rm
      join public.chat_rooms r on r.id = rm.room_id and r.room_type = 'group'
      where topic_in = 'chat-call:' || rm.room_id::text
        and rm.user_id = auth.uid()
    )
  );
$$;

create or replace function public.my_chat_username()
returns text language sql stable security definer set search_path = '' as $$
  select p.username from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.open_direct_chat(username_in text)
returns table (room_id uuid, room_name text, peer_username text)
language plpgsql security definer set search_path = '' as $$
declare peer_id uuid; pair_low uuid; pair_high uuid; existing_room uuid; new_room_id uuid; peer_name text; peer_handle text;
begin
  if auth.uid() is null then raise exception 'Sign in to start a private chat.'; end if;
  select p.id, p.display_name, p.username into peer_id, peer_name, peer_handle
    from public.profiles p where lower(p.username) = lower(btrim(username_in));
  if not found then raise exception 'No OfficeTime account uses that username. Ask them to sign up first.'; end if;
  if peer_id = auth.uid() then raise exception 'Enter another user’s username to start a private chat.'; end if;
  if auth.uid() < peer_id then pair_low := auth.uid(); pair_high := peer_id; else pair_low := peer_id; pair_high := auth.uid(); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(pair_low::text || pair_high::text, 0));
  select dp.room_id into existing_room from public.chat_direct_pairs dp where dp.user_low = pair_low and dp.user_high = pair_high;
  if existing_room is not null then
    return query select existing_room, coalesce(nullif(peer_name, ''), peer_handle), peer_handle;
    return;
  end if;
  insert into public.chat_rooms(name, created_by, room_type)
    values ('Direct chat', auth.uid(), 'direct') returning id into new_room_id;
  insert into public.chat_room_members(room_id, user_id) values (new_room_id, pair_low), (new_room_id, pair_high);
  insert into public.chat_direct_pairs(user_low, user_high, room_id) values (pair_low, pair_high, new_room_id);
  return query select new_room_id, coalesce(nullif(peer_name, ''), peer_handle), peer_handle;
end; $$;

create or replace function public.list_chat_room_members(room_id_in uuid)
returns table (member_id uuid, member_name text, joined_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_chat_room_member(room_id_in) then raise exception 'Join this room to view its members.'; end if;
  return query
    select rm.user_id,
      coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), 'OfficeTime member'),
      rm.joined_at
    from public.chat_room_members rm
    join auth.users u on u.id = rm.user_id
    where rm.room_id = room_id_in
    order by rm.joined_at asc;
end; $$;

create or replace function public.set_chat_room_password(room_id_in uuid, password_in text)
returns void language plpgsql security definer set search_path = '' as $$
declare owner_id uuid; target_type text;
begin
  select created_by, room_type into owner_id, target_type from public.chat_rooms where id = room_id_in;
  if not found then raise exception 'Room not found.'; end if;
  if auth.uid() is null or owner_id is distinct from auth.uid() or target_type <> 'group' then raise exception 'Only the group creator can change its password.'; end if;
  if password_in is not null and password_in <> '' and (char_length(password_in) < 4 or octet_length(password_in) > 72) then
    raise exception 'Password must be at least 4 characters and no more than 72 bytes.';
  end if;
  update public.chat_rooms
    set password_hash = case when password_in is null or password_in = '' then null else extensions.crypt(password_in, extensions.gen_salt('bf')) end
    where id = room_id_in;
end; $$;

create or replace function public.rename_chat_room(room_id_in uuid, name_in text)
returns void language plpgsql security definer set search_path = '' as $$
declare owner_id uuid; target_type text; clean_name text;
begin
  select created_by, room_type into owner_id, target_type
  from public.chat_rooms where id = room_id_in;
  if not found then raise exception 'Room not found.'; end if;
  if auth.uid() is null or owner_id is distinct from auth.uid() or target_type <> 'group' then
    raise exception 'Only the group creator can change its name.';
  end if;
  clean_name := btrim(name_in);
  if clean_name is null or char_length(clean_name) < 1 or char_length(clean_name) > 50 then
    raise exception 'Lobby name must be between 1 and 50 characters.';
  end if;
  update public.chat_rooms set name = clean_name where id = room_id_in;
end; $$;

create or replace function public.kick_chat_room_member(room_id_in uuid, member_id_in uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare owner_id uuid; target_type text; removed_count integer;
begin
  select created_by, room_type into owner_id, target_type from public.chat_rooms where id = room_id_in;
  if not found then raise exception 'Room not found.'; end if;
  if auth.uid() is null or owner_id is distinct from auth.uid() or target_type <> 'group' then raise exception 'Only the group creator can remove members.'; end if;
  if member_id_in = owner_id then raise exception 'The room creator cannot be removed.'; end if;
  delete from public.chat_room_members where room_id = room_id_in and user_id = member_id_in;
  get diagnostics removed_count = row_count;
  return removed_count > 0;
end; $$;

create or replace function public.create_chat_room(name_in text, password_in text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_room_id uuid; clean_name text;
begin
  if auth.uid() is null then raise exception 'Sign in to create a room.'; end if;
  clean_name := btrim(name_in);
  if clean_name is null or char_length(clean_name) < 1 or char_length(clean_name) > 50 then
    raise exception 'Room name must be between 1 and 50 characters.';
  end if;
  if password_in is null or char_length(password_in) < 4 or octet_length(password_in) > 72 then
    raise exception 'Room password must be at least 4 characters and no more than 72 bytes.';
  end if;
  insert into public.chat_rooms(name, created_by, password_hash)
  values (clean_name, auth.uid(), extensions.crypt(password_in, extensions.gen_salt('bf')))
  returning id into new_room_id;
  insert into public.chat_room_members(room_id, user_id) values (new_room_id, auth.uid());
  return new_room_id;
end; $$;

create or replace function public.join_chat_room(room_id_in uuid, password_in text default '')
returns boolean language plpgsql security definer set search_path = '' as $$
declare target public.chat_rooms%rowtype; recent_attempts integer;
begin
  if auth.uid() is null then raise exception 'Sign in to enter a room.'; end if;
  select * into target from public.chat_rooms where id = room_id_in;
  if not found then raise exception 'Room not found.'; end if;
  if exists (select 1 from public.chat_room_members where room_id = room_id_in and user_id = auth.uid()) then return true; end if;
  if target.password_hash is not null then
    delete from public.chat_room_join_attempts where user_id = auth.uid() and room_id = room_id_in and attempted_at < now() - interval '10 minutes';
    select count(*) into recent_attempts from public.chat_room_join_attempts
      where user_id = auth.uid() and room_id = room_id_in and attempted_at > now() - interval '10 minutes';
    if recent_attempts >= 10 then return false; end if;
    insert into public.chat_room_join_attempts(user_id, room_id) values (auth.uid(), room_id_in);
    if password_in is null or extensions.crypt(password_in, target.password_hash) <> target.password_hash then
      return false;
    end if;
  end if;
  insert into public.chat_room_members(room_id, user_id) values (room_id_in, auth.uid()) on conflict do nothing;
  return true;
end; $$;

create or replace function public.list_chat_room_media_paths(room_id_in uuid)
returns table (media_path text) language plpgsql stable security definer set search_path = '' as $$
declare owner_id uuid;
begin
  select created_by into owner_id from public.chat_rooms where id = room_id_in and room_type = 'group';
  if not found or auth.uid() is null or owner_id is distinct from auth.uid() then raise exception 'Only the room creator can delete this room.'; end if;
  return query select m.media_path from public.chat_messages m where m.room_id = room_id_in and m.media_path is not null;
end; $$;

create or replace function public.delete_chat_room(room_id_in uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare owner_id uuid;
begin
  select created_by into owner_id from public.chat_rooms where id = room_id_in and not is_default and room_type = 'group';
  if not found then raise exception 'This room cannot be deleted.'; end if;
  if auth.uid() is null or owner_id is distinct from auth.uid() then raise exception 'Only the room creator can delete this room.'; end if;
  delete from public.chat_rooms where id = room_id_in;
  return true;
end; $$;

create or replace function public.list_my_guest_group_media_paths()
returns table (media_path text) language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt()->>'is_anonymous', 'false') <> 'true' then raise exception 'Guest account required.'; end if;
  return query
    select m.media_path from public.chat_messages m
    join public.chat_rooms r on r.id = m.room_id
    where r.created_by = auth.uid() and r.room_type = 'group' and not r.is_default and m.media_path is not null;
end; $$;

create or replace function public.delete_my_guest_groups()
returns integer language plpgsql security definer set search_path = '' as $$
declare removed_count integer;
begin
  if coalesce(auth.jwt()->>'is_anonymous', 'false') <> 'true' then raise exception 'Guest account required.'; end if;
  delete from public.chat_rooms
    where created_by = auth.uid() and room_type = 'group' and not is_default;
  get diagnostics removed_count = row_count;
  return removed_count;
end; $$;

create or replace function public.is_chat_room_creator_for_media(media_path_in text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.chat_messages m join public.chat_rooms r on r.id = m.room_id
    where m.media_path = media_path_in and r.room_type = 'group' and r.created_by = auth.uid()
  );
$$;

revoke all on function public.list_chat_rooms() from public, anon;
revoke all on function public.create_chat_room(text,text) from public, anon;
revoke all on function public.join_chat_room(uuid,text) from public, anon;
revoke all on function public.list_chat_room_members(uuid) from public, anon;
revoke all on function public.set_chat_room_password(uuid,text) from public, anon;
revoke all on function public.rename_chat_room(uuid,text) from public, anon;
revoke all on function public.kick_chat_room_member(uuid,uuid) from public, anon;
revoke all on function public.list_chat_room_media_paths(uuid) from public, anon;
revoke all on function public.delete_chat_room(uuid) from public, anon;
revoke all on function public.list_my_guest_group_media_paths() from public, anon;
revoke all on function public.delete_my_guest_groups() from public, anon;
revoke all on function public.is_chat_room_creator_for_media(text) from public, anon;
revoke all on function public.add_chat_room_member_by_username(uuid,text) from public, anon;
revoke all on function public.list_direct_chats() from public, anon;
revoke all on function public.my_chat_username() from public, anon;
revoke all on function public.open_direct_chat(text) from public, anon;
revoke all on function public.get_direct_chat_peer(uuid) from public, anon;
grant execute on function public.list_chat_rooms() to authenticated;
grant execute on function public.create_chat_room(text,text) to authenticated;
grant execute on function public.join_chat_room(uuid,text) to authenticated;
grant execute on function public.list_chat_room_members(uuid) to authenticated;
grant execute on function public.set_chat_room_password(uuid,text) to authenticated;
grant execute on function public.rename_chat_room(uuid,text) to authenticated;
grant execute on function public.kick_chat_room_member(uuid,uuid) to authenticated;
grant execute on function public.list_chat_room_media_paths(uuid) to authenticated;
grant execute on function public.delete_chat_room(uuid) to authenticated;
grant execute on function public.list_my_guest_group_media_paths() to authenticated;
grant execute on function public.delete_my_guest_groups() to authenticated;
grant execute on function public.is_chat_room_creator_for_media(text) to authenticated;
grant execute on function public.add_chat_room_member_by_username(uuid,text) to authenticated;
grant execute on function public.list_direct_chats() to authenticated;
grant execute on function public.my_chat_username() to authenticated;
grant execute on function public.open_direct_chat(text) to authenticated;
grant execute on function public.get_direct_chat_peer(uuid) to authenticated;
revoke all on function public.can_access_chat_call_topic(text) from public, anon;
grant execute on function public.can_access_chat_call_topic(text) to authenticated;

-- WebRTC signaling uses private direct-chat or group-room Broadcast channels. In Supabase Dashboard,
-- Realtime Settings, disable "Allow public access" so these policies are enforced.
drop policy if exists "Direct chat members can receive call signals" on realtime.messages;
drop policy if exists "Direct chat members can send call signals" on realtime.messages;
drop policy if exists "Chat room members can receive call signals" on realtime.messages;
create policy "Chat room members can receive call signals" on realtime.messages
  for select to authenticated using (extension = 'broadcast' and public.can_access_chat_call_topic(realtime.topic()));
drop policy if exists "Chat room members can send call signals" on realtime.messages;
create policy "Chat room members can send call signals" on realtime.messages
  for insert to authenticated with check (extension = 'broadcast' and public.can_access_chat_call_topic(realtime.topic()));

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
  if not exists (select 1 from public.chat_room_members rm where rm.room_id = target.room_id and rm.user_id = viewer_id_in) then
    raise exception 'Join this room to view its media.';
  end if;
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
  array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','image/avif','video/mp4','video/quicktime','video/webm','audio/webm','audio/mp4','audio/mpeg','audio/wav','audio/ogg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists chat_media_upload_own on storage.objects;
create policy chat_media_upload_own on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists chat_media_delete_own on storage.objects;
create policy chat_media_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'chat-media' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_chat_room_creator_for_media(name)));
-- No client read policy: media is delivered through the authenticated Edge Function only.

do $$ begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.chat_message_hides;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.chat_message_reactions;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.chat_room_members;
exception when duplicate_object then null;
end $$;

-- App-wide voice/video call sessions, invitations, and reusable call history.
create table if not exists public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('voice','video')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create table if not exists public.call_session_members (
  call_id uuid not null references public.call_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited','joined','declined','left')),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  primary key (call_id,user_id)
);
create index if not exists call_members_user_history_idx on public.call_session_members(user_id, invited_at desc);
alter table public.call_sessions enable row level security;
alter table public.call_session_members enable row level security;
revoke all on public.call_sessions, public.call_session_members from public, anon, authenticated;

create or replace function public.create_call_session(usernames_in text[], mode_in text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare call_id_out uuid; target_id uuid; invited text; invite_count integer := 0;
begin
  if auth.uid() is null then raise exception 'Sign in to make a call.'; end if;
  if mode_in not in ('voice','video') then raise exception 'Choose voice or video call.'; end if;
  if coalesce(cardinality(usernames_in),0) < 1 or cardinality(usernames_in) > 5 then raise exception 'Invite between 1 and 5 people.'; end if;
  insert into public.call_sessions(created_by,mode) values(auth.uid(),mode_in) returning id into call_id_out;
  insert into public.call_session_members(call_id,user_id,status,joined_at) values(call_id_out,auth.uid(),'joined',now());
  foreach invited in array usernames_in loop
    select p.id into target_id from public.profiles p where lower(p.username)=lower(btrim(invited));
    if target_id is null then raise exception 'Username not found: %', invited; end if;
    if target_id <> auth.uid() then
      insert into public.call_session_members(call_id,user_id,status) values(call_id_out,target_id,'invited') on conflict(call_id,user_id) do nothing;
      invite_count := invite_count + 1;
    end if;
  end loop;
  if invite_count = 0 then raise exception 'Enter another user’s username.'; end if;
  return call_id_out;
end; $$;

create or replace function public.invite_call_member(call_id_in uuid, username_in text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_id uuid; target_username text; target_name text;
begin
  if not exists(select 1 from public.call_session_members m join public.call_sessions c on c.id=m.call_id where m.call_id=call_id_in and m.user_id=auth.uid() and m.status='joined' and c.ended_at is null) then raise exception 'Only a current caller can invite people.'; end if;
  perform 1 from public.call_sessions where id=call_id_in and ended_at is null for update;
  select p.id,p.username,p.display_name into target_id,target_username,target_name from public.profiles p where lower(p.username)=lower(btrim(username_in));
  if target_id is null then raise exception 'Username not found.'; end if;
  if target_id=auth.uid() then raise exception 'You are already on this call.'; end if;
  if exists(select 1 from public.call_session_members m where m.call_id=call_id_in and m.user_id=target_id and m.status in ('invited','joined')) then raise exception 'That user is already invited or on the call.'; end if;
  if (select count(*) from public.call_session_members m where m.call_id=call_id_in and m.status in ('invited','joined')) >= 6 then raise exception 'Calls support up to 6 people.'; end if;
  insert into public.call_session_members(call_id,user_id,status) values(call_id_in,target_id,'invited') on conflict(call_id,user_id) do update set status='invited', invited_at=now();
  return jsonb_build_object('user_id',target_id,'username',target_username,'display_name',target_name);
end; $$;

create or replace function public.respond_call_session(call_id_in uuid, action_in text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if action_in not in ('join','decline','leave','end') then raise exception 'Invalid call action.'; end if;
  if action_in='end' then
    update public.call_sessions set ended_at=now() where id=call_id_in and created_by=auth.uid() and ended_at is null;
    if not found then raise exception 'Only the call creator can end this call for everyone.'; end if;
  else
    update public.call_session_members set status=case action_in when 'join' then 'joined' else action_in end,
      joined_at=case when action_in='join' then now() else joined_at end
      where call_id=call_id_in and user_id=auth.uid() and status in ('invited','joined')
        and exists(select 1 from public.call_sessions c where c.id=call_id_in and c.ended_at is null);
    if not found then raise exception 'Call invitation not found.'; end if;
    if action_in='leave' and not exists(select 1 from public.call_session_members m where m.call_id=call_id_in and m.status='joined') then
      update public.call_sessions set ended_at=now() where id=call_id_in and ended_at is null;
    end if;
  end if;
end; $$;

create or replace function public.list_call_session_members(call_id_in uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id',p.id,'username',p.username,'display_name',p.display_name,'status',m.status,'call_creator',(select c.created_by from public.call_sessions c where c.id=call_id_in)) order by m.invited_at),'[]'::jsonb)
  from public.call_session_members m join public.profiles p on p.id=m.user_id
  where m.call_id=call_id_in and exists(select 1 from public.call_session_members mine where mine.call_id=call_id_in and mine.user_id=auth.uid());
$$;

create or replace function public.list_my_call_history()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'mode',c.mode,'created_at',c.created_at,'ended_at',c.ended_at,'created_by',c.created_by,
    'members',(select coalesce(jsonb_agg(jsonb_build_object('user_id',p.id,'username',p.username,'display_name',p.display_name,'status',m.status) order by m.invited_at),'[]'::jsonb)
      from public.call_session_members m join public.profiles p on p.id=m.user_id where m.call_id=c.id and m.user_id<>auth.uid())
  ) order by c.created_at desc),'[]'::jsonb)
  from public.call_sessions c where exists(select 1 from public.call_session_members mine where mine.call_id=c.id and mine.user_id=auth.uid());
$$;

create or replace function public.can_access_call_realtime_topic(topic_in text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(
    select 1 from public.call_sessions c join public.call_session_members m on m.call_id=c.id
    where topic_in='call-session:'||c.id::text and c.ended_at is null and m.user_id=auth.uid() and m.status in ('invited','joined')
  );
$$;
create or replace function public.can_receive_call_inbox(topic_in text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and topic_in='call-inbox:'||auth.uid()::text;
$$;
create or replace function public.can_send_call_inbox(topic_in text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(
    select 1 from public.call_sessions c
    join public.call_session_members sender on sender.call_id=c.id and sender.user_id=auth.uid() and sender.status='joined'
    join public.call_session_members recipient on recipient.call_id=c.id and recipient.status='invited'
    where c.ended_at is null and topic_in='call-inbox:'||recipient.user_id::text
  );
$$;
create or replace function public.can_access_call_inbox(topic_in text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_receive_call_inbox(topic_in) or public.can_send_call_inbox(topic_in);
$$;
revoke all on function public.create_call_session(text[],text), public.invite_call_member(uuid,text), public.respond_call_session(uuid,text), public.list_call_session_members(uuid), public.list_my_call_history(), public.can_access_call_realtime_topic(text), public.can_receive_call_inbox(text), public.can_send_call_inbox(text), public.can_access_call_inbox(text) from public, anon;
grant execute on function public.create_call_session(text[],text), public.invite_call_member(uuid,text), public.respond_call_session(uuid,text), public.list_call_session_members(uuid), public.list_my_call_history(), public.can_access_call_realtime_topic(text), public.can_receive_call_inbox(text), public.can_send_call_inbox(text), public.can_access_call_inbox(text) to authenticated;

drop policy if exists "Call session members can receive signals" on realtime.messages;
drop policy if exists "Call session members can send signals" on realtime.messages;
drop policy if exists "Users receive their call invitations" on realtime.messages;
drop policy if exists "Call members can send invitations" on realtime.messages;
create policy "Call session members can receive signals" on realtime.messages for select to authenticated
  using (extension='broadcast' and public.can_access_call_realtime_topic(realtime.topic()));
create policy "Call session members can send signals" on realtime.messages for insert to authenticated
  with check (extension='broadcast' and public.can_access_call_realtime_topic(realtime.topic()));
create policy "Users receive their call invitations" on realtime.messages for select to authenticated
  using (extension='broadcast' and public.can_access_call_inbox(realtime.topic()));
create policy "Call members can send invitations" on realtime.messages for insert to authenticated
  with check (extension='broadcast' and public.can_send_call_inbox(realtime.topic()));
