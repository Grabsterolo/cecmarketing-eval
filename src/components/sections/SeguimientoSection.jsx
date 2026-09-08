import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PhoneCall, ExternalLink, ChevronDown, ChevronLeft, ChevronRight, Smile, Minus, Frown, Radio, RadioTower } from "lucide-react";
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
// mismo punto de partida que Leads Potenciales y Métricas Sofía.
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
const QUEUE_COLUMNS = "id, phone_number, phone_hash, procedure_interest, procedure_code, escalation_reason, channel, message_count, sentiment, created_at, prospect_id, origen, categoria, score, estado, nota, actualizado_por, estado_actualizado_en, urgente, esperar_hasta";

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
// mismo patrón que LeadsCalientesSection y SofiaMetricsSection.
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
      groups.set(key, { key, latest: row, count: 1, maxScore: row.score });
      return;
    }
    existing.count += 1;
    existing.maxScore = Math.max(existing.maxScore, row.score);
    if (new Date(row.created_at) > new Date(existing.latest.created_at)) {
      existing.latest = row;
    }
  });
  const list = [...groups.values()];
  list.sort((a, b) => b.maxScore - a.maxScore || new Date(b.latest.created_at) - new Date(a.latest.created_at));
  return list;
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
  soloUrgentes, setSoloUrgentes, cuantosUrgentes,
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
          Desde
          <input type="date" value={from} min={MIN_DATE} max={to} onChange={(e) => setFrom(clampToMinDate(e.target.value))} style={dateInputStyle} />
        </label>
        {/* Ver lo que entró hoy exigía mover dos selectores de fecha. Los leads
            del día son justo los que todavía se pueden recuperar. */}
        <button
          onClick={() => { setFrom(todayISO()); setTo(todayISO()); }}
          style={{
            padding: "6px 14px", borderRadius: 999, fontSize: 13, fontWeight: 600,
            fontFamily: "'Manrope', sans-serif", cursor: "pointer",
            border: `1.5px solid ${from === todayISO() && to === todayISO() ? COLORS.green : COLORS.border}`,
            background: from === todayISO() && to === todayISO() ? COLORS.green : "transparent",
            color: from === todayISO() && to === todayISO() ? "#fff" : COLORS.text,
          }}
        >
          Hoy
        </button>
        {cuantosUrgentes > 0 && (
          <button
            onClick={() => setSoloUrgentes((v) => !v)}
            title="Reclamos, complicaciones post-operatorias y pacientes buscando otra clínica"
            style={{
              padding: "6px 14px", borderRadius: 999, fontSize: 13, fontWeight: 700,
              fontFamily: "'Manrope', sans-serif", cursor: "pointer",
              border: `1.5px solid ${COLORS.danger}`,
              background: soloUrgentes ? COLORS.danger : COLORS.dangerBg,
              color: soloUrgentes ? "#fff" : COLORS.danger,
            }}
          >
            ⚠ Urgentes ({cuantosUrgentes})
          </button>
        )}
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

function FollowupRow({ group, onUpdateStatus, error }) {
  const [notaOpen, setNotaOpen] = useState(false);
  const conv = group.latest;
  const sentimentInfo = SENTIMENT_ICON[normalize(conv.sentiment)];
  const title = formatProcedure(conv.procedure_interest) || conv.escalation_reason || "Sin detalle";

  return (
    <Card style={{ marginBottom: 12, padding: 16 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", width: "100%" }}>
        <ScoreBadge score={group.maxScore} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: COLORS.green, fontFamily: "'Manrope', sans-serif" }}>
              {title}
            </p>
            {conv.urgente && (
              <span style={{
                padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 800,
                letterSpacing: 0.3, background: COLORS.danger, color: "#fff",
                fontFamily: "'Manrope', sans-serif", whiteSpace: "nowrap",
              }} title="Reclamo, complicación o paciente buscando otra clínica">
                ⚠ URGENTE
              </span>
            )}
            <Badge variant={conv.categoria === "cirugia" ? "gold" : "default"}>
              {CATEGORIA_LABEL[conv.categoria] || conv.categoria}
            </Badge>
            <Badge>{ORIGEN_LABEL[conv.origen] || conv.origen}</Badge>
            <Badge>{conv.channel === "facebook" ? "Facebook" : "WhatsApp"}</Badge>
            {group.count > 1 && <Badge variant="gold">{group.count} conversaciones</Badge>}
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
              onUpdateStatus(conv.id, { estado: nuevo, esperar_hasta: null });
              return;
            }
            const dias = window.prompt(
              "¿En cuántos días vuelve a aparecer?\n\nEscribí 5, 15 o 30. Mientras tanto sale de la lista de pendientes.",
              "15"
            );
            if (dias === null) return;
            const n = parseInt(dias, 10);
            if (!Number.isFinite(n) || n < 1 || n > 365) {
              window.alert("Poné un número de días entre 1 y 365.");
              return;
            }
            const hasta = new Date();
            hasta.setDate(hasta.getDate() + n);
            onUpdateStatus(conv.id, { estado: "en_espera", esperar_hasta: hasta.toISOString() });
          }}
          style={{ ...SELECT_STYLE, flexShrink: 0 }}
        >
          {ESTADO_OPTIONS.map((v) => <option key={v} value={v}>{ESTADO_LABEL[v]}</option>)}
        </select>

        <ZenviaButton prospectId={conv.prospect_id} />

        <button
          onClick={() => setNotaOpen((v) => !v)}
          title="Nota de seguimiento"
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
          <NotaEditor conversationId={conv.id} initialNota={conv.nota} onSave={onUpdateStatus} />
        </div>
      )}
    </Card>
  );
}

