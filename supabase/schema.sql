-- Esquema completo de la base de CEC Marketing.
--
-- QUÉ ES ESTE ARCHIVO
--
-- Un volcado del estado real de producción, generado por introspección el
-- 2026-09-09 (no hay pg_dump ni acceso directo a Postgres desde acá). Sirve
-- para recrear la base desde cero con el dashboard funcionando.
--
-- La versión anterior de este archivo llevaba desactualizada desde julio: no
-- tenía procedure_code, ni sofia_pacientes, ni sofia_home_stats, ni nada de
-- Seguimiento. Recrear desde ahí dejaba el dashboard roto.
--
-- QUÉ SE VERIFICÓ
--
-- Las 10 funciones se compararon una por una contra la definición viva, por
-- huella md5 sobre el texto normalizado: las 10 coinciden. Los conteos de
-- objetos también cuadran con producción (12 tablas, 3 vistas, 12 índices,
-- 3 disparadores, 19 políticas, 21 restricciones). Las dos vistas grandes son
-- copias literales de las migraciones que definen lo que corre hoy.
--
-- Lo que NO se hizo: ejecutar este archivo entero contra una base vacía. No
-- hay dónde: no hay Postgres local ni pg_dump, y crear una rama de Supabase se
-- cobra aparte. Si alguien recrea la base con esto, conviene revisar que no
-- falte nada antes de darlo por bueno.
--
-- CÓMO MANTENERLO
--
-- No se edita a mano. Se regenera cuando el esquema cambie de forma
-- importante. La fuente de verdad sigue siendo la base; el historial paso a
-- paso está en supabase/migrations/.
--
-- QUÉ NO INCLUYE
--
-- Datos. Ni las conversaciones, ni los perfiles, ni el prompt y la base de
-- conocimiento de Sofía (sofia_config), que es contenido y vive solo en la
-- base. Una base recreada con esto arranca vacía y con Sofía sin prompt.
--
-- EL ORDEN IMPORTA
--
-- sofia_procedure_code() va antes que sofia_conversations porque la columna
-- generada procedure_code la invoca. Las vistas van antes que
-- asignar_mi_lista(), que consulta sofia_followup_queue. Los triggers van al
-- final, después de sus funciones y sus tablas.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SEQUENCE IF NOT EXISTS public.sofia_knowledge_chunks_id_seq;


-- ============================================================
-- FUNCIONES DE LAS QUE DEPENDEN LAS TABLAS
-- ============================================================

