-- Estado "En espera": la pelota está del lado del paciente.
--
-- Faltaba el estado que describe el desenlace más común. De 100 conversaciones
-- que recibieron seguimiento, 82 no contestaron y 14 contestaron sin avanzar:
-- 96 quedaban en un limbo que ningún estado nombraba. No están pendientes
-- —Sofía ya gastó su único mensaje y no hay nada más que hacer AHORA— pero
-- tampoco descartadas: la paciente del BodyTite tiene score 77 y dijo "sí claro
-- yo te escribo".
--
-- Marcarlas descartado sería mentir y perderlas; dejarlas pendiente hace que un
-- asesor las llame para escuchar lo mismo.
--
-- SE VENCE SOLA. La vista devuelve la conversación a 'pendiente' cuando pasa
-- esperar_hasta. Se calcula al consultar, así que NO hace falta un cron que
-- recorra la tabla — y no puede desincronizarse, que es el modo de falla de
-- cualquier proceso que despierte filas por su cuenta.
--
-- OJO AL RETOMARLA: pasadas las 24 h de WhatsApp ya no se le puede escribir
-- gratis, y el CEC solo tiene aprobada la plantilla de cumpleaños. Cuando una
-- conversación vuelve de "En espera", el siguiente paso es una LLAMADA, no un
-- mensaje. Por eso lo retoma una persona y no Sofía.

ALTER TABLE public.sofia_followup_status
  DROP CONSTRAINT IF EXISTS sofia_followup_status_estado_check;

ALTER TABLE public.sofia_followup_status
  ADD CONSTRAINT sofia_followup_status_estado_check
  CHECK (estado = ANY (ARRAY['pendiente','contactado','agendo','descartado','no_contactable','en_espera']));

ALTER TABLE public.sofia_followup_status
  ADD COLUMN IF NOT EXISTS esperar_hasta timestamptz;

COMMENT ON COLUMN public.sofia_followup_status.esperar_hasta IS
  'Solo con estado = en_espera. Hasta cuándo la conversación sale de la lista activa. La vista la devuelve sola a pendiente cuando pasa la fecha — no hace falta cron: se calcula al consultar.';

-- La vista completa (con el cálculo de vencimiento y esperar_hasta expuesto)
-- se aplicó en la misma tanda. Ver 20260908120000_seguimiento_urgencia.sql para
-- la versión anterior; el cambio acá es el CASE de `estado` y la columna nueva
-- al final:
--
--   CASE
--     WHEN st.estado = 'en_espera' AND st.esperar_hasta > now() THEN 'en_espera'
--     WHEN st.estado = 'en_espera'                              THEN 'pendiente'
--     ELSE COALESCE(st.estado, 'pendiente')
--   END AS estado,
--   ...
--   st.esperar_hasta
--
-- Probado con un bloque que se revierte por excepción:
--   pendiente -> en_espera -> (vence) -> pendiente
