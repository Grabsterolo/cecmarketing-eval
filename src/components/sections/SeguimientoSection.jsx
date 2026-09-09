import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PhoneCall, ExternalLink, ChevronDown, ChevronLeft, ChevronRight, Smile, Minus, Frown, Radio, RadioTower, AlertTriangle } from "lucide-react";
import { COLORS } from "../../constants/colors.js";
import { PROCEDURE_OPTIONS, matchesProcedure, formatProcedure } from "../../constants/procedures.js";
import { Card } from "../ui/Card.jsx";
import { SELECT_STYLE, FilterSelect } from "../ui/FilterSelect.jsx";
import { Badge } from "../ui/Badge.jsx";
import { ErrorBanner } from "../ui/ErrorBanner.jsx";
import { EmptyState } from "../ui/EmptyState.jsx";
import { SectionHeader } from "../ui/SectionHeader.jsx";
import { MetricKpi } from "../ui/MetricKpi.jsx";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { supabase } from "../../lib/supabase.js";

// prospect_id (y por lo tanto sofia_followup_queue) solo existe desde acá —
// mismo punto de partida que Métricas Sofía.
const MIN_DATE = "2026-08-06";
const PAGE_SIZE = 25;

// PostgREST corta cualquier select() sin paginar en 1000 filas — los filtros
// de esta sección son client-side sobre "el conjunto ya traído" (así lo pidió
// el spec), así que hay que traer todo el rango en bloques de 1000 antes de
// filtrar/agrupar en el cliente. Mismo patrón que fetchAllInRange en
// SofiaMetricsSection.jsx.
const FETCH_PAGE_SIZE = 1000;

// estado_actualizado_en es st.updated_at de sofia_followup_status expuesto por
// la vista (migración 20260902231711) — cuándo alguien del equipo tocó el
// estado, NO cuándo se actualizó la conversación. Se usa para el "por X · hace
// Nmin" de cada tarjeta.
const QUEUE_COLUMNS = "id, phone_number, phone_hash, procedure_interest, procedure_code, escalation_reason, channel, message_count, sentiment, created_at, prospect_id, origen, categoria, score, estado, nota, actualizado_por, estado_actualizado_en, urgente, esperar_hasta, patient_name, asignado_a, asignado_nombre";

// Cuántos leads lleva un asesor en su lista del día. La vista los reparte de
// arriba de la cola priorizada; la asignación se vence sola a los 3 días
// (migración 20260909010000).
const LISTA_DEL_DIA = 30;

// "Escalada por otro motivo" son escalaciones clínicas reales (contraindicación,
// lactancia, pérdida de peso en curso) que hasta el 2026-09-07 no llegaban acá:
// la vista las filtraba por palabras del motivo y estas no las tenían. Score
// promedio 69, prácticamente igual que "Escalada sin cita".
// "Escalada técnica" la disparó el sistema (tope de mensajes, falla de Claude,
// frase de traspaso sin etiqueta), no el paciente — se puede filtrar aparte.
const ORIGEN_LABEL = {
  escalada_sin_cita: "Escalada sin cita",
  escalada_otro_motivo: "Escalada por otro motivo",
  escalada_tecnica: "Escalada técnica",
  cerrada_sin_escalar: "Cerrada sin escalar",
};
const CATEGORIA_LABEL = { cirugia: "Cirugía", tratamiento_no_quirurgico: "No quirúrgico" };
const ESTADO_LABEL = {
  pendiente: "Pendiente", contactado: "Contactado", agendo: "Agendó",
  en_espera: "En espera", descartado: "Descartado", no_contactable: "No contactable",
};
const ESTADO_OPTIONS = ["pendiente", "contactado", "agendo", "en_espera", "descartado", "no_contactable"];

// Cuánto esperar cuando el paciente dijo que él escribe. La conversación sale de
// la lista activa y VUELVE SOLA pasada la fecha — lo calcula la vista al
// consultar, no hay proceso que la despierte.
const ESPERA_OPCIONES = [
  { dias: 5,  label: "5 días" },
  { dias: 15, label: "15 días" },
  { dias: 30, label: "30 días" },
];

