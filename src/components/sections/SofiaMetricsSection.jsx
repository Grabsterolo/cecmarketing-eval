import React, { useState, useEffect, useMemo } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { MessageCircle } from "lucide-react";
import { COLORS, SOURCE_COLORS } from "../../constants/colors.js";
import { PROCEDURE_OPTIONS, matchesProcedure, procedureLabel } from "../../constants/procedures.js";
import { Card } from "../ui/Card.jsx";
import { ErrorBanner } from "../ui/ErrorBanner.jsx";
import { SectionHeader } from "../ui/SectionHeader.jsx";
import { MetricKpi, tableStyles } from "../ui/MetricKpi.jsx";
import { FilterSelect } from "../ui/FilterSelect.jsx";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { supabase } from "../../lib/supabase.js";

// Los datos reales de sofia_conversations arrancan acá — igual que en
// LeadsCalientesSection, un rango anterior a esta fecha no tiene nada que
// mostrar y hay que avisarlo en vez de dejar una gráfica vacía sin explicar.
const SOFIA_DATA_LIVE_SINCE = "2026-07-26";

// created_at se guarda en UTC, pero el equipo opera en hora de Costa Rica
// (UTC-6, sin horario de verano) — bucketear o elegir rangos por fecha UTC
// corre "hoy" hasta 6 horas adelante y desplaza conversaciones al día
// siguiente. Mismo patrón que ya usan LeadsCalientesSection y
// daily-analysis.js.
function crDateStr(date) {
  return date.toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
}

function todayISO() {
  return crDateStr(new Date());
}

function daysAgoISO(n) {
  return crDateStr(new Date(Date.now() - n * 86400000));
}

function normalize(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Clasificación de escalation_reason en buckets legibles — el texto libre
// original tiene más de 40 variantes para el mismo motivo, así que se agrupa
// por palabras clave en vez de mostrarlo tal cual.
const ESCALATION_RULES = [
  { label: "Precio sin promoción vigente", test: (s) => s.includes("precio") && s.includes("promocion") },
  { label: "Precio de cirugía", test: (s) => s.includes("precio") && (s.includes("cirugia") || s.includes("quirurg")) },
  { label: "Límite de conversación alcanzado", test: (s) => s.includes("limite") || s.includes("mensajes") },
  // Sofía dijo una frase de traspaso ("le voy a pasar la información al
  // equipo", etc.) sin la etiqueta [ESCALAR] — cec-sofia-whatsapp lo detecta
  // y fuerza la escalación de todas formas (ver mentionsHandoffPromise en
  // ese repo, fix 2026-08-11). Bucket propio para que este volumen no se
  // pierda dentro de "Otro".
  { label: "Traspaso detectado automáticamente", test: (s) => s.includes("traspaso") },
  { label: "Síntoma o emergencia post-operatoria", test: (s) => s.includes("sintoma") || s.includes("dolor") || s.includes("molestia") || s.includes("emergencia") },
  { label: "Agendar valoración", test: (s) => s.includes("valoracion") || s.includes("agendar") },
  // Va al final: cualquier mención de precio que no calzó con las reglas más
  // específicas de arriba (promoción/cirugía/agendar) — antes cualquier
  // "solicitud de precio de Ultherapy/Trilipo/Oxígeno X/..." caía en "Otro"
  // (34% de las escalaciones, ~40% de eso con "precio" en el texto).
  { label: "Precio de tratamiento", test: (s) => s.includes("precio") },
];

function classifyEscalationReason(reason) {
  const s = normalize(reason);
  if (!s) return "Otro";
  const match = ESCALATION_RULES.find((rule) => rule.test(s));
  return match ? match.label : "Otro";
}

// Extrae solo el título de cada hallazgo numerado en negrita markdown
// ("**1. Título**\nTexto largo...") — la extracción es puramente por texto,
// no usa IA, porque la información ya está en el campo weaknesses.
function extractFindingTitles(weaknesses) {
  if (!weaknesses) return [];
  const matches = [...weaknesses.matchAll(/\*\*\d+\.\s*(.+?)\*\*/g)];
  return matches.map((m) => m[1].trim());
}

// Supabase/PostgREST corta cualquier select() sin paginar en 1000 filas por
// default — con ~300-400 conversaciones/día, un rango de solo unos pocos
// días ya supera ese límite y trunca los días siguientes en silencio (se
// veían días "sin conversaciones" que en realidad sí tenían datos). Se pagina
// en bloques de 1000 hasta traer todo el rango.
const FETCH_PAGE_SIZE = 1000;

async function fetchAllInRange(from, to) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("sofia_conversations")
      .select("id, sentiment, escalated, escalation_reason, created_at, procedure_code")
      .gte("created_at", `${from}T00:00:00-06:00`)
      .lte("created_at", `${to}T23:59:59-06:00`)
      .order("created_at", { ascending: true })
      .range(offset, offset + FETCH_PAGE_SIZE - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if (!data || data.length < FETCH_PAGE_SIZE) break;
    offset += FETCH_PAGE_SIZE;
  }
  return { data: rows, error: null };
}

