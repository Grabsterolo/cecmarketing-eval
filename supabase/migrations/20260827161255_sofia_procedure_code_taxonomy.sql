-- Normaliza procedure_interest (texto libre, 2.470 valores distintos sobre
-- ~9.000 conversaciones) a una taxonomía cerrada de 42 códigos derivada de las
-- conversaciones reales. Cobertura medida: 96,4%.
--
-- NO reemplaza el criterio de Claude: Claude lee la conversación y escribe
-- procedure_interest; esto solo agrupa esa salida de forma consistente y
-- auditable.
--
-- El orden de los WHEN es significativo: lo específico va antes que lo
-- genérico, para que "aumento mamario Preservé" caiga en Preservé y no en
-- aumento tradicional.
--
-- Independiente de las etiquetas de Zenvia a propósito: esa lista mezcla
-- procedimiento, temperatura del lead y doctor, obliga a elegir una sola, y se
-- han observado etiquetas mal puestas.
--
-- OJO: cambiar esta función NO recalcula las filas existentes. Para eso hay que
-- borrar y recrear la columna generada del final.
CREATE OR REPLACE FUNCTION public.sofia_procedure_code(procedure_interest text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
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

COMMENT ON FUNCTION public.sofia_procedure_code(text) IS
  'Normaliza procedure_interest (texto libre) a una taxonomía cerrada de 42 códigos derivada de las conversaciones reales. Cobertura medida: 96,4%. El orden de los WHEN es significativo.';

-- Columna generada: se calcula sola en cada insert/update y se rellena de
-- inmediato para las filas existentes. Por eso el Worker no necesitó cambios.
ALTER TABLE public.sofia_conversations
  ADD COLUMN IF NOT EXISTS procedure_code text
  GENERATED ALWAYS AS (public.sofia_procedure_code(procedure_interest)) STORED;

CREATE INDEX IF NOT EXISTS idx_sofia_conversations_procedure_code
  ON public.sofia_conversations (procedure_code);
