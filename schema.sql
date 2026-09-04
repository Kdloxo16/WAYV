-- WAYV database schema
create extension if not exists pgcrypto;

create table if not exists public.wayv_groups(
  id uuid primary key default gen_random_uuid(),
  name text not null check(char_length(name) between 1 and 40),
  invite_code text not null unique,
  creator_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.wayv_members(
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.wayv_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check(char_length(nickname) between 1 and 14),
  role text not null check(role in('creator','member')) default 'member',
  status text not null check(status in('pending','approved','rejected')) default 'pending',
  created_at timestamptz not null default now(),
  unique(group_id,user_id)
);

create table if not exists public.wayv_locations(
  group_id uuid not null references public.wayv_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  accuracy double precision not null check(accuracy>=0),
  heading double precision,
  updated_at timestamptz not null default now(),
  primary key(group_id,user_id)
);

create table if not exists public.wayv_meeting_points(
  id uuid primary key default gen_random_uuid(),group_id uuid not null references public.wayv_groups(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,latitude double precision not null,longitude double precision not null,
  created_at timestamptz not null default now()
);

create table if not exists public.wayv_signals(
  id uuid primary key default gen_random_uuid(),group_id uuid not null references public.wayv_groups(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,target_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in('find_me')) default 'find_me',color text not null default '#BDFF78',created_at timestamptz not null default now(),expires_at timestamptz not null default(now()+interval '2 minutes')
);

create or replace function public.is_wayv_member(target_group uuid,target_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from wayv_members where group_id=target_group and user_id=target_user and status='approved');
$$;
create or replace function public.is_wayv_creator(target_group uuid,target_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from wayv_groups where id=target_group and creator_id=target_user);
$$;

alter table public.wayv_groups enable row level security;alter table public.wayv_members enable row level security;alter table public.wayv_locations enable row level security;alter table public.wayv_meeting_points enable row level security;
alter table public.wayv_signals enable row level security;
create policy "members read groups" on public.wayv_groups for select to authenticated using(creator_id=auth.uid() or public.is_wayv_member(id));
create policy "members read memberships" on public.wayv_members for select to authenticated using(user_id=auth.uid() or public.is_wayv_member(group_id));
create policy "members read locations" on public.wayv_locations for select to authenticated using(public.is_wayv_member(group_id));
create policy "users insert own location" on public.wayv_locations for insert to authenticated with check(user_id=auth.uid() and public.is_wayv_member(group_id));
create policy "users update own location" on public.wayv_locations for update to authenticated using(user_id=auth.uid() and public.is_wayv_member(group_id)) with check(user_id=auth.uid());
create policy "members read meeting points" on public.wayv_meeting_points for select to authenticated using(public.is_wayv_member(group_id));
create policy "members create meeting points" on public.wayv_meeting_points for insert to authenticated with check(creator_id=auth.uid() and public.is_wayv_member(group_id));
create policy "members read signals" on public.wayv_signals for select to authenticated using(public.is_wayv_member(group_id));
create policy "members send signals" on public.wayv_signals for insert to authenticated with check(sender_id=auth.uid() and public.is_wayv_member(group_id));

create or replace function public.create_wayv_group(event_name text,creator_nickname text,expires_at timestamptz) returns jsonb language plpgsql security definer set search_path=public as $$
declare new_group wayv_groups; code text;
begin
  if auth.uid() is null then raise exception 'Authentication required';end if;
  if expires_at<=now() or expires_at>now()+interval '30 days' then raise exception 'Invalid expiration';end if;
  code:='WV-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  insert into wayv_groups(name,invite_code,creator_id,expires_at) values(trim(event_name),code,auth.uid(),expires_at) returning * into new_group;
  insert into wayv_members(group_id,user_id,nickname,role,status) values(new_group.id,auth.uid(),trim(creator_nickname),'creator','approved');
  return jsonb_build_object('group_id',new_group.id,'name',new_group.name,'invite_code',new_group.invite_code,'expires_at',new_group.expires_at,'role','creator','nickname',trim(creator_nickname));
end;$$;

create or replace function public.request_wayv_join(invitation_code text,nickname text) returns jsonb language plpgsql security definer set search_path=public as $$
declare target wayv_groups; member wayv_members;
begin
  if auth.uid() is null then raise exception 'Authentication required';end if;
  select * into target from wayv_groups where invite_code=upper(trim(invitation_code)) and expires_at>now();
  if target.id is null then raise exception 'Invitation not found or expired';end if;
  select * into member from wayv_members where group_id=target.id and user_id=auth.uid();
  if member.id is not null and member.status='approved' then
    return jsonb_build_object('group_id',target.id,'name',target.name,'member_id',member.id,'status',member.status);
  end if;
  insert into wayv_members(group_id,user_id,nickname) values(target.id,auth.uid(),trim(nickname))
  on conflict(group_id,user_id) do update
    set nickname=excluded.nickname,
        status=case when wayv_members.status='approved' then 'approved' else 'pending' end
  returning * into member;
  return jsonb_build_object('group_id',target.id,'name',target.name,'member_id',member.id,'status',member.status);
end;$$;

create or replace function public.approve_wayv_member(target_member_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin update wayv_members set status='approved' where id=target_member_id and public.is_wayv_creator(group_id);if not found then raise exception 'Not authorized';end if;end;$$;
create or replace function public.reject_wayv_member(target_member_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin update wayv_members set status='rejected' where id=target_member_id and public.is_wayv_creator(group_id);if not found then raise exception 'Not authorized';end if;end;$$;

create or replace function public.leave_wayv_group(target_group_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  delete from wayv_members where group_id=target_group_id and user_id=auth.uid() and role<>'creator';
  if not found then raise exception 'Creator must delete the group';end if;
end;$$;

create or replace function public.delete_wayv_group(target_group_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  delete from wayv_groups where id=target_group_id and creator_id=auth.uid();
  if not found then raise exception 'Not authorized';end if;
end;$$;

create or replace function public.get_my_wayv_membership() returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('group_id',g.id,'name',g.name,'invite_code',case when g.creator_id=auth.uid() then g.invite_code else null end,'expires_at',g.expires_at,'role',m.role,'status',m.status,'nickname',m.nickname)
  from wayv_members m join wayv_groups g on g.id=m.group_id where m.user_id=auth.uid() and g.expires_at>now() order by m.created_at desc limit 1;
$$;

grant execute on function public.create_wayv_group(text,text,timestamptz),public.request_wayv_join(text,text),public.approve_wayv_member(uuid),public.reject_wayv_member(uuid),public.leave_wayv_group(uuid),public.delete_wayv_group(uuid),public.get_my_wayv_membership() to authenticated;
grant select on public.wayv_groups,public.wayv_members,public.wayv_locations,public.wayv_meeting_points to authenticated;
grant insert,update on public.wayv_locations to authenticated;grant insert on public.wayv_meeting_points to authenticated;
grant select,insert on public.wayv_signals to authenticated;

do $$begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='wayv_locations') then alter publication supabase_realtime add table public.wayv_locations;end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='wayv_members') then alter publication supabase_realtime add table public.wayv_members;end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='wayv_meeting_points') then alter publication supabase_realtime add table public.wayv_meeting_points;end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='wayv_signals') then alter publication supabase_realtime add table public.wayv_signals;end if;
end$$;
