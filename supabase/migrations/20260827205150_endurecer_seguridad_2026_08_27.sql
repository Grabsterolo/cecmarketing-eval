-- Cierra los hallazgos del linter de seguridad de Supabase al 2026-08-27.
-- Se vuelve más relevante ahora que sofia_conversations guarda teléfonos de
-- pacientes en claro (ver 20260827180258_sofia_set_phones_rpc.sql).

-- 1) sofia_inactivity_cleanup estaba SIN RLS y expuesta vía PostgREST:
--    cualquiera con la clave pública podía leerla y escribirla completa.
--    Solo la escribe el Worker con SERVICE_ROLE_KEY, que ignora RLS, así que
--    habilitarla sin políticas la deja accesible únicamente al Worker — que es
--    lo que corresponde. Verificado en upsertCleanupRowClosed() antes de
--    aplicar. El linter la reporta como INFO "RLS enabled, no policy": es el
--    estado buscado, no un pendiente.
ALTER TABLE public.sofia_inactivity_cleanup ENABLE ROW LEVEL SECURITY;

-- 2) sofia_followup_candidates quedó huérfana: la reemplazó
--    sofia_followup_queue y no la referencia ningún código (verificado en los
--    dos repos). Se le pone security_invoker en vez de borrarla — con
--    SECURITY DEFINER aplicaba los permisos de quien la creó y no los de quien
--    consulta, saltándose las RLS de sofia_conversations.
ALTER VIEW public.sofia_followup_candidates SET (security_invoker = true);

-- 3) search_path fijo. Sin esto lo controla quien invoca, y una función puede
--    resolver un nombre de tabla contra un esquema antepuesto por el llamante.
--    Ya se había corregido lo mismo en sofia_followup_queue en su momento.
ALTER FUNCTION public.sofia_procedure_code(text)    SET search_path = public, pg_temp;
ALTER FUNCTION public.sofia_home_stats(timestamptz) SET search_path = public, pg_temp;
ALTER FUNCTION public.sofia_touch_updated_at()      SET search_path = public, pg_temp;

-- 4) La función de RAG que usa functions/api/chat.js. Incluye `public`
--    explícitamente porque la extensión `vector` vive ahí y el operador de
--    distancia tiene que seguir resolviéndose. Verificado después de aplicar:
--    sigue devolviendo chunks.
--    Ojo: el orden real de los argumentos es (embedding, count, threshold).
ALTER FUNCTION public.match_sofia_chunks(vector, integer, double precision)
  SET search_path = public, pg_temp;
