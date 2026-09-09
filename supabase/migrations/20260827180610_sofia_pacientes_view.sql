-- Recuperado del historial de Supabase (2026-09-09): aplicado el 2026-08-27,
-- sin archivo en el repo. Su definición quedó superada dos veces
-- (sofia_pacientes_v2 y sofia_pacientes_al_dia); se conserva por el orden.

-- Una fila por persona, no por conversación. sofia_conversations tiene 9.269
-- filas para 9.255 personas distintas, y alguien que escribió tres veces por
-- tres temas no debe aparecer tres veces en un listado de pacientes.
--
-- Se agrupa por phone_hash (siempre presente) y no por teléfono, que puede
-- venir vacío si Zenvia no lo tenía o si el prospecto quedó fuera del tope de
-- 5000 al sincronizar.
--
-- El procedimiento que se muestra es el de la conversación más reciente que
-- tenga uno identificable: si la última fue "solo preguntó precio" pero antes
-- consultó por abdominoplastia, interesa lo segundo.
CREATE OR REPLACE VIEW public.sofia_pacientes
WITH (security_invoker = true) AS
WITH ranked AS (
  SELECT
    phone_hash, phone_number, prospect_id, procedure_code,
    sentiment, escalated, created_at, channel,
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
  count(*)                                                      AS conversaciones,
  max(r.created_at)                                             AS ultima_actividad,
  min(r.created_at)                                             AS primera_actividad
FROM ranked r
GROUP BY r.phone_hash;

COMMENT ON VIEW public.sofia_pacientes IS
  'Una fila por persona (agrupada por phone_hash) con su teléfono, procedimiento de interés y actividad. Base del listado de Pacientes del dashboard.';
