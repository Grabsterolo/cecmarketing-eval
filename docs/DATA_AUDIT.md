# DATA AUDIT — Dashboard CEC Marketing

Auditoría del 2026-08-30. Cada métrica rastreada hasta su origen y validada
contra la base de producción (`wuradlaomyoxkiagqvyi`) y contra la respuesta
real de la API de Meta Ads.

**Cómo mantener este documento:** si agregás una métrica al dashboard,
agregala acá con su fuente y su nivel. Si no podés llenar la columna
"Cálculo" con una fuente real, la métrica no debería existir en pantalla.

## Semáforo

| | Significado |
|---|---|
| 🟢 CONFIRMADA | Fuente real, cálculo verificado contra la base o la API. |
| 🟡 PARCIAL | El dato es real pero incompleto o cubre menos de lo que sugiere. |
| 🟠 DUDOSA | Se calcula bien pero la etiqueta o el encuadre inducen a error. |
| 🔴 INCORRECTA | El número que se muestra no es lo que dice ser. |
| ⚫ SIN FUENTE | No existe el dato; la métrica no se puede calcular hoy. |

---

## Meta Ads

Origen común: `functions/api/meta-metrics.js` → Graph API v19.0
`/{ad_account}/insights?level=campaign`, ventana = mes a la fecha.
Validado el 2026-08-30 contra la cuenta real: 15 campañas, $8.493,96 de gasto.

| Métrica | Fuente | Campo | Cálculo | Nivel | Problema | Acción |
|---|---|---|---|---|---|---|
| Gasto | Meta API | `spend` | Suma por campaña | 🟢 | — | — |
| Impresiones | Meta API | `impressions` | Suma | 🟢 | Se rotulaba "Alcance total" | **Corregido** 2026-08-30 |
| Alcance | Meta API | `reach` | — | 🔴→🟢 | Se **sumaba** entre campañas; `reach` viene deduplicado por campaña, sumarlo cuenta dos veces a quien vio dos anuncios (1.379.311 inflado) | **Corregido**: se devuelve `null` con nota; para el alcance real hace falta pedirlo a nivel de cuenta |
| Clics | Meta API | `clicks` | Suma | 🔴→🟢 | 95.852 rotulados "Al sitio web", pero `clicks` incluye reacciones, comentarios y clics al perfil. Los clics reales al enlace eran 36.687 (2,6× inflado) | **Corregido**: ahora usa `inline_link_clicks` |
| Leads | Meta API | `actions[lead]` | Suma | 🟡 | 4.824 en agosto. Es el evento `lead`, no las conversaciones de los anuncios click-to-WhatsApp (6.963). Son dos definiciones distintas y el dashboard mostraba solo una | **Corregido**: se muestran ambas, etiquetadas |
| Conversaciones iniciadas | Meta API | `actions[onsite_conversion.messaging_conversation_started_7d]` | Suma | 🟢 | No existía | **Agregada** 2026-08-30 |
| CPL | Derivada | `spend / leads` | Solo campañas con leads | 🟡 | Mezcla campañas de alcance y de mensajes, cuyo CPL no es comparable | Nota al pie ya presente; segmentar por objetivo (P1) |
| Costo por conversación | Derivada | `spend / messagingStarted` | — | 🟢 | No existía | **Agregada** |
| CTR / CPC | Meta API | `ctr`, `cpc` | Vienen de Meta | 🟢 | Se traen pero no se muestran | Exponer (P2) |
| Totales del mes | Derivada | Suma de campañas | — | 🟡→🟢 | Sin paginación: Meta devuelve 25 campañas por página. Con 15 hoy no falla, pero al pasar de 25 **todos los totales quedaban subcontados en silencio** | **Corregido**: sigue `paging.next`, `limit=100` |
| Ventana "este mes" | Derivada | `time_range` | Mes a la fecha | 🟠→🟢 | Se calculaba con la hora del servidor (UTC). Entre 00:00 y 06:00 UTC del día 1, Cloudflare ya está en el mes nuevo y Costa Rica no | **Corregido**: se calcula en `America/Costa_Rica` |
| Atribución campaña → paciente | — | — | — | ⚫ | Sofía no recibe de qué anuncio viene cada persona: Meta lo manda en los click-to-WhatsApp pero Zenvia no lo propaga (`source` llega como `"WHATSAPP"`) | Ver "Funnel" abajo |
| Inversión en TikTok | — | — | — | ⚫ | 264 conversaciones vienen de anuncios de TikTok; el dashboard no registra ninguna inversión en ese canal | Punto ciego: el CPL global está subestimado |

## Sofía

Origen común: `sofia_conversations` (9.984 filas, primera 2026-07-27).
Clasificación (`sentiment`, `escalated`, `procedure_interest`) la escribe
Claude en el Worker `cec-sofia-whatsapp`.

