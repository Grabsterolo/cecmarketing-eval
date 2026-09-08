# CEC Marketing Dashboard
<!-- test commit 2 -->

Portal interno de mercadeo del Centro Europeo de Cirugía (CEC). Mismo sistema de diseño que `ceccolaboradores` (login, sidebar, paleta de colores, tipografía), construido como proyecto separado para esta función.

## Stack

- React 18 + Vite
- Supabase (auth + base de datos)
- Recharts (gráficos)
- Mismo sistema de diseño que el portal de colaboradores: verde `#1F4A40`, dorado `#C9A24E`, crema `#FAFAF8`, Cormorant Garamond + Manrope

## Estructura

```
src/
  components/
    auth/LoginScreen.jsx        — pantalla de login, mismo diseño que ceccolaboradores
    layout/Sidebar.jsx          — navegación lateral (desktop + mobile drawer)
    Dashboard.jsx               — layout, <h1> con el nombre de la sección, y el router
    sections/                     (el orden es el del menú)
      DashboardHome.jsx         — Inicio: KPIs del mes + cruce campañas/conversaciones
      MetricsSection.jsx        — Métricas Meta (datos reales de Meta Ads)
      SofiaMetricsSection.jsx   — Métricas Sofía: volumen, escalación, temas, calidad
      RecommendationsSection.jsx— análisis por período que cruza Meta con Sofía
      LeadsCalientesSection.jsx — Leads Potenciales, ordenados por score
      SeguimientoSection.jsx    — cola de conversaciones abiertas sin venta
      PacientesSection.jsx      — base de pacientes: teléfono, interés, actividad
      SofiaAuditSection.jsx     — autoauditorías de Sofía
      ConfigureSofiaSection.jsx — editor del prompt y base de conocimiento
      TestSofiaSection.jsx      — Probar a Sofía
      BirthdaySection.jsx       — Cumpleaños
      ConfiguracionSection.jsx  — Configuración: solo admins. Crear usuarios,
                                  decidir rol y qué módulos ve cada quien
    ui/                         — Card, Badge, Button, EmptyState, ErrorBanner,
                                  FilterSelect, Logo, MetricKpi, PasswordInput,
                                  PendingIntegrationCard, SectionHeader
  constants/colors.js           — paleta, escala tipográfica y animaciones
  constants/nav.js              — items de navegación, DATA_SOURCES, y
                                  getVisibleNavItems() (filtra el menú por
                                  profiles.role/allowed_modules)
  constants/procedures.js       — taxonomía de procedimientos (nombres y familias)
  lib/supabase.js               — cliente de Supabase
functions/api/                  — Cloudflare Pages Functions (corren en el server,
                                  NO en `vite dev`; ver "Deploy" más abajo)
  meta-metrics.js               — proxy a Meta Ads (mes a la fecha, por campaña)
  daily-analysis.js             — genera el reporte de período con Claude
  conversion-stats.js           — proxy al Worker /stats/conversion (sin consumidor)
  admin-users.js                — crear/editar usuarios (Configuración). A
                                  diferencia de las demás, valida el JWT de
                                  quien llama contra profiles.role = 'admin'
                                  en vez del secreto compartido x-sofia-secret
                                  — crea credenciales reales de acceso
  chat.js, audit-sofia.js, cleanup-scan.js, reindex.js, send-birthday.js
supabase/schema.sql             — SQL base (NO incluye las migraciones recientes,
                                  ver supabase/migrations/README.md)
```

## Variables de entorno

Crear un archivo `.env.local` (no se sube al repo) con:

```
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=tu_clave_publica
```

Puede ser el mismo proyecto de Supabase que ya usas para CEC, o uno separado — recomendado: mismo proyecto, tablas nuevas (ver `supabase/schema.sql`), para no duplicar autenticación de usuarios.

## Deploy

Mismo flujo que tus otros proyectos: conectar este repo a Cloudflare Pages, configurar:

