import React, { useState, useEffect } from "react";
import { Flame, ExternalLink, Copy, Check, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { COLORS } from "../../constants/colors.js";
import { PROCEDURE_GROUPS, procedureOrFilter } from "../../constants/procedures.js";
import { Card } from "../ui/Card.jsx";
import { SELECT_STYLE, FilterSelect } from "../ui/FilterSelect.jsx";
import { Badge } from "../ui/Badge.jsx";
import { ErrorBanner } from "../ui/ErrorBanner.jsx";
import { EmptyState } from "../ui/EmptyState.jsx";
import { SectionHeader } from "../ui/SectionHeader.jsx";
import { supabase } from "../../lib/supabase.js";

// Leads Potenciales solo cuenta conversaciones desde este punto en
// adelante — se decidió no usar el backlog histórico porque prospect_id
// apenas se empezó a llenar el 5 de agosto y el volumen viejo no es
// representativo (conversaciones sin prospect_id no tienen forma de abrir
// en Zenvia, así que mezclarlas con las nuevas solo genera ruido).
const LEADS_LIVE_SINCE = "2026-08-06T00:00:00-06:00";

const PAGE_SIZE = 20;

// --- Clasificación del procedimiento (0-40 / 22 / 8 pts) -------------------
// Sin distinguir mayúsculas ni tildes, por eso todo se normaliza antes de
// comparar. "ALTO" son cirugías (ticket más alto, decisión más lenta pero
// de mayor valor); el resto de tratamientos no quirúrgicos con nombre
// reconocible caen en "MEDIO"; sin procedimiento identificado o genérico
// ("información general", vacío, etc.) es "BAJO".
function normalize(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const CIRUGIA_KEYWORDS = [
  "abdominoplastia", "lifting facial", "rinoplastia", "aumento mamario",
  "mastopexia", "liposuccion", "lipoescultura", "mastectomia",
  "mia femtech", "preserve", "reconstruccion mamaria", "reduccion mamaria",
  "braquioplastia", "ginecomastia", "gluteoplastia", "gem", "mommy makeover",
  "remodelacion costal", "blefaroplastia", "otoplastia", "lobuloplastia",
  "cirugia",
];

const GENERICO_KEYWORDS = [
  "informacion general", "consulta general", "no especificado", "general",
];

function procedureScore(procedureInterest) {
  const p = normalize(procedureInterest);
  if (!p) return 8;
  if (CIRUGIA_KEYWORDS.some((kw) => p.includes(kw))) return 40;
  if (GENERICO_KEYWORDS.some((kw) => p.includes(kw))) return 8;
  return 22; // cualquier tratamiento no quirúrgico con nombre reconocible
}

function sentimentScore(sentiment) {
  const s = normalize(sentiment);
  if (s === "positivo") return 25;
  if (s === "negativo") return 0;
  if (s === "neutral") return 10;
  return 10; // null / sin clasificar
}

function engagementScore(messageCount) {
  const n = messageCount || 0;
  if (n >= 5) return 15;
  if (n >= 2) return 8;
  return 0;
}

function recencyScore(createdAt) {
  if (!createdAt) return 3;
  const hoursAgo = (Date.now() - new Date(createdAt).getTime()) / 36e5;
  if (hoursAgo < 6) return 20;
  if (hoursAgo < 24) return 14;
  if (hoursAgo < 72) return 8;
  return 3;
}

// Score total 0-100: valor del procedimiento (0-40) + sentimiento (0-25) +
// engagement por cantidad de mensajes (0-15) + recencia (0-20). Es una v1
// basada solo en datos que ya existen en sofia_conversations — no incluye
// tiempo de respuesta del asesor humano porque ese timestamp todavía no se
// registra en ningún lado (ver Worker cec-sofia-whatsapp, proyecto aparte).
function computeScore(conv) {
  return (
    procedureScore(conv.procedure_interest) +
    sentimentScore(conv.sentiment) +
    engagementScore(conv.message_count) +
    recencyScore(conv.created_at)
  );
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

const SENTIMENT_LABEL = {
  positivo: { label: "Positivo", fg: COLORS.green, bg: "rgba(31,74,64,0.08)" },
  neutral: { label: "Neutral", fg: COLORS.textMuted, bg: "rgba(31,74,64,0.06)" },
  negativo: { label: "Negativo", fg: COLORS.danger, bg: COLORS.dangerBg },
};

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

// Traduce cada criterio del score a algo que un asesor entienda de un
// vistazo (tier + explicación en palabras), en vez de puntos crudos —
// los puntos (0-40, 0-25...) no le dicen nada a quien va a contactar al
// lead, pero "Cirugía — mayor valor" sí.
function procedureCriterion(procedureInterest) {
  const p = normalize(procedureInterest);
  if (CIRUGIA_KEYWORDS.some((kw) => p.includes(kw))) {
    return { tier: "alto", detail: "Cirugía — mayor valor" };
  }
  if (!p || GENERICO_KEYWORDS.some((kw) => p.includes(kw))) {
    return { tier: "bajo", detail: "Sin especificar" };
  }
  return { tier: "medio", detail: "Tratamiento no quirúrgico" };
}

function sentimentCriterion(sentiment) {
  const s = normalize(sentiment);
  if (s === "positivo") return { tier: "alto", detail: "Positivo" };
  if (s === "negativo") return { tier: "bajo", detail: "Negativo" };
  return { tier: "medio", detail: "Neutral" };
}

function engagementCriterion(messageCount) {
  const n = messageCount || 0;
  if (n >= 5) return { tier: "alto", detail: `${n} mensajes — conversación activa` };
  if (n >= 2) return { tier: "medio", detail: `${n} mensajes` };
  return { tier: "bajo", detail: `${n} mensaje${n === 1 ? "" : "s"} — poco intercambio` };
}

function recencyCriterion(createdAt) {
  const rel = formatRelative(createdAt) || "sin fecha";
  if (!createdAt) return { tier: "bajo", detail: rel };
  const hoursAgo = (Date.now() - new Date(createdAt).getTime()) / 36e5;
  if (hoursAgo < 6) return { tier: "alto", detail: rel };
  if (hoursAgo < 24) return { tier: "medio", detail: rel };
  return { tier: "bajo", detail: rel };
}

function scoreCriteria(conv) {
  return [
    { label: "Procedimiento", ...procedureCriterion(conv.procedure_interest) },
    { label: "Sentimiento", ...sentimentCriterion(conv.sentiment) },
    { label: "Interacción", ...engagementCriterion(conv.message_count) },
    { label: "Última actividad", ...recencyCriterion(conv.created_at) },
  ];
}

function formatFullDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("es-CR", {
    day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
  });
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

function ZenviaButton({ prospectId, phoneNumber }) {
  const [copied, setCopied] = useState(false);
  const zenviaBase = import.meta.env.VITE_ZENVIA_WEB_BASE_URL;

  if (prospectId && zenviaBase) {
    return (
      <a
        href={`${zenviaBase}${prospectId}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "flex", alignItems: "center", gap: 6, textDecoration: "none",
          background: COLORS.green, color: "white", border: "none", borderRadius: 8,
          padding: "8px 16px", fontSize: 13, fontWeight: 600, fontFamily: "'Manrope', sans-serif",
          whiteSpace: "nowrap",
        }}
      >
        <ExternalLink size={13} />
        Abrir en Zenvia
      </a>
    );
  }

  // Fallback: todavía no está confirmado el formato exacto de la URL de
  // Zenvia Conversion (o no hay prospect_id para esta fila) — copiamos el
  // teléfono para que el equipo lo busque a mano mientras tanto.
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(phoneNumber || "");
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // clipboard puede fallar por permisos del navegador — no hay
          // mucho más que hacer que dejar el botón como estaba
        }
      }}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        background: COLORS.panelAlt, color: COLORS.green, border: `1px solid ${COLORS.border}`,
        borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600,
        fontFamily: "'Manrope', sans-serif", cursor: "pointer", whiteSpace: "nowrap",
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copiado — buscalo en Zenvia" : "Copiar teléfono"}
    </button>
  );
}

function FilterBar({ escalatedOnly, setEscalatedOnly, sentimentFilter, setSentimentFilter, scoreFilter, setScoreFilter, procedureFilter, setProcedureFilter }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: COLORS.text, fontFamily: "'Manrope', sans-serif", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={escalatedOnly}
          onChange={(e) => setEscalatedOnly(e.target.checked)}
          style={{ cursor: "pointer" }}
        />
        Solo escaladas
      </label>

      <select value={sentimentFilter} onChange={(e) => setSentimentFilter(e.target.value)} style={SELECT_STYLE}>
        <option value="todos">Sentimiento: todos</option>
        <option value="positivo">Positivo</option>
        <option value="neutral">Neutral</option>
        <option value="negativo">Negativo</option>
      </select>

      <select value={scoreFilter} onChange={(e) => setScoreFilter(e.target.value)} style={SELECT_STYLE}>
        <option value="todos">Score: todos</option>
        <option value="alto">Alto (70+)</option>
        <option value="medio">Medio (40-69)</option>
        <option value="bajo">Bajo (&lt;40)</option>
      </select>

      <FilterSelect value={procedureFilter} onChange={setProcedureFilter} options={PROCEDURE_GROUPS} />
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

const TIER_LABEL = { alto: "Alto", medio: "Medio", bajo: "Bajo" };

function CriterionRow({ label, detail, tier }) {
  const style = TIER_STYLES[tier];
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: "0 0 1px", fontSize: 11, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
          {label}
        </p>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: COLORS.text, fontFamily: "'Manrope', sans-serif" }}>
          {detail}
        </p>
      </div>
      <Badge style={{ background: style.bg, color: style.fg, flexShrink: 0 }}>
        {TIER_LABEL[tier]}
      </Badge>
    </div>
  );
}

function MetaField({ label, value }) {
  return (
    <div>
      <p style={{ margin: "0 0 2px", fontSize: 11, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>{label}</p>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: COLORS.green, fontFamily: "'Manrope', sans-serif" }}>{value}</p>
    </div>
  );
}

// Preview de una línea para la tarjeta colapsada: prioriza el motivo de
// escalación (es lo más accionable) y si no hay, cae al resumen de
// mensajes/canal que antes se mostraba siempre.
function previewLine(conv) {
  if (conv.escalation_reason) return conv.escalation_reason;
  return `${conv.message_count || 0} mensajes · ${conv.channel || "whatsapp"} · ${conv.phone_number || "sin número"}`;
}

function LeadRow({ conv }) {
  const [open, setOpen] = useState(false);
  const score = computeScore(conv);
  const criteria = scoreCriteria(conv);
  const sentimentInfo = SENTIMENT_LABEL[normalize(conv.sentiment)];

  function toggle() { setOpen((v) => !v); }
  function toggleOnKey(e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
  }

  return (
    <Card style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={toggleOnKey}
        style={{
          display: "flex", gap: 16, alignItems: "center", width: "100%",
          cursor: "pointer", padding: 16,
        }}
      >
        <ScoreBadge score={score} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: COLORS.green, fontFamily: "'Manrope', sans-serif" }}>
              {conv.procedure_interest || "Procedimiento no especificado"}
            </p>
            {sentimentInfo && (
              <Badge variant={sentimentInfo.fg === COLORS.danger ? "danger" : "default"} style={{ background: sentimentInfo.bg, color: sentimentInfo.fg }}>
                {sentimentInfo.label}
              </Badge>
            )}
            {conv.escalated && (
              <Badge variant="gold">
                Escalada
              </Badge>
            )}
            <span style={{ fontSize: 12, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
              {formatRelative(conv.created_at)}
            </span>
          </div>

          <p style={{
            margin: 0, fontSize: 12, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {previewLine(conv)}
          </p>
        </div>

        <div onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
          <ZenviaButton prospectId={conv.prospect_id} phoneNumber={conv.phone_number} />
        </div>

        <ChevronDown
          size={18} color={COLORS.textMuted} style={{ flexShrink: 0, transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "none" }}
        />
      </div>

      {open && (
        <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: "0 0 2px", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
              Por qué este score
            </p>
            {criteria.map((c) => <CriterionRow key={c.label} {...c} />)}
          </div>

          {conv.escalation_reason && (
            <div>
              <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
                Motivo de escalación
              </p>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.text, fontFamily: "'Manrope', sans-serif", lineHeight: 1.5 }}>
                {conv.escalation_reason}
              </p>
            </div>
          )}

          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <MetaField label="Mensajes" value={conv.message_count || 0} />
            <MetaField label="Canal" value={conv.channel || "whatsapp"} />
            <MetaField label="Teléfono" value={conv.phone_number || "sin número"} />
            <MetaField label="Recibido" value={formatFullDate(conv.created_at)} />
          </div>
        </div>
      )}
    </Card>
  );
}

// Aplica los filtros que sí son columnas reales de sofia_conversations a un
// query de Supabase ya iniciado (select/from). escalatedOnly reemplaza la
// condición base de calificación (escalada O positiva+engagement) por
// "solo escaladas"; sentimentFilter la restringe más. El filtro de score NO
// se puede aplicar acá porque no es una columna — se aplica después, en el
// cliente, sobre la página ya traída (ver comentario junto a "visible" más
// abajo, en LeadsCalientesSection).
function applyServerFilters(query, { escalatedOnly, sentimentFilter, procedureFilter }) {
  let q = query
    .gte("created_at", LEADS_LIVE_SINCE)
    .or("derived_to_appointment.is.null,derived_to_appointment.eq.false");

  q = escalatedOnly
    ? q.eq("escalated", true)
    : q.or("escalated.eq.true,and(sentiment.eq.positivo,message_count.gte.3)");

  if (sentimentFilter !== "todos") {
    q = q.eq("sentiment", sentimentFilter);
  }

  // Varios .or() encadenados se combinan con AND entre sí, que es lo que
  // queremos: (fecha) AND (calificación) AND (alguno de los patrones del grupo).
  const procedureOr = procedureOrFilter(procedureFilter);
  if (procedureOr) q = q.or(procedureOr);

  return q;
}

export function LeadsCalientesSection() {
  const [conversations, setConversations] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [page, setPage] = useState(1);
  const [escalatedOnly, setEscalatedOnly] = useState(false);
  const [sentimentFilter, setSentimentFilter] = useState("todos");
  const [scoreFilter, setScoreFilter] = useState("todos");
  const [procedureFilter, setProcedureFilter] = useState("todos");

  // Cambiar cualquier filtro vuelve a la página 1 — si no, se puede quedar
  // viendo una página que ya no existe con el filtro nuevo.
  function updateEscalatedOnly(value) { setEscalatedOnly(value); setPage(1); }
  function updateSentimentFilter(value) { setSentimentFilter(value); setPage(1); }
  function updateScoreFilter(value) { setScoreFilter(value); setPage(1); }
  function updateProcedureFilter(value) { setProcedureFilter(value); setPage(1); }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      const filters = { escalatedOnly, sentimentFilter, procedureFilter };
      const offset = (page - 1) * PAGE_SIZE;

      const [{ data, error: dataError }, { count, error: countError }] = await Promise.all([
        applyServerFilters(
          supabase.from("sofia_conversations").select(
            "id, phone_number, procedure_interest, sentiment, message_count, escalated, escalation_reason, created_at, channel, prospect_id"
          ),
          filters
        )
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1),
        applyServerFilters(
          supabase.from("sofia_conversations").select("id", { count: "exact", head: true }),
          filters
        ),
      ]);

      if (dataError) setError(dataError.message);
      else if (countError) setError(countError.message);
      else {
        setConversations(data || []);
        setTotalCount(count || 0);
      }
      setLoading(false);
    })();
  }, [page, escalatedOnly, sentimentFilter, procedureFilter]);

  // Filtro de score y orden final: se hacen en el cliente sobre la página
  // ya traída de Supabase (20 filas), no sobre el total. Es una limitación
  // v1 aceptada — en páginas donde pocas de esas 20 califiquen para el
  // score elegido, la lista puede verse con menos de 20 tarjetas o incluso
  // vacía aunque totalCount/totalPages diga que hay más. No es un bug: el
  // conteo de páginas refleja los filtros de servidor (fecha, escalada,
  // sentimiento), no el de score, porque el score no es una columna real.
  const visible = conversations
    .filter((conv) => scoreFilter === "todos" || scoreTier(computeScore(conv)) === scoreFilter)
    .sort((a, b) => computeScore(b) - computeScore(a));

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div>
      <SectionHeader
        icon={<Flame size={20} color={COLORS.gold} />}
        subtitle="Conversaciones de Sofía con más potencial de venta, ordenadas por score — a quién contactar primero."
      />

      <FilterBar
        escalatedOnly={escalatedOnly} setEscalatedOnly={updateEscalatedOnly}
        sentimentFilter={sentimentFilter} setSentimentFilter={updateSentimentFilter}
        scoreFilter={scoreFilter} setScoreFilter={updateScoreFilter}
        procedureFilter={procedureFilter} setProcedureFilter={updateProcedureFilter}
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {loading && (
        <p style={{ textAlign: "center", fontSize: 14, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", padding: "40px 0" }}>
          Cargando leads...
        </p>
      )}

      {!loading && !error && visible.length === 0 && (
        <EmptyState
          title="Sin leads potenciales por ahora"
          description={totalCount > 0
            ? "Ninguno de los resultados de esta página califica con los filtros actuales — probá otra página o cambiá el filtro de score."
            : "No hay conversaciones que califiquen todavía con los filtros actuales."}
        />
      )}

      {!loading && !error && visible.length > 0 && (
        <div>
          {visible.map((conv) => <LeadRow key={conv.id} conv={conv} />)}
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