function normalize(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// created_at se guarda en UTC pero el equipo opera en hora de Costa Rica —
// mismo patrón que SofiaMetricsSection.
function crDateStr(date) {
  return date.toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
}

function todayISO() {
  return crDateStr(new Date());
}

function daysAgoISO(n) {
  return crDateStr(new Date(Date.now() - n * 86400000));
}

function clampToMinDate(value) {
  return value < MIN_DATE ? MIN_DATE : value;
}

// Lunes de la semana actual en hora de Costa Rica, para el KPI "En
// seguimiento abierto". Se calcula sobre los componentes de fecha
// (año/mes/día) del día de hoy en CR, no sobre timestamps UTC, para que el
// corte de semana no se desplace por el offset horario.
function startOfWeekISO() {
  const [y, m, d] = todayISO().split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const diffToMonday = (dow + 6) % 7;
  const monday = new Date(Date.UTC(y, m - 1, d - diffToMonday));
  return monday.toISOString().slice(0, 10);
}

function formatRelative(dateStr) {
  if (!dateStr) return "";
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "justo ahora";
  if (mins < 60) return `hace ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

function formatFullDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("es-CR", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function scoreTier(score) {
  if (score >= 70) return "alto";
  if (score >= 40) return "medio";
  return "bajo";
}

const TIER_STYLES = {
  alto: { bg: COLORS.dangerBg, fg: COLORS.danger },
  medio: { bg: "rgba(201,162,78,0.14)", fg: COLORS.gold },
  bajo: { bg: "rgba(31,74,64,0.08)", fg: COLORS.textMuted },
};

// --- Desglose del puntaje -------------------------------------------------
//
// Rescatado de Leads Potenciales, que era la única pantalla que explicaba su
// número. Explicaba OTRO número: lo calculaba en el navegador con una fórmula
// distinta a la de la vista, y el 31% de los leads cambiaba de tramo
// (alto/medio/bajo) según en qué pantalla se mirara. Acá los tramos son los de
// sofia_followup_queue, así que las partes suman exactamente el puntaje que
// muestra la tarjeta.
//
// La red de seguridad está en desgloseScore(): si las partes no suman el score
// que mandó el servidor, no se pinta nada. Preferimos no explicar el puntaje a
// explicarlo mal — un desglose que no cuadra con el número de al lado destruye
// la confianza en los dos. Eso pasa si alguien cambia los tramos de la vista y
// no toca este archivo, o si una fila cruza un corte de antigüedad con la
// pantalla abierta (la vista usa el now() de la consulta; acá es Date.now()).
const APARATOLOGIA = /(ultherapy|quantum|trilipo|radiesse|hialur|toxina|botox|co2|criolipo|bodytite)/i;

function puntosProcedimiento(conv) {
  if (conv.categoria === "cirugia") return { pts: 35, detalle: "Cirugía" };
  if (APARATOLOGIA.test(`${conv.procedure_interest || ""} ${conv.escalation_reason || ""}`)) {
    return { pts: 22, detalle: "Tratamiento de aparatología" };
  }
  if (conv.procedure_interest) return { pts: 12, detalle: "Otro tratamiento" };
  return { pts: 0, detalle: "Sin procedimiento identificado" };
}

function puntosMensajes(count) {
  const n = count || 0;
  const texto = `${n} ${n === 1 ? "mensaje" : "mensajes"}`;
  if (n >= 6) return { pts: 25, detalle: `${texto} — conversación larga` };
  if (n >= 4) return { pts: 20, detalle: texto };
  if (n === 3) return { pts: 14, detalle: texto };
  if (n === 2) return { pts: 8, detalle: texto };
  return { pts: 0, detalle: `${texto} — poco intercambio` };
}

// Se compara el valor crudo, sin normalizar, porque la vista hace lo mismo
// (sentiment = 'positivo'). Cualquier otra cosa —negativo, null— vale 3.
function puntosSentimiento(sentiment) {
  if (sentiment === "positivo") return { pts: 15, detalle: "Positivo" };
  if (sentiment === "neutral") return { pts: 8, detalle: "Neutral" };
  return { pts: 3, detalle: sentiment === "negativo" ? "Negativo" : "Sin clasificar" };
}

function puntosAntiguedad(createdAt) {
  const dias = (Date.now() - new Date(createdAt).getTime()) / 86400000;
  const detalle = formatRelative(createdAt);
  if (dias <= 2) return { pts: 15, detalle };
  if (dias <= 5) return { pts: 11, detalle };
  if (dias <= 10) return { pts: 7, detalle };
  if (dias <= 20) return { pts: 3, detalle };
  return { pts: 0, detalle };
}

function puntosIntencion(origen) {
  if (origen === "escalada_sin_cita") return { pts: 10, detalle: "Pidió precio, cita o valoración" };
  if (origen === "escalada_otro_motivo") return { pts: 8, detalle: "Escalación clínica" };
  if (origen === "escalada_tecnica") return { pts: 0, detalle: "La escaló el sistema, no el paciente" };
  return { pts: 0, detalle: "No escaló" };
}

function desgloseScore(conv) {
  const partes = [
    { etiqueta: "Procedimiento", ...puntosProcedimiento(conv) },
    { etiqueta: "Interacción", ...puntosMensajes(conv.message_count) },
    { etiqueta: "Sentimiento", ...puntosSentimiento(conv.sentiment) },
    { etiqueta: "Antigüedad", ...puntosAntiguedad(conv.created_at) },
    { etiqueta: "Intención", ...puntosIntencion(conv.origen) },
  ];
  return partes.reduce((t, p) => t + p.pts, 0) === conv.score ? partes : null;
}

function DesgloseScore({ conv }) {
  const partes = desgloseScore(conv);
  if (!partes) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <p style={{
        margin: "0 0 8px", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
        textTransform: "uppercase", color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif",
      }}>
        Por qué este puntaje
      </p>
      {partes.map((p) => (
        <div key={p.etiqueta} style={{
          display: "flex", alignItems: "baseline", gap: 12, padding: "4px 0",
          fontFamily: "'Manrope', sans-serif",
        }}>
          <span style={{ fontSize: 12, color: COLORS.textMuted, width: 104, flexShrink: 0 }}>
            {p.etiqueta}
          </span>
          <span style={{ fontSize: 13, color: COLORS.text, flex: 1, minWidth: 0 }}>
            {p.detalle}
          </span>
          <span style={{
            fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums",
            color: p.pts > 0 ? COLORS.green : COLORS.textMuted, flexShrink: 0,
          }}>
            {p.pts > 0 ? `+${p.pts}` : "0"}
          </span>
        </div>
      ))}
      <div style={{
        display: "flex", alignItems: "baseline", gap: 12, paddingTop: 8, marginTop: 4,
        borderTop: `1px solid ${COLORS.border}`, fontFamily: "'Manrope', sans-serif",
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.text, flex: 1 }}>Total</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: COLORS.green, fontVariantNumeric: "tabular-nums" }}>
          {conv.score}
        </span>
      </div>
    </div>
  );
}

// Colores del sello "Contactado por Ana · hace 5min" que va en cada tarjeta.
// Van por estado para que se lea de un vistazo cuál ya está trabajado.
// "pendiente" también tiene color: alguien puede haber dejado una nota sin
// cambiar el estado, y eso igual significa que ese lead ya tiene dueño. La
// tarjeta queda sin sello solo cuando no hay actualizado_por, o sea cuando
// nadie lo tocó nunca.
// El sello no puede reusar ESTADO_LABEL: esas etiquetas están redactadas para
// el dropdown ("Agendó", "Pendiente") y pegadas a un "por Fulana" quedan mal
// en español ("Agendó por Valeria"). Acá van en participio, que es lo que pide
// la frase.
const SELLO_VERBO = {
  pendiente: "Visto por",
  contactado: "Contactado por",
  agendo: "Agendado por",
  en_espera: "Puesto en espera por",
  descartado: "Descartado por",
  no_contactable: "Marcado no contactable por",
};

const ESTADO_SELLO = {
  contactado: { bg: "rgba(201,162,78,0.14)", fg: COLORS.gold },
  agendo: { bg: "rgba(31,74,64,0.10)", fg: COLORS.success },
  descartado: { bg: "rgba(31,74,64,0.08)", fg: COLORS.textMuted },
  no_contactable: { bg: "rgba(31,74,64,0.08)", fg: COLORS.textMuted },
  pendiente: { bg: "rgba(31,74,64,0.08)", fg: COLORS.textMuted },
};

const SENTIMENT_ICON = {
  positivo: { Icon: Smile, color: COLORS.success, label: "Sentimiento positivo" },
  neutral: { Icon: Minus, color: COLORS.textMuted, label: "Sentimiento neutral" },
  negativo: { Icon: Frown, color: COLORS.danger, label: "Sentimiento negativo" },
};

async function fetchAllInRange(from, to) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("sofia_followup_queue")
      .select(QUEUE_COLUMNS)
      .gte("created_at", `${from}T00:00:00-06:00`)
      .lte("created_at", `${to}T23:59:59-06:00`)
      // urgente PRIMERO, igual que el ORDER BY de la vista. Antes esto pedía
      // solo score: un .order() explícito reemplaza el orden interno de la
      // vista, así que la prioridad de urgencia que la vista calcula se perdía
      // en el camino. El efecto medido el 2026-09-08: los 12 casos urgentes
      // abiertos quedaban repartidos entre las páginas 18 y 117 de 118 — una
      // paciente con sangrado y dolor post-procedimiento estaba en la 98.
      // El score ordena oportunidades de venta; no puede ordenar riesgos.
      .order("urgente", { ascending: false })
      .order("score", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + FETCH_PAGE_SIZE - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if (!data || data.length < FETCH_PAGE_SIZE) break;
    offset += FETCH_PAGE_SIZE;
  }
  return { data: rows, error: null };
}

// Los urgentes abiertos, aparte del resto y SIN el rango de fechas de la
// pantalla. Van en una franja fija arriba: un reclamo o una complicación
// post-operatoria no puede depender de que el rango elegido lo alcance, ni de
// que alguien se acuerde de tocar un filtro. Se trae desde MIN_DATE, que es
// donde empieza a existir la cola.
//
// El tope de 50 es una red, no un límite esperado: la vista marca como urgente
// ~0,5% de la cola (21 de 4.219 al escribir esto). Si algún día la franja
// llega al tope, el problema es el criterio de urgencia, no la franja — y por
// eso se avisa en pantalla en vez de recortar en silencio.
const URGENTES_TOPE = 50;

async function fetchUrgentesAbiertos() {
  return supabase
    .from("sofia_followup_queue")
    .select(QUEUE_COLUMNS)
    .eq("urgente", true)
    .eq("estado", "pendiente")
    .gte("created_at", `${MIN_DATE}T00:00:00-06:00`)
    .order("created_at", { ascending: false })
    .limit(URGENTES_TOPE);
}

// Agrupa por phone_hash: una misma persona con varias conversaciones en el
// conjunto ya filtrado se colapsa en una sola fila (la más reciente),
// mostrando el score más alto del grupo. Conversaciones sin phone_hash no se
// agrupan entre sí (cada una queda como su propia fila).
function groupByPhone(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = row.phone_hash || `id:${row.id}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { key, latest: row, count: 1, maxScore: row.score, urgente: !!row.urgente });
      return;
    }
    existing.count += 1;
    existing.maxScore = Math.max(existing.maxScore, row.score);
    // Si CUALQUIERA de las conversaciones de esta persona es urgente, el grupo
    // entero lo es: la fila que se muestra es la más reciente, y esconder la
    // urgencia porque el último mensaje no la tenía sería el mismo error que
    // esta corrección viene a arreglar.
    existing.urgente = existing.urgente || !!row.urgente;
    if (new Date(row.created_at) > new Date(existing.latest.created_at)) {
      existing.latest = row;
    }
  });
  const list = [...groups.values()];
  // Urgente primero, después score — el mismo criterio que la vista y que
  // fetchAllInRange. Ordenar solo por score acá deshacía la corrección de la
  // consulta, porque este sort corre después.
  list.sort((a, b) =>
    Number(b.urgente) - Number(a.urgente)
    || b.maxScore - a.maxScore
    || new Date(b.latest.created_at) - new Date(a.latest.created_at));
  return list;
}

