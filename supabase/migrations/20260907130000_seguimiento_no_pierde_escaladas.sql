-- Seguimiento perdía 1 de cada 4 conversaciones que Sofía escaló.
--
-- PROBLEMA: la rama A de sofia_followup_queue exigía DOS condiciones para
-- incluir una conversación escalada:
--     c.escalated = true
--     AND c.escalation_reason ~* '(precio|agendar|cita|valoraci)'
-- El segundo filtro es un regex sobre texto libre que escribe Claude. Toda
-- escalación cuyo motivo estuviera redactado con otras palabras quedaba fuera
-- de la vista, y por lo tanto invisible para el equipo comercial.
--
-- Medido el 2026-09-07: 587 de 2.319 escaladas desde el 6 de agosto (25,3%)
-- no aparecían en Seguimiento. Y no son casos de borde — el grueso son
-- escalaciones clínicas de alto valor con contexto excelente:
--
--   110  frase de traspaso detectada sin etiqueta [ESCALAR]   (mecánica)
--    57  límite de mensajes alcanzado                          (mecánica)
--    18  falla_tecnica_claude                                  (mecánica)
--   402  motivos clínicos reales, p.ej. "paciente en lactancia interesada en
--        abdominoplastia, requiere evaluación médica sobre momento adecuado"
--
-- Esos 402 son exactamente los leads que más caro cuesta conseguir, y Sofía
-- los estaba entregando bien: el que fallaba era el filtro.
--
-- ARREGLO: si Sofía escaló, la conversación entra. Punto. Escalar YA ES la
-- señal de que hace falta un humano — no hace falta confirmarla con un regex
-- sobre cómo quedó redactado el motivo. El regex pasa a hacer solo lo que sabe
-- hacer bien: clasificar el `origen`, no decidir la inclusión.
--
-- ⚠️ EFECTO: Seguimiento crece en ~587 tarjetas de golpe. Es deuda acumulada
-- desde el 6 de agosto, no volumen nuevo. El origen 'escalada_tecnica' existe
-- para poder filtrarlas: son las 185 que llegaron por mecanismo y no por
-- intención del paciente.

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
       st.updated_at AS estado_actualizado_en
FROM scored
LEFT JOIN sofia_followup_status st ON st.conversation_id = scored.id
ORDER BY scored.score DESC, scored.created_at DESC;
