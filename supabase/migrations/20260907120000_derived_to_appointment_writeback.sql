-- Cierra el círculo de Seguimiento: lo que el equipo marca como "agendó"
-- vuelve a sofia_conversations.derived_to_appointment.
--
-- PROBLEMA: derived_to_appointment estaba en 0 en las 11.940 filas — nadie la
-- escribía nunca. Las únicas 40 conversiones reales que existen viven en
-- sofia_followup_status.estado = 'agendo', marcadas a mano por el equipo
-- comercial, y no salían de ahí. Consecuencia: la conversión no se podía medir
-- contra las conversaciones, y cualquier cambio al prompt de Sofía solo se
-- podía evaluar por engagement (mensajes, escalación), que es un proxy — no
-- por el desenlace que de verdad importa.
--
-- ⚠️ EFECTO VISIBLE PARA EL EQUIPO: derived_to_appointment = true saca la
-- conversación de DOS pantallas, porque ambas la excluyen a propósito:
--   * la vista sofia_followup_queue  -> sección Seguimiento
--   * LeadsCalientesSection.jsx:465  -> sección Leads Potenciales
-- Es el comportamiento correcto (un lead agendado ya no necesita seguimiento),
-- pero al aplicar esto 40 tarjetas desaparecen de golpe de ambas listas. Si
-- alguien pregunta "¿dónde se fueron?", es esto.
--
-- Se hace con trigger y no desde el dashboard porque sofia_conversations tiene
-- RLS con SELECT para authenticated y ninguna policy de UPDATE: el cliente no
-- puede escribirla, y no queremos abrirle esa puerta solo para este campo.

-- ============================================================
-- 1. Función
-- ============================================================
-- SECURITY DEFINER porque corre con los permisos del dueño para saltar el RLS
-- de sofia_conversations (ver arriba). search_path fijo a 'public' — mismo
-- hardening que sofia_procedure_code y compañía, contra search_path hijacking.
CREATE OR REPLACE FUNCTION public.sofia_sync_derived_to_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estado = 'agendo' THEN
    UPDATE public.sofia_conversations
       SET derived_to_appointment = true
     WHERE id = NEW.conversation_id
       AND COALESCE(derived_to_appointment, false) = false;

  -- Revertir si corrigen la marca. Sin esta rama, un click equivocado en
  -- "agendó" escondería la conversación de Seguimiento y de Leads Potenciales
  -- para siempre, sin forma de recuperarla desde la interfaz.
  ELSIF TG_OP = 'UPDATE' AND OLD.estado = 'agendo' AND NEW.estado <> 'agendo' THEN
    UPDATE public.sofia_conversations
       SET derived_to_appointment = false
     WHERE id = NEW.conversation_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sofia_sync_derived_to_appointment() IS
  'Propaga sofia_followup_status.estado = ''agendo'' a sofia_conversations.derived_to_appointment, y lo revierte si se corrige la marca.';

-- ============================================================
-- 2. Trigger
-- ============================================================
-- AFTER: no modifica NEW, solo propaga a otra tabla.
-- OF estado: no dispara cuando solo se edita la nota o actualizado_por.
DROP TRIGGER IF EXISTS sofia_followup_status_sync_appointment ON public.sofia_followup_status;
CREATE TRIGGER sofia_followup_status_sync_appointment
  AFTER INSERT OR UPDATE OF estado ON public.sofia_followup_status
  FOR EACH ROW EXECUTE FUNCTION public.sofia_sync_derived_to_appointment();

-- ============================================================
-- 3. Backfill del histórico
-- ============================================================
-- Las marcas de 'agendo' que ya existían antes de que hubiera trigger.
UPDATE public.sofia_conversations c
   SET derived_to_appointment = true
  FROM public.sofia_followup_status s
 WHERE s.conversation_id = c.id
   AND s.estado = 'agendo'
   AND COALESCE(c.derived_to_appointment, false) = false;