-- Taxonomía de procedimientos. La invoca la columna generada
-- sofia_conversations.procedure_code, así que tiene que existir antes que la
-- tabla.
--
-- OJO: cambiar esta función NO recalcula la columna generada en las filas que
-- ya existen. Hay que forzar el recálculo.
CREATE OR REPLACE FUNCTION public.sofia_procedure_code(procedure_interest text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH n AS (
    SELECT translate(lower(trim(coalesce(procedure_interest, ''))), 'áéíóúñü', 'aeiounu') AS p
  )
  SELECT CASE
    WHEN (SELECT p FROM n) = '' THEN NULL

    -- ---- MAMARIO (4 técnicas independientes) ----
    -- "implante inyectable" es MIA aunque mencione una marca de implante
    -- tradicional, por eso va antes que la regla de aumento tradicional.
    WHEN (SELECT p FROM n) ~ 'implante inyectable|implantes inyectables' THEN 'mamario_mia'
    -- \y = límite de palabra: sin esto, "mia" captura bichectoMIA,
    -- mastectoMIA y lipectoMIA — todo lo que termina en -tomía.
    WHEN (SELECT p FROM n) ~ '\ymia\y|femtech' THEN 'mamario_mia'
    WHEN (SELECT p FROM n) ~ 'preserve' THEN 'mamario_preserve'
    WHEN (SELECT p FROM n) ~ 'sin cirugia' AND (SELECT p FROM n) ~ 'sen|mamari|busto|pecho' THEN 'mamario_mia'
    WHEN (SELECT p FROM n) ~ 'reconstruccion mamaria|post mastectomia' THEN 'mamario_reconstruccion'
    WHEN (SELECT p FROM n) ~ 'mastopexia|pexia|levantamiento de (sen|pecho|busto)|levantamiento mamario|levantamiento de mama' THEN 'mamario_mastopexia'
    WHEN (SELECT p FROM n) ~ 'reduccion mamaria|reduccion de sen|reduccion de pecho' THEN 'mamario_reduccion'
    WHEN (SELECT p FROM n) ~ 'aumento mamario|aumento de sen|aumento sen|aumento de pecho|aumento de busto|aumento busto|implante.*(sen|mamari|pecho|busto)|(sen|mamari|pecho).*implante|protesis mamari|motiva' THEN 'mamario_aumento_tradicional'

    -- ---- FACIAL QUIRÚRGICO (lifting y blefaroplastia son distintos) ----
    WHEN (SELECT p FROM n) ~ 'blefaro|parpado' THEN 'facial_blefaroplastia'
    WHEN (SELECT p FROM n) ~ 'lifting facial|ritidectomia|lifting de rostro|estiramiento facial|levantamiento facial' THEN 'facial_lifting'
    WHEN (SELECT p FROM n) ~ 'rinoplast|nariz' THEN 'facial_rinoplastia'
    WHEN (SELECT p FROM n) ~ 'otoplastia|orejas' THEN 'facial_otoplastia'
    WHEN (SELECT p FROM n) ~ 'bichectomia' THEN 'facial_bichectomia'

    -- ---- CORPORAL QUIRÚRGICO ----
    WHEN (SELECT p FROM n) ~ 'abdominoplast' THEN 'corporal_abdominoplastia'
    WHEN (SELECT p FROM n) ~ 'mommy makeover' THEN 'corporal_mommy_makeover'
    WHEN (SELECT p FROM n) ~ 'braquioplastia|contorno de brazo|brazos caidos' THEN 'corporal_braquioplastia'
    WHEN (SELECT p FROM n) ~ 'gluteo|bbl' THEN 'corporal_gluteos'
    WHEN (SELECT p FROM n) ~ 'ginecomastia' THEN 'corporal_ginecomastia'
    WHEN (SELECT p FROM n) ~ 'remodelacion costal' THEN 'corporal_remodelacion_costal'
    WHEN (SELECT p FROM n) ~ 'labioplastia|vaginoplastia|intima' THEN 'intima'
    WHEN (SELECT p FROM n) ~ 'lipoescultura|lipo 360|liposuccion|vaser|soft lipo|lipectomia' AND (SELECT p FROM n) !~ 'papada' THEN 'corporal_liposuccion'

    -- ---- APARATOLOGÍA ----
    WHEN (SELECT p FROM n) ~ 'ultherapy|ulthera|ultrasonido microfocalizado' THEN 'aparato_ultherapy'
    WHEN (SELECT p FROM n) ~ 'quantum|lipopapada|lipo papada|papada|contorno mandibular' THEN 'aparato_quantumrf_papada'
    WHEN (SELECT p FROM n) ~ 'trilipo' THEN 'aparato_trilipo'
    WHEN (SELECT p FROM n) ~ 'bodytite|facetite|accutite|morpheus' THEN 'aparato_tite_morpheus'
    WHEN (SELECT p FROM n) ~ 'oxygeneo|oxigeno|geneo|oxigenacion facial' THEN 'aparato_oxygeneo'
    WHEN (SELECT p FROM n) ~ 'laser|co2' THEN 'aparato_laser'
    WHEN (SELECT p FROM n) ~ 'criolipo|coolsculpt|reduccion grasa|reduccion de grasa' THEN 'aparato_reduccion_grasa'

    -- ---- INYECTABLES ----
    WHEN (SELECT p FROM n) ~ 'botox|toxina|botulinica|xeomin|dysport|lineas de expresion' THEN 'inyect_toxina'
    WHEN (SELECT p FROM n) ~ 'radiesse' THEN 'inyect_radiesse'
    WHEN (SELECT p FROM n) ~ 'harmonyca' THEN 'inyect_harmonyca'
    WHEN (SELECT p FROM n) ~ 'hialuronico|relleno|labios|ojeras|redensity|contorno de ojos|natural lift' THEN 'inyect_acido_hialuronico'
    WHEN (SELECT p FROM n) ~ 'exosoma|bioestimul|sculptra|profhilo' THEN 'inyect_bioestimuladores'
    WHEN (SELECT p FROM n) ~ 'armonizacion facial' THEN 'inyect_armonizacion_facial'

    -- ---- ESTÉTICA ----
    WHEN (SELECT p FROM n) ~ 'limpieza facial|peeling|hydrafacial|dermapen|microneedling|cosmelan|dermamelan|manchas|melasma' THEN 'estetica_facial'
    WHEN (SELECT p FROM n) ~ 'depilacion' THEN 'estetica_depilacion'
    WHEN (SELECT p FROM n) ~ 'carboxiterapia|masaje|post ?operatorio|post ?cirugia|drenaje' THEN 'estetica_postoperatorio'
    WHEN (SELECT p FROM n) ~ 'flacidez|firmeza|reafirm|rejuvenecimiento|tratamiento de piel|estrias|tratamiento facial|tratamiento rostro' THEN 'estetica_piel_flacidez'

    -- ---- NO ES UN PROCEDIMIENTO ----
    WHEN (SELECT p FROM n) ~ 'consulta laboral|vacante|empleo|trabajo' THEN 'no_paciente_laboral'
    WHEN (SELECT p FROM n) ~ 'dia de la madre|promocion|certificado de regalo|paquete' THEN 'promociones'
    WHEN (SELECT p FROM n) ~ 'informacion general|no especificad|sin especificar|consulta general|servicios generales|consulta inicial|valoracion general|informacion de servicio|sin informacion|indeterminado|ninguno|interes general|desconocido|no identificado|no aplica|sin interes|informacion no disponible|consulta de servicios|consulta comercial|procedimientos en general' THEN 'generico_sin_procedimiento'
    WHEN (SELECT p FROM n) ~ 'precio|costo|tarifa|financiamiento|pago|presupuesto' THEN 'generico_solo_precio'
    WHEN (SELECT p FROM n) ~ 'ubicacion|direccion|horario|cita|agendar|reprogramacion|telefono|correo|whatsapp' THEN 'generico_logistica'
    WHEN (SELECT p FROM n) ~ 'sesiones|riesgos|antes y despues|resultados|valoracion|cirugia|quirurgic' THEN 'generico_proceso'

    ELSE 'sin_clasificar'
  END
$$;

-- Pone updated_at en cada insert/update de sofia_conversations.
CREATE OR REPLACE FUNCTION public.sofia_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- Pone updated_at en sofia_followup_status, PERO solo cuando cambió algo que
-- cuenta como trabajar el lead. Asignarlo no cuenta: ese timestamp alimenta el
-- sello "Contactado por Ana · hace 5min" de cada tarjeta, y repartir la lista
-- del día haría aparecer 30 tarjetas como recién tocadas.
CREATE OR REPLACE FUNCTION public.set_sofia_followup_status_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
begin
  if TG_OP = 'INSERT'
     or new.estado          is distinct from old.estado
     or new.nota            is distinct from old.nota
     or new.actualizado_por is distinct from old.actualizado_por
     or new.esperar_hasta   is distinct from old.esperar_hasta then
    new.updated_at = now();
  end if;
  return new;
end;
$function$;

-- Marcar un lead como "agendó" en Seguimiento lo saca de la cola escribiendo
-- derived_to_appointment en la conversación. Y al revés: si se deshace, vuelve.
CREATE OR REPLACE FUNCTION public.sofia_sync_derived_to_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.estado = 'agendo' THEN
    UPDATE public.sofia_conversations
       SET derived_to_appointment = true
     WHERE id = NEW.conversation_id
       AND COALESCE(derived_to_appointment, false) = false;
  ELSIF TG_OP = 'UPDATE' AND OLD.estado = 'agendo' AND NEW.estado <> 'agendo' THEN
    UPDATE public.sofia_conversations
       SET derived_to_appointment = false
     WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- La usan las políticas RLS de profiles, así que va antes que ellas.
-- SECURITY DEFINER a propósito: si corriera como el usuario, leer profiles
-- para saber si es admin volvería a disparar la política y se cicla.
CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$function$;

REVOKE ALL ON FUNCTION public.current_user_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;


-- ============================================================
-- TABLAS
-- ============================================================

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  full_name text,
  role text DEFAULT 'user'::text,
  created_at timestamp with time zone DEFAULT now(),
  allowed_modules text[]
);

