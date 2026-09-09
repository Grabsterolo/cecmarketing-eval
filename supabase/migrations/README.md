# Migraciones

## Qué son estos archivos

Un **registro escrito a mano** del SQL que se aplicó a Supabase: para leer,
revisar en un diff y volver a aplicar si hiciera falta.

**No se aplican solos.** Este proyecto no tiene el CLI de Supabase configurado
(no hay `supabase/config.toml`) ni CI que los ejecute. Guardar un archivo acá no
cambia nada en la base; aplicar algo en la base no crea un archivo acá. Son dos
pasos separados y hay que hacer los dos.

## El nombre del archivo tiene que ser la versión real

`<version>_<nombre>.sql`, con **la versión y el nombre exactos que reporta
Supabase** — no una fecha inventada. Es lo único que permite cruzar los dos
lados.

Hasta el 2026-09-09 esto no se cumplía: había once archivos con fechas
elegidas a mano que no correspondían a ninguna versión aplicada. Ya están
renombrados.

## Cómo comprobar que los dos lados coinciden

```sql
-- Migraciones aplicadas que NO tienen archivo en el repo.
-- Comparar contra: ls supabase/migrations/*.sql
select version, name
from supabase_migrations.schema_migrations
order by version;
```

Supabase guarda el SQL completo de cada migración aplicada en
`supabase_migrations.schema_migrations.statements`. Si un archivo se pierde, se
recupera desde ahí — así se recuperaron siete de los que faltaban.

Para saber si una vista o función que corre hoy está bien registrada, comparar
la definición viva contra la última migración que la define:

```sql
select pg_get_viewdef('public.sofia_pacientes'::regclass, true);
```

## Lo que falta a propósito

**Las ~30 migraciones de contenido de Sofía** (prompt y base de conocimiento,
sobre todo del 17 y 18 de agosto) no tienen archivo. Son texto, no estructura, y
la fuente de verdad de ese texto es `sofia_config` en la base — un archivo acá
sería una copia que envejece. Están en el historial de Supabase si se necesitan.

## Dos archivos que son solo documentación

`20260908120000_seguimiento_urgencia.sql` y
`20260908140000_queue_expone_patient_name.sql` describen cambios que **sí están
en producción pero se aplicaron sueltos**, con un `execute_sql` directo, y nunca
quedaron registrados. Sus nombres no corresponden a ninguna versión aplicada.

No hay que hacer nada con ellos: la definición vigente de la vista quedó
capturada entera en `20260909012621_seguimiento_lista_del_dia.sql`, así que
reproducir el historial en orden da el resultado correcto. Llevan una nota en la
cabecera.

**La lección:** aplicar con `execute_sql` en vez de `apply_migration` deja el
cambio sin registro. El 2026-09-09 eso ya había roto una cosa concreta —
`sofia_pacientes` corría con la columna `nombre` que ninguna migración
registrada creaba, así que recrear la base dejaba la sección Pacientes sin
nombres y sin ningún error que lo explicara. Se arregló con
`20260909015506_sofia_pacientes_al_dia.sql`.

## `schema.sql` está desactualizado

El `supabase/schema.sql` de la raíz **no incluye** ninguna de las migraciones de
agosto ni de septiembre de 2026. Recrear la base desde ese archivo deja el
dashboard roto: faltarían `procedure_code`, `sofia_pacientes`,
`sofia_home_stats`, la asignación de la lista del día y más.

Para recrear la base, reproducir las migraciones en orden de versión.

## Al agregar una migración nueva

1. Aplicarla con `apply_migration` (MCP de Supabase) o el panel — **nunca con
   `execute_sql`**, que no deja registro.
2. Guardar el SQL acá con el nombre `<version>_<nombre>.sql` usando la versión
   real que devolvió Supabase.
3. Si toca una vista, incluir la **definición completa**, no solo el cambio. Una
   vista no se parchea: se reemplaza entera, y quien reproduzca el historial
   necesita el texto completo.
4. Si toca la taxonomía o una vista, revisar las trampas del README principal —
   sobre todo que cambiar `sofia_procedure_code()` **no recalcula** la columna
   generada, y que agregar una columna a una tabla **no la agrega a sus vistas**.