// Aplica a un arreglo de filas el cambio de estado que llegó por realtime (o el
// optimista de quien lo está tocando). Devuelve el MISMO arreglo si la fila no
// está, para que React no re-renderice una lista que no cambió.
//
// Se copian SOLO estos cuatro campos, nada de spread del payload: el evento
// trae las columnas de sofia_followup_status, y su created_at es el de la fila
// de ESTADO — un spread pisaría el created_at de la conversación, que es el
// que ordena la lista y fecha la tarjeta.
function conEstadoAplicado(rows, statusRow) {
  let hit = false;
  const next = rows.map((r) => {
    if (r.id !== statusRow.conversation_id) return r;
    hit = true;
    return {
      ...r,
      estado: statusRow.estado,
      nota: statusRow.nota,
      actualizado_por: statusRow.actualizado_por,
      estado_actualizado_en: statusRow.updated_at,
    };
  });
  return hit ? next : rows;
}

const dateInputStyle = {
  background: COLORS.inputBg, border: `1.5px solid ${COLORS.border}`,
  borderRadius: 8, padding: "8px 12px", color: COLORS.text, fontSize: 13,
  outline: "none", fontFamily: "'Manrope', sans-serif",
};

function FilterBar({
  from, to, setFrom, setTo,
  origen, setOrigen, categoria, setCategoria, estado, setEstado, canal, setCanal,
  procedimiento, setProcedimiento,
  search, setSearch,
}) {
  const hoyActivo = from === todayISO() && to === todayISO();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
          Desde
          <input type="date" value={from} min={MIN_DATE} max={to} onChange={(e) => setFrom(clampToMinDate(e.target.value))} style={dateInputStyle} />
        </label>
        {/* Ver lo que entró hoy exigía mover dos selectores de fecha. Los leads
            del día son justo los que todavía se pueden recuperar.

            Es un INTERRUPTOR, no un atajo de ida. La primera versión solo hacía
            setFrom/setTo a hoy: se pintaba de verde pero volver a tocarlo no
            hacía nada, y para salir había que mover los dos selectores a mano —
            exactamente lo que el botón venía a evitar. Al apagarlo vuelve al
            rango por defecto (últimos 30 días), que es como arranca la
            pantalla. */}
        <button
          onClick={() => {
            if (hoyActivo) {
              setFrom(clampToMinDate(daysAgoISO(30)));
              setTo(todayISO());
            } else {
              setFrom(todayISO());
              setTo(todayISO());
            }
          }}
          aria-pressed={hoyActivo}
          title={hoyActivo ? "Volver a los últimos 30 días" : "Ver solo lo que entró hoy"}
          style={{
            padding: "6px 14px", borderRadius: 999, fontSize: 13, fontWeight: 600,
            fontFamily: "'Manrope', sans-serif", cursor: "pointer",
            border: `1.5px solid ${hoyActivo ? COLORS.green : COLORS.border}`,
            background: hoyActivo ? COLORS.green : "transparent",
            color: hoyActivo ? "#fff" : COLORS.text,
          }}
        >
          Hoy
        </button>
        {/* Acá vivía el botón "⚠ Urgentes (N)". Lo reemplaza la franja fija de
            arriba, que muestra los urgentes abiertos siempre, sin depender del
            rango de fechas ni de que alguien se acuerde de pulsarlo — que era
            justamente el problema: un caso de riesgo no puede estar detrás de
            un filtro opcional. */}
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
          Hasta
          <input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} style={dateInputStyle} />
        </label>

        <select value={origen} onChange={(e) => setOrigen(e.target.value)} style={SELECT_STYLE}>
          <option value="todos">Origen: todos</option>
          <option value="escalada_sin_cita">Escalada sin cita</option>
          <option value="escalada_otro_motivo">Escalada por otro motivo</option>
          <option value="escalada_tecnica">Escalada técnica</option>
          <option value="cerrada_sin_escalar">Cerrada sin escalar</option>
        </select>

        <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={SELECT_STYLE}>
          <option value="todos">Categoría: todas</option>
          <option value="cirugia">Cirugía</option>
          <option value="tratamiento_no_quirurgico">No quirúrgico</option>
        </select>

        <select value={estado} onChange={(e) => setEstado(e.target.value)} style={SELECT_STYLE}>
          <option value="todos">Estado: todos</option>
          {ESTADO_OPTIONS.map((v) => <option key={v} value={v}>{ESTADO_LABEL[v]}</option>)}
        </select>

        <select value={canal} onChange={(e) => setCanal(e.target.value)} style={SELECT_STYLE}>
          <option value="todos">Canal: todos</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="facebook">Facebook</option>
        </select>

        <FilterSelect value={procedimiento} onChange={setProcedimiento} options={PROCEDURE_OPTIONS} />
      </div>

      <input
        type="text"
        placeholder="Buscar por procedimiento..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ ...dateInputStyle, width: "100%", maxWidth: 360 }}
      />

      {from === MIN_DATE && (
        <p style={{ margin: 0, fontSize: 12, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", fontStyle: "italic" }}>
          Seguimiento no tiene datos antes del 6 de agosto de 2026 — es cuando se empezó a registrar el prospect_id que necesita el link a Zenvia.
        </p>
      )}
    </div>
  );
}

// Indicador del canal realtime. No es decoración: cuando dice "Sin conexión
// en vivo" el equipo está viendo una foto del momento en que cargó, y dos
// personas pueden volver a pisarse — por eso el estado caído es el único que
// grita (color de peligro y una instrucción concreta).
function LiveIndicator({ status, onReload }) {
  if (status === "vivo") {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        fontSize: 12, fontWeight: 600, color: COLORS.success,
        fontFamily: "'Manrope', sans-serif",
      }}>
        <RadioTower size={13} /> En vivo — los cambios de tu equipo aparecen solos
      </span>
    );
  }

  if (status === "conectando") {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        fontSize: 12, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif",
      }}>
        <Radio size={13} /> Conectando en vivo...
      </span>
    );
  }

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap",
      fontSize: 12, fontWeight: 600, color: COLORS.danger,
      fontFamily: "'Manrope', sans-serif",
    }}>
      <Radio size={13} /> Sin conexión en vivo — puede que alguien más ya haya contactado a estos leads.
      <button
        onClick={onReload}
        style={{
          background: "none", border: "none", padding: 0,
          color: COLORS.danger, fontSize: 12, fontWeight: 700,
          fontFamily: "'Manrope', sans-serif", cursor: "pointer",
          textDecoration: "underline",
        }}
      >
        Recargar la lista
      </button>
    </span>
  );
}

