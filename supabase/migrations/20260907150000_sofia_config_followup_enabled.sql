-- Interruptor propio del seguimiento proactivo de Sofía.
--
-- Aparte de whatsapp_enabled a propósito: son dos decisiones distintas.
--   whatsapp_enabled -> "que Sofía conteste"
--   followup_enabled -> "que Sofía escriba primero"
-- El CEC puede querer lo primero sin lo segundo, y apagar el seguimiento no
-- debería obligar a dejar a los pacientes sin atención automática.
--
-- La relación entre los dos NO es simétrica y está implementada así en el
-- Worker (runFollowupSweep) y en la interfaz: si Sofía está pausada, el
-- seguimiento no corre aunque followup_enabled sea true — un bot que no puede
-- responder tampoco debe poder escribir primero. Por eso el toggle de la
-- interfaz queda deshabilitado mientras Sofía esté en pausa.
--
-- DEFAULT FALSE, y es lo importante de esta migración: desplegar el Worker con
-- el cron nuevo NO debe empezar a mandarle mensajes a nadie. Encenderlo tiene
-- que ser un acto deliberado de una persona, desde el dashboard. El mismo
-- criterio se repite en el default de loadSofiaConfig() y en el useState del
-- componente: ante cualquier duda o lectura fallida, apagado.

ALTER TABLE public.sofia_config
  ADD COLUMN IF NOT EXISTS followup_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sofia_config.followup_enabled IS
  'Interruptor propio del seguimiento proactivo (cron 5,35). Independiente de whatsapp_enabled: se puede tener a Sofía respondiendo pero sin escribir primero. Default false a propósito — desplegar el Worker no debe empezar a mandar mensajes solo.';