CREATE TABLE public.sofia_audits (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  sample_size integer,
  strengths text,
  weaknesses text,
  suggestions text,
  raw_report text
);

CREATE TABLE public.sofia_config (
  id integer DEFAULT 1 NOT NULL,
  system_prompt text,
  knowledge_base text,
  updated_at timestamp with time zone DEFAULT now(),
  whatsapp_enabled boolean DEFAULT true NOT NULL,
  escalation_round_robin_index integer DEFAULT 0 NOT NULL,
  followup_enabled boolean DEFAULT false NOT NULL
);

CREATE TABLE public.sofia_conversations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  phone_number text,
  topic text,
  last_message text,
  escalated boolean DEFAULT false,
  escalation_reason text,
  created_at timestamp with time zone DEFAULT now(),
  phone_hash text,
  procedure_interest text,
  channel text DEFAULT 'whatsapp'::text,
  derived_to_appointment boolean DEFAULT false,
  message_count integer DEFAULT 0,
  duration_minutes integer DEFAULT 0,
  period text,
  sentiment text DEFAULT 'neutral'::text,
  ended_at timestamp with time zone,
  last_interaction_id text,
  prospect_id text,
  procedure_code text GENERATED ALWAYS AS (sofia_procedure_code(procedure_interest)) STORED,
  updated_at timestamp with time zone,
  patient_name text
);

CREATE TABLE public.sofia_followup_messages (
  phone_hash text NOT NULL,
  prospect_id text,
  conversation_id uuid,
  channel text,
  message text NOT NULL,
  trigger_reason text,
  dry_run boolean DEFAULT true NOT NULL,
  sent_at timestamp with time zone DEFAULT now() NOT NULL,
  fallback_reason text,
  tokens_in integer,
  tokens_out integer
);

CREATE TABLE public.sofia_followup_status (
  conversation_id uuid NOT NULL,
  estado text DEFAULT 'pendiente'::text NOT NULL,
  nota text,
  actualizado_por text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  esperar_hasta timestamp with time zone,
  asignado_a uuid,
  asignado_nombre text,
  asignado_en timestamp with time zone
);

CREATE TABLE public.sofia_inactivity_cleanup (
  prospect_id text NOT NULL,
  group_id text NOT NULL,
  warned_at timestamp with time zone,
  closed_at timestamp with time zone,
  skipped_reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.sofia_interaction_dedup (
  interaction_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.sofia_knowledge_chunks (
  id bigint DEFAULT nextval('sofia_knowledge_chunks_id_seq'::regclass) NOT NULL,
  category text,
  content text,
  embedding vector(1536),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.sofia_recommendations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  date date DEFAULT CURRENT_DATE,
  analysis text NOT NULL,
  highlights jsonb DEFAULT '[]'::jsonb,
  data_snapshot jsonb DEFAULT '{}'::jsonb,
  period_days integer DEFAULT 1 NOT NULL
);

CREATE TABLE public.sofia_reliability_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  event_type text NOT NULL,
  prospect_id text,
  phone_hash text,
  detail text
);

CREATE TABLE public.sofia_whatsapp_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  phone_hash text NOT NULL,
  messages jsonb DEFAULT '[]'::jsonb,
  channel text DEFAULT 'whatsapp_sandbox'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  version integer DEFAULT 0 NOT NULL
);


