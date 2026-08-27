import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PhoneCall, ExternalLink, ChevronDown, ChevronLeft, ChevronRight, Smile, Minus, Frown } from "lucide-react";
import { COLORS } from "../../constants/colors.js";
import { PROCEDURE_GROUPS, matchesProcedure, formatProcedure } from "../../constants/procedures.js";
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

const QUEUE_COLUMNS = "id, phone_number, phone_hash, procedure_interest, escalation_reason, channel, message_count, sentiment, created_at, prospect_id, origen, categoria, score, estado, nota, actualizado_por";

const ORIGEN_LABEL = { escalada_sin_cita: "Escalada sin cita", cerrada_sin_escalar: "Cerrada sin escalar" };
const CATEGORIA_LABEL = { cirugia: "Cirugía", tratamiento_no_quirurgico: "No quirúrgico" };
const ESTADO_LABEL = {
  pendiente: "Pendiente", contactado: "Contactado", agendo: "Agendó",
  descartado: "Descartado", no_contactable: "No contactable",
};
const ESTADO_OPTIONS = ["pendiente", "contactado", "agendo", "descartado", "no_contactable"];

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

// Lunes de la semana actual en hora de Costa Rica, para el KPI "Contactados
// esta semana". Se calcula sobre los componentes de fecha (año/mes/día) del
// día de hoy en CR, no sobre timestamps UTC, para que el corte de semana no
// se desplace por el offset horario.
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
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
          Desde
          <input type="date" value={from} min={MIN_DATE} max={to} onChange={(e) => setFrom(clampToMinDate(e.target.value))} style={dateInputStyle} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
          Hasta
          <input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} style={dateInputStyle} />
        </label>

        <select value={origen} onChange={(e) => setOrigen(e.target.value)} style={SELECT_STYLE}>
          <option value="todos">Origen: todos</option>
          <option value="escalada_sin_cita">Escalada sin cita</option>
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

        <FilterSelect value={procedimiento} onChange={setProcedimiento} options={PROCEDURE_GROUPS} />
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
        </div>

        <select
          value={conv.estado}
          onChange={(e) => onUpdateStatus(conv.id, { estado: e.target.value })}
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
          <NotaEditor conversationId={conv.id} initialNota={conv.nota} onSave={onUpdateStatus} />
          {conv.actualizado_por && (
            <p style={{ margin: "8px 0 0", fontSize: 11, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
              Última actualización por {conv.actualizado_por}
            </p>
          )}
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
  const [page, setPage] = useState(1);

  const [rawRows, setRawRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rowErrors, setRowErrors] = useState({});

  const [kpis, setKpis] = useState({ pendientes: null, pendientesCirugia: null, contactadosSemana: null, agendados: null });
  const [kpisLoading, setKpisLoading] = useState(true);

  // Si alguna de las 4 queries falla (p.ej. la tabla/vista todavía no existe),
  // el KPI queda en null y se muestra "—" en vez de "0" — un 0 falso podría
  // leerse como "no hay pendientes" cuando en realidad la carga falló.
  //
  // "Pendientes de contactar"/"Pendientes de cirugía" respetan el rango de
  // fechas elegido (from/to) para no quedar como un conteo histórico abierto.
  // "Contactados esta semana" y "Agendados desde el módulo" quedan fuera del
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
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await fetchAllInRange(from, to);
      if (cancelled) return;
      if (fetchError) setError(fetchError.message);
      else setRawRows(data || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [from, to]);

  // Cambiar cualquier filtro vuelve a la página 1 — si no, se puede quedar
  // viendo una página que ya no existe con el filtro nuevo.
  useEffect(() => { setPage(1); }, [from, to, origen, categoria, estado, canal, procedimiento, search]);

  const updateStatus = useCallback(async (conversationId, patch) => {
    const prevRows = rawRows;
    setRawRows((rows) => rows.map((r) => (r.id === conversationId ? { ...r, ...patch, actualizado_por: actor } : r)));
    setRowErrors((errs) => { const next = { ...errs }; delete next[conversationId]; return next; });

    const { error: upsertError } = await supabase
      .from("sofia_followup_status")
      .upsert({ conversation_id: conversationId, actualizado_por: actor, ...patch }, { onConflict: "conversation_id" });

    if (upsertError) {
      setRawRows(prevRows);
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
      if (!matchesProcedure(r.procedure_interest, procedimiento)) return false;
      if (q && !normalize(r.procedure_interest).includes(q)) return false;
      return true;
    });
  }, [rawRows, origen, categoria, estado, canal, procedimiento, search]);

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
          <MetricKpi label="Contactados esta semana" value={kpisLoading || kpis.contactadosSemana === null ? "—" : `${kpis.contactadosSemana}`} sub="Desde el lunes" />
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
