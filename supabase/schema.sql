-- OfficeTime attendance schema. Run in the Supabase SQL editor.
-- Grant manager/hr_admin roles only by trusted service-side tooling.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'employee' check (role in ('employee','manager','hr_admin')),
  created_at timestamptz not null default now()
);
create table if not exists public.attendance_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  punch_in_at timestamptz,
  punch_out_at timestamptz,
  office_out_at timestamptz,
  sessions jsonb not null default '[]'::jsonb check (jsonb_typeof(sessions) = 'array'),
  break_minutes integer not null default 60 check (break_minutes between 0 and 240),
  manager_approved_late_login boolean not null default false,
  approval_status text not null default 'not_required' check (approval_status in ('pending','approved','rejected','not_required')),
  approval_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, work_date),
  check (punch_out_at is null or punch_in_at is not null),
  check (punch_out_at is null or punch_out_at > punch_in_at)
);
create table if not exists public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attendance_day_id uuid references public.attendance_days(id) on delete cascade,
  event_type text not null check (event_type in ('punch_in','punch_out','break_start','break_end','correction_request')),
  occurred_at timestamptz not null default now(),
  source text not null default 'mobile', metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.late_arrival_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  login_at timestamptz not null,
  minutes_late integer not null default 0,
  after_flex_limit boolean not null default false,
  manager_approved boolean not null default false,
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected','not_required')),
  notes text, reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
  created_at timestamptz not null default now(), unique (user_id, work_date)
);

-- Migration safety for installations that used the starter schema.
alter table public.attendance_days add column if not exists approval_status text not null default 'not_required';
alter table public.attendance_days add column if not exists sessions jsonb not null default '[]'::jsonb;
alter table public.attendance_days add column if not exists office_out_at timestamptz;
alter table public.late_arrival_reviews add column if not exists reviewed_by uuid references auth.users(id);
alter table public.late_arrival_reviews add column if not exists reviewed_at timestamptz;

create or replace function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))) on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created_officetime on auth.users;
create trigger on_auth_user_created_officetime after insert on auth.users for each row execute procedure public.create_profile_for_new_user();
insert into public.profiles (id, display_name)
select id, coalesce(raw_user_meta_data ->> 'full_name', split_part(email, '@', 1)) from auth.users
on conflict (id) do nothing;

create or replace function public.has_staff_role()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('manager','hr_admin'));
$$;

create or replace function public.protect_attendance_approval_fields()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_staff_role() then
    if tg_op = 'UPDATE' then
      new.manager_approved_late_login := old.manager_approved_late_login;
      new.approval_status := old.approval_status;
      new.approval_note := old.approval_note;
    else
      new.manager_approved_late_login := false;
      new.approval_status := 'not_required';
      new.approval_note := null;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists protect_attendance_approval_fields on public.attendance_days;
create trigger protect_attendance_approval_fields before insert or update on public.attendance_days
for each row execute procedure public.protect_attendance_approval_fields();

create or replace function public.protect_late_review_fields()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_staff_role() then
    if tg_op = 'UPDATE' then
      new.manager_approved := old.manager_approved;
      new.review_status := old.review_status;
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
    else
      new.manager_approved := false;
      new.review_status := 'pending';
      new.reviewed_by := null;
      new.reviewed_at := null;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists protect_late_review_fields on public.late_arrival_reviews;
create trigger protect_late_review_fields before insert or update on public.late_arrival_reviews
for each row execute procedure public.protect_late_review_fields();

alter table public.profiles enable row level security;
alter table public.attendance_days enable row level security;
alter table public.attendance_events enable row level security;
alter table public.late_arrival_reviews enable row level security;

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_select_staff on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using (auth.uid() = id or public.has_staff_role());
-- No client profile update policy: users cannot promote themselves or alter trusted role fields.

drop policy if exists attendance_days_select_own on public.attendance_days;
drop policy if exists attendance_days_insert_own on public.attendance_days;
drop policy if exists attendance_days_update_own on public.attendance_days;
drop policy if exists attendance_days_delete_own on public.attendance_days;
drop policy if exists attendance_days_select_staff on public.attendance_days;
create policy attendance_days_select_own on public.attendance_days for select to authenticated using (auth.uid() = user_id or public.has_staff_role());
create policy attendance_days_insert_own on public.attendance_days for insert to authenticated with check (auth.uid() = user_id);
create policy attendance_days_update_own on public.attendance_days for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy attendance_days_delete_own on public.attendance_days for delete to authenticated using (auth.uid() = user_id);

