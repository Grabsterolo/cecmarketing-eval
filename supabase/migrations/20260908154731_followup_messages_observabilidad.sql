-- Saber POR QUÉ un seguimiento salió genérico, y cuánto costó de verdad.
--
-- APLICADA EN SUPABASE EL 2026-09-08 y archivada acá el mismo día, después de
-- detectar que faltaba. El resto de las migraciones de esta tanda sí quedaron
-- archivadas al aplicarse; esta se pasó por alto. Es la misma desincronización
-- que advierte el README del Worker, en la dirección contraria: la base con algo
-- que el repo no registra.
--
-- CONTEXTO. El 14,7% de los mensajes (5 de 34 medidos) salía con el texto de
-- respaldo genérico en vez del redactado, y no había forma de saber por qué: el
-- Worker solo hacía console.error, que no queda en ningún lado consultable. Un
-- porcentaje sin explicación no se puede arreglar.
--
-- Con la columna puesta se encontró la causa enseguida: el validador de
-- contenido bloqueaba las palabras "precio", "costo" y "cuesta" a secas, y
-- rechazaba frases sanas como "quería retomar su consulta sobre el precio de la
-- abdominoplastia". Se reemplazó por dos reglas (FOLLOWUP_CLAIM y
-- FOLLOWUP_MONTO) que bloquean afirmaciones y montos, no referencias.
--
-- Valores posibles de fallback_reason:
--   NULL                    el mensaje se redactó bien
--   sin_historial           no había conversación que leer
--   api_NNN                 la API de Anthropic respondió con ese status
--   excepcion               la llamada lanzó
--   vacio                   el modelo no devolvió texto
--   muy_largo               pasó de 320 caracteres
--   afirmacion_prohibida    promoción, descuento, garantía, disponibilidad
--   monto_en_el_texto       una cifra con símbolo de moneda o "mil/dólares"
--
-- tokens_in / tokens_out vienen del `usage` que reporta la propia API. Con eso
-- el costo dejó de ser una estimación: 100 mensajes = $0,068 medidos, contra los
-- ~$4/mes que se habían proyectado a ojo.

ALTER TABLE public.sofia_followup_messages
  ADD COLUMN IF NOT EXISTS fallback_reason text,
  ADD COLUMN IF NOT EXISTS tokens_in  integer,
  ADD COLUMN IF NOT EXISTS tokens_out integer;

COMMENT ON COLUMN public.sofia_followup_messages.fallback_reason IS
  'NULL = el mensaje se redactó bien. Si no, por qué cayó al respaldo genérico (api_error, vacio, muy_largo, contenido_prohibido, sin_historial). Sin esto no se puede saber por qué un 14,7% salía genérico: el console.log del Worker no queda en ningún lado consultable.';

COMMENT ON COLUMN public.sofia_followup_messages.tokens_in IS
  'Tokens de entrada que reportó la API de Anthropic para redactar este mensaje. Permite calcular el costo real en vez de estimarlo.';
