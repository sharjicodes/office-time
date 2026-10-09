-- Team availability privacy controls and per-room unread tracking.
-- Run after schema.sql and chat-schema.sql in Supabase SQL Editor.

create table if not exists public.team_availability_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  visible_to_team boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.team_availability_preferences enable row level security;
revoke all on public.team_availability_preferences from public, anon, authenticated;
grant select, insert, update on public.team_availability_preferences to authenticated;
drop policy if exists team_availability_preferences_read_own on public.team_availability_preferences;
create policy team_availability_preferences_read_own on public.team_availability_preferences
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists team_availability_preferences_insert_own on public.team_availability_preferences;
create policy team_availability_preferences_insert_own on public.team_availability_preferences
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists team_availability_preferences_update_own on public.team_availability_preferences;
create policy team_availability_preferences_update_own on public.team_availability_preferences
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.set_team_availability_visible(visible_in boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to change availability sharing.'; end if;
  insert into public.team_availability_preferences(user_id, visible_to_team, updated_at)
  values (auth.uid(), visible_in, now())
  on conflict (user_id) do update set visible_to_team = excluded.visible_to_team, updated_at = now();
end; $$;

create or replace function public.list_team_availability(work_date_in date)
returns table (username text, display_name text, presence_status text)
language sql stable security definer set search_path = '' as $$
  select p.username, coalesce(nullif(p.display_name, ''), p.username),
    case
      when d.office_out_at is not null then 'Finished for today'
      when d.id is null or last_session.item is null then 'Not punched in'
      when nullif(last_session.item ->> 'punchOutAt', '') is null then 'Working'
      else 'On break'
    end
  from public.team_availability_preferences pref
  join public.profiles p on p.id = pref.user_id
  left join public.attendance_days d on d.user_id = pref.user_id and d.work_date = work_date_in
  left join lateral (
    select session_item.value as item
    from jsonb_array_elements(
      case when coalesce(jsonb_array_length(d.sessions), 0) > 0 then d.sessions
        when d.punch_in_at is not null then jsonb_build_array(jsonb_build_object('punchInAt', d.punch_in_at, 'punchOutAt', d.punch_out_at))
        else '[]'::jsonb end
    ) with ordinality as session_item(value, ordinality)
    order by session_item.ordinality desc limit 1
  ) last_session on true
  where pref.visible_to_team = true
  order by case when p.id = auth.uid() then 0 else 1 end, p.username;
$$;
revoke all on function public.set_team_availability_visible(boolean) from public, anon;
revoke all on function public.list_team_availability(date) from public, anon;
grant execute on function public.set_team_availability_visible(boolean) to authenticated;
grant execute on function public.list_team_availability(date) to authenticated;

create table if not exists public.chat_room_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, room_id)
);
alter table public.chat_room_reads enable row level security;
revoke all on public.chat_room_reads from public, anon, authenticated;

create or replace function public.mark_chat_room_read(room_id_in uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_chat_room_member(room_id_in) then raise exception 'Join this room before marking it read.'; end if;
  insert into public.chat_room_reads(user_id, room_id, last_read_at)
  values (auth.uid(), room_id_in, now())
  on conflict (user_id, room_id) do update set last_read_at = now();
end; $$;

create or replace function public.list_chat_unread_counts()
returns table (room_id uuid, unread_count bigint)
language sql stable security definer set search_path = '' as $$
  select member.room_id, count(message.id)::bigint
  from public.chat_room_members member
  join public.chat_messages message on message.room_id = member.room_id and message.sender_id <> auth.uid()
  left join public.chat_room_reads read_state on read_state.user_id = auth.uid() and read_state.room_id = member.room_id
  left join public.chat_message_hides hidden on hidden.viewer_id = auth.uid() and hidden.message_id = message.id
  where member.user_id = auth.uid() and hidden.message_id is null
    and message.sent_at > coalesce(read_state.last_read_at, '-infinity'::timestamptz)
  group by member.room_id
  having count(message.id) > 0;
$$;
revoke all on function public.mark_chat_room_read(uuid) from public, anon;
revoke all on function public.list_chat_unread_counts() from public, anon;
grant execute on function public.mark_chat_room_read(uuid) to authenticated;
grant execute on function public.list_chat_unread_counts() to authenticated;

-- Add usernames to member results so the UI can offer unambiguous @mentions.
drop function if exists public.list_chat_room_members(uuid);
create function public.list_chat_room_members(room_id_in uuid)
returns table (member_id uuid, member_name text, joined_at timestamptz, username text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_chat_room_member(room_id_in) then raise exception 'Join this room to view its members.'; end if;
  return query
    select rm.user_id,
      coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), p.username),
      rm.joined_at, p.username
    from public.chat_room_members rm
    join auth.users u on u.id = rm.user_id
    join public.profiles p on p.id = rm.user_id
    where rm.room_id = room_id_in
    order by rm.joined_at asc;
end; $$;
revoke all on function public.list_chat_room_members(uuid) from public, anon;
grant execute on function public.list_chat_room_members(uuid) to authenticated;
