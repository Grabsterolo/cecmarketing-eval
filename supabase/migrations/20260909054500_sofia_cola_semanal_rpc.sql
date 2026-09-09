-- Ritmo semanal de la cola de seguimiento, para el indicador de Inicio.
--
-- Reemplaza al aviso que estuvo un día en Seguimiento y decía "1.088
-- conversaciones van a salir del rango". Era la métrica equivocada en la
-- pantalla equivocada: un asesor no puede actuar sobre 1.088, y el número
-- además mezclaba la deuda vieja con la fuga actual.
--
-- Medido al escribir esto, el equipo pasó de trabajar el 0-1% de lo que entraba
-- (semanas del 3 al 24 de agosto) al 70% (semana del 31). Las conversaciones
-- viejas sin resolver son de ese período muerto, no del ritmo de hoy. Un número
-- que junta las dos épocas hace parecer que se pierde terreno cuando en
-- realidad se está ganando — por eso `atrasadas` va aparte y con su explicación
-- al lado en la pantalla.
--
-- Las semanas se cortan en hora de Costa Rica, no UTC: con el corte en UTC el
-- lunes empieza a las 6 p.m. del domingo y los números no cuadran con la semana
-- que vive el equipo.
CREATE OR REPLACE FUNCTION public.sofia_cola_semanal()
RETURNS json
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH ref AS (
    SELECT date_trunc('week', (now() AT TIME ZONE 'America/Costa_Rica')) AS lunes
  ), semanal AS (
    SELECT date_trunc('week', (created_at AT TIME ZONE 'America/Costa_Rica')) AS semana,
           count(*)                                        AS entraron,
           count(*) FILTER (WHERE estado <> 'pendiente')    AS trabajadas
    FROM sofia_followup_queue, ref
    WHERE (created_at AT TIME ZONE 'America/Costa_Rica') >= ref.lunes - interval '1 week'
    GROUP BY 1
  )
  SELECT json_build_object(
    'estaSemana', COALESCE(
      (SELECT json_build_object('entraron', entraron, 'trabajadas', trabajadas)
         FROM semanal, ref WHERE semana = ref.lunes),
      json_build_object('entraron', 0, 'trabajadas', 0)),
    'semanaPasada', COALESCE(
      (SELECT json_build_object('entraron', entraron, 'trabajadas', trabajadas)
         FROM semanal, ref WHERE semana = ref.lunes - interval '1 week'),
      json_build_object('entraron', 0, 'trabajadas', 0)),
    'atrasadas', (
      SELECT count(*) FROM sofia_followup_queue, ref
       WHERE estado = 'pendiente'
         AND (created_at AT TIME ZONE 'America/Costa_Rica') < ref.lunes - interval '1 week')
  );
$function$;

REVOKE ALL ON FUNCTION public.sofia_cola_semanal() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sofia_cola_semanal() TO authenticated;