const dateInputStyle = {
  background: COLORS.inputBg, border: `1.5px solid ${COLORS.border}`,
  borderRadius: 8, padding: "8px 12px", color: COLORS.text, fontSize: 13,
  outline: "none", fontFamily: "'Manrope', sans-serif",
};

function DateRangePicker({ from, to, setFrom, setTo }) {
  return (
    // Sin marginBottom propio: vive dentro de una fila centrada junto al
    // filtro de procedimiento, y ese margen le sumaba alto solo a este
    // bloque, dejando las fechas más arriba que el select. El espacio
    // inferior lo pone la fila que los contiene.
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
        Desde
        <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={dateInputStyle} />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
        Hasta
        <input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} style={dateInputStyle} />
      </label>
    </div>
  );
}

function formatDay(dayStr) {
  return new Date(`${dayStr}T00:00:00`).toLocaleDateString("es-CR", { day: "numeric", month: "short" });
}

function buildDailySeries(conversations, from, to) {
  const byDay = new Map();
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, { day: key, name: formatDay(key), Conversaciones: 0, escaladas: 0 });
  }

  conversations.forEach((conv) => {
    if (!conv.created_at) return;
    const day = crDateStr(new Date(conv.created_at));
    const bucket = byDay.get(day);
    if (!bucket) return;
    bucket.Conversaciones += 1;
    if (conv.escalated) bucket.escaladas += 1;
  });

  return [...byDay.values()].map((b) => ({
    ...b,
    "% Escalado": b.Conversaciones > 0 ? Math.round((b.escaladas / b.Conversaciones) * 100) : 0,
  }));
}

