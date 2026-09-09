-- Recuperado del historial de Supabase (2026-09-09): estaba aplicado desde el
-- 2026-08-12 pero no tenía archivo en el repo.

-- El advisor de seguridad marcó sofia_followup_queue como SECURITY DEFINER
-- (comportamiento por defecto de las vistas en Postgres: corren con los
-- permisos del dueño de la vista). Eso podría bypasear el RLS de
-- sofia_followup_status/sofia_conversations para quien consulte la vista.
-- security_invoker=true hace que la vista respete el rol y el RLS de quien
-- la consulta (el usuario autenticado vía PostgREST), no el del dueño.
alter view public.sofia_followup_queue set (security_invoker = true);

-- Fija el search_path del trigger function para que no sea mutable
-- (WARN del linter de Supabase — hardening estándar, sin efecto funcional
-- porque la función no referencia objetos sin calificar).
--
-- OJO: este cuerpo quedó superado por 20260909012621_seguimiento_lista_del_dia,
-- que le agregó la guarda para que asignar un lead no mueva updated_at.
create or replace function public.set_sofia_followup_status_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