drop policy if exists attendance_events_select_own on public.attendance_events;
drop policy if exists attendance_events_insert_own on public.attendance_events;
create policy attendance_events_select_own on public.attendance_events for select to authenticated using (auth.uid() = user_id or public.has_staff_role());
create policy attendance_events_insert_own on public.attendance_events for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists late_reviews_select_own on public.late_arrival_reviews;
drop policy if exists late_reviews_insert_own on public.late_arrival_reviews;
drop policy if exists late_reviews_update_own on public.late_arrival_reviews;
drop policy if exists late_reviews_update_staff on public.late_arrival_reviews;
create policy late_reviews_select_own on public.late_arrival_reviews for select to authenticated using (auth.uid() = user_id or public.has_staff_role());
create policy late_reviews_insert_own on public.late_arrival_reviews for insert to authenticated with check (auth.uid() = user_id);
create policy late_reviews_update_own on public.late_arrival_reviews for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.hr_attendance_report()
returns table (
  review_id uuid, user_id uuid, employee_name text, email text, work_date date,
  minutes_late integer, review_status text, net_work_minutes integer
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_staff_role() then raise exception 'HR or manager role required'; end if;
  return query
    select r.id, p.id, coalesce(p.display_name, u.email::text), u.email::text, coalesce(r.work_date, a.work_date),
      r.minutes_late, r.review_status,
      case when a.punch_in_at is null then 0
        when jsonb_typeof(a.sessions) = 'array' and jsonb_array_length(a.sessions) > 0 then
          greatest(0, coalesce(session_totals.elapsed_minutes, 0))
        else greatest(0, floor(extract(epoch from (coalesce(a.punch_out_at, now()) - a.punch_in_at))/60)::integer)
      end
    from public.attendance_days a
    join auth.users u on u.id = a.user_id
    join public.profiles p on p.id = a.user_id
    full join public.late_arrival_reviews r on r.user_id = a.user_id and r.work_date = a.work_date
    left join lateral (
      select
        coalesce(sum(floor(extract(epoch from (coalesce((s.value->>'punchOutAt')::timestamptz, now()) - (s.value->>'punchInAt')::timestamptz))/60)::integer), 0)::integer as elapsed_minutes,
        coalesce(sum(case when s.previous_value->>'punchOutAt' is not null
          then greatest(0, floor(extract(epoch from ((s.value->>'punchInAt')::timestamptz - (s.previous_value->>'punchOutAt')::timestamptz))/60)::integer)
          else 0 end), 0)::integer as gap_minutes
      from (
        select value, lag(value) over (order by ordinality) as previous_value
        from jsonb_array_elements(case when jsonb_typeof(a.sessions) = 'array' then a.sessions else '[]'::jsonb end) with ordinality
      ) s
    ) session_totals on true
    where a.work_date >= current_date - 30 or r.work_date >= current_date - 30
    order by coalesce(r.work_date, a.work_date) desc;
end; $$;
revoke all on function public.hr_attendance_report() from public;
grant execute on function public.hr_attendance_report() to authenticated;

create or replace function public.resolve_late_arrival(review_id uuid, decision text)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.late_arrival_reviews%rowtype;
begin
  if not public.has_staff_role() then raise exception 'HR or manager role required'; end if;
  if decision not in ('approved','rejected') then raise exception 'Invalid decision'; end if;
  select * into target from public.late_arrival_reviews where id = review_id for update;
  if not found then raise exception 'Review not found'; end if;
  update public.late_arrival_reviews set review_status = decision, manager_approved = (decision = 'approved'), reviewed_by = auth.uid(), reviewed_at = now() where id = review_id;
  update public.attendance_days set approval_status = decision, manager_approved_late_login = (decision = 'approved'), updated_at = now() where user_id = target.user_id and work_date = target.work_date;
end; $$;
revoke all on function public.resolve_late_arrival(uuid,text) from public;
grant execute on function public.resolve_late_arrival(uuid,text) to authenticated;

-- Example trusted provisioning (run only as project owner/service role):
-- update public.profiles set role = 'hr_admin' where id = '<verified-auth-user-uuid>';
