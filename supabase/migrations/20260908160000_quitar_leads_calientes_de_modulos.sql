-- Limpia 'leads-calientes' de profiles.allowed_modules.
--
-- La sección Leads Potenciales se eliminó: el 99,8% de lo que mostraba (3.281
-- de 3.286 conversaciones) ya estaba en Seguimiento, que además guarda estado,
-- nota, quién trabajó cada lead y se actualiza en vivo. Leads Potenciales no
-- tenía nada de eso, así que dos asesores podían llamar al mismo paciente sin
-- enterarse.
--
-- Sin esta migración nada se rompe: getVisibleNavItems() cruza allowed_modules
-- contra NAV_ITEMS, y como el item ya no está en NAV_ITEMS, la cadena sobrante
-- simplemente no pinta nada. Pero queda invisible y para siempre: la sección
-- Configuración arma su lista de módulos desde NAV_ITEMS, así que un admin
-- nunca vería la casilla y por lo tanto no podría desmarcarla.
--
-- Al escribir esto: 5 de 6 perfiles lo tienen asignado.

UPDATE public.profiles
SET allowed_modules = array_remove(allowed_modules, 'leads-calientes')
WHERE allowed_modules IS NOT NULL
  AND 'leads-calientes' = ANY(allowed_modules);

-- allowed_modules IS NULL significa "todos los módulos" (ver getVisibleNavItems
-- en src/constants/nav.js) y no se toca: esos perfiles siguen viendo todo lo que
-- exista en el menú, que ahora es una sección menos.
