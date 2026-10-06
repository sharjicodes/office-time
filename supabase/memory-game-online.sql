-- Online Memory Match. Run once in the Supabase SQL Editor.
-- Guest users use Supabase anonymous auth and receive the generated user_… username in profiles.
create table if not exists public.memory_game_matches (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  invitee_id uuid not null references auth.users(id) on delete cascade,
  creator_username text not null,
  invitee_username text not null,
  pair_count integer not null check (pair_count in (8, 16, 24)),
  deck text[] not null,
  matched_tiles integer[] not null default '{}',
  opened_tiles integer[] not null default '{}',
  pending_miss boolean not null default false,
  scores jsonb not null default '{}'::jsonb,
  turn_user_id uuid references auth.users(id),
  status text not null default 'waiting' check (status in ('waiting', 'active', 'completed', 'declined')),
  winner_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (creator_id <> invitee_id),
  check (cardinality(deck) = pair_count * 2)
);
create index if not exists memory_game_invites_pending_idx on public.memory_game_matches (invitee_id, created_at desc) where status = 'waiting';
create index if not exists memory_game_participants_idx on public.memory_game_matches (creator_id, invitee_id, updated_at desc);
alter table public.memory_game_matches enable row level security;
drop policy if exists memory_game_participant_read on public.memory_game_matches;
create policy memory_game_participant_read on public.memory_game_matches for select to authenticated
  using (auth.uid() = creator_id or auth.uid() = invitee_id);
revoke insert, update, delete on public.memory_game_matches from anon, authenticated;
grant select on public.memory_game_matches to authenticated;

create or replace function public.create_memory_game_invite(username_in text, pair_count_in integer, deck_in text[])
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare target_id uuid; sender_name text; target_name text; match_id uuid;
begin
  if auth.uid() is null then raise exception 'Create a guest profile or sign in to invite a player.'; end if;
  if pair_count_in not in (8,16,24) or cardinality(deck_in) <> pair_count_in * 2 then raise exception 'Invalid board size.'; end if;
  if (select count(*) from unnest(deck_in) p) <> pair_count_in * 2 or
     (select count(*) from (select p from unnest(deck_in) p group by p having count(*) = 2) pairs) <> pair_count_in then
    raise exception 'Each board pair must appear exactly twice.';
  end if;
  select id, username into target_id, target_name from public.profiles where lower(username) = lower(btrim(username_in));
  if target_id is null then raise exception 'No user found with that username.'; end if;
  if target_id = auth.uid() then raise exception 'You cannot invite yourself.'; end if;
  select username into sender_name from public.profiles where id = auth.uid();
  insert into public.memory_game_matches (creator_id, invitee_id, creator_username, invitee_username, pair_count, deck, scores, turn_user_id)
    values (auth.uid(), target_id, coalesce(sender_name, 'Player'), target_name, pair_count_in, deck_in,
      jsonb_build_object(auth.uid()::text, 0, target_id::text, 0), auth.uid()) returning id into match_id;
  return match_id;
end $$;

create or replace function public.respond_memory_game_invite(match_id_in uuid, accept_in boolean)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  update public.memory_game_matches set status = case when accept_in then 'active' else 'declined' end,
    turn_user_id = case when accept_in then creator_id else null end, updated_at = now()
    where id = match_id_in and invitee_id = auth.uid() and status = 'waiting';
  if not found then raise exception 'This invitation is no longer available.'; end if;
end $$;

create or replace function public.play_memory_game_tile(match_id_in uuid, tile_index_in integer)
returns void language plpgsql security definer set search_path = public, auth as $$
declare m public.memory_game_matches%rowtype; first_index integer; new_opened integer[]; new_matched integer[]; next_scores jsonb;
begin
  select * into m from public.memory_game_matches where id = match_id_in for update;
  if not found or auth.uid() not in (m.creator_id, m.invitee_id) then raise exception 'Match not found.'; end if;
  if m.status <> 'active' or m.turn_user_id <> auth.uid() then raise exception 'It is not your turn.'; end if;
  if tile_index_in < 0 or tile_index_in >= cardinality(m.deck) or tile_index_in = any(m.matched_tiles) or tile_index_in = any(m.opened_tiles) then raise exception 'That tile is not available.'; end if;
  if m.pending_miss then raise exception 'Wait for the previous turn to finish.'; end if;
  if cardinality(m.opened_tiles) = 0 then
    update public.memory_game_matches set opened_tiles = array[tile_index_in], updated_at = now() where id = match_id_in;
    return;
  end if;
  first_index := m.opened_tiles[1]; new_opened := array[first_index, tile_index_in];
  if m.deck[first_index + 1] = m.deck[tile_index_in + 1] then
    new_matched := array(select distinct x from unnest(m.matched_tiles || new_opened) x order by x);
    next_scores := jsonb_set(m.scores, array[auth.uid()::text], to_jsonb(coalesce((m.scores ->> auth.uid()::text)::integer,0) + 1), true);
    update public.memory_game_matches set matched_tiles = new_matched, opened_tiles = '{}', scores = next_scores,
      status = case when cardinality(new_matched) = cardinality(m.deck) then 'completed' else status end,
      winner_user_id = case when cardinality(new_matched) = cardinality(m.deck) then
        case when (next_scores ->> m.creator_id::text)::integer = (next_scores ->> m.invitee_id::text)::integer then null
          when (next_scores ->> m.creator_id::text)::integer > (next_scores ->> m.invitee_id::text)::integer then m.creator_id else m.invitee_id end
        else null end, updated_at = now() where id = match_id_in;
  else
    update public.memory_game_matches set opened_tiles = new_opened, pending_miss = true, updated_at = now() where id = match_id_in;
  end if;
end $$;

create or replace function public.settle_memory_game_miss(match_id_in uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare m public.memory_game_matches%rowtype; other_player uuid;
begin
  select * into m from public.memory_game_matches where id = match_id_in for update;
  if not found or auth.uid() not in (m.creator_id, m.invitee_id) then raise exception 'Match not found.'; end if;
  if not m.pending_miss or cardinality(m.opened_tiles) <> 2 then return; end if;
  if m.turn_user_id = m.creator_id then other_player := m.invitee_id; else other_player := m.creator_id; end if;
  update public.memory_game_matches set opened_tiles = '{}', pending_miss = false, turn_user_id = other_player, updated_at = now() where id = match_id_in;
end $$;

revoke all on function public.create_memory_game_invite(text, integer, text[]) from public, anon;
revoke all on function public.respond_memory_game_invite(uuid, boolean) from public, anon;
revoke all on function public.play_memory_game_tile(uuid, integer) from public, anon;
revoke all on function public.settle_memory_game_miss(uuid) from public, anon;
grant execute on function public.create_memory_game_invite(text, integer, text[]) to authenticated;
grant execute on function public.respond_memory_game_invite(uuid, boolean) to authenticated;
grant execute on function public.play_memory_game_tile(uuid, integer) to authenticated;
grant execute on function public.settle_memory_game_miss(uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'memory_game_matches') then
    alter publication supabase_realtime add table public.memory_game_matches;
  end if;
end $$;
