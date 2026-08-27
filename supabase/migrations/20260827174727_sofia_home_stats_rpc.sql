-- Inicio pedía 11 conteos por separado (total, escaladas, 3 de sentimiento y
-- uno por cada tema de campaña). En Postgres cada uno tarda 2-4 ms, pero eran
-- 11 peticiones HTTP concurrentes: el navegador limita conexiones por host y
-- PostgREST las encola, así que en producción una llegó a tardar 10 segundos y
-- la pantalla quedaba en "Cargando..." todo ese rato.
--
-- Esta función devuelve todo en una sola llamada. El agrupamiento por familia
-- se deja del lado del cliente a propósito: la taxonomía ya vive en
-- src/constants/procedures.js y no conviene duplicarla acá.
--
-- SECURITY INVOKER (default) para que las políticas RLS del que llama sigan
-- aplicando, igual que si consultara la tabla directo.
CREATE OR REPLACE FUNCTION public.sofia_home_stats(desde timestamptz)
RETURNS json
LANGUAGE sql
STABLE
AS $$
  SELECT json_build_object(
    'total',      count(*),
    'escaladas',  count(*) FILTER (WHERE escalated),
    'positivo',   count(*) FILTER (WHERE sentiment = 'positivo'),
    'neutral',    count(*) FILTER (WHERE sentiment = 'neutral'),
    'negativo',   count(*) FILTER (WHERE sentiment = 'negativo'),
    'porCodigo',  COALESCE(
      (SELECT json_object_agg(procedure_code, n)
       FROM (
         SELECT procedure_code, count(*) n
         FROM sofia_conversations
         WHERE created_at >= desde AND procedure_code IS NOT NULL
         GROUP BY procedure_code
       ) t),
      '{}'::json)
  )
  FROM sofia_conversations
  WHERE created_at >= desde;
$$;

COMMENT ON FUNCTION public.sofia_home_stats(timestamptz) IS
  'Todas las cifras de la pantalla de Inicio en una sola llamada, para no disparar 11 peticiones concurrentes desde el navegador.';

GRANT EXECUTE ON FUNCTION public.sofia_home_stats(timestamptz) TO authenticated;
