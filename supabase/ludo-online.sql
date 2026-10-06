-- Multiplayer Ludo rooms and server-validated turns. Run after schema.sql/chat-schema.sql.
create table if not exists public.ludo_matches (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  creator_username text not null,
  player_count integer not null check (player_count in (4, 6)),
  invitee_ids uuid[] not null,
  invitee_usernames text[] not null,
  declined_ids uuid[] not null default '{}',
  player_user_ids uuid[] not null,
  player_usernames text[] not null,
  tokens jsonb not null default '{}'::jsonb,
  turn_index integer not null default 0,
  dice_value integer check (dice_value between 1 and 6),
  six_streak integer not null default 0 check (six_streak between 0 and 2),
  forfeit_triple_six boolean not null default true,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'completed', 'cancelled')),
  winner_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(invitee_ids) = player_count - 1),
  check (cardinality(invitee_usernames) = player_count - 1),
  check (cardinality(player_user_ids) = cardinality(player_usernames))
);
alter table public.ludo_matches add column if not exists six_streak integer not null default 0 check (six_streak between 0 and 2);
alter table public.ludo_matches add column if not exists forfeit_triple_six boolean not null default true;
create index if not exists ludo_matches_created_idx on public.ludo_matches (created_at desc) where status = 'waiting';
create index if not exists ludo_matches_players_idx on public.ludo_matches using gin (player_user_ids);
alter table public.ludo_matches enable row level security;
drop policy if exists ludo_matches_participant_read on public.ludo_matches;
create policy ludo_matches_participant_read on public.ludo_matches for select to authenticated
  using (auth.uid() = creator_id or auth.uid() = any(invitee_ids) or auth.uid() = any(player_user_ids));
revoke insert, update, delete on public.ludo_matches from anon, authenticated;
grant select on public.ludo_matches to authenticated;

drop function if exists public.create_ludo_invite(text[], integer);
create or replace function public.create_ludo_invite(username_list_in text[], player_count_in integer, forfeit_triple_six_in boolean default true)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare target_id uuid; target_name text; sender_name text; invite_ids uuid[] := '{}'; invite_names text[] := '{}'; requested text; match_id uuid; initial_tokens jsonb;
begin
  if auth.uid() is null then raise exception 'Create a guest profile or sign in to invite players.'; end if;
  if player_count_in not in (4,6) or cardinality(username_list_in) <> player_count_in - 1 then raise exception 'Enter exactly % usernames.', player_count_in - 1; end if;
  select username into sender_name from public.profiles where id = auth.uid();
  foreach requested in array username_list_in loop
    select id, username into target_id, target_name from public.profiles where lower(username) = lower(btrim(regexp_replace(requested, '^@', '')));
    if target_id is null then raise exception 'No user found with username %.', requested; end if;
    if target_id = auth.uid() then raise exception 'You cannot invite yourself.'; end if;
    if target_id = any(invite_ids) then raise exception 'Invite each username only once.'; end if;
    invite_ids := array_append(invite_ids, target_id);
    invite_names := array_append(invite_names, target_name);
  end loop;
  initial_tokens := jsonb_build_object(auth.uid()::text, '[-1,-1,-1,-1]'::jsonb);
  insert into public.ludo_matches (creator_id, creator_username, player_count, invitee_ids, invitee_usernames, player_user_ids, player_usernames, tokens, forfeit_triple_six)
    values (auth.uid(), coalesce(sender_name,'Player'), player_count_in, invite_ids, invite_names, array[auth.uid()], array[coalesce(sender_name,'Player')], initial_tokens, forfeit_triple_six_in)
    returning id into match_id;
  return match_id;
end $$;

create or replace function public.respond_ludo_invite(match_id_in uuid, accept_in boolean)
returns void language plpgsql security definer set search_path = public, auth as $$
declare m public.ludo_matches%rowtype; invite_index integer; who_username text;
begin
  select * into m from public.ludo_matches where id = match_id_in for update;
  if not found or not (auth.uid() = any(m.invitee_ids)) then raise exception 'Invitation not found.'; end if;
  if m.status <> 'waiting' then raise exception 'This room has already started.'; end if;
  if auth.uid() = any(m.player_user_ids) or auth.uid() = any(m.declined_ids) then return; end if;
  invite_index := array_position(m.invitee_ids, auth.uid());
  if not accept_in then
    update public.ludo_matches set declined_ids = array_append(declined_ids, auth.uid()), status = 'cancelled', updated_at = now() where id = match_id_in;
    return;
  end if;
  who_username := m.invitee_usernames[invite_index];
  update public.ludo_matches set player_user_ids = array_append(player_user_ids, auth.uid()),
    player_usernames = array_append(player_usernames, who_username),
    tokens = jsonb_set(tokens, array[auth.uid()::text], '[-1,-1,-1,-1]'::jsonb, true),
    status = case when cardinality(player_user_ids) + 1 = player_count then 'active' else 'waiting' end,
    updated_at = now() where id = match_id_in;
end $$;

create or replace function public.roll_ludo_dice(match_id_in uuid)
returns integer language plpgsql security definer set search_path = public, auth as $$
declare m public.ludo_matches%rowtype; rolled integer;
begin
  select * into m from public.ludo_matches where id = match_id_in for update;
  if not found or auth.uid() <> m.player_user_ids[m.turn_index + 1] then raise exception 'It is not your turn.'; end if;
  if m.status <> 'active' or m.dice_value is not null then raise exception 'Finish your current move first.'; end if;
  rolled := floor(random() * 6 + 1)::integer;
  if rolled = 6 and m.forfeit_triple_six and m.six_streak >= 2 then
    update public.ludo_matches set dice_value = null, six_streak = 0, turn_index = (turn_index + 1) % cardinality(player_user_ids), updated_at = now() where id = match_id_in;
    return 0;
  end if;
  update public.ludo_matches set dice_value = rolled, six_streak = case when rolled = 6 then least(m.six_streak + 1, 2) else 0 end, updated_at = now() where id = match_id_in;
  return rolled;
