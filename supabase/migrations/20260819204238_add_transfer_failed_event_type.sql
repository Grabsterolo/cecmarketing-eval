-- Recuperado del historial de Supabase (2026-09-09).
alter table public.sofia_reliability_events
  drop constraint sofia_reliability_events_event_type_check;

alter table public.sofia_reliability_events
  add constraint sofia_reliability_events_event_type_check
  check (event_type = any (array['claude_call_failed'::text, 'zenvia_lookup_failed'::text, 'transfer_failed'::text]));
