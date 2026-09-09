-- Paso 1 de 2 del renombrado de Pacientes a Contactos.
--
-- POR QUÉ EN DOS PASOS
--
-- La clave del módulo se guarda en profiles.allowed_modules, y
-- getVisibleNavItems() cruza esa lista contra NAV_ITEMS. Si se cambia de golpe
-- hay una ventana —entre aplicar la migración y que Cloudflare Pages termine
-- de desplegar— en la que una de las dos partes busca una clave que la otra ya
-- no tiene, y cinco asesores se quedan sin la sección.
--
-- Este paso AGREGA 'contactos' sin quitar 'pacientes'. Con las dos claves
-- conviviendo no hay ventana en ningún orden: el front viejo encuentra
-- 'pacientes', el nuevo encuentra 'contactos'.
--
-- El paso 2 (20260909033000) quita 'pacientes' una vez que el front nuevo está
-- en producción.

UPDATE public.profiles
SET allowed_modules = array_append(allowed_modules, 'contactos')
WHERE allowed_modules IS NOT NULL
  AND 'pacientes' = ANY(allowed_modules)
  AND NOT ('contactos' = ANY(allowed_modules));
