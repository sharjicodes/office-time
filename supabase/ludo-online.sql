-- Multiplayer Ludo rooms and server-validated turns. Run after schema.sql/chat-schema.sql.
create table if not exists public.ludo_matches (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  creator_username text not null,
  player_count integer not null check (player_count between 2 and 6),
  invitee_ids uuid[] not null,
  invitee_usernames text[] not null,
  room_name text,
  room_password_hash text,
  is_public boolean not null default false,
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
  check ((is_public and cardinality(invitee_ids) = 0 and cardinality(invitee_usernames) = 0) or (not is_public and cardinality(invitee_ids) = player_count - 1 and cardinality(invitee_usernames) = player_count - 1)),
  check (cardinality(player_user_ids) = cardinality(player_usernames)),
  constraint ludo_matches_public_password_check check (not is_public or room_password_hash is not null)
);
alter table public.ludo_matches drop constraint if exists ludo_matches_player_count_check;
alter table public.ludo_matches add constraint ludo_matches_player_count_check check (player_count between 2 and 6);
alter table public.ludo_matches add column if not exists six_streak integer not null default 0 check (six_streak between 0 and 2);
alter table public.ludo_matches add column if not exists forfeit_triple_six boolean not null default true;
alter table public.ludo_matches add column if not exists room_name text;
alter table public.ludo_matches add column if not exists room_password_hash text;
alter table public.ludo_matches add column if not exists is_public boolean not null default false;
alter table public.ludo_matches drop constraint if exists ludo_matches_public_password_check;
alter table public.ludo_matches add constraint ludo_matches_public_password_check check (not is_public or room_password_hash is not null);
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.ludo_matches'::regclass and contype = 'c'
    and (pg_get_constraintdef(oid) like '%cardinality(invitee_ids)%' or pg_get_constraintdef(oid) like '%cardinality(invitee_usernames)%')
  loop execute format('alter table public.ludo_matches drop constraint %I', c.conname); end loop;
end $$;
alter table public.ludo_matches add constraint ludo_matches_room_invite_counts_check check (
  (is_public and cardinality(invitee_ids) = 0 and cardinality(invitee_usernames) = 0)
  or (not is_public and cardinality(invitee_ids) = player_count - 1 and cardinality(invitee_usernames) = player_count - 1)
);
create index if not exists ludo_matches_created_idx on public.ludo_matches (created_at desc) where status = 'waiting';
create index if not exists ludo_matches_players_idx on public.ludo_matches using gin (player_user_ids);
alter table public.ludo_matches enable row level security;
drop policy if exists ludo_matches_participant_read on public.ludo_matches;
create policy ludo_matches_participant_read on public.ludo_matches for select to authenticated
  using (auth.uid() = creator_id or auth.uid() = any(invitee_ids) or auth.uid() = any(player_user_ids));
revoke insert, update, delete on public.ludo_matches from anon, authenticated;
grant select on public.ludo_matches to authenticated;

create or replace function public.create_public_ludo_room(room_name_in text, password_in text, player_count_in integer, forfeit_triple_six_in boolean default true)
returns uuid language plpgsql security definer set search_path = public, auth, extensions as $$
declare creator_name text; clean_name text; match_id uuid;
begin
  if auth.uid() is null then raise exception 'Create a guest username or sign in to open a room.'; end if;
  clean_name := left(btrim(coalesce(room_name_in, '')), 32);
  if clean_name = '' then raise exception 'Enter a room name.'; end if;
  if password_in is null or length(password_in) < 4 or length(password_in) > 64 then raise exception 'Choose a room password between 4 and 64 characters.'; end if;
  if player_count_in not between 2 and 6 then raise exception 'Choose 2–6 players.'; end if;
  select username into creator_name from public.profiles where id = auth.uid();
  if creator_name is null then raise exception 'Your guest username is still being created. Try again in a moment.'; end if;
  insert into public.ludo_matches (creator_id, creator_username, player_count, invitee_ids, invitee_usernames, room_name, room_password_hash, is_public, player_user_ids, player_usernames, tokens, forfeit_triple_six)
    values (auth.uid(), creator_name, player_count_in, '{}', '{}', clean_name, extensions.crypt(password_in, extensions.gen_salt('bf')), true,
      array[auth.uid()], array[creator_name], jsonb_build_object(auth.uid()::text, '[-1,-1,-1,-1]'::jsonb), forfeit_triple_six_in)
    returning id into match_id;
  return match_id;
end $$;

