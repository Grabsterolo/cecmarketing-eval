-- current_user_is_admin() solo la necesitan las RLS policies de profiles,
-- evaluadas en contexto del rol authenticated. anon no la necesita.
revoke execute on function public.current_user_is_admin() from public;
grant execute on function public.current_user_is_admin() to authenticated;
