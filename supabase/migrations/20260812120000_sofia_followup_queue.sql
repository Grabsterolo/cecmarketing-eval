-- Módulo "Seguimiento" — cola unificada de conversaciones de Sofía que
-- quedaron abiertas sin venta, más el estado de seguimiento que el equipo
-- comercial le da a cada una.
--
-- Aplicada al proyecto wuradlaomyoxkiagqvyi vía apply_migration (Supabase MCP).
--
-- No modifica ni elimina sofia_followup_candidates (se verificó que no
-- tiene consumidores en src/, pero puede tener otros — se deja intacta).
-- No agrega columnas a sofia_conversations (la escribe el Worker de Sofía).

-- ============================================================
-- 1. Tabla: sofia_followup_status
-- ============================================================
-- Va primero porque la vista de abajo hace LEFT JOIN contra esta tabla —
-- tiene que existir antes de que se pueda crear la vista.
create table if not exists public.sofia_followup_status (
  conversation_id uuid primary key references public.sofia_conversations(id) on delete cascade,
  estado text not null default 'pendiente'
    check (estado in ('pendiente','contactado','agendo','descartado','no_contactable')),
  nota text,
  actualizado_por text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists sofia_followup_status_estado_idx on public.sofia_followup_status (estado);
create index if not exists sofia_followup_status_updated_at_idx on public.sofia_followup_status (updated_at desc);

alter table public.sofia_followup_status enable row level security;

-- RLS obligatorio, sin acceso a anon (mismo patrón que sofia_config) —
-- ver el hallazgo abierto de sofia_inactivity_cleanup, que quedó sin RLS.
create policy "Authenticated users can read sofia_followup_status"
  on public.sofia_followup_status for select
  using (auth.role() = 'authenticated');

create policy "Authenticated users can insert sofia_followup_status"
  on public.sofia_followup_status for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated users can update sofia_followup_status"
  on public.sofia_followup_status for update
  using (auth.role() = 'authenticated');

-- search_path fijo a 'public' — hardening estándar contra search_path
-- hijacking (WARN del linter de Supabase); sin efecto funcional acá porque
-- la función no referencia objetos sin calificar.
create or replace function public.set_sofia_followup_status_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sofia_followup_status_set_updated_at on public.sofia_followup_status;
create trigger sofia_followup_status_set_updated_at
  before update on public.sofia_followup_status
  for each row execute function public.set_sofia_followup_status_updated_at();

-- ============================================================
-- 2. Vista: sofia_followup_queue
-- ============================================================
-- Une dos orígenes de seguimiento sobre sofia_conversations:
--   A) 'escalada_sin_cita'   — Sofía escaló pidiendo precio/agendar/cita/
--                              valoración y nunca se registró una cita.
--   B) 'cerrada_sin_escalar' — conversación real (3+ mensajes) sobre un
--                              procedimiento concreto que Sofía respondió
--                              bien pero que murió sin escalar ni agendar.
-- Ambos orígenes excluyen conversaciones ya derivadas a cita
-- (derived_to_appointment = true) y solo consideran datos desde el
-- 2026-08-06, que es cuando prospect_id empezó a llenarse (antes de esa
-- fecha no hay forma de abrir la conversación en Zenvia desde el dashboard).
--
-- La vista hace LEFT JOIN contra sofia_followup_status para exponer
-- estado/nota/actualizado_por como columnas reales de la vista — así el
-- dashboard puede filtrar y ordenar por estado con una sola query en vez
-- de tener que cruzar dos tablas a mano en el cliente. Conversaciones sin
-- fila en sofia_followup_status aparecen con estado='pendiente' (default).
create or replace view public.sofia_followup_queue as
with base as (
  select
    c.*,
    case
      when c.escalated = true
       and c.escalation_reason ~* '(precio|agendar|cita|valoraci)'
      then 'escalada_sin_cita'
      else 'cerrada_sin_escalar'
    end as origen
  from public.sofia_conversations c
  where coalesce(c.derived_to_appointment, false) = false
    and c.created_at >= '2026-08-06'::timestamptz
    and (
      -- Origen A: escalada pidiendo precio/agendar/cita/valoración, sin cita derivada.
      (
        c.escalated = true
        and c.escalation_reason ~* '(precio|agendar|cita|valoraci)'
      )
      or
      -- Origen B: conversación real sobre un procedimiento concreto, cerrada sin escalar.
      (
        coalesce(c.escalated, false) = false
        -- UMBRAL_MENSAJES = 3. Con 3, el origen B aporta ~457 conversaciones/semana
        -- (~850/semana combinado con el origen A). Si ese volumen resulta
        -- inmanejable para el equipo comercial, subir este número a 4 lo baja
        -- a ~268/semana en el origen B.
        and c.message_count >= 3
        and c.procedure_interest is not null
        and c.procedure_interest <> ''
        and c.procedure_interest !~* '(informaci[oó]n general|no especificado|^general$|^precio|consulta de precio|informaci[oó]n de (precio|costo)|no identificado)'
      )
    )
),
classified as (
  select
    base.*,
    case
      when coalesce(base.procedure_interest, '') || ' ' || coalesce(base.escalation_reason, '')
           ~* '(abdominoplast|mamari|senos|mastopex|rinoplast|blefaro|lipo|preserv[eé]|mia femtech|lifting facial|facetite)'
      then 'cirugia'
      else 'tratamiento_no_quirurgico'
    end as categoria
  from base
),
scored as (
  select
    classified.*,
    (
      -- Valor del procedimiento (0-35)
      case
        when classified.categoria = 'cirugia' then 35
        when coalesce(classified.procedure_interest, '') || ' ' || coalesce(classified.escalation_reason, '')
             ~* '(ultherapy|quantum|trilipo|radiesse|hialur|toxina|botox|co2|criolipo|bodytite)' then 22
        when classified.procedure_interest is not null and classified.procedure_interest <> '' then 12
        else 0
      end
      +
      -- Engagement por cantidad de mensajes (0-25)
      case
        when classified.message_count >= 6 then 25
        when classified.message_count >= 4 then 20
        when classified.message_count = 3 then 14
        when classified.message_count = 2 then 8
        else 0
      end
      +
      -- Sentimiento (0-15)
      case
        when classified.sentiment = 'positivo' then 15
        when classified.sentiment = 'neutral' then 8
        else 3
      end
      +
      -- Recencia (0-15) — calculada con now() en la vista, no en el cliente.
      case
        when classified.created_at >= now() - interval '2 days' then 15
        when classified.created_at >= now() - interval '5 days' then 11
        when classified.created_at >= now() - interval '10 days' then 7
        when classified.created_at >= now() - interval '20 days' then 3
        else 0
      end
      +
      -- Intención explícita (0-10) — el paciente ya pidió precio/agendar/cita.
      case when classified.origen = 'escalada_sin_cita' then 10 else 0 end
    )::int as score
  from classified
)
select
  scored.id,
  scored.phone_number,
  scored.phone_hash,
  scored.topic,
  scored.last_message,
  scored.escalated,
  scored.escalation_reason,
  scored.procedure_interest,
  scored.channel,
  scored.derived_to_appointment,
  scored.message_count,
  scored.duration_minutes,
  scored.period,
  scored.sentiment,
  scored.created_at,
  scored.ended_at,
  scored.last_interaction_id,
  scored.prospect_id,
  scored.origen,
  scored.categoria,
  scored.score,
  coalesce(st.estado, 'pendiente') as estado,
  st.nota,
  st.actualizado_por
from scored
left join public.sofia_followup_status st on st.conversation_id = scored.id
order by scored.score desc, scored.created_at desc;

-- Por defecto las vistas en Postgres corren con los permisos de su dueño,
-- no de quien las consulta ("security definer" implícito) — eso podría
-- bypasear el RLS de sofia_followup_status/sofia_conversations para
-- cualquiera con SELECT sobre la vista. security_invoker=true hace que
-- respete el rol y el RLS de quien consulta (el advisor de seguridad de
-- Supabase lo marcó como ERROR al aplicar esta migración por primera vez).
alter view public.sofia_followup_queue set (security_invoker = true);