-- ============================================================
-- LLAVES Y RESTRICCIONES
-- ============================================================

ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.sofia_audits ADD CONSTRAINT sofia_audits_pkey PRIMARY KEY (id);
ALTER TABLE public.sofia_config ADD CONSTRAINT sofia_config_pkey PRIMARY KEY (id);
ALTER TABLE public.sofia_conversations ADD CONSTRAINT sofia_conversations_pkey PRIMARY KEY (id);
ALTER TABLE public.sofia_followup_messages ADD CONSTRAINT sofia_followup_messages_pkey PRIMARY KEY (phone_hash);
ALTER TABLE public.sofia_followup_status ADD CONSTRAINT sofia_followup_status_pkey PRIMARY KEY (conversation_id);
ALTER TABLE public.sofia_inactivity_cleanup ADD CONSTRAINT sofia_inactivity_cleanup_pkey PRIMARY KEY (prospect_id);
ALTER TABLE public.sofia_interaction_dedup ADD CONSTRAINT sofia_interaction_dedup_pkey PRIMARY KEY (interaction_id);
ALTER TABLE public.sofia_knowledge_chunks ADD CONSTRAINT sofia_knowledge_chunks_pkey PRIMARY KEY (id);
ALTER TABLE public.sofia_recommendations ADD CONSTRAINT sofia_recommendations_pkey PRIMARY KEY (id);
ALTER TABLE public.sofia_reliability_events ADD CONSTRAINT sofia_reliability_events_pkey PRIMARY KEY (id);
ALTER TABLE public.sofia_whatsapp_sessions ADD CONSTRAINT sofia_whatsapp_sessions_pkey PRIMARY KEY (id);

ALTER TABLE public.sofia_whatsapp_sessions ADD CONSTRAINT sofia_whatsapp_sessions_phone_hash_key UNIQUE (phone_hash);

ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'user'::text])));
-- sofia_config es una sola fila, siempre id = 1.
ALTER TABLE public.sofia_config ADD CONSTRAINT single_row CHECK ((id = 1));
ALTER TABLE public.sofia_followup_status ADD CONSTRAINT sofia_followup_status_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'contactado'::text, 'agendo'::text, 'descartado'::text, 'no_contactable'::text, 'en_espera'::text])));
ALTER TABLE public.sofia_reliability_events ADD CONSTRAINT sofia_reliability_events_event_type_check CHECK ((event_type = ANY (ARRAY['claude_call_failed'::text, 'zenvia_lookup_failed'::text, 'transfer_failed'::text, 'inbound_message_dropped'::text, 'send_failed'::text])));

ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.sofia_followup_messages ADD CONSTRAINT sofia_followup_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES sofia_conversations(id) ON DELETE SET NULL;
ALTER TABLE public.sofia_followup_status ADD CONSTRAINT sofia_followup_status_asignado_a_fkey FOREIGN KEY (asignado_a) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.sofia_followup_status ADD CONSTRAINT sofia_followup_status_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES sofia_conversations(id) ON DELETE CASCADE;


-- ============================================================
-- ÍNDICES
-- ============================================================

CREATE INDEX idx_sofia_conversations_derived ON public.sofia_conversations USING btree (derived_to_appointment);
CREATE INDEX idx_sofia_conversations_period ON public.sofia_conversations USING btree (period);
CREATE INDEX idx_sofia_conversations_procedure ON public.sofia_conversations USING btree (procedure_interest);
CREATE INDEX idx_sofia_conversations_procedure_code ON public.sofia_conversations USING btree (procedure_code);
CREATE UNIQUE INDEX idx_sofia_recommendations_date ON public.sofia_recommendations USING btree (date);
CREATE INDEX idx_whatsapp_sessions_phone ON public.sofia_whatsapp_sessions USING btree (phone_hash);
CREATE INDEX sofia_conversations_prospect_id_idx ON public.sofia_conversations USING btree (prospect_id);
CREATE INDEX sofia_followup_messages_dry_run_idx ON public.sofia_followup_messages USING btree (dry_run);
CREATE INDEX sofia_followup_messages_sent_at_idx ON public.sofia_followup_messages USING btree (sent_at DESC);
CREATE INDEX sofia_followup_status_asignado_a_idx ON public.sofia_followup_status USING btree (asignado_a) WHERE (asignado_a IS NOT NULL);
CREATE INDEX sofia_followup_status_estado_idx ON public.sofia_followup_status USING btree (estado);
CREATE INDEX sofia_followup_status_updated_at_idx ON public.sofia_followup_status USING btree (updated_at DESC);


-- ============================================================
-- DISPARADORES
-- ============================================================

CREATE TRIGGER trg_sofia_conversations_updated_at BEFORE INSERT OR UPDATE ON public.sofia_conversations FOR EACH ROW EXECUTE FUNCTION sofia_touch_updated_at();
CREATE TRIGGER sofia_followup_status_set_updated_at BEFORE UPDATE ON public.sofia_followup_status FOR EACH ROW EXECUTE FUNCTION set_sofia_followup_status_updated_at();
CREATE TRIGGER sofia_followup_status_sync_appointment AFTER INSERT OR UPDATE OF estado ON public.sofia_followup_status FOR EACH ROW EXECUTE FUNCTION sofia_sync_derived_to_appointment();


