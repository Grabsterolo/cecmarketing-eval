-- Paso 2 de 2 del renombrado de Pacientes a Contactos.
-- Ver 20260909031500_contactos_agregar_clave_nueva.sql para el porqué de los
-- dos pasos.
--
-- Se aplicó DESPUÉS de confirmar que el front nuevo estaba en producción —
-- buscando "Sin contactos para estos filtros" dentro del paquete que sirve
-- Cloudflare Pages, no confiando en que el despliegue ya hubiera terminado.
--
-- A partir de acá 'pacientes' no corresponde a ningún item de NAV_ITEMS.
-- Dejarla sería basura invisible y permanente: la lista de módulos de
-- Configuración se arma desde NAV_ITEMS, así que ningún admin vería la casilla
-- para desmarcarla. Es exactamente lo que pasó con 'leads-calientes'.

UPDATE public.profiles
SET allowed_modules = array_remove(allowed_modules, 'pacientes')
WHERE allowed_modules IS NOT NULL
  AND 'pacientes' = ANY(allowed_modules);
