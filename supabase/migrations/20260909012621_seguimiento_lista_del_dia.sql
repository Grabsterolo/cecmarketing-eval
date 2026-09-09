-- Lista del día: 30 leads asignados por asesor.
--
-- EL PROBLEMA
--
-- Seguimiento abría con 2.946 pendientes repartidos en 118 páginas, la misma
-- lista para todo el mundo. Nadie trabaja 118 páginas, y como no había forma
-- de saber qué le tocaba a cada quien, todos empezaban por arriba y se
-- pisaban. Se nota en los datos: de casi 3.700 conversaciones, solo 803
-- llegaron a tener algún estado guardado.
--
-- CÓMO FUNCIONA
--
-- Cada asesor pide su lista y el sistema le completa hasta 30 pendientes,
-- tomados de arriba de la cola priorizada (urgentes primero, después score).
-- No hay reparto nocturno: se toma cuando alguien se sienta a trabajar, así
-- que a quien está de vacaciones no se le asigna nada.
--
-- SE VENCE SOLA a los 3 días. Mismo patrón que "En espera": se calcula al
-- consultar, sin cron, y por lo tanto no puede desincronizarse. Sin esto un
-- lead asignado a alguien que se fue quedaría bloqueado para siempre.
--
-- POR QUÉ EL NOMBRE VA DENORMALIZADO
--
-- profiles tiene RLS: cada quien lee solo su propio perfil. La vista es
-- security_invoker, así que un JOIN a profiles devolvería NULL para todos los
-- demás asesores y las tarjetas dirían "asignado a nadie". Se guarda el
-- nombre junto al id, igual que ya hace actualizado_por. El id es la llave
-- (hay dos perfiles con el mismo nombre, así que comparar por texto sería un
-- error); el nombre es solo para mostrar.

ALTER TABLE public.sofia_followup_status
  ADD COLUMN IF NOT EXISTS asignado_a uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS asignado_nombre text,
  ADD COLUMN IF NOT EXISTS asignado_en timestamptz;

COMMENT ON COLUMN public.sofia_followup_status.asignado_a IS
  'Asesor que tiene este lead en su lista. Se vence a los 3 días: la vista sofia_followup_queue lo devuelve NULL pasado ese plazo, sin cron.';

CREATE INDEX IF NOT EXISTS sofia_followup_status_asignado_a_idx
  ON public.sofia_followup_status (asignado_a)
  WHERE asignado_a IS NOT NULL;

-- Asignar un lead NO es trabajarlo.
--
-- El disparador ponía updated_at = now() en cualquier UPDATE. Ese campo sale
-- por la vista como estado_actualizado_en y es lo que alimenta el sello
-- "Contactado por Ana · hace 5min" de cada tarjeta. Sin esta guarda, repartir
-- la lista del día haría que 30 tarjetas aparecieran recién tocadas, que es
-- justo la señal que el equipo usa para no llamar dos veces al mismo paciente.
CREATE OR REPLACE FUNCTION public.set_sofia_followup_status_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
begin
  if TG_OP = 'INSERT'
     or new.estado          is distinct from old.estado
     or new.nota            is distinct from old.nota
     or new.actualizado_por is distinct from old.actualizado_por
     or new.esperar_hasta   is distinct from old.esperar_hasta then
    new.updated_at = now();
  end if;
  return new;
end;
$function$;

-- La vista va ANTES que las funciones: asignar_mi_lista() consulta
-- sofia_followup_queue.asignado_a, que no existe hasta que se recrea acá.