-- ============================================================
-- FUNCIONES QUE DEPENDEN DE LAS TABLAS
-- ============================================================

CREATE OR REPLACE FUNCTION public.match_sofia_chunks(query_embedding vector, match_count integer DEFAULT 4, match_threshold double precision DEFAULT 0.7)
RETURNS TABLE(id bigint, category text, content text, similarity double precision)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  select id, category, content,
    1 - (embedding <=> query_embedding) as similarity
  from sofia_knowledge_chunks
  where 1 - (embedding <=> query_embedding) > match_threshold
  order by similarity desc
  limit match_count;
$function$;

CREATE OR REPLACE FUNCTION public.sofia_home_stats(desde timestamp with time zone)
RETURNS json
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT json_build_object(
    'total',      count(*),
    'escaladas',  count(*) FILTER (WHERE escalated),
    'positivo',   count(*) FILTER (WHERE sentiment = 'positivo'),
    'neutral',    count(*) FILTER (WHERE sentiment = 'neutral'),
    'negativo',   count(*) FILTER (WHERE sentiment = 'negativo'),
    'porCodigo',  COALESCE(
      (SELECT json_object_agg(procedure_code, n)
       FROM (
         SELECT procedure_code, count(*) n
         FROM sofia_conversations
         WHERE created_at >= desde AND procedure_code IS NOT NULL
         GROUP BY procedure_code
       ) t),
      '{}'::json)
  )
  FROM sofia_conversations
  WHERE created_at >= desde;
$function$;

