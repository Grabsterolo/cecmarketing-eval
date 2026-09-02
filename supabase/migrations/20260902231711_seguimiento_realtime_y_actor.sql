-- Seguimiento en tiempo real entre usuarios del equipo comercial.
--
-- PROBLEMA: el estado de cada conversación ya era compartido y persistente
-- (sofia_followup_status, con conversation_id como PK), pero la sección
-- Seguimiento cargaba la lista UNA sola vez al montar — no había ninguna
-- suscripción realtime ni polling en toda la app, y la publicación
-- supabase_realtime estaba vacía. Resultado: si Ana marcaba "Contactado" a
-- las 10:00, Luis —con la pestaña abierta desde las 9:30— seguía viendo
-- "Pendiente" y llamaba al mismo paciente. El upsert es último-en-escribir-
-- gana, así que no se corrompía nada, pero el trabajo se duplicaba igual.
--
-- Esta migración habilita las dos mitades del arreglo:
--   1) expone st.updated_at en la vista, para poder mostrar en la tarjeta
--      "Contactado por Ana · hace 5min" sin abrir la nota;
--   2) mete sofia_followup_status en la publicación supabase_realtime, para
--      que el cliente reciba postgres_changes y parchee la fila en vivo.

-- ============================================================
-- 1. Vista: exponer updated_at como estado_actualizado_en
-- ============================================================
-- OJO: CREATE OR REPLACE VIEW solo admite AGREGAR columnas AL FINAL —
-- intercalarlas intenta renombrar las existentes y falla con "cannot change
-- name of view column" (misma trampa documentada en 20260827163613, por eso
-- procedure_code también quedó al final en su momento). estado_actualizado_en
-- va después de procedure_code.
--
-- Se le cambia el nombre (updated_at -> estado_actualizado_en) a propósito:
-- la vista ya tiene created_at (el de la conversación), y un updated_at pelado
-- al lado se leería como "cuándo se actualizó la conversación", que es otra
-- cosa. Acá es "cuándo alguien tocó el estado de seguimiento".
--
-- Se conserva security_invoker=true (ver 20260812183138).
CREATE OR REPLACE VIEW public.sofia_followup_queue
WITH (security_invoker = true) AS
WITH base AS (
  SELECT c.id, c.phone_number, c.topic, c.last_message, c.escalated,
         c.escalation_reason, c.created_at, c.phone_hash, c.procedure_interest,
         c.procedure_code, c.channel, c.derived_to_appointment, c.message_count,
         c.duration_minutes, c.period, c.sentiment, c.ended_at,
         c.last_interaction_id, c.prospect_id,
         CASE
           WHEN c.escalated = true AND c.escalation_reason ~* '(precio|agendar|cita|valoraci)'::text THEN 'escalada_sin_cita'::text
           ELSE 'cerrada_sin_escalar'::text
         END AS origen
  FROM sofia_conversations c
  WHERE COALESCE(c.derived_to_appointment, false) = false
    AND c.created_at >= '2026-08-06 00:00:00+00'::timestamp with time zone
    AND (
      c.escalated = true AND c.escalation_reason ~* '(precio|agendar|cita|valoraci)'::text
      OR COALESCE(c.escalated, false) = false
         AND c.message_count >= 3
         AND c.procedure_interest IS NOT NULL
         AND c.procedure_interest <> ''::text
         AND c.procedure_interest !~* '(informaci[oó]n general|no especificado|^general$|^precio|consulta de precio|informaci[oó]n de (precio|costo)|no identificado)'::text
    )
), classified AS (
  SELECT base.*,
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
         CASE
           WHEN classified.origen = 'escalada_sin_cita'::text THEN 10
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
       COALESCE(st.estado, 'pendiente'::text) AS estado,
       st.nota, st.actualizado_por,
       scored.procedure_code,
       st.updated_at AS estado_actualizado_en
FROM scored
LEFT JOIN sofia_followup_status st ON st.conversation_id = scored.id
ORDER BY scored.score DESC, scored.created_at DESC;

-- ============================================================
-- 2. Realtime sobre sofia_followup_status
-- ============================================================
-- La publicación supabase_realtime existía pero estaba VACÍA (0 tablas), así
-- que ninguna tabla del proyecto emitía eventos. Se agrega solo esta: es la
-- única cuyo cambio tiene que verse al instante en otra pantalla.
--
-- No se toca sofia_conversations: la escribe el Worker de Sofía en cada
-- mensaje y publicarla sería un chorro de eventos que nadie consume.
--
-- REPLICA IDENTITY queda en DEFAULT: postgres_changes manda el registro NUEVO
-- completo en INSERT/UPDATE, que es lo único que el cliente necesita para
-- parchear la fila. FULL solo haría falta para recibir old_record, y costaría
-- WAL de más en cada update.
--
-- RLS ya permite SELECT a authenticated ("Authenticated users can read
-- sofia_followup_status"), que es lo que Realtime evalúa antes de entregarle
-- un evento a cada cliente — sin esa policy los eventos se filtrarían en
-- silencio.
ALTER PUBLICATION supabase_realtime ADD TABLE public.sofia_followup_status;
