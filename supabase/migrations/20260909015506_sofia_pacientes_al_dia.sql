-- Registra la definición REAL de sofia_pacientes.
--
-- POR QUÉ HACÍA FALTA
--
-- La vista que corre en producción expone la columna `nombre`, pero la última
-- migración registrada que la define es 20260827180610 (sofia_pacientes_view),
-- de antes de que existiera patient_name. El cambio se aplicó suelto, sin
-- quedar registrado en ningún lado.
--
-- Consecuencia concreta: recrear la base reproduciendo el historial daba una
-- vista SIN `nombre`, y la columna "Paciente" de la sección Pacientes —además
-- de la búsqueda por nombre— quedaba rota, sin ningún error que lo explicara.
--
-- Esta migración no cambia nada en producción: es exactamente lo que ya corre,
-- verificado con pg_get_viewdef. Lo que arregla es el historial.

CREATE OR REPLACE VIEW publisofia_conversations.sofia_pacientes
WITH (security_invoker = true) AS
WITH ranked AS (
  SELECT sofia_conversations.phone_hash, sofia_conversations.phone_number, sofia_conversations.prospect_id, sofia_conversations.procedure_code,
         sofia_conversations.sentiment, sofia_conversations.escalated, sofia_conversations.created_at, sofia_conversations.updated_at, sofia_conversations.channel,
         sofia_conversations.message_count, sofia_conversations.patient_name,
         -- Se prefiere la conversación con un procedimiento de verdad: si la
         -- última fue "solo precio" o "logística", esa no describe a la
         -- persona. Entre las que sirven, gana la más reciente.
         row_number() OVER (
           PARTITION BY sofia_conversations.phone_hash
           ORDER BY (CASE
             WHEN sofia_conversations.procedure_code IS NOT NULL
              AND (sofia_conversations.procedure_code <> ALL (ARRAY[
                    'generico_sin_procedimiento'::text, 'generico_solo_precio'::text,
                    'generico_logistica'::text, 'generico_proceso'::text,
                    'sin_clasificar'::text])) THEN 0
             ELSE 1
           END), sofia_conversations.created_at DESC
         ) AS rn
  FROM sofia_conversations c
  WHERE sofia_conversations.phone_hash IS NOT NULL
)
SELECT phone_hash,
       max(phone_number)  FILTER (WHERE phone_number IS NOT NULL) AS telefono,
       max(prospect_id)   FILTER (WHERE prospect_id IS NOT NULL)  AS prospect_id,
       max(procedure_code) FILTER (WHERE rn = 1)                  AS procedure_code,
       max(sentiment)      FILTER (WHERE rn = 1)                  AS sentiment,
       max(channel)        FILTER (WHERE rn = 1)                  AS channel,
       bool_or(escalated)                                         AS alguna_vez_escalada,
       sum(message_count)                                         AS mensajes,
       max(updated_at)                                            AS ultima_actividad,
       min(created_at)                                            AS primer_contacto,
       -- La columna que faltaba en el historial.
       max(patient_name)  FILTER (WHERE patient_name IS NOT NULL) AS nombre
FROM ranked r
GROUP BY phone_hash;
