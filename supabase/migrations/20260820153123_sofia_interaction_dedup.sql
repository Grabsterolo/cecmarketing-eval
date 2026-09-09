-- Deduplicación atómica de entregas repetidas de webhook (mismo interactionId)
-- para el Worker cec-sofia-whatsapp (repo aparte, mismo proyecto de Supabase).
--
-- Aplicada al proyecto wuradlaomyoxkiagqvyi vía apply_migration (Supabase MCP).
--
-- Reemplaza el chequeo get/put sobre SOFIA_DEDUP (Workers KV) en
-- processInboundMessage() — KV no ofrece compare-and-swap, así que dos
-- entregas concurrentes del mismo interactionId podían ambas leer "no
-- procesado" antes de que ninguna alcanzara a escribir, y las dos procesaban
-- el mensaje completo. Verificado en producción: 13 pares de filas en
-- sofia_conversations con el mismo phone_hash/prospect_id, creadas 19-90ms
-- aparte, cada una con una respuesta de Claude distinta — procesamiento
-- duplicado real, no solo una fila de más.
--
-- El PRIMARY KEY de esta tabla sí es atómico en Postgres: la segunda entrega
-- concurrente choca contra la restricción y sabe que perdió la carrera antes
-- de llamar a Claude o mandar nada por WhatsApp (ver claimInteraction() en
-- cec-sofia-whatsapp/src/index.js).
create table if not exists public.sofia_interaction_dedup (
  interaction_id text primary key,
  created_at timestamptz not null default now()
);

alter table public.sofia_interaction_dedup enable row level security;

-- Sin policies para anon/authenticated a propósito — solo el Worker
-- (service_role, que bypasea RLS) necesita tocar esta tabla. Mismo patrón
-- "RLS obligatorio, sin acceso a anon" que sofia_followup_status; ver el
-- hallazgo de sofia_inactivity_cleanup (quedó sin RLS) como el error a no
-- repetir.
