-- Escribe phone_number en sofia_conversations a partir de un mapa
-- { prospect_id: telefono } que arma el Worker consultando Zenvia
-- (POST /sync/phones).
--
-- Va como función y no como miles de PATCH individuales: un solo UPDATE contra
-- jsonb_each resuelve todo el lote en una llamada.
--
-- SECURITY DEFINER + sin GRANT a `authenticated`: solo el Worker (que usa la
-- service_role key) puede escribir teléfonos. Los usuarios del dashboard los
-- leen a través de la política de lectura que ya existe sobre la tabla, pero
-- no pueden modificarlos.
--
-- Contexto de privacidad: hasta el 2026-08-27 la tabla solo guardaba
-- phone_hash (SHA-256, irreversible). Guardar el número en claro fue una
-- decisión explícita del cliente para poder tener la sección Pacientes.
CREATE OR REPLACE FUNCTION public.sofia_set_phones(mapa jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

COMMENT ON FUNCTION public.sofia_set_phones(jsonb) IS
  'Rellena phone_number desde un mapa { prospect_id: telefono } que arma el Worker con datos de Zenvia. Solo service_role.';

REVOKE ALL ON FUNCTION public.sofia_set_phones(jsonb) FROM PUBLIC, anon, authenticated;