- **Build command:** `npm run build`
- **Build output directory:** `dist`
- Variables de entorno `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en la configuración del proyecto de Cloudflare.

## Roadmap (orden de construcción)

> **Las cuatro fases están terminadas.** Se dejan como registro de cómo se
> construyó. El estado real y actualizado está en la sección siguiente.

**Fase 1 — Frontend y editor de Sofía** *(hecho)*
Login, dashboard, sidebar y "Configurar a Sofía" contra Supabase.

**Fase 2 — Conversaciones de Sofía** *(hecho)*
`sofia_conversations` recibe datos del Worker desde el 2026-07-26. Al
2026-09-03 son **10.983** conversaciones reales, repartidas en Métricas
Sofía, Leads Potenciales, Seguimiento y Pacientes.

**Fase 3 — Conectar Meta y Google** *(hecho — Meta en vivo; Google se retiró)*
`MetricsSection.jsx` ("Métricas Meta" en el nav) corre con datos reales de Meta Ads, sin mock data (CPL, gráfico gasto vs leads, insight automático). Google Ads/Analytics se integró primero (commit `8da8f0b`) pero se quitó del dashboard por decisión de producto — "resultó poco práctico" (commit `2039363`), no por falta de acceso. `DATA_SOURCES` en `nav.js` solo lista `meta` y `sofia`, ambos `connected: true`.

**Fase 4 — Motor de recomendaciones** *(hecho)*
`RecommendationsSection.jsx` ya no es placeholder: muestra el análisis diario real de la tabla `sofia_recommendations`, generado por la función `daily-analysis`, que cruza el gasto/leads de Meta con los temas de conversación de Sofía (commit `2c6f093`, "cruzar Meta Ads con conversaciones de Sofía en el reporte diario").

## Estado del sistema — leer esto primero

Foto completa del sistema. Si abrís una sesión nueva, esto es lo que hay que
saber antes de tocar nada. Escrita el 2026-08-27; las cifras se reverificaron
contra la base el 2026-09-03.

### Auditorías (viven en `docs/`, no estaban enlazadas desde acá)

| Archivo | Qué cubre |
|---|---|
| `AUDITORIA_2026-08-30.html` | Veracidad de las métricas del dashboard. Ninguna cifra inventada, pero varias no medían lo que su etiqueta decía. Origen del hallazgo de `VITE_SOFIA_SECRET`. |
| `AUDITORIA_RAG_CACHING_2026-09-03.html` | Búsqueda semántica y prompt caching de Sofía, medidos contra el índice y el tráfico reales. |
| `DATA_AUDIT.md` | Rastreo de cada métrica hasta su origen. |

### Las tres piezas y cómo se despliega cada una

Esto causó dos errores reales el 2026-08-27, así que va primero:

| Pieza | Repo | Despliegue |
|---|---|---|
| Dashboard | `cecmarketing` | **Automático.** Cloudflare Pages publica en cada push a `main`. |
| Worker de Sofía | `cec-sofia-whatsapp` | **MANUAL.** `npx wrangler deploy` desde ese repo. **Un push NO lo despliega.** |
| Base de datos | Supabase (proyecto `wuradlaomyoxkiagqvyi`) | Las migraciones quedan vivas al aplicarse. |

**Nunca asumir que un cambio del Worker está en producción por haberlo
pusheado.** Para verificar qué versión corre, llamar a un endpoint suyo y ver
si trae los campos nuevos. El 2026-08-27 hubo dos commits que llevaban horas
subidos sin estar vivos, y se reportaron como desplegados.

Se puede automatizar conectando el repo del Worker en Cloudflare →
Settings → Builds. No se hizo: deja pasar a producción sin revisión, y ahí
corre la conversación real con pacientes.

### Migraciones

El SQL de las migraciones de agosto 2026 **ya está volcado** en
`supabase/migrations/` (ver el README de esa carpeta). Pero ojo con dos cosas:

- **No se aplican solas.** No hay CLI de Supabase configurado ni CI: son un
  registro para leer y revisar, no automatización. Aplicar y archivar son dos
  pasos separados.
- **`supabase/schema.sql` sigue desactualizado.** No incluye nada de esto, así
  que recrear la base desde ese archivo deja el dashboard roto.

La fuente de verdad es Supabase, que lleva 49 migraciones registradas contra
las 9 archivadas acá. Las que faltan son sobre todo cambios al prompt y a la
base de conocimiento de Sofía.

Las que importan para que el dashboard funcione:

| Migración | Qué hace |
|---|---|
| `sofia_recommendations_period_days` | Columna `period_days`: distingue reportes diarios (histórico) de los cortes de 5 días. |
| `sofia_procedure_code_taxonomy` | Función `sofia_procedure_code()` + columna generada `procedure_code`. **Es el corazón de la categorización.** |
| `followup_queue_expose_procedure_code_v2` | Recrea la vista `sofia_followup_queue` para exponer `procedure_code`. |
| `sofia_home_stats_rpc` | Función `sofia_home_stats()`: todas las cifras de Inicio en una llamada. |
| `sofia_set_phones_rpc` | Función `sofia_set_phones()`: escribe teléfonos. SECURITY DEFINER, solo service_role. |
| `sofia_conversations_updated_at` | Columna `updated_at` + trigger. |
| `sofia_pacientes_v2` | Vista `sofia_pacientes`, base de la sección Pacientes. |
| `seguimiento_realtime_y_actor` | Expone `estado_actualizado_en` en `sofia_followup_queue` y mete `sofia_followup_status` en la publicación `supabase_realtime`. Es lo que hace que Seguimiento se sincronice en vivo entre usuarios. |

**Hecho el 2026-08-27:** el SQL está en `supabase/migrations/`. Lo que sigue
pendiente es configurar el CLI o CI para que se apliquen solos.

### Seguridad — estado y lo que falta

Revisado con el linter de Supabase el 2026-08-27, después de empezar a guardar
teléfonos en claro. **Los dos hallazgos de nivel ERROR quedaron cerrados**
(migración `endurecer_seguridad`):

- `sofia_inactivity_cleanup` estaba **sin RLS y expuesta vía PostgREST** —
  cualquiera con la clave pública la leía y escribía entera. Ahora tiene RLS
  sin políticas: solo la alcanza el Worker con `SERVICE_ROLE_KEY`. El linter
  la reporta como INFO "RLS enabled, no policy" — **es el estado buscado**.
- `sofia_followup_candidates` (vista huérfana, la reemplazó
  `sofia_followup_queue`) tenía SECURITY DEFINER y se saltaba las RLS. Ahora
  es `security_invoker`.
- `search_path` fijo en `sofia_procedure_code`, `sofia_home_stats`,
  `sofia_touch_updated_at` y `match_sofia_chunks`.

**Lo que sigue abierto, y necesita a una persona:**

0. **`VITE_SOFIA_SECRET` viaja en el bundle público.** Seis funciones de
   `functions/api/` (`chat`, `send-birthday`, `reindex`, `daily-analysis`,
   `audit-sofia`, `cleanup-scan`) se protegen con el header
   `x-sofia-secret`, cuyo valor sale de `VITE_SOFIA_SECRET` — y **toda
   variable `VITE_*` se compila dentro del JavaScript que sirve el
   navegador.** No es un candado: es un valor público. Hallazgo de la
   auditoría del 2026-08-30 (sección L), que faltaba en esta lista.

   Cualquiera con el bundle puede disparar envíos reales de WhatsApp,
   reescribir los embeddings de la base de conocimiento, y consumir las
   cuentas de Anthropic y OpenAI del CEC.

   **Mitigado a medias el 2026-09-03:** `chat.js` ya no acepta un `system`
   ni un `knowledge_base` del cliente salvo que traiga el `access_token` de
   un usuario logueado, así que el endpoint dejó de ser un Claude de
   propósito general a costa del CEC. Lo que falta —y es lo que cierra la
   puerta— es migrar las seis funciones al patrón de token de sesión que ya
   usan `meta-metrics.js` y `admin-users.js`, poner Turnstile y un límite de
   tasa en el widget público (que no tiene usuario a quien autenticar), y
   **recién entonces** rotar `SOFIA_CHAT_SECRET`. Ese orden importa: rotar
   antes rompe los seis endpoints del dashboard de una vez.

1. **Rotar `STATS_TRIGGER_SECRET`.** El valor actual se manejó en texto plano
   y es débil. Es lo único que protege `GET /stats/prospect-phones`, un
   endpoint público que devuelve **miles de teléfonos de pacientes**. Rotarlo
   no rompe nada: `conversion-stats.js` no tiene consumidor. Valorar también
   si ese endpoint debe seguir existiendo — la extracción ya se hizo.
2. **Confirmar que el registro público esté deshabilitado** en Supabase Auth.
   La política de `sofia_conversations` es `auth.role() = 'authenticated'`:
   **no filtra por usuario ni por rol**, así que cualquier cuenta creada en
   ese proyecto vería todos los teléfonos.

   ⚠️ **El atenuante que decía esta sección caducó.** Hasta el 2026-08-27
   decía "hoy hay 2 usuarios y el último registro es de junio, así que en la
   práctica está contenido". Verificado contra la base el 2026-09-03: son
   **6 usuarios** y el último registro es del **2026-09-02**. Y ya no son
   3.374 teléfonos sino **5.277 distintos**, sobre 5.281 conversaciones que
   lo traen. La exposición creció y la razón por la que se consideraba
   contenida ya no aplica.
3. **Activar la protección de contraseñas filtradas** (WARN del linter).
4. **La definición legal** — Ley 8968 y las restricciones de Meta sobre datos
   de salud. Ya no es teórico: la base con los teléfonos existe.

### Cómo se clasifican las conversaciones

`procedure_interest` lo escribe Claude en **texto libre**: 2.470 valores
distintos sobre ~9.000 conversaciones, 1.842 de ellos apareciendo una sola
vez. No sirve para agrupar ni filtrar.

Por eso existe `procedure_code`, una **columna generada** que normaliza ese
texto a 42 códigos con la función `sofia_procedure_code()`. Cobertura
medida: **96,4%**. Al ser generada, el histórico se clasificó solo y las filas
nuevas se calculan sin que el Worker haga nada.

Los nombres legibles y las familias viven en `src/constants/procedures.js`.
**Si se ajustan las reglas hay que cambiar la función en Supabase Y recrear la
columna** — cambiar la función no recalcula las filas existentes.

Dos cosas deliberadas de esa taxonomía:
- **MIA, Preservé, aumento tradicional y mastopexia van separados.** No es
  cosmético: mastopexia escala al 51% y Preservé al 28%.
- **La regla de MIA usa `\ymia\y`** (límite de palabra). Sin eso captura
  bichectoMIA, mastectoMIA y lipectoMIA.

### Seguimiento proactivo de Sofía (desde el 2026-09-07)

Sofía le escribe **una vez, y para siempre**, a quien se calló ~2 h después de
hablar con ella. El código vive en el Worker `cec-sofia-whatsapp` (§ 2b de su
README, que tiene el detalle completo); acá va lo que toca a este repo.

**Se prende y se apaga desde el dashboard.** Configurar a Sofía tiene un toggle
"Seguimiento" debajo del de "Sofía al aire", sobre `sofia_config.followup_enabled`.
**Default false**: desplegar el Worker no debe empezar a mandarle mensajes a
nadie. Si Sofía está en pausa el toggle se deshabilita — un bot que no puede
responder tampoco debe poder escribir primero.

**Tabla nueva `sofia_followup_messages`**, un registro por persona. La PK es
`phone_hash` y no `conversation_id` a propósito: un paciente que vuelve no
genera fila nueva, y la regla que se quiere es un mensaje por PERSONA. Trae
`fallback_reason` (por qué un mensaje salió genérico) y `tokens_in/out` (costo
real, no estimado).

**Cómo se mide si sirve.** Cruzar `sofia_followup_messages` con
`derived_to_appointment` responde la única pregunta que importa: si el
seguimiento produce citas o solo respuestas. Para eso se conectó el write-back
(migración `20260907120000`) — antes esa columna estaba en 0 en las 11.940 filas.

Al 2026-09-08: 34 enviados, 4 respuestas (15,4%), 1 escaló a un asesor, 0
agendados. Muestra chica; volver a mirarlo con 200-300 enviados.

**Costo:** ~$10/mes (Haiku para redactar, más las conversaciones que se
reabren), contra una factura de entrada de ~$88/mes. Lo que no está medido es
lo que cobre Zenvia por mensaje — ese contrato no está a la vista.

### Lo que NO se puede medir hoy, y por qué

- **Conversión a paciente.** `derived_to_appointment` sigue en 0 en todas las
  filas: nadie la escribe, así que la conversión real no se puede cerrar
  contra `sofia_conversations`. Lo que sí cambió es el módulo de Seguimiento:
  al 2026-09-02 `sofia_followup_status` tiene **68 filas** marcadas por 4
  personas — 32 contactados, 11 agendados, 16 descartados, sobre 3.079
  pendientes. O sea que hoy la única medida de conversión que existe es la que
  el equipo marca a mano en Seguimiento.
  (Antes acá decía "4 filas, cero agendó, el equipo no lo usa" — quedó viejo.)
- **Atribución publicitaria.** Sofía no recibe de qué anuncio viene cada
  paciente. Se revisó el objeto Prospect de Zenvia: su campo `leads` trae
  `source`/`utmSource`, pero con valor `"WHATSAPP"` — sin campaña ni anuncio.
  Meta manda ese dato en sus anuncios click-to-WhatsApp, pero no llega a
  través de Zenvia. **Inicio cruza campañas y conversaciones por TEMA, y lo
  dice en pantalla: no es atribución.**
- **Tráfico de TikTok.** 264 conversaciones vienen de anuncios de TikTok
  (el primer mensaje los identifica), y el dashboard no registra ninguna
  inversión en ese canal. **Punto ciego que el cliente no sabe que tiene.**

### Teléfonos de pacientes

`sofia_conversations` guardaba solo `phone_hash` (SHA-256, irreversible) por
privacidad. **El 2026-08-27 se revirtió esa decisión a pedido del cliente**
para poder tener la sección Pacientes:

- El Worker ahora guarda `phone_number` en claro en cada conversación nueva
  (ya tenía el número; lo usaba para el hash y lo descartaba).
- `POST /sync/phones` rellena el histórico desde Zenvia. Cobertura lograda:
  **3.374 de 9.257 personas (36%)**, limitada porque las conversaciones
  anteriores al 5 de agosto no tienen `prospect_id`, y porque
  `GET /prospects` de Zenvia **topa en 5.000 sin paginación**.
- Protección: RLS con lectura solo para autenticados; la escritura de
  teléfonos está restringida al Worker vía SECURITY DEFINER.

**Sin resolver:** el uso legal. Subir a Meta teléfonos de personas que
consultaron por cirugía estética toca la Ley 8968 y las restricciones de Meta
sobre datos de salud. La parte técnica está lista; la definición no.

### Un paciente que vuelve NO genera una fila nueva

`upsertConversation` busca por `phone_hash` **sin filtro de fecha**, toma la
fila más antigua y la actualiza. Consecuencias:

- `created_at` es el **primer contacto** y nunca cambia.
- `updated_at` (trigger, agregado el 2026-08-27) es la última actividad.
- `message_count` acumula para siempre; `escalated` es "sticky".
- Solo 14 personas de 9.257 tienen más de una fila, y son residuo de un bug
  viejo de entregas duplicadas.

**Ojo con las métricas:** la gráfica de volumen diario agrupa por
`created_at`, así que mide **conversaciones nuevas por día**, no actividad.
Hoy da casi igual; si aparecen pacientes recurrentes, dejará de darlo.

### Errores encontrados y corregidos el 2026-08-27 — no reintroducir

- **Un fallo nunca puede pintar 0.** Inicio mostraba `$0.00` cuando Meta
  fallaba (`.catch(() => {})` + `|| 0`), que se lee como "no se invirtió
  nada". Ahora muestra `—` y lo explica. Mismo criterio en toda pantalla.
- **`MetricKpi` reventaba** al pasar de `"..."` a un valor con decimales:
  `useState` no reaplica su inicializador, `display` seguía en `null` y
  `null.toFixed()` desmontaba todo React → pantalla en blanco.
- **Condición de carrera** en Métricas Sofía y Seguimiento: el efecto no
  cancelaba la carga anterior y una respuesta vieja pisaba a la nueva.
- **11 peticiones concurrentes** en Inicio hacían que una tardara 10 segundos.
  Las consultas tardan 2-4 ms en Postgres: el cuello era HTTP, no la base.
  Resuelto con `sofia_home_stats`.
- **`CREATE OR REPLACE VIEW` no permite renombrar ni intercalar columnas** —
  solo agregar al final. Para cambiar nombres hay que `DROP` y recrear.
- **Agregar una columna a una tabla NO la agrega a sus vistas.** Al crear
  `procedure_code` la vista `sofia_followup_queue` no lo heredó y Seguimiento
  quedó roto.

### Verificación: compilar no es ejecutar

El 2026-08-27 se subió una pantalla que compilaba y cuyos números cuadraban
contra SQL, pero que **reventaba al renderizar**. Antes de subir una sección
nueva hay que verla corriendo.

`vite dev` **no ejecuta las Cloudflare Pages Functions**, así que localmente
`/api/*` devuelve el `index.html` y Meta siempre falla. Eso es normal en
local, no un bug. Para probar el build de producción hay una config
`cecmarketing-preview` en `.claude/launch.json`.

## Notas para sesiones futuras

**2026-09-03 — Auditoría del RAG y el prompt caching, y el candado del prompt.**
Informe completo en `docs/AUDITORIA_RAG_CACHING_2026-09-03.html`. Lo que hay
que saber sin abrirlo:

- **El caching está bien hecho** y conviene no romperlo en un refactor: la
  hora va fuera del prefijo cacheado, el bloque `system` es idéntico en las
  dos ramas, y el TTL de 1 h está justificado por el patrón de tráfico real
  (~$101/mes mejor que el de 5 min). Confirmado en producción el mismo día
  con los primeros mensajes reales: 103.682 tokens de lectura de caché y
  **cero escrituras**. El `console.log` de `usage` que se agregó es lo único
  que avisaría si eso se rompe.
- **El umbral del RAG pasó de 0,3 a 0,45**, medido sobre 180 consultas
  reconstruidas de conversaciones reales. Con 0,3, el 27% del contexto que
  se le inyectaba a Sofía eran fragmentos sin relación con la pregunta.
- **`chat.js` ya no acepta el prompt del cliente sin sesión** (ver punto 0
  de Seguridad).
- ⚠️ **Todo cambio al comportamiento de Sofía va en DOS repos.** `chat.js`
  solo atiende el widget público y "Probar a Sofía"; los ~17.300 mensajes de
  paciente al mes pasan por el Worker `cec-sofia-whatsapp`, que es un espejo
  deliberado de ese archivo. Arreglar solo uno no cambia nada para los
  pacientes. Los tres cambios de esta fecha se aplicaron en ambos.

**2026-08-30 — Sección Configuración: usuarios, roles y módulos.**
Nueva sección (solo visible para `role = 'admin'`) para crear usuarios del
dashboard, decidir si son admin o no, y qué módulos del menú ven. Piezas:

- **Migración** `profiles_admin_and_module_access`: agrega
  `profiles.allowed_modules text[]` (`null` = todos los módulos — así los
  usuarios que ya existían no perdieron acceso al aplicar esto), un check
  constraint en `role` (`admin`/`user`), y policies de admin sobre `profiles`
  vía el helper `current_user_is_admin()` (`SECURITY DEFINER`, `EXECUTE`
  revocado a `anon`).
- **`functions/api/admin-users.js`** crea/edita usuarios reales de Supabase
  Auth (`service_role`, API de admin de GoTrue). A diferencia de las demás
  funciones en `functions/api/`, protegidas con el secreto compartido
  `x-sofia-secret`, esta valida el `access_token` de quien llama y exige
  `profiles.role = 'admin'` antes de tocar nada — crear una cuenta no es lo
  mismo que enviar un WhatsApp de prueba. Bloquea que el único admin se quite
  a sí mismo el rol.
- **`nav.js` → `getVisibleNavItems(profile)`** filtra el sidebar. Configurar
  el menú por módulo vive en `NAV_ITEMS`; "Configuración" no es un módulo
  asignable (vive aparte, solo para admins).
- **No probado end-to-end** — `/api/*` no corre bajo `vite dev` (ver más
  abajo), así que solo se verificó la UI (formulario, checklist de módulos,
  el toggle admin/usuario deshabilitando el checklist) con un perfil admin
  simulado en `App.jsx` y revertido después. Falta probar `admin-users.js`
  contra el Worker real de Supabase Auth una vez desplegado.

**2026-08-22 — Ojo: el Roadmap de arriba se había quedado desactualizado.**
Una sesión anterior le dijo al usuario que Meta/Google (Fase 3) y el motor de
recomendaciones (Fase 4) seguían pendientes, citando este mismo README sin
cruzarlo con el código. Era falso: Meta lleva conectado y en vivo desde hace
semanas (ver `nav.js` → `DATA_SOURCES`), y `RecommendationsSection.jsx` ya
muestra análisis reales. **Antes de reportar el estado de una integración,
verificar contra `nav.js`/`git log`, no solo contra este README** — ya van
dos veces que este documento se queda atrás de lo que dice el código (la
otra fue el bullet de Zenvia, corregido el 2026-08-20 más abajo).

**2026-08-20 — Auditoría de métricas de Sofía (de dónde salen los datos, y qué no cuadraba).**
Todo lo que muestra este dashboard sobre Sofía (Métricas Sofía, Leads
Potenciales, Inicio, Seguimiento) lee directo de `sofia_conversations` /
`sofia_whatsapp_sessions` en Supabase — es decir, de las conversaciones
reales ya clasificadas por Claude (sentiment/escalated/procedure_interest),
**no** de etiquetas de Zenvia. Zenvia solo aparece como link de salida
(`VITE_ZENVIA_WEB_BASE_URL` + `prospect_id`) y en `conversion-stats.js`
(proxy a `/stats/conversion` del Worker, construido pero **no** conectado
a ninguna pantalla todavía).

Se corrigieron dos cosas en este repo:
- `SofiaMetricsSection.jsx` — "Motivos de escalación" mandaba 34% de las
  escalaciones a "Otro" porque las reglas solo reconocían precio+promoción
  o precio+cirugía; se agregó un bucket "Precio de tratamiento" para el
  resto (ver commit `0e738b4`).
- `DashboardHome.jsx` — "este mes" se calculaba con la medianoche local del
  navegador en vez de Costa Rica, a diferencia del resto de las secciones
  (ver commit `0e738b4`).

La auditoría también encontró un bug real en el Worker
**`cec-sofia-whatsapp`** (repo hermano, no vive acá): la deduplicación de
webhooks por Workers KV no era atómica, y dos entregas concurrentes del
mismo mensaje podían procesarse ambas (13 pares de filas duplicadas
confirmadas en `sofia_conversations`, con respuestas de Claude distintas —
posible doble mensaje real al paciente). Se arregló ahí, documentado en
detalle en la sección **5p** del README de ese repo — leer eso antes de
tocar `processInboundMessage()` o la deduplicación de interacciones.

## Pendientes al 2026-08-27

### Decisiones que dependen del cliente

- **Uso legal de los teléfonos.** Ya hay 3.374 números de pacientes de cirugía
  estética en la base. Para el dashboard interno es una cosa; subirlos a Meta
  como audiencias de exclusión es otra (Ley 8968 + restricciones de Meta sobre
  datos de salud). La parte técnica está lista, la definición no.
- **El guion de precio en cirugía.** 766 conversaciones terminan en la
  respuesta de "no puedo dar precio", y ahí el paciente abandona en el 62,7%
  de los casos, contra 11,9% del resto de consultas quirúrgicas. Cerrar con
  una pregunta NO ayuda (61,8% vs 65,3%): Sofía ya lo hace en 3 de cada 4.
  Qué ofrecer en ese mensaje es decisión comercial del CEC.
- **Cerrar el círculo de Seguimiento.** Ya se usa (68 leads marcados, 11
  agendados al 2026-09-02), pero lo que se marca ahí no vuelve a
  `sofia_conversations`: `derived_to_appointment` sigue en 0, así que las
  métricas de Sofía no ven esos 11 agendados.
- **Avisarle al cliente lo de TikTok** — 264 conversaciones sin inversión
  registrada en ese canal.
- **Frecuencia del reporte en Cloudflare.** El código genera cortes de 5 días,
  pero si el disparador sigue siendo diario produce una ventana móvil de 5
  días cada día, no un corte cada 5.
- **Dónde vive la conversión de Zenvia.** `conversion-stats.js` sigue sin
  consumidor: se quitó de Métricas Sofía por pedido de que esa sección fuera
  solo de Sofía.

### Técnicos

- **Automatizar las migraciones.** El SQL ya está en `supabase/migrations/`,
  pero no hay CLI ni CI que lo aplique, y `schema.sql` sigue desactualizado.
- **Cerrar los endpoints protegidos con `VITE_SOFIA_SECRET`** (ver punto 0 de
  "Seguridad" más arriba). Es lo más urgente: ese secreto es público por
  construcción.
- **Rotar `STATS_TRIGGER_SECRET`** y decidir si `/stats/prospect-phones` debe
  seguir existiendo (ver "Seguridad" más arriba).
- **Confirmar que el registro público esté cerrado** en Supabase Auth.
- **El tope de 5.000 de Zenvia.** Afecta dos cosas: la conversión sale
  subcontada (`/stats/conversion` ya devuelve `truncated: true`, y se
  confirmó que el tope se está alcanzando), y la cobertura de teléfonos del
  histórico quedó en 36%. `GET /prospects` no pagina; habría que trocear la
  consulta por fecha o por motivo de archivo, si la API lo permite.
- **3,6% de conversaciones sin clasificar** (320) en la cola de la taxonomía.
- **Una conversación = un procedimiento.** Se pierden los casos que comparan
  dos opciones (7 con MIA vs Preservé) o combinan procedimientos (6 con
  lifting + blefaroplastia). Se resolvería con categoría primaria y
  secundaria.
- **Workspace dedicado en la consola de Anthropic** para separar el costo de
  Sofía del resto del uso de Claude.
