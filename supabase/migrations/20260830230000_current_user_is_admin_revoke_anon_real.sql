-- Corrige 20260830222647_current_user_is_admin_restrict_execute.sql.
--
-- Esa migración hacía `revoke execute ... from public`, que solo quita el
-- permiso implícito del pseudo-rol PUBLIC. Supabase concede EXECUTE de forma
-- EXPLÍCITA a anon y authenticated cuando se crea la función, y ese grant
-- sobrevivía intacto: el proacl seguía mostrando `anon=X` y el linter seguía
-- reportando que anon podía llamar /rest/v1/rpc/current_user_is_admin.
--
-- Aplicada el 2026-08-30. Verificado después: has_function_privilege('anon',...)
-- pasó de true a false, y las 4 policies de profiles siguen intactas.
revoke execute on function public.current_user_is_admin() from anon;
grant  execute on function public.current_user_is_admin() to authenticated;