export function SeguimientoSection({ profile }) {
  const isMobile = useIsMobile();
  const actor = profile?.full_name || "Equipo comercial";

  const [from, setFrom] = useState(clampToMinDate(daysAgoISO(30)));
  const [to, setTo] = useState(todayISO());

  const [origen, setOrigen] = useState("todos");
  const [categoria, setCategoria] = useState("todos");
  const [estado, setEstado] = useState("pendiente");
  const [canal, setCanal] = useState("todos");
  const [procedimiento, setProcedimiento] = useState("todos");
  const [search, setSearch] = useState("");
  const [soloUrgentes, setSoloUrgentes] = useState(false);
  const [page, setPage] = useState(1);

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

  // Cambiar cualquier filtro vuelve a la página 1 — si no, se puede quedar
  // viendo una página que ya no existe con el filtro nuevo.
  useEffect(() => { setPage(1); }, [from, to, origen, categoria, estado, canal, procedimiento, search, soloUrgentes]);

  // Aplica a la lista en memoria un cambio hecho por OTRA persona (o por uno
  // mismo en otra pestaña) que llegó por realtime.
  const applyRemoteStatus = useCallback((statusRow) => {
    if (!statusRow?.conversation_id) return;

    setRawRows((rows) => {
      let hit = false;
      const next = rows.map((r) => {
        if (r.id !== statusRow.conversation_id) return r;
        hit = true;
        // Se copian SOLO estos cuatro campos, nada de spread del payload: el
        // evento trae las columnas de sofia_followup_status, y su created_at
        // es el de la fila de ESTADO — un spread pisaría el created_at de la
        // conversación, que es el que ordena la lista y fecha la tarjeta.
        return {
          ...r,
          estado: statusRow.estado,
          nota: statusRow.nota,
          actualizado_por: statusRow.actualizado_por,
          estado_actualizado_en: statusRow.updated_at,
        };
      });
      return hit ? next : rows;
    });

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
    const prevRow = rawRows.find((r) => r.id === conversationId);
    // El optimista incluye estado_actualizado_en para que el sello de la
    // tarjeta diga "hace un momento" sin esperar el eco del realtime; cuando
    // llega el evento se pisa con el updated_at real del trigger.
    setRawRows((rows) => rows.map((r) => (
      r.id === conversationId
        ? { ...r, ...patch, actualizado_por: actor, estado_actualizado_en: new Date().toISOString() }
        : r
    )));
    setRowErrors((errs) => { const next = { ...errs }; delete next[conversationId]; return next; });

    const { error: upsertError } = await supabase
      .from("sofia_followup_status")
      .upsert({ conversation_id: conversationId, actualizado_por: actor, ...patch }, { onConflict: "conversation_id" });

    if (upsertError) {
      // Rollback quirúrgico: se repone SOLO esta fila. Antes se restauraba el
      // array entero, y con realtime encima eso borraría los cambios que
      // otras personas hicieron mientras este upsert estaba en vuelo.
      if (prevRow) setRawRows((rows) => rows.map((r) => (r.id === conversationId ? prevRow : r)));
      setRowErrors((errs) => ({ ...errs, [conversationId]: upsertError.message }));
    } else if (patch.estado) {
      loadKpis(from, to);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawRows, actor, loadKpis, from, to]);

  const filtered = useMemo(() => {
    const q = normalize(search);
    return rawRows.filter((r) => {
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
            && !normalize(r.escalation_reason).includes(q)) return false;
      if (soloUrgentes && !r.urgente) return false;
      return true;
    });
  }, [rawRows, origen, categoria, estado, canal, procedimiento, search, soloUrgentes]);

  const grouped = useMemo(() => groupByPhone(filtered), [filtered]);
  const totalPages = Math.max(1, Math.ceil(grouped.length / PAGE_SIZE));
  const pageItems = grouped.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <SectionHeader
        icon={<PhoneCall size={20} color={COLORS.gold} />}
        subtitle="Conversaciones de Sofía que quedaron abiertas sin venta — escaladas sin cita y cerradas sin escalar, priorizadas por score."
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
        soloUrgentes={soloUrgentes} setSoloUrgentes={setSoloUrgentes}
        cuantosUrgentes={rawRows.filter((r) => r.urgente && r.estado === "pendiente").length}
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
          Cargando seguimiento...
        </p>
      )}

      {!loading && !error && pageItems.length === 0 && (
        <EmptyState
          title="Sin conversaciones para estos filtros"
          description={rawRows.length > 0
            ? "Ninguna conversación del rango elegido califica con los filtros actuales — probá ampliar el rango o cambiar un filtro."
            : "No hay conversaciones que califiquen para seguimiento en este rango de fechas."}
        />
      )}

      {!loading && !error && pageItems.length > 0 && (
        <div>
          {pageItems.map((group) => (
            <FollowupRow
              key={group.key}
              group={group}
              onUpdateStatus={updateStatus}
              error={rowErrors[group.latest.id]}
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
