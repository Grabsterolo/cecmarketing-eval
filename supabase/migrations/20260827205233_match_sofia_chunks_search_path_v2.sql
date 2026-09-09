-- Recuperado del historial de Supabase (2026-09-09).

-- Último hallazgo de search_path mutable. Es la función de RAG que usa
-- functions/api/chat.js para recuperar la base de conocimiento de Sofía, así
-- que el search_path incluye `public` explícitamente: la extensión `vector`
-- vive ahí y el operador de distancia tiene que seguir resolviéndose.
--
-- El orden real de los argumentos es (query_embedding, match_count,
-- match_threshold) — no el que sugiere el nombre del lint.
ALTER FUNCTION public.match_sofia_chunks(vector, integer, double precision)
  SET search_path = public, pg_temp;
