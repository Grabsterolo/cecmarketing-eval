-- Sección Configuración: permite a un admin crear usuarios y decidir
-- rol (admin/user) y qué módulos del nav ve cada quien.
--
-- allowed_modules = null significa "todos los módulos" (mantiene el acceso
-- de los usuarios existentes tal cual estaba antes de esta migración).
alter table profiles
  add column if not exists allowed_modules text[];

alter table profiles
  alter column role set default 'user';

alter table profiles
  add constraint profiles_role_check check (role in ('admin', 'user'));

-- Helper SECURITY DEFINER para no depender de una subconsulta recursiva
-- sobre profiles dentro de sus propias policies.
create or replace function public.current_user_is_admin()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

create policy "Admins can read all profiles"
  on profiles for select
  using (public.current_user_is_admin());

create policy "Admins can insert profiles"
  on profiles for insert
  with check (public.current_user_is_admin());

create policy "Admins can update all profiles"
  on profiles for update
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());
