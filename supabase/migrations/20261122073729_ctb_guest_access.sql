create table ctb_private.guest_attempts (
  room_id uuid primary key references public.ctb_rooms on delete cascade,
  window_start timestamptz not null,
  hits integer not null
);
alter table ctb_private.guest_attempts enable row level security;

grant usage on schema ctb_private to service_role;
grant select (room_id, token_hash, expires_at) on ctb_private.invites to service_role;
grant select, insert, update on ctb_private.guest_attempts to service_role;

-- Only the Edge Function can resolve a code before the guest has a session.
create function public.ctb_guest_invite(token uuid) returns uuid
language plpgsql set search_path = '' as $$
declare target uuid;
declare attempt_count integer;
begin
  select room_id into target from ctb_private.invites
    where token_hash = sha256(convert_to(token::text, 'UTF8')) and expires_at > now();
  if target is null then return null; end if;
  insert into ctb_private.guest_attempts as attempts(room_id, window_start, hits)
    values (target, now(), 1)
    on conflict (room_id) do update set
      window_start = case when attempts.window_start < now() - interval '10 minutes'
        then now() else attempts.window_start end,
      hits = case when attempts.window_start < now() - interval '10 minutes'
        then 1 else least(attempts.hits + 1, 51) end
    returning hits into attempt_count;
  if attempt_count > 50 then return null; end if;
  return target;
end;
$$;
revoke all on function public.ctb_guest_invite(uuid) from public, anon, authenticated;
grant execute on function public.ctb_guest_invite(uuid) to service_role;

create or replace function ctb_private.create_room(title text, display_name text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare room uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if auth.jwt()->'app_metadata'->>'ctb_guest_room' is not null
    or lower(coalesce(auth.jwt()->>'email','')) like '%@guest.cwrite.invalid'
    or coalesce(auth.jwt()->>'is_anonymous','false') = 'true'
  then raise exception 'An account is required to create a room'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 19473));
  if exists(select 1 from public.ctb_members where user_id = auth.uid() and role = 'owner') then
    raise exception 'You already own a room';
  end if;
  insert into public.ctb_rooms(title) values (btrim(title)) returning id into room;
  insert into public.ctb_members(room_id, user_id, name, role)
    values (room, auth.uid(), btrim(display_name), 'owner');
  return room;
end;
$$;

create or replace function ctb_private.join_room(token uuid, display_name text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare invitation ctb_private.invites%rowtype;
declare guest_room text := auth.jwt()->'app_metadata'->>'ctb_guest_room';
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into invitation from ctb_private.invites
    where token_hash = sha256(convert_to(token::text, 'UTF8')) and expires_at > now() for share;
  if not found then raise exception 'Invitation expired or invalid'; end if;
  if guest_room is not null and guest_room <> invitation.room_id::text then
    raise exception 'Invitation expired or invalid';
  end if;
  if guest_room is null and lower(coalesce(auth.jwt()->>'email','')) like '%@guest.cwrite.invalid' then
    raise exception 'Access revoked';
  end if;
  if ctb_private.member_role(invitation.room_id) = 'blocked' then raise exception 'Access revoked'; end if;
  insert into public.ctb_members(room_id, user_id, name, role)
    values (invitation.room_id, auth.uid(), btrim(display_name), invitation.role)
    on conflict (room_id, user_id) do nothing;
  return invitation.room_id;
end;
$$;
