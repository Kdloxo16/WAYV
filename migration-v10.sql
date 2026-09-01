-- Ejecutar una sola vez en Supabase > SQL Editor.
create table if not exists public.wayv_signals(
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.wayv_groups(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in('find_me')) default 'find_me',
  color text not null default '#BDFF78',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default(now()+interval '2 minutes')
);
alter table public.wayv_signals enable row level security;
drop policy if exists "members read signals" on public.wayv_signals;
drop policy if exists "members send signals" on public.wayv_signals;
create policy "members read signals" on public.wayv_signals for select to authenticated using(public.is_wayv_member(group_id));
create policy "members send signals" on public.wayv_signals for insert to authenticated with check(sender_id=auth.uid() and public.is_wayv_member(group_id));
grant select,insert on public.wayv_signals to authenticated;
do $$begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='wayv_meeting_points') then alter publication supabase_realtime add table public.wayv_meeting_points;end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='wayv_signals') then alter publication supabase_realtime add table public.wayv_signals;end if;
end$$;
