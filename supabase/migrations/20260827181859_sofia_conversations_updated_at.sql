-- upsertConversation (Worker) busca por phone_hash sin filtro de fecha, toma
-- la fila más antigua y la actualiza: un paciente que vuelve NO genera una
-- fila nueva. Por eso created_at es el PRIMER contacto y nunca cambia, y no
-- había forma de saber la última actividad (ended_at nunca se llenó).
--
-- Trigger y no una escritura del Worker, para que valga para cualquier
-- escritor y no haya que acordarse de setearlo.
ALTER TABLE public.sofia_conversations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- Punto de partida para las filas existentes: lo más preciso que se puede
-- afirmar sin inventar es que su última actividad conocida es su creación.
UPDATE public.sofia_conversations
   SET updated_at = created_at
 WHERE updated_at IS NULL;

CREATE OR REPLACE FUNCTION public.sofia_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sofia_conversations_updated_at ON public.sofia_conversations;
CREATE TRIGGER trg_sofia_conversations_updated_at
  BEFORE INSERT OR UPDATE ON public.sofia_conversations
  FOR EACH ROW EXECUTE FUNCTION public.sofia_touch_updated_at();

COMMENT ON COLUMN public.sofia_conversations.updated_at IS
  'Última vez que la conversación recibió actividad. created_at es el primer contacto y nunca cambia.';