function PaginationControls({ page, totalPages, onPrev, onNext }) {
  if (totalPages <= 1) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginTop: 20 }}>
      <button
        onClick={onPrev}
        disabled={page <= 1}
        style={{
          display: "flex", alignItems: "center", gap: 4, background: COLORS.panelAlt,
          color: COLORS.green, border: `1px solid ${COLORS.border}`, borderRadius: 8,
          padding: "8px 12px", fontSize: 13, fontWeight: 600, fontFamily: "'Manrope', sans-serif",
          cursor: page <= 1 ? "not-allowed" : "pointer", opacity: page <= 1 ? 0.5 : 1,
        }}
      >
        <ChevronLeft size={14} /> Anterior
      </button>
      <span style={{ fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
        Página {page} de {totalPages}
      </span>
      <button
        onClick={onNext}
        disabled={page >= totalPages}
        style={{
          display: "flex", alignItems: "center", gap: 4, background: COLORS.panelAlt,
          color: COLORS.green, border: `1px solid ${COLORS.border}`, borderRadius: 8,
          padding: "8px 12px", fontSize: 13, fontWeight: 600, fontFamily: "'Manrope', sans-serif",
          cursor: page >= totalPages ? "not-allowed" : "pointer", opacity: page >= totalPages ? 0.5 : 1,
        }}
      >
        Siguiente <ChevronRight size={14} />
      </button>
    </div>
  );
}

function ScoreBadge({ score }) {
  const tier = scoreTier(score);
  const style = TIER_STYLES[tier];
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      width: 52, height: 52, borderRadius: 12, background: style.bg, flexShrink: 0,
    }}>
      <span style={{ fontSize: 18, fontWeight: 700, color: style.fg, fontFamily: "'Manrope', sans-serif", lineHeight: 1 }}>
        {score}
      </span>
    </div>
  );
}

function ZenviaButton({ prospectId }) {
  const zenviaBase = import.meta.env.VITE_ZENVIA_WEB_BASE_URL;
  const btnStyle = {
    display: "flex", alignItems: "center", gap: 6, textDecoration: "none",
    background: COLORS.green, color: "white", border: "none", borderRadius: 8,
    padding: "8px 16px", fontSize: 13, fontWeight: 600, fontFamily: "'Manrope', sans-serif",
    whiteSpace: "nowrap",
  };

  if (!prospectId) {
    return (
      <button disabled title="Esta conversación no tiene prospect_id — no se puede abrir en Zenvia." style={{ ...btnStyle, opacity: 0.45, cursor: "not-allowed" }}>
        <ExternalLink size={13} /> Abrir en Zenvia
      </button>
    );
  }
  if (!zenviaBase) {
    return (
      <button disabled title="Falta configurar VITE_ZENVIA_WEB_BASE_URL en el entorno." style={{ ...btnStyle, opacity: 0.45, cursor: "not-allowed" }}>
        <ExternalLink size={13} /> Abrir en Zenvia
      </button>
    );
  }
  return (
    <a href={`${zenviaBase}${prospectId}`} target="_blank" rel="noopener noreferrer" style={btnStyle}>
      <ExternalLink size={13} /> Abrir en Zenvia
    </a>
  );
}

function NotaEditor({ conversationId, initialNota, onSave }) {
  const [value, setValue] = useState(initialNota || "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave(conversationId, { nota: value });
    setSaving(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        placeholder="Nota de seguimiento..."
        style={{
          ...dateInputStyle, width: "100%", resize: "vertical",
          fontFamily: "'Manrope', sans-serif",
        }}
      />
      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          alignSelf: "flex-start", background: COLORS.panelAlt, color: COLORS.green,
          border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "6px 14px",
          fontSize: 12, fontWeight: 700, fontFamily: "'Manrope', sans-serif",
          cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1,
        }}
      >
        {saving ? "Guardando..." : "Guardar nota"}
      </button>
    </div>
  );
}

