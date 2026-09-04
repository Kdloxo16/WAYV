-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Conserva la aprobación cuando un integrante vuelve a abrir la invitación.

create or replace function public.request_wayv_join(invitation_code text,nickname text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  target wayv_groups;
  member wayv_members;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into target
  from wayv_groups
  where invite_code=upper(trim(invitation_code))
    and expires_at>now();

  if target.id is null then
    raise exception 'Invitation not found or expired';
  end if;

  select * into member
  from wayv_members
  where group_id=target.id
    and user_id=auth.uid();

  if member.id is not null and member.status='approved' then
    return jsonb_build_object(
      'group_id',target.id,
      'name',target.name,
      'member_id',member.id,
      'status',member.status
    );
  end if;

  insert into wayv_members(group_id,user_id,nickname)
  values(target.id,auth.uid(),trim(nickname))
  on conflict(group_id,user_id) do update
    set nickname=excluded.nickname,
        status=case
          when wayv_members.status='approved' then 'approved'
          else 'pending'
        end
  returning * into member;

  return jsonb_build_object(
    'group_id',target.id,
    'name',target.name,
    'member_id',member.id,
    'status',member.status
  );
end;
$$;

grant execute on function public.request_wayv_join(text,text) to authenticated;
