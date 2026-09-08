-- El nombre del paciente llega a la sección Pacientes.
--
-- patient_name se agregó a sofia_conversations y ya se expuso en
-- sofia_followup_queue (20260908140000). Falta la tercera pantalla: Pacientes
-- lee de sofia_pacientes, que agrupa por persona.
--
-- Se toma con `max(...) FILTER (WHERE patient_name IS NOT NULL)` y NO el de la
-- fila rn=1, a diferencia de procedure_code o sentiment. Esos describen la
-- conversación más relevante; el nombre describe a la PERSONA y no cambia entre
-- conversaciones. Si una vieja quedó sin nombre y una nueva sí lo trae, queremos
-- el que exista — mismo criterio que ya usa `telefono` en esta misma vista.
--
-- Se usa CREATE OR REPLACE y no DROP+CREATE: solo se agrega una columna al
-- final, no se renombra ninguna, así que Postgres lo acepta en sitio. (La
-- migración original 20260827181935 sí necesitó DROP porque cambiaba nombres.)

CREATE OR REPLACE VIEW public.sofia_pacientes
WITH (security_invoker = true) AS
WITH ranked AS (
  SELECT
    phone_hash, phone_number, prospect_id, procedure_code, sentiment,
    escalated, created_at, updated_at, channel, message_count, patient_name,
    row_number() OVER (
      PARTITION BY phone_hash
      ORDER BY
        CASE WHEN procedure_code IS NOT NULL
              AND procedure_code NOT IN ('generico_sin_procedimiento','generico_solo_precio',
                                         'generico_logistica','generico_proceso','sin_clasificar')
             THEN 0 ELSE 1 END,
        created_at DESC
    ) AS rn
  FROM sofia_conversations
  WHERE phone_hash IS NOT NULL
)
SELECT
  r.phone_hash,
  max(r.phone_number) FILTER (WHERE r.phone_number IS NOT NULL) AS telefono,
  max(r.prospect_id)  FILTER (WHERE r.prospect_id IS NOT NULL)  AS prospect_id,
  max(r.procedure_code) FILTER (WHERE r.rn = 1)                 AS procedure_code,
  max(r.sentiment)    FILTER (WHERE r.rn = 1)                   AS sentiment,
  max(r.channel)      FILTER (WHERE r.rn = 1)                   AS channel,
  bool_or(r.escalated)                                          AS alguna_vez_escalada,
  sum(r.message_count)                                          AS mensajes,
  max(r.updated_at)                                             AS ultima_actividad,
  min(r.created_at)                                             AS primer_contacto,
  max(r.patient_name) FILTER (WHERE r.patient_name IS NOT NULL) AS nombre
FROM ranked r
GROUP BY r.phone_hash;

COMMENT ON VIEW public.sofia_pacientes IS
  'Una fila por persona (por phone_hash) con nombre, teléfono, procedimiento de interés, mensajes y actividad. Base del listado de Pacientes.';
