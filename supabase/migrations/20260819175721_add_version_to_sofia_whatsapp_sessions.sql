-- Recuperado del historial de Supabase (2026-09-09): aplicado el 2026-08-19,
-- sin archivo en el repo.
alter table public.sofia_whatsapp_sessions
  add column version integer not null default 0;