function EscalationReasonsCard({ conversations }) {
  const escalated = conversations.filter((c) => c.escalated);
  const total = escalated.length;

  const counts = new Map();
  escalated.forEach((c) => {
    const label = classifyEscalationReason(c.escalation_reason);
    counts.set(label, (counts.get(label) || 0) + 1);
  });

  const rows = [...counts.entries()]
    .map(([label, count]) => ({ label, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);

  return (
    <Card>
      <h3 style={{ margin: "0 0 16px", fontSize: 18, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, color: COLORS.green }}>
        Motivos de escalación
      </h3>
      {total === 0 && (
        <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
          Sin conversaciones escaladas en este rango.
        </p>
      )}
      {total > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => (
            <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 220, maxWidth: "40%", fontSize: 12, fontWeight: 600, color: COLORS.text, fontFamily: "'Manrope', sans-serif", flexShrink: 0 }}>
                {r.label}
              </span>
              <div style={{ flex: 1, height: 8, background: COLORS.border, borderRadius: 4 }}>
                <div style={{
                  height: "100%", width: `${r.pct}%`,
                  background: SOURCE_COLORS.sofia, borderRadius: 4,
                  transition: "width 0.8s ease-out",
                }} />
              </div>
              <span style={{ width: 36, textAlign: "right", fontSize: 12, fontWeight: 700, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", flexShrink: 0 }}>
                {r.pct}%
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function QualityCard({ audit, auditLoading, setActive }) {
  const findings = audit ? extractFindingTitles(audit.weaknesses) : [];

  return (
    <Card>
      <h3 style={{ margin: "0 0 16px", fontSize: 18, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, color: COLORS.green }}>
        Calidad
      </h3>
      {auditLoading && (
        <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
          Cargando auditoría...
        </p>
      )}
      {!auditLoading && !audit && (
        <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", lineHeight: 1.6 }}>
          Sin auditorías en este rango — corré una nueva auditoría desde{" "}
          <button
            onClick={() => setActive?.("auditoria-sofia")}
            style={{ background: "none", border: "none", padding: 0, color: COLORS.gold, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif", fontSize: 13 }}
          >
            Auditoría de Sofía
          </button>.
        </p>
      )}
      {!auditLoading && audit && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {findings.length === 0 && (
            <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
              La auditoría más reciente en este rango no tiene hallazgos identificados.
            </p>
          )}
          {findings.slice(0, 4).map((title, i) => (
            <div key={i} style={{
              background: COLORS.panelAlt, borderRadius: 8, padding: "10px 14px",
              fontSize: 13, color: COLORS.text, fontFamily: "'Manrope', sans-serif", lineHeight: 1.4,
            }}>
              {title}
            </div>
          ))}
          <button
            onClick={() => setActive?.("auditoria-sofia")}
            style={{
              alignSelf: "flex-start", background: "none", border: "none", padding: "4px 0 0",
              color: COLORS.gold, fontWeight: 700, cursor: "pointer", fontFamily: "'Manrope', sans-serif", fontSize: 12,
            }}
          >
            Ver detalle completo →
          </button>
        </div>
      )}
    </Card>
  );
}

export function SofiaMetricsSection({ setActive }) {
  const isMobile = useIsMobile();
  const [from, setFrom] = useState(daysAgoISO(15));
  const [to, setTo] = useState(todayISO());

  const [allConversations, setConversations] = useState([]);
  const [procedureFilter, setProcedureFilter] = useState("todos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [audit, setAudit] = useState(null);
  const [auditLoading, setAuditLoading] = useState(true);

  useEffect(() => {
    // fetchAllInRange pagina de a 1000 filas, así que un rango grande tarda
    // varios viajes. Sin esta guarda, cambiar de fecha dispara una segunda
    // carga y la que termine de último gana — aunque sea la del rango
    // anterior: se veían KPIs de un rango con las fechas de otro.
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await fetchAllInRange(from, to);
      if (cancelled) return;
      if (fetchError) setError(fetchError.message);
      else setConversations(data || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [from, to]);

  useEffect(() => {
    (async () => {
      setAuditLoading(true);
      const { data } = await supabase
        .from("sofia_audits")
        .select("id, created_at, weaknesses")
        .gte("created_at", `${from}T00:00:00-06:00`)
        .lte("created_at", `${to}T23:59:59-06:00`)
        .order("created_at", { ascending: false })
        .limit(1);
      setAudit((data && data[0]) || null);
      setAuditLoading(false);
    })();
  }, [from, to]);

  const rangeBeforeData = to < SOFIA_DATA_LIVE_SINCE;

  // El filtro de procedimiento se aplica en memoria: esta sección ya trae
  // todas las filas del rango para calcular los KPIs, así que no hace falta
  // volver a consultar Supabase al cambiarlo.
  const conversations = useMemo(
    () => allConversations.filter((c) => matchesProcedure(c.procedure_code, procedureFilter)),
    [allConversations, procedureFilter]
  );

  const dailySeries = useMemo(() => buildDailySeries(conversations, from, to), [conversations, from, to]);

  const totalConversations = conversations.length;
  const escalatedCount = conversations.filter((c) => c.escalated).length;
  const pctNoEscalado = totalConversations > 0 ? Math.round(((totalConversations - escalatedCount) / totalConversations) * 100) : 0;

  const positiveOrNeutral = conversations.filter((c) => {
    const s = normalize(c.sentiment);
    return s === "positivo" || s === "neutral";
  }).length;
  const pctTonoOk = totalConversations > 0 ? Math.round((positiveOrNeutral / totalConversations) * 100) : 0;

  const findingsCount = audit ? extractFindingTitles(audit.weaknesses).length : 0;

  // Temas más consultados, calculado sobre las conversaciones ya filtradas.
  // procedure_interest lo escribe Claude en texto libre, así que se agrupa
  // sin distinguir mayúsculas ni tildes y se muestra la grafía más frecuente
  // de cada grupo — si no, "Abdominoplastia" y "abdominoplastia" saldrían
  // como dos temas distintos.
  // Agrupa por procedure_code, la columna generada que normaliza el texto
  // libre de procedure_interest a la taxonomía cerrada. Antes esto agrupaba
  // por el texto crudo y salían 1.323 "temas" — casi todos la misma cosa
  // escrita distinto.
  //
  // Los códigos que no son un procedimiento (solo preguntó precio, logística,
  // sin especificar) se dejan fuera: inflaban el ranking sin decir nada de
  // qué le interesa a la gente.
  const { topTopics, distinctTopicCount } = useMemo(() => {
    const NO_PROCEDIMIENTO = new Set([
      "generico_sin_procedimiento", "generico_solo_precio", "generico_logistica",
      "generico_proceso", "no_paciente_laboral", "promociones", "sin_clasificar",
    ]);

    const groups = new Map();
    for (const c of conversations) {
      const code = c.procedure_code;
      if (!code || NO_PROCEDIMIENTO.has(code)) continue;
      const g = groups.get(code) || { count: 0, escalated: 0 };
      g.count += 1;
      if (c.escalated) g.escalated += 1;
      groups.set(code, g);
    }

    const ranked = [...groups.entries()]
      .map(([code, g]) => ({
        topic: procedureLabel(code),
        count: g.count,
        pctEscalated: Math.round((g.escalated / g.count) * 100),
      }))
      .sort((a, b) => b.count - a.count);

    const top = ranked.slice(0, 8);
    const max = top.length > 0 ? top[0].count : 1;
    return {
      topTopics: top.map((t) => ({ ...t, pctOfTop: Math.round((t.count / max) * 100) })),
      distinctTopicCount: ranked.length,
    };
  }, [conversations]);

  return (
    <div>
      <SectionHeader
        icon={<MessageCircle size={20} color={SOURCE_COLORS.sofia} />}
        subtitle="Volumen, escalación y calidad de las conversaciones de Sofía en el rango elegido."
      />

      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <FilterSelect
          value={procedureFilter}
          onChange={setProcedureFilter}
          options={PROCEDURE_OPTIONS}
        />
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {loading && (
        <p style={{ textAlign: "center", fontSize: 14, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", padding: "40px 0" }}>
          Cargando métricas de Sofía...
        </p>
      )}

      {!loading && !error && rangeBeforeData && (
        <Card>
          <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", lineHeight: 1.6 }}>
            Los datos reales de Sofía arrancan el 26 de julio de 2026 — el rango elegido no tiene conversaciones que mostrar. Probá un rango que incluya fechas a partir de esa día.
          </p>
        </Card>
      )}

      {!loading && !error && !rangeBeforeData && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", gap: 16 }}>
            <Card>
              <MetricKpi
                label="Conversaciones"
                value={`${totalConversations}`}
                sub={procedureFilter === "todos" ? "Total en el rango" : "En el rango, del procedimiento filtrado"}
              />
            </Card>
            <Card>
              <MetricKpi label="Resuelto sin asesor" value={`${pctNoEscalado}%`} sub="Nunca pasó a escalación" />
            </Card>
            <Card>
              <MetricKpi label="Tono neutral o positivo" value={`${pctTonoOk}%`} sub="Según lectura de IA, no es encuesta" />
            </Card>
            <Card>
              <MetricKpi
                label="Hallazgos activos"
                value={audit ? `${findingsCount}` : "—"}
                sub={audit ? "Última auditoría del rango" : "Sin auditoría en el rango"}
              />
            </Card>
          </div>

          <Card>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, color: COLORS.green }}>
                Temas más consultados
              </h3>
              <span style={{ fontSize: 12, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
                {topTopics.length > 0 ? `${topTopics.length} de ${distinctTopicCount} temas` : ""}
              </span>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
              Qué pregunta la gente, y qué tanto de cada tema termina con un asesor.
            </p>

            {topTopics.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
                Ninguna conversación del rango tiene procedimiento identificado.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {topTopics.map((t) => (
                  <div key={t.topic}>
                    <div style={{
                      display: "flex", justifyContent: "space-between", alignItems: "baseline",
                      gap: 12, marginBottom: 4, fontSize: 13, fontFamily: "'Manrope', sans-serif",
                    }}>
                      <span style={{ color: COLORS.text, fontWeight: 600 }}>{t.topic}</span>
                      <span style={{ color: COLORS.textMuted, whiteSpace: "nowrap" }}>
                        {t.count} · {t.pctEscalated}% a un asesor
                      </span>
                    </div>
                    {/* La barra mide volumen (relativo al tema más consultado);
                        el tramo dorado, cuántas de esas llegaron a un humano. */}
                    <div style={{
                      height: 10, borderRadius: 4, background: "rgba(31,74,64,0.08)",
                      overflow: "hidden",
                    }}>
                      <div style={{
                        width: `${t.pctOfTop}%`, height: "100%",
                        background: COLORS.green, borderRadius: 4,
                        display: "flex", justifyContent: "flex-end",
                      }}>
                        <div style={{ width: `${t.pctEscalated}%`, height: "100%", background: COLORS.gold }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p style={{
              margin: "16px 0 0", fontSize: 11.5, lineHeight: 1.5,
              color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif",
            }}>
              El largo de la barra es el volumen del tema; el tramo dorado, la parte que pasó a un asesor.
              Responde al rango de fechas y al filtro de procedimiento.
            </p>
          </Card>

          <Card>
            <h3 style={{ margin: "0 0 16px", fontSize: 18, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, color: COLORS.green }}>
              Volumen diario y % escalado
            </h3>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={dailySeries} barGap={4} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                <XAxis dataKey="name" tick={tableStyles.tick} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" orientation="left" tick={tableStyles.tick} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
                <YAxis yAxisId="right" orientation="right" tick={tableStyles.tick} axisLine={false} tickLine={false} width={36} unit="%" />
                <Tooltip
                  contentStyle={{
                    fontFamily: "'Manrope', sans-serif", fontSize: 12,
                    borderRadius: 8, border: `1px solid ${COLORS.border}`,
                    background: COLORS.panel,
                  }}
                  cursor={{ fill: COLORS.panelAlt }}
                />
                <Legend wrapperStyle={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, paddingTop: 8 }} />
                <Bar yAxisId="left" dataKey="Conversaciones" fill={SOURCE_COLORS.sofia} radius={[4, 4, 0, 0]} />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="% Escalado"
                  stroke={COLORS.green}
                  strokeWidth={2}
                  dot={{ r: 3, fill: COLORS.green }}
                  activeDot={{ r: 5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
            <EscalationReasonsCard conversations={conversations} />
            <QualityCard audit={audit} auditLoading={auditLoading} setActive={setActive} />
          </div>

        </div>
      )}
    </div>
  );
}