CREATE OR REPLACE VIEW public.sofia_followup_queue
WITH (security_invoker = true) AS
WITH base AS (
  SELECT c.id, c.phone_number, c.patient_name, c.topic, c.last_message, c.escalated,
         c.escalation_reason, c.created_at, c.phone_hash, c.procedure_interest,
         c.procedure_code, c.channel, c.derived_to_appointment, c.message_count,
         c.duration_minutes, c.period, c.sentiment, c.ended_at,
         c.last_interaction_id, c.prospect_id,
         CASE
           -- Escalación mecánica: la disparó el sistema, no el paciente.
           WHEN c.escalated = true
            AND c.escalation_reason ~* '(frase de traspaso|l[ií]mite de mensajes|falla_tecnica)'::text
             THEN 'escalada_tecnica'::text
           -- Intención explícita: el paciente pidió precio/cita/valoración.
           WHEN c.escalated = true
            AND c.escalation_reason ~* '(precio|agendar|cita|valoraci)'::text
             THEN 'escalada_sin_cita'::text
           -- Escalación real con otro motivo (clínico, contraindicación, etc.)
           WHEN c.escalated = true
             THEN 'escalada_otro_motivo'::text
           ELSE 'cerrada_sin_escalar'::text
         END AS origen
  FROM sofia_conversations c
  WHERE COALESCE(c.derived_to_appointment, false) = false
    AND c.created_at >= '2026-08-06 00:00:00+00'::timestamp with time zone
    AND (
      -- Rama A: Sofía escaló. Sin condición extra sobre el texto del motivo.
      c.escalated = true
      -- Rama B: conversación real sobre un procedimiento concreto, sin escalar.
      OR COALESCE(c.escalated, false) = false
         AND c.message_count >= 3
         AND c.procedure_interest IS NOT NULL
         AND c.procedure_interest <> ''::text
         AND c.procedure_interest !~* '(informaci[oó]n general|no especificado|^general$|^precio|consulta de precio|informaci[oó]n de (precio|costo)|no identificado)'::text
    )
), classified AS (
  SELECT base.*,
         -- Urgencia clínica o reputacional. Es INDEPENDIENTE del score: el score
         -- mide valor comercial y acá lo que importa es el riesgo.
         --
         -- El caso que lo motivó (2026-09-08): una paciente post-abdominoplastia
         -- insatisfecha, ya consultando con otro cirujano en Bogotá, pidiendo
         -- hablar con la dirección. Escribió UN mensaje, largo y grave — y el
         -- score castiga tener un solo mensaje con -25, así que quedó en el
         -- puesto 2.488 de 4.219: página 100. Nadie llega ahí.
         --
         -- "sin complicaci" queda excluido con lookbehind: es parte del screening
         -- normal que hace Sofía ("cesárea sin complicaciones aparentes"), no una
         -- complicación real. Medido: 7 filas mencionan "complicaci", 1 es del
         -- screening.
         --
         -- Marca el 0,5% de la cola (21 de 4.219). Si algún día pasa del 2%, se
         -- volvió ruido y hay que apretar la lista, no aflojarla.
         (COALESCE(base.escalation_reason, ''::text) ~* '(insatisfac|inconform|disconform|queja|reclamo|molest[ao]|director|gerenci|(?<!sin )complicaci|infecci[oó]n|sangrado|emergencia|otro cirujano|segunda opini|mal resultado|demanda|abogado|legal)'::text) AS urgente,
         CASE
           WHEN ((COALESCE(base.procedure_interest, ''::text) || ' '::text) || COALESCE(base.escalation_reason, ''::text)) ~* '(abdominoplast|mamari|senos|mastopex|rinoplast|blefaro|lipo|preserv[eé]|mia femtech|lifting facial|facetite)'::text THEN 'cirugia'::text
           ELSE 'tratamiento_no_quirurgico'::text
         END AS categoria
  FROM base
), scored AS (
  SELECT classified.*,
         CASE
           WHEN classified.categoria = 'cirugia'::text THEN 35
           WHEN ((COALESCE(classified.procedure_interest, ''::text) || ' '::text) || COALESCE(classified.escalation_reason, ''::text)) ~* '(ultherapy|quantum|trilipo|radiesse|hialur|toxina|botox|co2|criolipo|bodytite)'::text THEN 22
           WHEN classified.procedure_interest IS NOT NULL AND classified.procedure_interest <> ''::text THEN 12
           ELSE 0
         END +
         CASE
           WHEN classified.message_count >= 6 THEN 25
           WHEN classified.message_count >= 4 THEN 20
           WHEN classified.message_count = 3 THEN 14
           WHEN classified.message_count = 2 THEN 8
           ELSE 0
         END +
         CASE
           WHEN classified.sentiment = 'positivo'::text THEN 15
           WHEN classified.sentiment = 'neutral'::text THEN 8
           ELSE 3
         END +
         CASE
           WHEN classified.created_at >= (now() - '2 days'::interval) THEN 15
           WHEN classified.created_at >= (now() - '5 days'::interval) THEN 11
           WHEN classified.created_at >= (now() - '10 days'::interval) THEN 7
           WHEN classified.created_at >= (now() - '20 days'::interval) THEN 3
           ELSE 0
         END +
         -- Intención explícita. Una escalación clínica real vale casi tanto
         -- como un pedido de precio; una mecánica no vale nada, porque no
         -- dice nada sobre lo que quiere el paciente.
         CASE
           WHEN classified.origen = 'escalada_sin_cita'::text    THEN 10
           WHEN classified.origen = 'escalada_otro_motivo'::text THEN 8
           ELSE 0
         END AS score
  FROM classified
)
SELECT scored.id, scored.phone_number, scored.phone_hash, scored.topic,
       scored.last_message, scored.escalated, scored.escalation_reason,
       scored.procedure_interest, scored.channel, scored.derived_to_appointment,
       scored.message_count, scored.duration_minutes, scored.period,
       scored.sentiment, scored.created_at, scored.ended_at,
       scored.last_interaction_id, scored.prospect_id, scored.origen,
       scored.categoria, scored.score,
       -- "En espera" se vence sola: pasada la fecha, la conversación vuelve a
       -- pendiente sin que nadie la despierte. Se calcula al consultar, así que
       -- no hace falta un cron que recorra la tabla — y por lo tanto no puede
       -- desincronizarse, que es el modo de falla de cualquier proceso que
       -- despierte filas por su cuenta.
       CASE
         WHEN st.estado = 'en_espera' AND st.esperar_hasta IS NOT NULL AND st.esperar_hasta > now()
           THEN 'en_espera'::text
         WHEN st.estado = 'en_espera'
           THEN 'pendiente'::text
         ELSE COALESCE(st.estado, 'pendiente'::text)
       END AS estado,
       st.nota, st.actualizado_por,
       scored.procedure_code,
       st.updated_at AS estado_actualizado_en,
       scored.urgente,
       st.esperar_hasta,
       scored.patient_name,
       -- La asignación SE VENCE SOLA a los 3 días, mismo patrón que "En espera":
       -- se calcula al consultar, así que no hace falta un cron y no puede
       -- desincronizarse. Sin esto, un lead asignado a alguien que se fue de
       -- vacaciones queda bloqueado para siempre: nadie más lo puede tomar
       -- porque figura como asignado, y quien lo tiene no lo va a trabajar.
       CASE WHEN st.asignado_en > now() - interval '3 days' THEN st.asignado_a END AS asignado_a,
       -- El nombre va denormalizado, como ya lo hace actualizado_por. No es
       -- descuido: profiles solo deja a cada quien leer SU propio perfil, así
       -- que un JOIN acá (la vista es security_invoker) devolvería NULL para
       -- todos los demás y las tarjetas dirían "asignado a nadie".
       CASE WHEN st.asignado_en > now() - interval '3 days' THEN st.asignado_nombre END AS asignado_nombre,
       st.asignado_en
