# Migraciones

## Qué son estos archivos — y qué NO son

Son un **registro escrito a mano** del SQL que se aplicó a Supabase. Sirven
para leer, revisar en un diff y volver a aplicar si hiciera falta.

**No se aplican solos.** Este proyecto **no tiene el CLI de Supabase
configurado** (no hay `supabase/config.toml`) ni CI que los ejecute. Guardar un
archivo acá no cambia nada en la base; aplicar algo en la base no crea un
archivo acá. Son dos pasos separados y hay que hacer los dos.

## La fuente de verdad es Supabase, no esta carpeta

Supabase lleva su propio historial de migraciones — al 2026-08-27 tiene **49
registradas**, y acá hay 9. Las 40 que faltan son sobre todo cambios al prompt
y a la base de conocimiento de Sofía, aplicados directo.

Para ver el historial real:

```
list_migrations (MCP de Supabase)  →  proyecto wuradlaomyoxkiagqvyi
```

**No asumir que esta carpeta refleja el estado de la base.** Si necesitás saber
qué hay realmente, consultá la base.

## `schema.sql` está desactualizado

El `supabase/schema.sql` de la raíz **no incluye** ninguna de las migraciones
de agosto de 2026. Recrear la base desde ese archivo deja el dashboard roto:
faltarían `procedure_code`, `sofia_pacientes`, `sofia_home_stats` y más.

## Al agregar una migración nueva

1. Aplicala a Supabase (MCP `apply_migration` o el panel).
2. Guardá el SQL acá, con el nombre `<version>_<nombre>.sql` usando la versión
   real que reporta Supabase, para que los dos lados se puedan cruzar.
3. Si toca la taxonomía o una vista, revisá las trampas anotadas en el README
   principal — sobre todo que cambiar `sofia_procedure_code()` **no recalcula**
   la columna generada, y que agregar una columna a una tabla **no la agrega a
   sus vistas**.