| Métrica | Fuente | Campo | Cálculo | Nivel | Problema | Acción |
|---|---|---|---|---|---|---|
| Conversaciones | `sofia_conversations` | `count(*)` | Por `created_at` en hora CR | 🟡 | Cuenta **conversaciones nuevas**, no actividad: un paciente que vuelve actualiza la fila original, no crea otra. Hoy da casi igual (16 de 9.968 personas tienen más de una fila) | Documentado; si crece la recurrencia deja de valer |
| "Resueltas sin asesor" | Derivada | `not escalated` | 74,7% en agosto | 🔴 | **El 51% de esas "resueltas" tenían un solo mensaje** — gente que escribió una vez y no volvió. Eso es abandono, no resolución. Invitaba a concluir que Sofía resuelve 3 de cada 4 | **Eliminada** 2026-08-30, reemplazada por el desglose de tres grupos excluyentes |
| Sin enganche | Derivada | `message_count = 1` | 40,4% en agosto | 🟢 | No existía | **Agregada** |
| Atendidas por Sofía | Derivada | `message_count > 1 and not escalated` | 34,4% | 🟢 | No existía | **Agregada**. No significa que agendaron |
| Escalación | `sofia_conversations` | `escalated` | 25,3% en agosto | 🟢 | `escalated` es "sticky": una vez true nunca vuelve a false | Aceptable |
| Motivos de escalación | `escalation_reason` | Reglas de texto | Buckets por palabra clave | 🟡 | Texto libre agrupado por keywords; el bucket "Otro" absorbe lo que no calza | Mejorado en agosto; revisar cobertura periódicamente |
| Sentimiento | `sentiment` | — | 3 categorías | 🟡→🟢 | 16 conversaciones con `sentiment` null desaparecían del donut mientras el centro sí las contaba: las partes no sumaban el total | **Corregido**: se muestra "Sin clasificar" |
| Temas consultados | `procedure_code` | Columna generada | Agrupa por código | 🟢 | 294 filas (2,9%) sin clasificar | Cola de taxonomía |
| Duración de conversación | `duration_minutes` | — | — | ⚫ | **Está en 0 en las 8.610 filas de agosto.** Nadie lo escribe | No mostrar hasta que el Worker lo llene |
| Tiempo de respuesta de Sofía | — | — | — | ⚫ | No se registra ningún timestamp por mensaje | Requiere instrumentar el Worker |
| Conversión a cita | `derived_to_appointment` | — | — | ⚫ | **0 en toda la base.** Nadie lo escribe | El dato no existe: no se puede medir conversión |
| Leads calificados | Derivada | Score cliente | 0-100 | 🟠 | Ver "Lead scoring" abajo | — |

## Call Center

| Métrica | Fuente | Cálculo | Nivel | Problema | Acción |
|---|---|---|---|---|---|
| Pendientes de contactar | `sofia_followup_queue` | `estado='pendiente'` | 🟢 | 2.761 en cola | — |
| Contactados esta semana | `sofia_followup_status` | `estado='contactado'` | ⚫ | **0 filas en toda la historia** | El módulo no se usa |
| Agendados | `sofia_followup_status` | `estado='agendo'` | ⚫ | **0 filas** | El módulo no se usa |
| Score de Seguimiento | Vista `sofia_followup_queue` | SQL, servidor | 🟢 | Se ordena en Postgres sobre toda la cola | Correcto |
| Score de Leads Potenciales | `LeadsCalientesSection.jsx` | JS, navegador | 🔴 | **Fórmula distinta a la de Seguimiento** y se ordena solo dentro de las 20 filas de la página, que vienen ordenadas por fecha. Un lead de score alto de hace semanas es inalcanzable | Aviso agregado en pantalla; consolidar en una sola definición (P0) |
| "Última actividad" en Leads | `created_at` | — | 🔴→🟢 | Mostraba el **primer** contacto rotulado como última actividad, y le restaba hasta 17 de los 20 puntos de recencia a leads activos. Mismo bug ya corregido en Pacientes | **Corregido**: usa `updated_at` |

## Recomendaciones (análisis con IA)

| Métrica | Fuente | Nivel | Problema | Acción |
|---|---|---|---|---|
| Análisis del período | `sofia_recommendations` | 🟠→🟢 | La fila más reciente se mostraba como si fuera de hoy. El 2026-08-30 se veía el corte del **26 de agosto** sin ningún aviso | **Corregido**: avisa la antigüedad |
| `data_snapshot` | Meta + Sofía al generar | 🟢 | Es una foto del momento, no se recalcula | Correcto por diseño |

---

## Lo que NO se puede medir hoy

Ninguna de estas se debe mostrar en el dashboard hasta que exista la fuente.

1. **Conversión a cita, asistencia, procedimiento e ingresos.** No hay
   integración con la agenda ni con el sistema clínico. `derived_to_appointment`
   existe como columna pero nadie la escribe.
2. **Atribución publicitaria.** No se puede responder "qué pasó con los leads
   de la campaña X". Requiere propagar el `ctwa_clid` de Meta a través de
   Zenvia, o pedirlo a Zenvia.
3. **ROI / ROAS.** Depende de (1). Sin ingresos no hay retorno.
4. **Productividad por agente.** `sofia_followup_status.actualizado_por`
   existe pero no tiene datos.
5. **Tiempo de respuesta y duración de conversación.** Sin instrumentar.