FROM scored
LEFT JOIN sofia_followup_status st ON st.conversation_id = scored.id
-- Lo urgente primero, SIEMPRE, sin importar el score. Un reclamo de 55 puntos
-- va antes que un aumento mamario de 100: el score ordena oportunidades, no
-- riesgos.
ORDER BY scored.urgente DESC, scored.score DESC, scored.created_at DESC;


-- Completa la lista del asesor que la pide hasta p_limite pendientes.
-- Devuelve cuántos se agregaron (0 si ya estaba llena).
--
-- SECURITY DEFINER porque tiene que ver toda la cola para repartir, y porque
-- escribe la asignación. Todo lo que decide sale de auth.uid(): no recibe a
-- quién asignar, así que nadie puede llenarle la lista a otro.
CREATE OR REPLACE FUNCTION public.asignar_mi_lista(p_limite int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_nombre    text;
  v_ya_tiene  int;
  v_faltan    int;
  v_agregados int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Hay que iniciar sesión para tomar leads.';
  END IF;

  IF p_limite < 1 OR p_limite > 100 THEN
    RAISE EXCEPTION 'El límite tiene que estar entre 1 y 100.';
  END IF;

  SELECT full_name INTO v_nombre FROM public.profiles WHERE id = v_uid;

  SELECT count(*) INTO v_ya_tiene
  FROM public.sofia_followup_queue
  WHERE asignado_a = v_uid AND estado = 'pendiente';

  v_faltan := p_limite - v_ya_tiene;
  IF v_faltan <= 0 THEN
    RETURN 0;
  END IF;

  WITH candidatos AS (
    SELECT id
    FROM public.sofia_followup_queue
    WHERE estado = 'pendiente'
      AND asignado_a IS NULL
    ORDER BY urgente DESC, score DESC, created_at DESC
    LIMIT v_faltan
  )
  INSERT INTO public.sofia_followup_status
    (conversation_id, estado, asignado_a, asignado_nombre, asignado_en)
  SELECT id, 'pendiente', v_uid, v_nombre, now() FROM candidatos
  ON CONFLICT (conversation_id) DO UPDATE
    SET asignado_a      = EXCLUDED.asignado_a,
        asignado_nombre = EXCLUDED.asignado_nombre,
        asignado_en     = EXCLUDED.asignado_en
    -- La guarda que evita robar un lead que otro asesor acaba de tomar. Dos
    -- personas pidiendo su lista a la vez pueden elegir los mismos candidatos:
    -- la primera escribe, y a la segunda esta condición la deja afuera, así
    -- que el conteo devuelto es el de los que realmente se llevó.
    WHERE public.sofia_followup_status.asignado_a IS NULL
       OR public.sofia_followup_status.asignado_en <= now() - interval '3 days';

  GET DIAGNOSTICS v_agregados = ROW_COUNT;
  RETURN v_agregados;
END;
$function$;

REVOKE ALL ON FUNCTION public.asignar_mi_lista(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asignar_mi_lista(int) TO authenticated;

-- Suelta los leads que el asesor todavía no trabajó. Para cuando alguien toma
-- una lista y se da cuenta de que no le va a llegar — sin esto, los 30 quedan
-- retenidos hasta que se vencen solos a los 3 días.
CREATE OR REPLACE FUNCTION public.soltar_mi_lista()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_soltados int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Hay que iniciar sesión.';
  END IF;

  -- Solo los que siguen pendientes: los ya contactados o descartados conservan
  -- la asignación como registro de quién los trabajó.
  UPDATE public.sofia_followup_status
     SET asignado_a = NULL, asignado_nombre = NULL, asignado_en = NULL
   WHERE asignado_a = v_uid
     AND estado = 'pendiente';

  GET DIAGNOSTICS v_soltados = ROW_COUNT;
  RETURN v_soltados;
END;
$function$;

REVOKE ALL ON FUNCTION public.soltar_mi_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soltar_mi_lista() TO authenticated;