create or replace function public.list_public_ludo_rooms()
returns table (id uuid, room_name text, creator_username text, player_count integer, joined_count integer, created_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select m.id, m.room_name, m.creator_username, m.player_count, cardinality(m.player_user_ids), m.created_at
  from public.ludo_matches m where m.is_public and m.status = 'waiting' and cardinality(m.player_user_ids) < m.player_count
  order by m.created_at desc limit 60
$$;

create or replace function public.join_public_ludo_room(match_id_in uuid, password_in text)
returns boolean language plpgsql security definer set search_path = public, auth, extensions as $$
declare m public.ludo_matches%rowtype; joining_username text; joined_count integer;
begin
  if auth.uid() is null then raise exception 'Create a guest username or sign in to join a room.'; end if;
  select * into m from public.ludo_matches where id = match_id_in for update;
  if not found or not m.is_public then raise exception 'This public room could not be found.'; end if;
  if auth.uid() = any(m.player_user_ids) then return true; end if;
  if m.status <> 'waiting' or cardinality(m.player_user_ids) >= m.player_count then raise exception 'This room is full.'; end if;
  if m.room_password_hash is null or extensions.crypt(password_in, m.room_password_hash) <> m.room_password_hash then raise exception 'That room password is incorrect.'; end if;
  select username into joining_username from public.profiles where id = auth.uid();
  if joining_username is null then raise exception 'Your guest username is still being created. Try again in a moment.'; end if;
  joined_count := cardinality(m.player_user_ids) + 1;
  update public.ludo_matches set player_user_ids = array_append(player_user_ids, auth.uid()),
    player_usernames = array_append(player_usernames, joining_username),
    tokens = jsonb_set(tokens, array[auth.uid()::text], '[-1,-1,-1,-1]'::jsonb, true),
    status = case when joined_count = player_count then 'active' else 'waiting' end, updated_at = now()
    where id = match_id_in;
  return joined_count = m.player_count;
end $$;

drop function if exists public.create_ludo_invite(text[], integer);
create or replace function public.create_ludo_invite(username_list_in text[], player_count_in integer, forfeit_triple_six_in boolean default true)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare target_id uuid; target_name text; sender_name text; invite_ids uuid[] := '{}'; invite_names text[] := '{}'; requested text; match_id uuid; initial_tokens jsonb;
begin
  if auth.uid() is null then raise exception 'Create a guest profile or sign in to invite players.'; end if;
  if player_count_in not between 2 and 6 or cardinality(username_list_in) <> player_count_in - 1 then raise exception 'Choose 2–6 players and enter exactly % usernames.', player_count_in - 1; end if;
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
  -- A lively Ludo die: six appears about one-third of the time; 1–5 share the rest.
  if random() < (1.0 / 3.0) then
    rolled := 6;
  else
    rolled := floor(random() * 5 + 1)::integer;
  end if;
  if rolled = 6 and m.forfeit_triple_six and m.six_streak >= 2 then
    update public.ludo_matches set dice_value = null, six_streak = 0, turn_index = (turn_index + 1) % cardinality(player_user_ids), updated_at = now() where id = match_id_in;
    return 0;
  end if;
  update public.ludo_matches set dice_value = rolled, six_streak = case when rolled = 6 then least(m.six_streak + 1, 2) else 0 end, updated_at = now() where id = match_id_in;
  return rolled;
end $$;

-- Shared rules helper used by both server-side moves and the no-move check.
create or replace function public.ludo_token_move_is_legal(tokens_in jsonb, player_ids_in uuid[], player_count_in integer, player_id_in uuid, token_index_in integer, die_in integer)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  position integer;
  destination integer;
  first_step integer;
  step_index integer;
  square integer;
  other_player uuid;
  other_start integer;
  other_token integer;
  opposing_pieces integer;
  starts integer[];
  safe_cells integer[];
begin
  if token_index_in not between 0 and 3 or die_in not between 1 and 6 then return false; end if;
  if player_count_in = 2 then starts := array[41,28]; safe_cells := array[2,10,15,23,28,36,41,49];
  elsif player_count_in = 3 then starts := array[41,28,15]; safe_cells := array[2,10,15,23,28,36,41,49];
  elsif player_count_in = 4 then starts := array[41,28,15,2]; safe_cells := array[2,10,15,23,28,36,41,49];
  elsif player_count_in = 5 then starts := array[0,9,18,27,36]; safe_cells := array[0,4,9,13,18,22,27,31,36,40,48];
  elsif player_count_in = 6 then starts := array[0,9,18,27,36,44]; safe_cells := array[0,4,9,13,18,22,27,31,36,40,44,48];
  else return false; end if;
  if not player_id_in = any(player_ids_in) then return false; end if;
  position := (tokens_in -> player_id_in::text ->> token_index_in)::integer;
  if position is null or position >= 57 then return false; end if;
  if position < 0 and die_in <> 6 then return false; end if;
  destination := case when position < 0 then 0 else position + die_in end;
  if destination > 57 then return false; end if;
  first_step := case when position < 0 then 0 else position + 1 end;
  if first_step > least(destination, 51) then return true; end if;
  for step_index in first_step..least(destination, 51) loop
    square := (starts[array_position(player_ids_in, player_id_in)] + step_index) % 52;
    -- Safe squares permit stacked pieces; a blockade there does not block movement.
    if square = any(safe_cells) then continue; end if;
    opposing_pieces := 0;
    foreach other_player in array player_ids_in loop
      if other_player <> player_id_in then
        other_start := starts[array_position(player_ids_in, other_player)];
        for other_token in 0..3 loop
          if (tokens_in -> other_player::text ->> other_token)::integer between 0 and 51
             and (other_start + (tokens_in -> other_player::text ->> other_token)::integer) % 52 = square then
            opposing_pieces := opposing_pieces + 1;
          end if;
        end loop;
      end if;
    end loop;
    if opposing_pieces >= 2 then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public.move_ludo_token(match_id_in uuid, token_index_in integer)
returns void language plpgsql security definer set search_path = public, auth as $$
declare m public.ludo_matches%rowtype; player_id uuid; position integer; destination integer; die integer; start_offset integer; absolute_cell integer; safe_cells integer[] := array[2,10,15,23,28,36,41,49]; opponent uuid; opponent_tokens integer[]; updated_tokens integer[]; player_pos integer; captured boolean := false;
begin
  select * into m from public.ludo_matches where id = match_id_in for update;
  if not found or auth.uid() <> m.player_user_ids[m.turn_index + 1] then raise exception 'It is not your turn.'; end if;
  if m.player_count = 5 then safe_cells := array[0,4,9,13,18,22,27,31,36,40,48]; end if;
  if m.player_count = 6 then safe_cells := array[0,4,9,13,18,22,27,31,36,40,44,48]; end if;
  if m.status <> 'active' or m.dice_value is null then raise exception 'Roll the dice first.'; end if;
  if token_index_in < 0 or token_index_in > 3 then raise exception 'Choose one of your four pieces.'; end if;
  player_id := auth.uid(); die := m.dice_value;
  if not public.ludo_token_move_is_legal(m.tokens, m.player_user_ids, m.player_count, player_id, token_index_in, die) then raise exception 'That piece cannot move because it would pass a blockade or overshoot home.'; end if;
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
  start_offset := (case m.player_count
    when 2 then array[41,28]
    when 3 then array[41,28,15]
    when 4 then array[41,28,15,2]
    when 5 then array[0,9,18,27,36]
    else array[0,9,18,27,36,44] end)[array_position(m.player_user_ids, player_id)];
  if destination < 52 then
    absolute_cell := (start_offset + destination) % 52;
    if not absolute_cell = any(safe_cells) then
      foreach opponent in array m.player_user_ids loop
        if opponent <> player_id then
          select array_agg((m.tokens -> opponent::text ->> n)::integer order by n) into opponent_tokens from generate_series(0,3) n;
          for player_pos in 1..4 loop
            if opponent_tokens[player_pos] >= 0 and opponent_tokens[player_pos] < 52 and
               (((case m.player_count
                 when 2 then array[41,28]
                 when 3 then array[41,28,15]
                 when 4 then array[41,28,15,2]
                 when 5 then array[0,9,18,27,36]
                 else array[0,9,18,27,36,44] end)[array_position(m.player_user_ids, opponent)]) + opponent_tokens[player_pos]) % 52 = absolute_cell then
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
    if public.ludo_token_move_is_legal(m.tokens, m.player_user_ids, m.player_count, auth.uid(), n, die) then has_move := true; end if;
  end loop;
  if has_move then raise exception 'You have a legal move. Select one of your pieces.'; end if;
    update public.ludo_matches set dice_value = null, six_streak = case when die = 6 then six_streak else 0 end,
    turn_index = case when die = 6 then turn_index else (turn_index + 1) % cardinality(player_user_ids) end,
    updated_at = now() where id = match_id_in;
end $$;

revoke all on function public.create_ludo_invite(text[], integer, boolean) from public, anon;
revoke all on function public.create_public_ludo_room(text, text, integer, boolean) from public, anon;
revoke all on function public.list_public_ludo_rooms() from public, anon;
revoke all on function public.join_public_ludo_room(uuid, text) from public, anon;
revoke all on function public.respond_ludo_invite(uuid, boolean) from public, anon;
revoke all on function public.roll_ludo_dice(uuid) from public, anon;
revoke all on function public.move_ludo_token(uuid, integer) from public, anon;
revoke all on function public.skip_ludo_turn(uuid) from public, anon;
revoke all on function public.ludo_token_move_is_legal(jsonb, uuid[], integer, uuid, integer, integer) from public, anon;
grant execute on function public.create_ludo_invite(text[], integer, boolean) to authenticated;
grant execute on function public.create_public_ludo_room(text, text, integer, boolean) to authenticated;
grant execute on function public.list_public_ludo_rooms() to authenticated;
grant execute on function public.join_public_ludo_room(uuid, text) to authenticated;
grant execute on function public.respond_ludo_invite(uuid, boolean) to authenticated;
grant execute on function public.roll_ludo_dice(uuid) to authenticated;
grant execute on function public.move_ludo_token(uuid, integer) to authenticated;
grant execute on function public.skip_ludo_turn(uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ludo_matches') then
    alter publication supabase_realtime add table public.ludo_matches;
  end if;
end $$;