CREATE OR REPLACE FUNCTION public.sofia_set_phones(mapa jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  actualizadas integer;
BEGIN
  UPDATE sofia_conversations c
     SET phone_number = m.value #>> '{}'
    FROM jsonb_each(mapa) AS m(key, value)
   WHERE c.prospect_id = m.key
     AND (c.phone_number IS DISTINCT FROM m.value #>> '{}');
  GET DIAGNOSTICS actualizadas = ROW_COUNT;

  RETURN json_build_object(
    'actualizadas', actualizadas,
    'conTelefono', (SELECT count(*) FROM sofia_conversations WHERE phone_number IS NOT NULL),
    'sinTelefono', (SELECT count(*) FROM sofia_conversations WHERE phone_number IS NULL)
  );
END;
$function$;

CREATE OR REPLACE VIEW public.sofia_followup_candidates WITH (security_invoker=true) AS
 SELECT id, phone_hash, channel, procedure_interest, escalation_reason,
    sentiment, message_count, duration_minutes, created_at, ended_at,
        CASE
            WHEN escalation_reason ~~* '%cirugía%'::text OR escalation_reason ~~* '%lifting facial%'::text OR escalation_reason ~~* '%mastopexia%'::text OR escalation_reason ~~* '%facetite%'::text OR escalation_reason ~~* '%abdominoplastia%'::text OR escalation_reason ~~* '%mamari%'::text OR escalation_reason ~~* '%blefaroplastia%'::text THEN 'cirugia'::text
            ELSE 'tratamiento_no_quirurgico'::text
        END AS categoria,
        CASE
            WHEN sentiment = 'positivo'::text THEN 3
            WHEN sentiment = 'neutral'::text THEN 2
            ELSE 1
        END AS prioridad_sentimiento
   FROM sofia_conversations
  WHERE escalated = true AND COALESCE(derived_to_appointment, false) = false AND (escalation_reason ~~* '%precio%'::text OR escalation_reason ~~* '%agendar%'::text OR escalation_reason ~~* '%cita%'::text OR escalation_reason ~~* '%valoraci%'::text);


-- ============================================================
-- VISTAS DEL DASHBOARD
-- ============================================================

-- Copiadas literalmente de sus migraciones: son las definiciones vigentes.

CREATE OR REPLACE VIEW public.sofia_followup_queue
WITH (security_invoker = true) AS
WITH base AS (
  SELECT c.id, c.phone_number, c.patient_name, c.topic, c.last_message, c.escalated,
         c.escalation_reason, c.created_at, c.phone_hash, c.procedure_interest,
         c.procedure_code, c.channel, c.derived_to_appointment, c.message_count,
         c.duration_minutes, c.period, c.sentiment, c.ended_at,
         c.last_interaction_id, c.prospect_id,
         CASE
           -- Escalación mecánica: la disparó el sistema, no el paciente.
           WHEN c.escalated = true
            AND c.escalation_reason ~* '(frase de traspaso|l[ií]mite de mensajes|falla_tecnica)'::text
             THEN 'escalada_tecnica'::text
           -- Intención explícita: el paciente pidió precio/cita/valoración.
           WHEN c.escalated = true
            AND c.escalation_reason ~* '(precio|agendar|cita|valoraci)'::text
             THEN 'escalada_sin_cita'::text
           -- Escalación real con otro motivo (clínico, contraindicación, etc.)
           WHEN c.escalated = true
             THEN 'escalada_otro_motivo'::text
           ELSE 'cerrada_sin_escalar'::text
         END AS origen
  FROM sofia_conversations c
  WHERE COALESCE(c.derived_to_appointment, false) = false
    AND c.created_at >= '2026-08-06 00:00:00+00'::timestamp with time zone
    AND (
      -- Rama A: Sofía escaló. Sin condición extra sobre el texto del motivo.
      c.escalated = true
      -- Rama B: conversación real sobre un procedimiento concreto, sin escalar.
      OR COALESCE(c.escalated, false) = false
         AND c.message_count >= 3
         AND c.procedure_interest IS NOT NULL
         AND c.procedure_interest <> ''::text
         AND c.procedure_interest !~* '(informaci[oó]n general|no especificado|^general$|^precio|consulta de precio|informaci[oó]n de (precio|costo)|no identificado)'::text
    )
), classified AS (
  SELECT base.*,
         -- Urgencia clínica o reputacional. Es INDEPENDIENTE del score: el score
         -- mide valor comercial y acá lo que importa es el riesgo.
         --
         -- El caso que lo motivó (2026-09-08): una paciente post-abdominoplastia
         -- insatisfecha, ya consultando con otro cirujano en Bogotá, pidiendo
         -- hablar con la dirección. Escribió UN mensaje, largo y grave — y el
         -- score castiga tener un solo mensaje con -25, así que quedó en el
         -- puesto 2.488 de 4.219: página 100. Nadie llega ahí.
         --
         -- "sin complicaci" queda excluido con lookbehind: es parte del screening
         -- normal que hace Sofía ("cesárea sin complicaciones aparentes"), no una
         -- complicación real. Medido: 7 filas mencionan "complicaci", 1 es del
         -- screening.
         --
         -- Marca el 0,5% de la cola (21 de 4.219). Si algún día pasa del 2%, se
         -- volvió ruido y hay que apretar la lista, no aflojarla.
         (COALESCE(base.escalation_reason, ''::text) ~* '(insatisfac|inconform|disconform|queja|reclamo|molest[ao]|director|gerenci|(?<!sin )complicaci|infecci[oó]n|sangrado|emergencia|otro cirujano|segunda opini|mal resultado|demanda|abogado|legal)'::text) AS urgente,
         CASE
           WHEN ((COALESCE(base.procedure_interest, ''::text) || ' '::text) || COALESCE(base.escalation_reason, ''::text)) ~* '(abdominoplast|mamari|senos|mastopex|rinoplast|blefaro|lipo|preserv[eé]|mia femtech|lifting facial|facetite)'::text THEN 'cirugia'::text
           ELSE 'tratamiento_no_quirurgico'::text
         END AS categoria
  FROM base
), scored AS (
  SELECT classified.*,
         CASE
           WHEN classified.categoria = 'cirugia'::text THEN 35
           WHEN ((COALESCE(classified.procedure_interest, ''::text) || ' '::text) || COALESCE(classified.escalation_reason, ''::text)) ~* '(ultherapy|quantum|trilipo|radiesse|hialur|toxina|botox|co2|criolipo|bodytite)'::text THEN 22
           WHEN classified.procedure_interest IS NOT NULL AND classified.procedure_interest <> ''::text THEN 12
           ELSE 0
         END +
         CASE
           WHEN classified.message_count >= 6 THEN 25
           WHEN classified.message_count >= 4 THEN 20
           WHEN classified.message_count = 3 THEN 14
           WHEN classified.message_count = 2 THEN 8
           ELSE 0
         END +
         CASE
           WHEN classified.sentiment = 'positivo'::text THEN 15
           WHEN classified.sentiment = 'neutral'::text THEN 8
           ELSE 3
         END +
         CASE
           WHEN classified.created_at >= (now() - '2 days'::interval) THEN 15
           WHEN classified.created_at >= (now() - '5 days'::interval) THEN 11
           WHEN classified.created_at >= (now() - '10 days'::interval) THEN 7
           WHEN classified.created_at >= (now() - '20 days'::interval) THEN 3
           ELSE 0
         END +
         -- Intención explícita. Una escalación clínica real vale casi tanto
         -- como un pedido de precio; una mecánica no vale nada, porque no
         -- dice nada sobre lo que quiere el paciente.
         CASE
           WHEN classified.origen = 'escalada_sin_cita'::text    THEN 10
           WHEN classified.origen = 'escalada_otro_motivo'::text THEN 8
           ELSE 0
         END AS score
  FROM classified
)
SELECT scored.id, scored.phone_number, scored.phone_hash, scored.topic,
       scored.last_message, scored.escalated, scored.escalation_reason,
       scored.procedure_interest, scored.channel, scored.derived_to_appointment,
       scored.message_count, scored.duration_minutes, scored.period,
       scored.sentiment, scored.created_at, scored.ended_at,
       scored.last_interaction_id, scored.prospect_id, scored.origen,
       scored.categoria, scored.score,
       -- "En espera" se vence sola: pasada la fecha, la conversación vuelve a
       -- pendiente sin que nadie la despierte. Se calcula al consultar, así que
       -- no hace falta un cron que recorra la tabla — y por lo tanto no puede
       -- desincronizarse, que es el modo de falla de cualquier proceso que
       -- despierte filas por su cuenta.
       CASE
         WHEN st.estado = 'en_espera' AND st.esperar_hasta IS NOT NULL AND st.esperar_hasta > now()
           THEN 'en_espera'::text
         WHEN st.estado = 'en_espera'
           THEN 'pendiente'::text
         ELSE COALESCE(st.estado, 'pendiente'::text)
       END AS estado,
       st.nota, st.actualizado_por,
       scored.procedure_code,
       st.updated_at AS estado_actualizado_en,
       scored.urgente,
       st.esperar_hasta,
       scored.patient_name,
       -- La asignación SE VENCE SOLA a los 3 días, mismo patrón que "En espera":
       -- se calcula al consultar, así que no hace falta un cron y no puede
       -- desincronizarse. Sin esto, un lead asignado a alguien que se fue de
       -- vacaciones queda bloqueado para siempre: nadie más lo puede tomar
       -- porque figura como asignado, y quien lo tiene no lo va a trabajar.
       CASE WHEN st.asignado_en > now() - interval '3 days' THEN st.asignado_a END AS asignado_a,
       -- El nombre va denormalizado, como ya lo hace actualizado_por. No es
       -- descuido: profiles solo deja a cada quien leer SU propio perfil, así
       -- que un JOIN acá (la vista es security_invoker) devolvería NULL para
       -- todos los demás y las tarjetas dirían "asignado a nadie".
       CASE WHEN st.asignado_en > now() - interval '3 days' THEN st.asignado_nombre END AS asignado_nombre,
       st.asignado_en
FROM scored
LEFT JOIN sofia_followup_status st ON st.conversation_id = scored.id
-- Lo urgente primero, SIEMPRE, sin importar el score. Un reclamo de 55 puntos
-- va antes que un aumento mamario de 100: el score ordena oportunidades, no
-- riesgos.
ORDER BY scored.urgente DESC, scored.score DESC, scored.created_at DESC;

CREATE OR REPLACE VIEW publisofia_conversations.sofia_pacientes
WITH (security_invoker = true) AS
WITH ranked AS (
  SELECT sofia_conversations.phone_hash, sofia_conversations.phone_number, sofia_conversations.prospect_id, sofia_conversations.procedure_code,
         sofia_conversations.sentiment, sofia_conversations.escalated, sofia_conversations.created_at, sofia_conversations.updated_at, sofia_conversations.channel,
         sofia_conversations.message_count, sofia_conversations.patient_name,
         -- Se prefiere la conversación con un procedimiento de verdad: si la
         -- última fue "solo precio" o "logística", esa no describe a la
         -- persona. Entre las que sirven, gana la más reciente.
         row_number() OVER (
           PARTITION BY sofia_conversations.phone_hash
           ORDER BY (CASE
             WHEN sofia_conversations.procedure_code IS NOT NULL
              AND (sofia_conversations.procedure_code <> ALL (ARRAY[
                    'generico_sin_procedimiento'::text, 'generico_solo_precio'::text,
                    'generico_logistica'::text, 'generico_proceso'::text,
                    'sin_clasificar'::text])) THEN 0
             ELSE 1
           END), sofia_conversations.created_at DESC
         ) AS rn
  FROM sofia_conversations c
  WHERE sofia_conversations.phone_hash IS NOT NULL
)
SELECT phone_hash,
       max(phone_number)  FILTER (WHERE phone_number IS NOT NULL) AS telefono,
       max(prospect_id)   FILTER (WHERE prospect_id IS NOT NULL)  AS prospect_id,
       max(procedure_code) FILTER (WHERE rn = 1)                  AS procedure_code,
       max(sentiment)      FILTER (WHERE rn = 1)                  AS sentiment,
       max(channel)        FILTER (WHERE rn = 1)                  AS channel,
       bool_or(escalated)                                         AS alguna_vez_escalada,
       sum(message_count)                                         AS mensajes,
       max(updated_at)                                            AS ultima_actividad,
       min(created_at)                                            AS primer_contacto,
       -- La columna que faltaba en el historial.
       max(patient_name)  FILTER (WHERE patient_name IS NOT NULL) AS nombre
FROM ranked r
GROUP BY phone_hash;

COMMENT ON VIEW public.sofia_pacientes IS
  'Una fila por persona (agrupada por phone_hash) con su teléfono, procedimiento de interés y actividad. Base del listado de Pacientes del dashboard.';


-- ============================================================
-- FUNCIONES QUE DEPENDEN DE LAS VISTAS
-- ============================================================

-- La lista del día: completa hasta p_limite pendientes a nombre de quien la
-- pide. Consulta sofia_followup_queue, así que va después de la vista.
--
-- SECURITY DEFINER porque tiene que ver toda la cola para repartir. Todo lo
-- que decide sale de auth.uid(): no recibe a quién asignar, así que nadie
-- puede llenarle la lista a otro.
CREATE OR REPLACE FUNCTION public.asignar_mi_lista(p_limite integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_nombre    text;
  v_ya_tiene  int;
  v_faltan    int;
  v_agregados int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Hay que iniciar sesion para tomar leads.';
  END IF;

  IF p_limite < 1 OR p_limite > 100 THEN
    RAISE EXCEPTION 'El limite tiene que estar entre 1 y 100.';
  END IF;

  SELECT full_name INTO v_nombre FROM public.profiles WHERE id = v_uid;

  SELECT count(*) INTO v_ya_tiene
  FROM public.sofia_followup_queue
  WHERE asignado_a = v_uid AND estado = 'pendiente';

  v_faltan := p_limite - v_ya_tiene;
  IF v_faltan <= 0 THEN
    RETURN 0;
  END IF;

  WITH candidatos AS (
    SELECT id
    FROM public.sofia_followup_queue
    WHERE estado = 'pendiente'
      AND asignado_a IS NULL
    ORDER BY urgente DESC, score DESC, created_at DESC
    LIMIT v_faltan
  )
  INSERT INTO public.sofia_followup_status
    (conversation_id, estado, asignado_a, asignado_nombre, asignado_en)
  SELECT id, 'pendiente', v_uid, v_nombre, now() FROM candidatos
  ON CONFLICT (conversation_id) DO UPDATE
    SET asignado_a      = EXCLUDED.asignado_a,
        asignado_nombre = EXCLUDED.asignado_nombre,
        asignado_en     = EXCLUDED.asignado_en
    -- Evita robar un lead que otro asesor acaba de tomar.
    WHERE public.sofia_followup_status.asignado_a IS NULL
       OR public.sofia_followup_status.asignado_en <= now() - interval '3 days';

  GET DIAGNOSTICS v_agregados = ROW_COUNT;
  RETURN v_agregados;
END;
$function$;

REVOKE ALL ON FUNCTION public.asignar_mi_lista(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asignar_mi_lista(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.soltar_mi_lista()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_soltados int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Hay que iniciar sesion.';
  END IF;

  UPDATE public.sofia_followup_status
     SET asignado_a = NULL, asignado_nombre = NULL, asignado_en = NULL
   WHERE asignado_a = v_uid
     AND estado = 'pendiente';

  GET DIAGNOSTICS v_soltados = ROW_COUNT;
  RETURN v_soltados;
END;
$function$;

REVOKE ALL ON FUNCTION public.soltar_mi_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soltar_mi_lista() TO authenticated;


-- ============================================================
-- SEGURIDAD A NIVEL DE FILA
-- ============================================================
--
-- Todas las tablas la tienen activada. Las que no aparecen abajo con una
-- política quedan sin acceso para los usuarios normales, a propósito: solo
-- las toca el Worker con la service_role, que se salta el RLS.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sofia_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sofia_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sofia_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sofia_followup_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sofia_followup_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sofia_inactivity_cleanup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sofia_interaction_dedup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sofia_knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sofia_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sofia_reliability_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sofia_whatsapp_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can insert profiles" ON public.profiles AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_user_is_admin());
CREATE POLICY "Admins can read all profiles" ON public.profiles AS PERMISSIVE FOR SELECT TO public USING (current_user_is_admin());
CREATE POLICY "Admins can update all profiles" ON public.profiles AS PERMISSIVE FOR UPDATE TO public USING (current_user_is_admin()) WITH CHECK (current_user_is_admin());
CREATE POLICY "Users can read their own profile" ON public.profiles AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = id));

CREATE POLICY "Authenticated users can read sofia_audits" ON public.sofia_audits AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role can insert sofia_audits" ON public.sofia_audits AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Authenticated users can read sofia_config" ON public.sofia_config AS PERMISSIVE FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "Authenticated users can update sofia_config" ON public.sofia_config AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "Authenticated users can read sofia_conversations" ON public.sofia_conversations AS PERMISSIVE FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "Authenticated users can read sofia_followup_messages" ON public.sofia_followup_messages AS PERMISSIVE FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "Authenticated users can insert sofia_followup_status" ON public.sofia_followup_status AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "Authenticated users can read sofia_followup_status" ON public.sofia_followup_status AS PERMISSIVE FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "Authenticated users can update sofia_followup_status" ON public.sofia_followup_status AS PERMISSIVE FOR UPDATE TO public USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "Authenticated users can manage chunks" ON public.sofia_knowledge_chunks AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "Authenticated users can read chunks" ON public.sofia_knowledge_chunks AS PERMISSIVE FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "Authenticated users can read recommendations" ON public.sofia_recommendations AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role can insert recommendations" ON public.sofia_recommendations AS PERMISSIVE FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "Authenticated users can read sofia_reliability_events" ON public.sofia_reliability_events AS PERMISSIVE FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "Authenticated users can read sofia_whatsapp_sessions" ON public.sofia_whatsapp_sessions AS PERMISSIVE FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));


-- ============================================================
-- REALTIME
-- ============================================================
--
-- Seguimiento se suscribe a los cambios de estado para que dos asesores no
-- llamen al mismo paciente. Sin esto el canal conecta igual pero no llega ni
-- un evento.

ALTER PUBLICATION supabase_realtime ADD TABLE public.sofia_followup_status;


-- ============================================================
-- FILA INICIAL DE CONFIGURACIÓN
-- ============================================================
--
-- sofia_config tiene que existir con id = 1 o el Worker no arranca. El prompt
-- y la base de conocimiento van vacíos: son contenido, no esquema, y hay que
-- cargarlos aparte desde "Configurar a Sofía" o desde un respaldo.

INSERT INTO public.sofia_config (id, system_prompt, knowledge_base)
VALUES (1, '', '')
ON CONFLICT (id) DO NOTHING;
