# CEC Marketing Dashboard
<!-- test commit 2 -->

Portal interno de mercadeo del Centro Europeo de Cirugía (CEC). Mismo sistema de diseño que `ceccolaboradores` (login, sidebar, paleta de colores, tipografía), construido como proyecto separado para esta función.

## Stack

- React 18 + Vite
- Supabase (auth + base de datos)
- Recharts (gráficos, cuando se conecten Meta/Google)
- Mismo sistema de diseño que el portal de colaboradores: verde `#1F4A40`, dorado `#C9A24E`, crema `#FAFAF8`, Cormorant Garamond + Manrope

## Estructura

```
src/
  components/
    auth/LoginScreen.jsx       — pantalla de login, mismo diseño que ceccolaboradores
    layout/Sidebar.jsx          — navegación lateral (desktop + mobile drawer)
    sections/
      DashboardHome.jsx         — resumen general
      MetricsSection.jsx        — Meta Ads + Google Ads/Analytics (placeholder, Fase 3)
      SofiaConversationsSection.jsx — conversaciones de WhatsApp, conectado a Supabase
      RecommendationsSection.jsx    — recomendaciones de IA (placeholder, Fase 4)
      ConfigureSofiaSection.jsx     — editor del prompt y base de conocimiento de Sofía
    ui/                         — Card, Logo, PasswordInput, PendingIntegrationCard
  constants/colors.js           — paleta y animaciones, idénticas a ceccolaboradores
  constants/nav.js               — items de navegación y estado de fuentes de datos
  lib/supabase.js                — cliente de Supabase
supabase/schema.sql              — SQL para crear las tablas necesarias
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

**Fase 1 — Frontend y editor de Sofía (este entregable)**
Login, dashboard, sidebar, y la sección "Configurar a Sofía" ya funcionando contra Supabase. No depende de acceso externo.

**Fase 2 — Conversaciones de Sofía**
La sección ya está construida y lista para mostrar datos reales en cuanto el backend del webhook de WhatsApp empiece a escribir en la tabla `sofia_conversations`.

**Fase 3 — Conectar Meta y Google** *(pendiente: acceso aún no otorgado por CEC)*
Requiere acceso de administrador a Meta Business Manager y a Google Ads / Analytics. La sección `MetricsSection.jsx` está lista para recibir la integración real una vez haya acceso.

**Fase 4 — Motor de recomendaciones**
Solo tiene sentido con datos reales de ambos lados (campañas + conversaciones) para cruzar. `RecommendationsSection.jsx` queda como placeholder hasta entonces.

## Notas para sesiones futuras

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

## Pendientes generales del proyecto CEC (no específicos de este dashboard)

- Pedir a CEC acceso de administrador a Meta Business Manager y Google Ads / Analytics (bloquea Fase 3).
- Workspace dedicado en la consola de Anthropic para separar el costo de Sofía del resto del uso de Claude.
- Conectar `conversion-stats.js` a alguna pantalla del dashboard, o quitarlo si no se va a usar — hoy es un endpoint construido sin consumidor.
