-- Lo urgente ya no queda en la página 100.
--
-- El 2026-09-08, una paciente post-abdominoplastia insatisfecha —ya consultando
-- con otro cirujano en Bogotá, pidiendo hablar con la dirección de la clínica—
-- quedó en el puesto 2.488 de 4.219. Página 100 con 25 por página. Nadie llega
-- ahí.
--
-- La causa: el score mide VALOR COMERCIAL, no urgencia. Ella escribió un solo
-- mensaje —largo y grave— y el componente de "cantidad de mensajes" le quitó 25
-- puntos, los mismos que le da a quien preguntó seis veces por una limpieza
-- facial. El score premia la conversación larga; una queja es breve y definitiva.
--
-- Se agrega `urgente` como señal separada del score y se ordena por ella
-- primero. No se toca el cálculo del score: son dos cosas distintas y mezclarlas
-- volvería a esconder una de las dos.
CREATE OR REPLACE VIEW public.sofia_followup_queue
WITH (security_invoker = true) AS
WITH base AS (
  SELECT c.id, c.phone_number, c.topic, c.last_message, c.escalated,
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
       COALESCE(st.estado, 'pendiente'::text) AS estado,
       st.nota, st.actualizado_por,
       scored.procedure_code,
       st.updated_at AS estado_actualizado_en,
       scored.urgente
FROM scored
LEFT JOIN sofia_followup_status st ON st.conversation_id = scored.id
-- Lo urgente primero, SIEMPRE, sin importar el score. Un reclamo de 55 puntos
-- va antes que un aumento mamario de 100: el score ordena oportunidades, no
-- riesgos.
ORDER BY scored.urgente DESC, scored.score DESC, scored.created_at DESC;
