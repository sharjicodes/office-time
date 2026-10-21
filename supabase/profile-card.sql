-- Profile card support for Milo. Run after schema.sql and chat-schema.sql.
-- Users may change their public name and username, but the authorization role
-- (profiles.role) remains server managed.

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

revoke update on public.profiles from public, anon, authenticated;
grant update (display_name, username) on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('milo-profile-photos', 'milo-profile-photos', true, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists milo_profile_photo_select_own on storage.objects;
drop policy if exists milo_profile_photo_insert_own on storage.objects;
drop policy if exists milo_profile_photo_update_own on storage.objects;
drop policy if exists milo_profile_photo_delete_own on storage.objects;

create policy milo_profile_photo_select_own on storage.objects
  for select to authenticated using (bucket_id = 'milo-profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy milo_profile_photo_insert_own on storage.objects
  for insert to authenticated with check (bucket_id = 'milo-profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy milo_profile_photo_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'milo-profile-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'milo-profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy milo_profile_photo_delete_own on storage.objects
  for delete to authenticated using (bucket_id = 'milo-profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
