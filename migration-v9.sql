-- Ejecutar una sola vez en Supabase > SQL Editor para habilitar salir/eliminar grupos.
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

grant execute on function public.leave_wayv_group(uuid),public.delete_wayv_group(uuid) to authenticated;
