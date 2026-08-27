-- Vista base de la sección Pacientes: una fila por PERSONA, no por
-- conversación. sofia_conversations tiene ~9.269 filas para ~9.255 personas,
-- así que alguien que escribió tres veces no debe aparecer tres veces.
--
-- Se recrea (no CREATE OR REPLACE) porque respecto a la primera versión
-- cambian nombres de columna, y eso Postgres no lo permite reemplazando en
-- sitio. Reemplaza a la migración 20260827180610_sofia_pacientes_view.
--
-- Dos correcciones sobre esa primera versión:
--   * "ultima_actividad" mostraba created_at, que es el PRIMER contacto y
--     nunca cambia — el Worker siempre actualiza la fila original del mismo
--     phone_hash, así que un paciente que vuelve no genera fila nueva. Ahora
--     usa updated_at, que mantiene el trigger de 20260827181859.
--   * "conversaciones" contaba filas, y por lo mismo siempre daba 1. Se
--     reemplaza por la suma de mensajes, que sí mide la interacción real.
--
-- Se agrupa por phone_hash (siempre presente) y no por teléfono, que puede
-- venir vacío si Zenvia no lo tenía o si el prospecto quedó fuera del tope de
-- 5000 al sincronizar.
DROP VIEW IF EXISTS public.sofia_pacientes;

CREATE VIEW public.sofia_pacientes
WITH (security_invoker = true) AS
WITH ranked AS (
  SELECT
    phone_hash, phone_number, prospect_id, procedure_code, sentiment,
    escalated, created_at, updated_at, channel, message_count,
    -- El interés que se muestra es el de la conversación más reciente que
    -- tenga un procedimiento real: si la última fue "solo preguntó precio"
    -- pero antes consultó por abdominoplastia, interesa lo segundo.
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
  min(r.created_at)                                             AS primer_contacto
FROM ranked r
GROUP BY r.phone_hash;

COMMENT ON VIEW public.sofia_pacientes IS
  'Una fila por persona (por phone_hash) con teléfono, procedimiento de interés, mensajes y actividad. Base del listado de Pacientes.';
