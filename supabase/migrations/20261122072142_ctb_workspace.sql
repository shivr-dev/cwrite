create schema ctb_private;
revoke all on schema ctb_private from public;
grant usage on schema ctb_private to authenticated;

create table public.ctb_rooms (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  created_at timestamptz not null default now()
);
create table public.ctb_members (
  room_id uuid not null references public.ctb_rooms on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 32),
  role text not null check (role in ('owner', 'editor', 'viewer', 'blocked')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index ctb_members_by_user on public.ctb_members (user_id, room_id);
create unique index ctb_one_owner on public.ctb_members (room_id) where role = 'owner';

create table ctb_private.invites (
  room_id uuid not null references public.ctb_rooms on delete cascade,
  role text not null check (role in ('editor', 'viewer')),
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  primary key (room_id, role)
);
alter table ctb_private.invites enable row level security;

create sequence ctb_private.event_position;
create table public.ctb_events (
  room_id uuid not null references public.ctb_rooms on delete cascade,
  event_id uuid not null,
  position bigint not null unique,
  author_id uuid not null default auth.uid(),
  kind text not null check (kind in ('edit', 'chat')),
  body text not null,
  created_at timestamptz not null default now(),
  primary key (room_id, event_id),
  check ((kind = 'edit' and octet_length(body) between 1 and 1310720)
      or (kind = 'chat' and char_length(btrim(body)) between 1 and 2000))
);
create index ctb_events_by_room on public.ctb_events (room_id, position);

create table public.ctb_backups (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.ctb_rooms on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 100),
  document jsonb not null check (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 1800000),
  created_at timestamptz not null default now()
);
create index ctb_backups_by_room on public.ctb_backups (room_id, created_at desc);

alter table public.ctb_rooms enable row level security;
alter table public.ctb_members enable row level security;
alter table public.ctb_events enable row level security;
alter table public.ctb_backups enable row level security;
revoke all on public.ctb_rooms, public.ctb_members, public.ctb_events, public.ctb_backups from public, anon, authenticated;
grant select on public.ctb_rooms, public.ctb_members, public.ctb_events, public.ctb_backups to authenticated;
grant update (title) on public.ctb_rooms to authenticated;
grant insert (room_id, event_id, kind, body) on public.ctb_events to authenticated;
grant insert (room_id, label, document) on public.ctb_backups to authenticated;

create function ctb_private.member_role(room uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select role from public.ctb_members where room_id = room and user_id = (select auth.uid())
$$;
revoke all on function ctb_private.member_role(uuid) from public, anon, authenticated;
grant execute on function ctb_private.member_role(uuid) to authenticated;

create policy ctb_room_read on public.ctb_rooms for select to authenticated
  using (ctb_private.member_role(id) in ('owner', 'editor', 'viewer'));
create policy ctb_room_rename on public.ctb_rooms for update to authenticated
  using (ctb_private.member_role(id) = 'owner') with check (ctb_private.member_role(id) = 'owner');
create policy ctb_roster_read on public.ctb_members for select to authenticated
  using (ctb_private.member_role(room_id) = 'owner' or
    (role <> 'blocked' and ctb_private.member_role(room_id) in ('editor', 'viewer')));
create policy ctb_events_read on public.ctb_events for select to authenticated
  using (ctb_private.member_role(room_id) in ('owner', 'editor', 'viewer'));
create policy ctb_events_write on public.ctb_events for insert to authenticated
  with check (author_id = (select auth.uid()) and (
    (kind = 'edit' and ctb_private.member_role(room_id) in ('owner', 'editor')) or
    (kind = 'chat' and ctb_private.member_role(room_id) in ('owner', 'editor', 'viewer'))
  ));
create policy ctb_backups_read on public.ctb_backups for select to authenticated
  using (ctb_private.member_role(room_id) = 'owner');
create policy ctb_backups_write on public.ctb_backups for insert to authenticated
  with check (ctb_private.member_role(room_id) = 'owner');

-- Assign positions under a room lock so a later commit cannot skip an earlier position during catch-up.
create function ctb_private.number_event() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.room_id::text, 47219));
  new.position := nextval('ctb_private.event_position'::regclass);
  return new;
end;
$$;
revoke all on function ctb_private.number_event() from public, anon, authenticated;
create trigger ctb_event_number before insert on public.ctb_events
for each row execute function ctb_private.number_event();

create function ctb_private.create_room(title text, display_name text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare room uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  insert into public.ctb_rooms(title) values (btrim(title)) returning id into room;
  insert into public.ctb_members(room_id, user_id, name, role)
    values (room, auth.uid(), btrim(display_name), 'owner');
  return room;
end;
$$;

create function ctb_private.issue_invite(room uuid, access_role text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare token uuid := gen_random_uuid();
begin
  if ctb_private.member_role(room) is distinct from 'owner' then raise exception 'Owner required'; end if;
  if access_role not in ('viewer', 'editor') then raise exception 'Invalid role'; end if;
  insert into ctb_private.invites(room_id, role, token_hash, expires_at)
    values (room, access_role, sha256(convert_to(token::text, 'UTF8')), now() + interval '7 days')
    on conflict (room_id, role) do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at;
  return token;
end;
$$;

create function ctb_private.join_room(token uuid, display_name text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare invitation ctb_private.invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into invitation from ctb_private.invites
    where token_hash = sha256(convert_to(token::text, 'UTF8')) and expires_at > now() for share;
  if not found then raise exception 'Invitation expired or invalid'; end if;
  if ctb_private.member_role(invitation.room_id) = 'blocked' then raise exception 'Access revoked'; end if;
  insert into public.ctb_members(room_id, user_id, name, role)
    values (invitation.room_id, auth.uid(), btrim(display_name), invitation.role)
    on conflict (room_id, user_id) do nothing;
  return invitation.room_id;
end;
$$;

create function ctb_private.change_member(room uuid, member_id uuid, new_role text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if ctb_private.member_role(room) is distinct from 'owner' then raise exception 'Owner required'; end if;
  if new_role not in ('viewer', 'editor', 'blocked') then raise exception 'Invalid role'; end if;
  update public.ctb_members set role = new_role where room_id = room and user_id = member_id and role <> 'owner';
  if not found then raise exception 'Invalid member'; end if;
end;
$$;

create function public.ctb_create_room(title text, display_name text) returns uuid
language sql set search_path = '' as $$ select ctb_private.create_room(title, display_name) $$;
create function public.ctb_issue_invite(room uuid, access_role text) returns uuid
language sql set search_path = '' as $$ select ctb_private.issue_invite(room, access_role) $$;
create function public.ctb_join_room(token uuid, display_name text) returns uuid
language sql set search_path = '' as $$ select ctb_private.join_room(token, display_name) $$;
create function public.ctb_change_member(room uuid, member_id uuid, new_role text) returns void
language sql set search_path = '' as $$ select ctb_private.change_member(room, member_id, new_role) $$;

revoke all on all functions in schema ctb_private from public, anon;
grant execute on function ctb_private.create_room(text,text), ctb_private.issue_invite(uuid,text),
  ctb_private.join_room(uuid,text), ctb_private.change_member(uuid,uuid,text) to authenticated;
revoke all on function public.ctb_create_room(text,text), public.ctb_issue_invite(uuid,text),
  public.ctb_join_room(uuid,text), public.ctb_change_member(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.ctb_create_room(text,text), public.ctb_issue_invite(uuid,text),
  public.ctb_join_room(uuid,text), public.ctb_change_member(uuid,uuid,text) to authenticated;

alter publication supabase_realtime add table public.ctb_events;