function FollowupRow({ group, onUpdateStatus, error, miId }) {
  const [notaOpen, setNotaOpen] = useState(false);
  const [esperaAbierta, setEsperaAbierta] = useState(false);
  const conv = group.latest;
  const sentimentInfo = SENTIMENT_ICON[normalize(conv.sentiment)];
  // El nombre manda, el procedimiento pasa a subtítulo. Un asesor llama a
  // personas, no a procedimientos: "Jeannette Salazar" es accionable de un
  // vistazo, "Abdominoplastia" obliga a abrir la conversación para saber a quién
  // se está por llamar.
  //
  // patient_name solo existe desde el 2026-09-08 (lo llena el Worker desde
  // Zenvia). El histórico sigue en null, así que el procedimiento tiene que
  // seguir sirviendo de título cuando no hay nombre — que hoy es la mayoría.
  const procedimiento = formatProcedure(conv.procedure_interest) || conv.escalation_reason || "Sin detalle";
  const title = conv.patient_name || procedimiento;
  const subtitulo = conv.patient_name ? procedimiento : null;

  return (
    <Card style={{ marginBottom: 12, padding: 16 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", width: "100%" }}>
        <ScoreBadge score={group.maxScore} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: COLORS.green, fontFamily: "'Manrope', sans-serif" }}>
              {title}
            </p>
            {subtitulo && (
              <span style={{ fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
                {subtitulo}
              </span>
            )}
            {/* Icono en vez del carácter ⚠, que cada sistema operativo dibuja
                distinto y en algunos sale a color, como un emoji. */}
            {conv.urgente && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 800,
                letterSpacing: 0.3, background: COLORS.danger, color: "#fff",
                fontFamily: "'Manrope', sans-serif", whiteSpace: "nowrap",
              }} title="Reclamo, complicación o paciente buscando otra clínica">
                <AlertTriangle size={11} strokeWidth={2.5} /> URGENTE
              </span>
            )}
            <Badge variant={conv.categoria === "cirugia" ? "gold" : "default"}>
              {CATEGORIA_LABEL[conv.categoria] || conv.categoria}
            </Badge>
            <Badge>{ORIGEN_LABEL[conv.origen] || conv.origen}</Badge>
            <Badge>{conv.channel === "facebook" ? "Facebook" : "WhatsApp"}</Badge>
            {group.count > 1 && <Badge variant="gold">{group.count} conversaciones</Badge>}
            {/* Quién lo tiene en su lista. Solo se muestra si es de OTRA
                persona: en "Mi lista" son todos míos y repetir "Mío" en las 30
                tarjetas sería ruido. En la cola completa, en cambio, es lo que
                evita que alguien trabaje un lead que ya tiene dueño. */}
            {conv.asignado_a && conv.asignado_a !== miId && conv.asignado_nombre && (
              <Badge>En la lista de {conv.asignado_nombre}</Badge>
            )}
            {sentimentInfo && (
              <span title={sentimentInfo.label} style={{ display: "flex", alignItems: "center" }}>
                <sentimentInfo.Icon size={14} color={sentimentInfo.color} />
              </span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
            {conv.message_count || 0} mensajes · {formatRelative(conv.created_at)} · {formatFullDate(conv.created_at)}
          </p>

          {/* Quién tocó este lead y cuándo — a la vista en la tarjeta, no
              escondido dentro de la nota. Es lo que evita que dos personas
              llamen al mismo paciente: aunque el realtime falle, acá se ve
              que alguien más ya lo trabajó. Solo aparece si hay un actor
              registrado (nadie tocó = tarjeta limpia). */}
          {conv.actualizado_por && (
            <p style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              margin: "6px 0 0", padding: "3px 8px", borderRadius: 6,
              fontSize: 11, fontWeight: 700, fontFamily: "'Manrope', sans-serif",
              background: (ESTADO_SELLO[conv.estado] || ESTADO_SELLO.pendiente).bg,
              color: (ESTADO_SELLO[conv.estado] || ESTADO_SELLO.pendiente).fg,
            }}>
              {SELLO_VERBO[conv.estado] || `${ESTADO_LABEL[conv.estado] || conv.estado} por`} {conv.actualizado_por}
              {conv.estado === "en_espera" && conv.esperar_hasta && (
                <> · vuelve el {new Date(conv.esperar_hasta).toLocaleDateString("es-CR", { day: "numeric", month: "short" })}</>
              )}
              {conv.estado_actualizado_en && ` · ${formatRelative(conv.estado_actualizado_en)}`}
            </p>
          )}
        </div>

        <select
          value={conv.estado}
          onChange={(e) => {
            const nuevo = e.target.value;
            if (nuevo !== "en_espera") {
              // Salir de "en espera" limpia la fecha: si no, quedaría una
              // fecha vieja colgando que confunde al leer la fila.
              setEsperaAbierta(false);
              onUpdateStatus(conv.id, { estado: nuevo, esperar_hasta: null });
              return;
            }
            // El <select> es controlado por conv.estado, así que si no se
            // guarda nada vuelve solo a lo que estaba: abrir el selector de
            // plazo no compromete el cambio hasta que se elige un plazo.
            setEsperaAbierta(true);
          }}
          style={{ ...SELECT_STYLE, flexShrink: 0 }}
        >
          {ESTADO_OPTIONS.map((v) => <option key={v} value={v}>{ESTADO_LABEL[v]}</option>)}
        </select>

        <ZenviaButton prospectId={conv.prospect_id} />

        <button
          onClick={() => setNotaOpen((v) => !v)}
          title="Ver el desglose del puntaje y la nota de seguimiento"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 32, height: 32, flexShrink: 0, borderRadius: 8,
            border: `1px solid ${COLORS.border}`, background: notaOpen ? COLORS.panelAlt : "transparent",
            cursor: "pointer", color: COLORS.textMuted,
          }}
        >
          <ChevronDown size={16} style={{ transition: "transform 0.2s", transform: notaOpen ? "rotate(180deg)" : "none" }} />
        </button>
      </div>

      {/* Antes esto era un window.prompt que pedía escribir un número del 1 al
          365, con un window.alert de error si no lo era. Solo hay tres plazos
          con sentido, así que se eligen; no se escriben. Y se ven: la ventana
          del navegador no tiene los colores del sistema y algunos navegadores
          la bloquean.

          Puede que fuera el motivo de que el estado casi no se usara — 6 de
          más de 800 conversaciones trabajadas — siendo el que describe el
          desenlace más común. */}
      {esperaAbierta && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          marginTop: 12, paddingTop: 12, borderTop: `1px solid ${COLORS.border}`,
        }}>
          <span style={{ fontSize: 13, color: COLORS.text, fontFamily: "'Manrope', sans-serif" }}>
            ¿Cuándo vuelve a la lista?
          </span>
          {ESPERA_OPCIONES.map((opcion) => (
            <button
              key={opcion.dias}
              onClick={() => {
                const hasta = new Date();
                hasta.setDate(hasta.getDate() + opcion.dias);
                setEsperaAbierta(false);
                onUpdateStatus(conv.id, { estado: "en_espera", esperar_hasta: hasta.toISOString() });
              }}
              style={{
                background: COLORS.panelAlt, color: COLORS.green,
                border: `1px solid ${COLORS.border}`, borderRadius: 8,
                padding: "6px 14px", fontSize: 13, fontWeight: 700,
                fontFamily: "'Manrope', sans-serif", cursor: "pointer",
              }}
            >
              {opcion.label}
            </button>
          ))}
          <button
            onClick={() => setEsperaAbierta(false)}
            style={{
              background: "none", border: "none", padding: "6px 4px",
              fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif",
              cursor: "pointer", textDecoration: "underline",
            }}
          >
            Cancelar
          </button>
          <span style={{ fontSize: 12, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", width: "100%" }}>
            Sale de pendientes y vuelve sola en esa fecha. Al retomarla, el siguiente paso es una llamada.
          </span>
        </div>
      )}

      {error && (
        <p style={{ margin: "10px 0 0", fontSize: 12, color: COLORS.danger, fontFamily: "'Manrope', sans-serif" }}>
          No se pudo guardar: {error}
        </p>
      )}

      {notaOpen && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${COLORS.border}` }}>
          {/* El "por quién / cuándo" ya no vive acá: subió a la tarjeta, donde
              se ve sin tener que abrir la nota (era el punto ciego que dejaba
              repetir llamadas). */}
          <DesgloseScore conv={conv} />
          <NotaEditor conversationId={conv.id} initialNota={conv.nota} onSave={onUpdateStatus} />
        </div>
      )}
    </Card>
  );
}

// Cabecera de la lista del día. Es el cambio de fondo de esta pantalla: antes
// abría con 2.946 pendientes en 118 páginas, la misma lista para todos, y nadie
// sabía qué le tocaba. Ahora cada asesor trabaja sus 30.
//
// El interruptor deja ver la cola completa igual — hace falta para buscar un
// paciente concreto o revisar lo de otro — pero deja de ser lo primero que se
// ve al entrar.
function CabeceraMiLista({
  modo, setModo, mios, total, tomando, onTomar, onSoltar, error,
}) {
  const enMiLista = modo === "mias";
  const faltan = LISTA_DEL_DIA - mios;

  const tab = (activo) => ({
    padding: "7px 16px", borderRadius: 999, fontSize: 13.5, fontWeight: 700,
    fontFamily: "'Manrope', sans-serif", cursor: "pointer",
    border: `1.5px solid ${activo ? COLORS.green : COLORS.border}`,
    background: activo ? COLORS.green : "transparent",
    color: activo ? "#fff" : COLORS.text,
  });

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => setModo("mias")} aria-pressed={enMiLista} style={tab(enMiLista)}>
          Mi lista {mios > 0 && `(${mios})`}
        </button>
        <button onClick={() => setModo("todas")} aria-pressed={!enMiLista} style={tab(!enMiLista)}>
          Toda la cola
        </button>

        {enMiLista && faltan > 0 && (
          <button
            onClick={onTomar}
            disabled={tomando}
            style={{
              background: COLORS.gold, color: "#fff", border: "none", borderRadius: 8,
              padding: "8px 16px", fontSize: 13, fontWeight: 700,
              fontFamily: "'Manrope', sans-serif",
              cursor: tomando ? "not-allowed" : "pointer", opacity: tomando ? 0.6 : 1,
            }}
          >
            {tomando
              ? "Tomando..."
              : mios === 0
                ? `Tomar mis ${LISTA_DEL_DIA} leads`
                : `Completar mi lista (+${faltan})`}
          </button>
        )}

        {enMiLista && mios > 0 && (
          <button
            onClick={onSoltar}
            disabled={tomando}
            style={{
              background: "none", border: "none", padding: "8px 4px",
              fontSize: 12.5, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif",
              cursor: tomando ? "not-allowed" : "pointer", textDecoration: "underline",
            }}
          >
            Soltar los que no trabajé
          </button>
        )}
      </div>

      <p style={{ margin: "10px 0 0", fontSize: 12.5, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
        {enMiLista
          ? mios === 0
            ? `Su lista está vacía. Tome ${LISTA_DEL_DIA} leads del principio de la cola para empezar el día.`
            : `${mios} ${mios === 1 ? "lead pendiente" : "leads pendientes"} a su nombre. Los que no trabaje vuelven a la cola en 3 días.`
          : `${total.toLocaleString("es-CR")} conversaciones en la cola completa, de todos los asesores.`}
      </p>

      {error && (
        <p style={{ margin: "8px 0 0", fontSize: 12.5, color: COLORS.danger, fontFamily: "'Manrope', sans-serif" }}>
          {error}
        </p>
      )}
    </div>
  );
}

// Franja fija de urgentes. Va arriba de todo y no responde a ningún filtro ni
// al rango de fechas: son reclamos, complicaciones post-operatorias y pacientes
// que están buscando otra clínica. El score los enterraba porque mide valor
// comercial, y un caso de riesgo con un solo mensaje puntúa bajo — así llegó
// una paciente con sangrado y dolor a la página 98 de 118.
//
// Las tarjetas son las mismas de la lista, a propósito: se puede cambiar el
// estado, abrir Zenvia y dejar nota sin bajar. Al marcarlas con cualquier
// estado distinto de "pendiente" salen solas de la franja.
function BandaUrgentes({ filas, onUpdateStatus, rowErrors, miId }) {
  if (filas.length === 0) return null;

  return (
    <section
      aria-label="Casos urgentes"
      style={{
        border: `1.5px solid ${COLORS.danger}`, borderRadius: 12,
        background: COLORS.dangerBg, padding: 16, marginBottom: 24,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <AlertTriangle size={17} color={COLORS.danger} strokeWidth={2.5} />
        <h3 style={{
          margin: 0, fontSize: 15, fontWeight: 800, color: COLORS.danger,
          fontFamily: "'Manrope', sans-serif",
        }}>
          {filas.length === 1 ? "1 caso urgente sin atender" : `${filas.length} casos urgentes sin atender`}
        </h3>
        <span style={{ fontSize: 12.5, color: COLORS.danger, fontFamily: "'Manrope', sans-serif", opacity: 0.85 }}>
          Reclamos, complicaciones y pacientes buscando otra clínica. Van primero, sin importar el puntaje.
        </span>
      </header>

      {filas.map((row) => (
        <FollowupRow
          key={row.id}
          group={{ key: row.id, latest: row, count: 1, maxScore: row.score, urgente: true }}
          onUpdateStatus={onUpdateStatus}
          error={rowErrors[row.id]}
          miId={miId}
        />
      ))}

      {filas.length >= URGENTES_TOPE && (
        <p style={{ margin: "4px 0 0", fontSize: 12, color: COLORS.danger, fontFamily: "'Manrope', sans-serif", fontWeight: 600 }}>
          Se muestran los {URGENTES_TOPE} más recientes. Que la lista llegue a este tope
          es señal de que el criterio de urgencia está marcando de más — conviene revisarlo.
        </p>
      )}
    </section>
  );
}

export function SeguimientoSection({ profile }) {
  const isMobile = useIsMobile();
  const actor = profile?.full_name || "Equipo comercial";
  // El id, no el nombre: hay dos perfiles llamados "Juan Pablo Gamboa", así que
  // comparar por texto le mostraría a uno la lista del otro.
  const miId = profile?.id || null;

  const [from, setFrom] = useState(clampToMinDate(daysAgoISO(30)));
  const [to, setTo] = useState(todayISO());

  const [origen, setOrigen] = useState("todos");
  const [categoria, setCategoria] = useState("todos");
  const [estado, setEstado] = useState("pendiente");
  const [canal, setCanal] = useState("todos");
  const [procedimiento, setProcedimiento] = useState("todos");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // "mias" | "todas". Arranca en la lista del día: es lo que un asesor viene a
  // hacer. La cola completa sigue a un clic para buscar un paciente concreto.
  const [modo, setModo] = useState("mias");
  const [tomando, setTomando] = useState(false);
  const [errorLista, setErrorLista] = useState(null);

  // Los urgentes viven aparte de rawRows porque no comparten alcance: la lista
  // respeta el rango de fechas y los filtros, la franja no.
  const [urgentes, setUrgentes] = useState([]);

  const [rawRows, setRawRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rowErrors, setRowErrors] = useState({});

  const [kpis, setKpis] = useState({ pendientes: null, pendientesCirugia: null, contactadosSemana: null, agendados: null });
  const [kpisLoading, setKpisLoading] = useState(true);

  // "conectando" | "vivo" | "caido" — estado de la suscripción realtime. Se
  // muestra en pantalla a propósito: si el canal se cae, el equipo tiene que
  // saber que está viendo una foto vieja y que le toca recargar, en vez de
  // confiar en que los cambios de los demás van a aparecer solos.
  const [liveStatus, setLiveStatus] = useState("conectando");

  // Bumpear reloadKey vuelve a traer la lista sin recargar la página. Lo usa
  // la reconexión del canal y el botón del indicador cuando está caído.
  const [reloadKey, setReloadKey] = useState(0);

  // Realtime NO reenvía lo que se perdió mientras el canal estuvo caído: si a
  // alguien se le duerme la laptop, al volver el socket se reengancha y los
  // cambios de ese hueco no llegan nunca. Sin este flag el indicador diría
  // "En vivo" sobre datos viejos — peor que no tener realtime, porque miente
  // con confianza. Por eso cada RE-conexión (no la primera) refresca la lista.
  const yaEstuvoEnVivo = useRef(false);

  // Rango de la última carga, para distinguir "carga nueva" (montaje o cambio
  // de fechas → pantalla de carga) de "refresco" (reconexión o botón → en
  // silencio, sin desarmar la lista que el equipo está mirando).
  const prevRangeRef = useRef(null);
  const [refreshing, setRefreshing] = useState(false);

  // El rango vive en un ref además de en el estado para que la suscripción
  // realtime no se tenga que recrear cada vez que alguien mueve las fechas —
  // el handler necesita el rango solo para recontar los KPIs.
  const rangeRef = useRef({ from, to });
  useEffect(() => { rangeRef.current = { from, to }; }, [from, to]);

  // Si alguna de las 4 queries falla (p.ej. la tabla/vista todavía no existe),
  // el KPI queda en null y se muestra "—" en vez de "0" — un 0 falso podría
  // leerse como "no hay pendientes" cuando en realidad la carga falló.
  //
  // "Pendientes de contactar"/"Pendientes de cirugía" respetan el rango de
  // fechas elegido (from/to) para no quedar como un conteo histórico abierto.
  // "En seguimiento abierto" y "Agendados desde el módulo" quedan fuera del
  // rango a propósito: tienen su propio período con sentido (semana
  // calendario / total histórico acumulado).
  const loadKpis = useCallback(async (rangeFrom, rangeTo) => {
    setKpisLoading(true);
    const weekStart = `${startOfWeekISO()}T00:00:00-06:00`;
    const rangeStart = `${rangeFrom}T00:00:00-06:00`;
    const rangeEnd = `${rangeTo}T23:59:59-06:00`;
    const [pendientes, pendientesCirugia, contactadosSemana, agendados] = await Promise.all([
      supabase.from("sofia_followup_queue").select("id", { count: "exact", head: true }).eq("estado", "pendiente").gte("created_at", rangeStart).lte("created_at", rangeEnd),
      supabase.from("sofia_followup_queue").select("id", { count: "exact", head: true }).eq("estado", "pendiente").eq("categoria", "cirugia").gte("created_at", rangeStart).lte("created_at", rangeEnd),
      supabase.from("sofia_followup_status").select("conversation_id", { count: "exact", head: true }).eq("estado", "contactado").gte("updated_at", weekStart),
      supabase.from("sofia_followup_status").select("conversation_id", { count: "exact", head: true }).eq("estado", "agendo"),
    ]);
    // OJO: para queries head:true, PostgREST puede responder 204 con
    // count:null y error:null cuando la tabla/vista no existe (no siempre
    // llena `error`) — por eso el fallo se detecta por count == null, no
    // solo por `error`, y así nunca se confunde un fallo con un 0 real.
    setKpis({
      pendientes: pendientes.error || pendientes.count == null ? null : pendientes.count,
      pendientesCirugia: pendientesCirugia.error || pendientesCirugia.count == null ? null : pendientesCirugia.count,
      contactadosSemana: contactadosSemana.error || contactadosSemana.count == null ? null : contactadosSemana.count,
      agendados: agendados.error || agendados.count == null ? null : agendados.count,
    });
    setKpisLoading(false);
  }, []);

  useEffect(() => { loadKpis(from, to); }, [loadKpis, from, to]);

  useEffect(() => {
    // Misma guarda que en SofiaMetricsSection: fetchAllInRange pagina de a
    // 1000 filas, así que cambiar de fecha durante una carga dejaba que la
    // respuesta del rango viejo pisara a la del nuevo.
    let cancelled = false;

    // Un refetch por reconexión (o por el botón del indicador) NO es una carga
    // nueva: la lista de abajo sigue siendo válida. Blanquearla con "Cargando
    // seguimiento..." haría parpadear la pantalla cada vez que se recupera el
    // wifi. Solo el montaje y el cambio de rango muestran el estado de carga
    // completo; el resto refresca en silencio, con un "Actualizando..." chico.
    const rangeKey = `${from}|${to}`;
    const esCargaNueva = prevRangeRef.current !== rangeKey;
    prevRangeRef.current = rangeKey;

    (async () => {
      if (esCargaNueva) setLoading(true);
      else setRefreshing(true);
      setError(null);
      const { data, error: fetchError } = await fetchAllInRange(from, to);
      if (cancelled) return;
      if (fetchError) setError(fetchError.message);
      else setRawRows(data || []);
      setLoading(false);
      setRefreshing(false);
    })();
    return () => { cancelled = true; };
  }, [from, to, reloadKey]);

  // La franja de urgentes se recarga solo al montar y en cada reconexión — no
  // depende de from/to, que es justamente lo que la hace confiable: mover las
  // fechas no puede esconder un caso de riesgo.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: urgErr } = await fetchUrgentesAbiertos();
      if (cancelled) return;
      // Un fallo acá no bloquea la pantalla: la lista de abajo sigue sirviendo,
      // y los urgentes igual salen primeros dentro de ella.
      if (!urgErr) setUrgentes(data || []);
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  // Pide la lista del día. La función de Postgres decide todo a partir de
  // auth.uid(): no se le manda a quién asignar, así que nadie puede llenarle
  // la lista a otro. Devuelve cuántos agregó — 0 si ya estaba llena, o si otro
  // asesor se llevó los candidatos entre que se leyó la cola y se escribió.
  const tomarMiLista = useCallback(async () => {
    setTomando(true);
    setErrorLista(null);
    const { data, error: rpcError } = await supabase.rpc("asignar_mi_lista", { p_limite: LISTA_DEL_DIA });
    if (rpcError) {
      setErrorLista(`No se pudo tomar la lista: ${rpcError.message}`);
    } else if (data === 0) {
      setErrorLista("No quedan leads sin asignar en la cola. Los demás asesores ya los tienen.");
    } else {
      setReloadKey((k) => k + 1);
    }
    setTomando(false);
  }, []);

  const soltarMiLista = useCallback(async () => {
    setTomando(true);
    setErrorLista(null);
    const { error: rpcError } = await supabase.rpc("soltar_mi_lista");
    if (rpcError) setErrorLista(`No se pudo soltar la lista: ${rpcError.message}`);
    else setReloadKey((k) => k + 1);
    setTomando(false);
  }, []);

  // Cambiar cualquier filtro vuelve a la página 1 — si no, se puede quedar
  // viendo una página que ya no existe con el filtro nuevo.
  useEffect(() => { setPage(1); }, [from, to, modo, origen, categoria, estado, canal, procedimiento, search]);

  // Aplica a la lista en memoria un cambio hecho por OTRA persona (o por uno
  // mismo en otra pestaña) que llegó por realtime.
  const applyRemoteStatus = useCallback((statusRow) => {
    if (!statusRow?.conversation_id) return;

    // Las dos listas: la de abajo y la franja de urgentes. Si el cambio deja
    // la conversación en un estado distinto de "pendiente", sale sola de la
    // franja al pintar.
    setRawRows((rows) => conEstadoAplicado(rows, statusRow));
    setUrgentes((rows) => conEstadoAplicado(rows, statusRow));

    // Los KPIs se recuentan siempre, aunque la fila no esté en la lista
    // cargada: "En seguimiento abierto" y "Agendados desde el módulo" tienen
    // su propio período y pueden moverse por una conversación fuera del rango
    // que se está viendo.
    const { from: rangeFrom, to: rangeTo } = rangeRef.current;
    loadKpis(rangeFrom, rangeTo);
  }, [loadKpis]);

  // Suscripción realtime a sofia_followup_status. Sin esto el módulo cargaba
  // la lista una sola vez y dos personas podían llamar al mismo paciente: el
  // estado se guardaba compartido, pero nadie se enteraba hasta recargar.
  //
  // La tabla está en la publicación supabase_realtime desde la migración
  // 20260902231711 — sin esa parte, este canal conecta igual ("SUBSCRIBED")
  // pero no llega ni un evento.
  //
  // Solo INSERT y UPDATE: la app nunca borra filas de estado. El único DELETE
  // posible viene del ON DELETE CASCADE de sofia_conversations, y en ese caso
  // desaparece también la conversación, así que la fila se va de la vista en
  // la siguiente carga igual.
  useEffect(() => {
    // Sufijo aleatorio en el topic: StrictMode monta, desmonta y vuelve a
    // montar los efectos en desarrollo, y removeChannel() es asíncrono — dos
    // canales con el MISMO topic solapados se pisan y pueden duplicar eventos
    // o no suscribirse. Con un topic por montaje eso no puede pasar.
    const channel = supabase
      .channel(`seguimiento-followup-status-${Math.random().toString(36).slice(2, 10)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sofia_followup_status" },
        (payload) => applyRemoteStatus(payload.new)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sofia_followup_status" },
        (payload) => applyRemoteStatus(payload.new)
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setLiveStatus("vivo");
          // Primera conexión: la carga inicial ya está en camino, no hay nada
          // que recuperar. Re-conexión: hay que volver a traer la lista,
          // porque los eventos del hueco no se reenvían.
          if (yaEstuvoEnVivo.current) setReloadKey((k) => k + 1);
          else yaEstuvoEnVivo.current = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setLiveStatus("caido");
        } else {
          setLiveStatus("conectando");
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [applyRemoteStatus]);

  const updateStatus = useCallback(async (conversationId, patch) => {
    // La fila puede venir de la lista o de la franja de urgentes — para el
    // rollback sirve la que se encuentre primero.
    const prevRow = rawRows.find((r) => r.id === conversationId)
      || urgentes.find((r) => r.id === conversationId);
    // El optimista incluye estado_actualizado_en para que el sello de la
    // tarjeta diga "hace un momento" sin esperar el eco del realtime; cuando
    // llega el evento se pisa con el updated_at real del trigger.
    const optimista = (rows) => rows.map((r) => (
      r.id === conversationId
        ? { ...r, ...patch, actualizado_por: actor, estado_actualizado_en: new Date().toISOString() }
        : r
    ));
    setRawRows(optimista);
    setUrgentes(optimista);
    setRowErrors((errs) => { const next = { ...errs }; delete next[conversationId]; return next; });

    const { error: upsertError } = await supabase
      .from("sofia_followup_status")
      .upsert({ conversation_id: conversationId, actualizado_por: actor, ...patch }, { onConflict: "conversation_id" });

    if (upsertError) {
      // Rollback quirúrgico: se repone SOLO esta fila. Antes se restauraba el
      // array entero, y con realtime encima eso borraría los cambios que
      // otras personas hicieron mientras este upsert estaba en vuelo.
      if (prevRow) {
        const reponer = (rows) => rows.map((r) => (r.id === conversationId ? prevRow : r));
        setRawRows(reponer);
        setUrgentes(reponer);
      }
      setRowErrors((errs) => ({ ...errs, [conversationId]: upsertError.message }));
    } else if (patch.estado) {
      loadKpis(from, to);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawRows, urgentes, actor, loadKpis, from, to]);

  // Lo que se pinta en la franja: solo los que siguen pendientes. Al cambiarle
  // el estado a uno, sale de acá sin necesidad de recargar.
  const urgentesAbiertos = useMemo(
    () => urgentes.filter((r) => r.estado === "pendiente"),
    [urgentes]
  );

  // Cuántos leads tiene el asesor pendientes a su nombre. Se cuenta sobre el
  // rango cargado, que es de dónde sale la lista que va a trabajar.
  const misPendientes = useMemo(
    () => rawRows.filter((r) => r.asignado_a === miId && r.estado === "pendiente").length,
    [rawRows, miId]
  );

  // Los que ya están en la franja no se repiten abajo: verlos dos veces en la
  // misma pantalla se lee como un error del sistema, y además invita a que dos
  // personas trabajen la misma tarjeta creyendo que son casos distintos.
  const enLaFranja = useMemo(
    () => new Set(urgentesAbiertos.map((r) => r.id)),
    [urgentesAbiertos]
  );

  const filtered = useMemo(() => {
    const q = normalize(search);
    return rawRows.filter((r) => {
      if (enLaFranja.has(r.id)) return false;
      // "Mi lista" es el modo por defecto: solo lo asignado a esta persona.
      if (modo === "mias" && r.asignado_a !== miId) return false;
      if (origen !== "todos" && r.origen !== origen) return false;
      if (categoria !== "todos" && r.categoria !== categoria) return false;
      if (estado !== "todos" && r.estado !== estado) return false;
      if (canal !== "todos" && r.channel !== canal) return false;
      if (!matchesProcedure(r.procedure_code, procedimiento)) return false;
      // El buscador miraba SOLO procedure_interest, que es una etiqueta de 2-4
      // palabras. Todo el contexto clínico que escribe Sofía vive en
      // escalation_reason —"solicita hablar con director", "consultando con otro
      // cirujano en Bogotá"— y era inbuscable. Buscar "director" no devolvía
      // nada aunque la conversación tratara exactamente de eso.
      if (q && !normalize(r.procedure_interest).includes(q)
            && !normalize(r.escalation_reason).includes(q)
            && !normalize(r.patient_name).includes(q)) return false;
      return true;
    });
  }, [rawRows, enLaFranja, modo, miId, origen, categoria, estado, canal, procedimiento, search]);

  const grouped = useMemo(() => groupByPhone(filtered), [filtered]);
  const totalPages = Math.max(1, Math.ceil(grouped.length / PAGE_SIZE));
  const pageItems = grouped.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <SectionHeader
        icon={<PhoneCall size={20} color={COLORS.gold} />}
        subtitle="Conversaciones de Sofía que quedaron abiertas sin venta — escaladas sin cita y cerradas sin escalar, priorizadas por score."
      />

      {/* Antes que los indicadores y que cualquier filtro: es lo primero que
          tiene que ver quien abre la pantalla. */}
      <CabeceraMiLista
        modo={modo} setModo={setModo}
        mios={misPendientes} total={rawRows.length}
        tomando={tomando} onTomar={tomarMiLista} onSoltar={soltarMiLista}
        error={errorLista}
      />

      <BandaUrgentes
        filas={urgentesAbiertos}
        onUpdateStatus={updateStatus}
        rowErrors={rowErrors}
        miId={miId}
      />

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", gap: 16, marginBottom: 24 }}>
        <Card>
          <MetricKpi label="Pendientes de contactar" value={kpisLoading || kpis.pendientes === null ? "—" : `${kpis.pendientes}`} sub="En el rango elegido" />
        </Card>
        <Card>
          <MetricKpi label="Pendientes de cirugía" value={kpisLoading || kpis.pendientesCirugia === null ? "—" : `${kpis.pendientesCirugia}`} sub="Sobre los pendientes del rango" />
        </Card>
        <Card>
          {/* La consulta cuenta filas cuyo estado ACTUAL es "contactado", así
              que un lead que avanza a "agendó" sale de este número. Por eso la
              etiqueta no dice "Contactados esta semana": así dicha, bajaba
              cuando el equipo trabajaba mejor. Dice lo que el número es —
              leads contactados que siguen abiertos. Para contar contactos de
              verdad haría falta guardar cuándo se contactó cada uno, y hoy la
              tabla no lo guarda: solo el último estado. */}
          <MetricKpi label="En seguimiento abierto" value={kpisLoading || kpis.contactadosSemana === null ? "—" : `${kpis.contactadosSemana}`} sub="Contactados esta semana, sin cerrar" />
        </Card>
        <Card>
          <MetricKpi label="Agendados desde el módulo" value={kpisLoading || kpis.agendados === null ? "—" : `${kpis.agendados}`} sub="Total histórico" />
        </Card>
      </div>

      <FilterBar
        from={from} to={to} setFrom={setFrom} setTo={setTo}
        origen={origen} setOrigen={setOrigen}
        categoria={categoria} setCategoria={setCategoria}
        estado={estado} setEstado={setEstado}
        canal={canal} setCanal={setCanal}
        procedimiento={procedimiento} setProcedimiento={setProcedimiento}
        search={search} setSearch={setSearch}
      />

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginBottom: 12 }}>
        {refreshing && (
          <span style={{ fontSize: 12, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
            Actualizando...
          </span>
        )}
        <LiveIndicator status={liveStatus} onReload={() => setReloadKey((k) => k + 1)} />
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {loading && (
        <p style={{ textAlign: "center", fontSize: 14, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", padding: "40px 0" }}>
          Cargando...
        </p>
      )}

      {!loading && !error && pageItems.length === 0 && (
        modo === "mias" && misPendientes === 0 ? (
          // En "Mi lista" el vacío no es un problema de filtros: es que
          // todavía no tomó leads. Decirle que amplíe el rango lo mandaría a
          // buscar donde no está la solución.
          <EmptyState
            title="Su lista está vacía"
            description={`Tome ${LISTA_DEL_DIA} leads del principio de la cola con el botón de arriba. Son los de mayor prioridad que nadie más tiene asignados.`}
          />
        ) : (
          <EmptyState
            title="Sin conversaciones para estos filtros"
            description={rawRows.length > 0
              ? "Ninguna conversación del rango elegido cumple los filtros actuales. Amplíe el rango de fechas o quite alguno de los filtros."
              : "No hay conversaciones que califiquen para seguimiento en este rango de fechas."}
          />
        )
      )}

      {!loading && !error && pageItems.length > 0 && (
        <div>
          {pageItems.map((group) => (
            <FollowupRow
              key={group.key}
              group={group}
              onUpdateStatus={updateStatus}
              error={rowErrors[group.latest.id]}
              miId={miId}
            />
          ))}
        </div>
      )}

      {!loading && !error && (
        <PaginationControls
          page={page}
          totalPages={totalPages}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        />
      )}
    </div>
  );
}
