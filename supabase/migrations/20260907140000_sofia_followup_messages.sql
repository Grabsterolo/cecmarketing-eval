-- Registro de los mensajes de seguimiento proactivo que manda Sofía.
--
-- POR QUÉ UNA TABLA APARTE y no una columna en sofia_conversations:
--   1. Idempotencia. La consulta "¿ya le escribí a esta persona?" tiene que ser
--      barata y a prueba de corridas concurrentes del barrido. Una PK sobre
--      phone_hash lo garantiza a nivel de base: un segundo intento de insertar
--      choca contra la PK en vez de mandar un segundo WhatsApp.
--   2. Auditoría. Queda qué se mandó, cuándo, y con qué motivo se eligió a esa
--      persona — sin ensuciar la tabla caliente que el Worker escribe en cada
--      mensaje.
--   3. Medición. Con derived_to_appointment ya conectado (migración
--      20260907120000), se puede cruzar "recibió seguimiento" contra "agendó"
--      y saber si esto sirve, en vez de suponerlo.
--
-- LA PK ES phone_hash, NO conversation_id: un paciente que vuelve NO genera
-- fila nueva en sofia_conversations (upsertConversation busca por phone_hash y
-- actualiza la más vieja — ver README "Un paciente que vuelve NO genera una
-- fila nueva"). Si la PK fuera conversation_id daría lo mismo hoy, pero
-- phone_hash expresa la regla que de verdad queremos: UN mensaje de
-- seguimiento por PERSONA, nunca dos, aunque escriba diez veces.

CREATE TABLE IF NOT EXISTS public.sofia_followup_messages (
  phone_hash        text PRIMARY KEY,
  prospect_id       text,
  conversation_id   uuid REFERENCES public.sofia_conversations(id) ON DELETE SET NULL,
  channel           text,
  message           text NOT NULL,
  -- Motivo por el que entró al barrido (procedure_code, horas de silencio).
  -- Sirve para segmentar el experimento después.
  trigger_reason    text,
  -- El barrido en seco NO escribe filas: solo devuelve a quién le habría
  -- escrito. Así una corrida de prueba nunca consume el cupo de nadie y se
  -- puede repetir sin limpiar nada. La columna queda para poder distinguir
  -- envíos simulados si alguna vez hiciera falta registrarlos.
  dry_run           boolean NOT NULL DEFAULT true,
  sent_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sofia_followup_messages_sent_at_idx
  ON public.sofia_followup_messages (sent_at DESC);
CREATE INDEX IF NOT EXISTS sofia_followup_messages_dry_run_idx
  ON public.sofia_followup_messages (dry_run);

-- RLS activo con lectura para el dashboard. La escritura queda solo para el
-- Worker con SERVICE_ROLE_KEY (que bypasea RLS), igual que
-- sofia_conversations: nadie logueado en el dashboard debe poder inventar
-- una fila que haga creer que ya se le escribió a alguien.
ALTER TABLE public.sofia_followup_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read sofia_followup_messages"
  ON public.sofia_followup_messages FOR SELECT
  USING (auth.role() = 'authenticated');

COMMENT ON TABLE public.sofia_followup_messages IS
  'Un mensaje de seguimiento proactivo por persona (PK phone_hash), como máximo. Lo escribe el Worker cec-sofia-whatsapp en POST /followup/sweep.';
