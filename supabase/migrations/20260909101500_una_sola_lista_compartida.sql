-- Se retira la asignación de leads: vuelve una sola lista compartida.
--
-- POR QUÉ
--
-- La lista del día (30 leads a nombre de cada asesor) resolvía un problema real
-- —2.946 pendientes en 118 páginas, sin saber a quién le tocaba qué— pero lo
-- resolvía con un mecanismo que hay que explicar: tomar, completar, liberar, y
-- una asignación que caduca a los 3 días. Decisión de producto del 2026-09-09:
-- una herramienta de call center que necesita instrucciones ya perdió.
--
-- QUÉ LA REEMPLAZA
--
-- Una sola lista que ven los cuatro asesores, ordenada por prioridad, que se
-- actualiza en vivo conforme cada quien va marcando. Lo que evita que dos
-- personas llamen al mismo paciente NO desaparece: sigue siendo el sello
-- "Contactado por Ana · hace 5min" de cada tarjeta, más la sincronización en
-- tiempo real que ya existía desde el 2026-09-02 (migración
-- 20260902231711_seguimiento_realtime_y_actor).
--
-- QUÉ SE PIERDE Y POR QUÉ SE ACEPTA
--
-- Ya no hay reserva: dos asesores pueden abrir la misma conversación a la vez.
-- El riesgo es menor de lo que parece —el sello se escribe apenas alguien
-- cambia el estado y viaja al resto en el momento— y a cambio desaparece todo
-- el mecanismo que había que aprender.
--
-- Al aplicar esto había UNA sola asignación viva (una prueba del 09-sep 09:35).
-- Su estado 'contactado' y su actualizado_por se conservan intactos: lo único
-- que se borra es a quién estaba reservada.

DROP FUNCTION IF EXISTS public.asignar_mi_lista(int);
DROP FUNCTION IF EXISTS public.soltar_mi_lista();

-- La vista se recrea ANTES de borrar las columnas: mientras las exponga,
-- Postgres no deja eliminarlas.
--
-- Y va con DROP + CREATE, no con CREATE OR REPLACE: reemplazar una vista solo
-- permite AGREGAR columnas al final, nunca quitarlas ("cannot drop columns from
-- view"). Se comprobó antes que ninguna otra vista ni función depende de esta.
DROP VIEW public.sofia_followup_queue;

CREATE VIEW public.sofia_followup_queue
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
  WHERE c.created_at >= '2026-08-06 00:00:00+00'::timestamp with time zone
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
       scored.patient_name
FROM scored
LEFT JOIN sofia_followup_status st ON st.conversation_id = scored.id
-- Lo urgente primero, SIEMPRE, sin importar el score. Un reclamo de 55 puntos
-- va antes que un aumento mamario de 100: el score ordena oportunidades, no
-- riesgos.
ORDER BY scored.urgente DESC, scored.score DESC, scored.created_at DESC;

-- Los permisos se reponen tal cual estaban: recrear la vista los pierde. Son
-- los que Supabase da por defecto a todo el esquema public; lo que de verdad
-- protege es el security_invoker de arriba más el RLS de las tablas de origen,
-- no la ausencia de GRANT.
GRANT ALL ON public.sofia_followup_queue TO anon, authenticated, service_role;

DROP INDEX IF EXISTS public.sofia_followup_status_asignado_a_idx;

ALTER TABLE public.sofia_followup_status
  DROP COLUMN IF EXISTS asignado_a,
  DROP COLUMN IF EXISTS asignado_nombre,
  DROP COLUMN IF EXISTS asignado_en;