end $$;

create or replace function public.move_ludo_token(match_id_in uuid, token_index_in integer)
returns void language plpgsql security definer set search_path = public, auth as $$
declare m public.ludo_matches%rowtype; player_id uuid; position integer; destination integer; die integer; start_offset integer; absolute_cell integer; safe_cells integer[] := array[2,8,15,21,28,34,41,47]; opponent uuid; opponent_tokens integer[]; updated_tokens integer[]; player_pos integer; captured boolean := false;
begin
  select * into m from public.ludo_matches where id = match_id_in for update;
  if not found or auth.uid() <> m.player_user_ids[m.turn_index + 1] then raise exception 'It is not your turn.'; end if;
  if m.status <> 'active' or m.dice_value is null then raise exception 'Roll the dice first.'; end if;
  if token_index_in < 0 or token_index_in > 3 then raise exception 'Choose one of your four pieces.'; end if;
  player_id := auth.uid(); die := m.dice_value;
  position := (m.tokens -> player_id::text ->> token_index_in)::integer;
  if position < 0 then
    if die <> 6 then raise exception 'Roll a six to move a piece out of the yard.'; end if;
    destination := 0;
  else
    destination := position + die;
    if destination > 57 then raise exception 'Roll the exact number to reach home.'; end if;
  end if;
  select array_agg((m.tokens -> player_id::text ->> n)::integer order by n) into updated_tokens from generate_series(0,3) n;
  updated_tokens[token_index_in + 1] := destination;
  start_offset := case m.player_count
    when 4 then (array[41,32,15,2])[array_position(m.player_user_ids, player_id)]
    else (array[41,32,15,2,47,21])[array_position(m.player_user_ids, player_id)] end;
  if destination < 52 then
    absolute_cell := (start_offset + destination) % 52;
    if not absolute_cell = any(safe_cells) then
      foreach opponent in array m.player_user_ids loop
        if opponent <> player_id then
          select array_agg((m.tokens -> opponent::text ->> n)::integer order by n) into opponent_tokens from generate_series(0,3) n;
          for player_pos in 1..4 loop
            if opponent_tokens[player_pos] >= 0 and opponent_tokens[player_pos] < 52 and
               ((case m.player_count when 4 then (array[41,32,15,2])[array_position(m.player_user_ids, opponent)] else (array[41,32,15,2,47,21])[array_position(m.player_user_ids, opponent)] end) + opponent_tokens[player_pos]) % 52 = absolute_cell then
              opponent_tokens[player_pos] := -1; captured := true;
            end if;
          end loop;
          m.tokens := jsonb_set(m.tokens, array[opponent::text], to_jsonb(opponent_tokens), true);
        end if;
      end loop;
    end if;
  end if;
  m.tokens := jsonb_set(m.tokens, array[player_id::text], to_jsonb(updated_tokens), true);
  if updated_tokens = array[57,57,57,57] then
    update public.ludo_matches set tokens = m.tokens, dice_value = null, status = 'completed', winner_user_id = player_id, updated_at = now() where id = match_id_in;
  else
    update public.ludo_matches set tokens = m.tokens, dice_value = null,
      six_streak = case when die = 6 then six_streak else 0 end,
      turn_index = case when die = 6 or captured then turn_index else (turn_index + 1) % cardinality(player_user_ids) end,
      updated_at = now() where id = match_id_in;
  end if;
end $$;

create or replace function public.skip_ludo_turn(match_id_in uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare m public.ludo_matches%rowtype; die integer; token_pos integer; has_move boolean := false; n integer;
begin
  select * into m from public.ludo_matches where id = match_id_in for update;
  if not found or auth.uid() <> m.player_user_ids[m.turn_index + 1] then raise exception 'It is not your turn.'; end if;
  if m.status <> 'active' or m.dice_value is null then raise exception 'Roll the dice first.'; end if;
  die := m.dice_value;
  for n in 0..3 loop
    token_pos := (m.tokens -> auth.uid()::text ->> n)::integer;
    if (token_pos < 0 and die = 6) or (token_pos >= 0 and token_pos + die <= 57) then has_move := true; end if;
  end loop;
  if has_move then raise exception 'You have a legal move. Select one of your pieces.'; end if;
    update public.ludo_matches set dice_value = null, six_streak = case when die = 6 then six_streak else 0 end,
    turn_index = case when die = 6 then turn_index else (turn_index + 1) % cardinality(player_user_ids) end,
    updated_at = now() where id = match_id_in;
end $$;

revoke all on function public.create_ludo_invite(text[], integer, boolean) from public, anon;
revoke all on function public.respond_ludo_invite(uuid, boolean) from public, anon;
revoke all on function public.roll_ludo_dice(uuid) from public, anon;
revoke all on function public.move_ludo_token(uuid, integer) from public, anon;
revoke all on function public.skip_ludo_turn(uuid) from public, anon;
grant execute on function public.create_ludo_invite(text[], integer, boolean) to authenticated;
grant execute on function public.respond_ludo_invite(uuid, boolean) to authenticated;
grant execute on function public.roll_ludo_dice(uuid) to authenticated;
grant execute on function public.move_ludo_token(uuid, integer) to authenticated;
grant execute on function public.skip_ludo_turn(uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ludo_matches') then
    alter publication supabase_realtime add table public.ludo_matches;
  end if;
end $$;
