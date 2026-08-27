import React, { useState, useEffect } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { COLORS, SOURCE_COLORS } from "../../constants/colors.js";
import { Card } from "../ui/Card.jsx";
import { Badge } from "../ui/Badge.jsx";
import { DATA_SOURCES } from "../../constants/nav.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { supabase } from "../../lib/supabase.js";

const SOURCE_DOT_COLORS = {
  meta:  SOURCE_COLORS.meta,
  sofia: SOURCE_COLORS.sofia,
};

// created_at se guarda en UTC pero el equipo opera en hora de Costa Rica
// (UTC-6) — mismo patrón que SofiaMetricsSection/LeadsCalientesSection/
// SeguimientoSection. Sin esto, "este mes" arrancaba en la medianoche local
// del navegador de quien tuviera el dashboard abierto, no en la de Costa
// Rica, y podía desfasarse contra el resto de las pantallas.
function startOfMonthCR() {
  const todayCR = new Date().toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
  return `${todayCR.slice(0, 7)}-01T00:00:00-06:00`;
}

function ActiveBadge({ active }) {
  return (
    <Badge variant={active ? "success" : "default"}>
      {active ? "● Activo" : "..."}
    </Badge>
  );
}

// Indicador chiquito de conexiones — solo debe llamar la atención cuando
// algo esté desconectado (antes era una tarjeta completa con una fila por
// fuente, ver Conexiones más abajo).
function ConnectionIndicator() {
  const disconnected = DATA_SOURCES.filter((s) => !s.connected);

  if (disconnected.length > 0) {
    return (
      <Badge variant="danger">
        {disconnected.map((s) => s.label).join(", ")} desconectado
      </Badge>
    );
  }

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {DATA_SOURCES.map((s) => (
        <span key={s.key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: SOURCE_DOT_COLORS[s.key] || COLORS.textMuted, flexShrink: 0 }} />
          {s.label} ✓
        </span>
      ))}
    </span>
  );
}

export function DashboardHome({ profile }) {
  const isMobile = useIsMobile();
  const [metaData, setMetaData] = useState(null);
  const [metaError, setMetaError] = useState(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [sofiaStats, setSofiaStats] = useState(null);
  const [sofiaLoading, setSofiaLoading] = useState(true);

  useEffect(() => {
    fetch("/api/meta-metrics")
      .then(r => r.json())
      .then(data => {
        // Un fallo NO puede terminar mostrando $0.00 y 0 leads: eso se lee
        // como "no se invirtió nada" cuando en realidad no se pudo consultar
        // a Meta. Mismo manejo que MetricsSection, que sí lo hacía bien.
        if (data.error) setMetaError(data.error);
        else setMetaData(data);
      })
      .catch(err => setMetaError(err.message))
      .finally(() => setMetaLoading(false));
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadSofiaStats() {
      const since = startOfMonthCR();
      const countQuery = () => supabase.from("sofia_conversations").select("*", { count: "exact", head: true }).gte("created_at", since);

      const [{ count: total }, { count: escalated }, { count: positivo }, { count: neutral }, { count: negativo }] = await Promise.all([
        countQuery(),
        countQuery().eq("escalated", true),
        countQuery().eq("sentiment", "positivo"),
        countQuery().eq("sentiment", "neutral"),
        countQuery().eq("sentiment", "negativo"),
      ]);
      if (!mounted) return;
      setSofiaStats({
        total: total || 0, escalated: escalated || 0,
        positivo: positivo || 0, neutral: neutral || 0, negativo: negativo || 0,
      });
      setSofiaLoading(false);
    }
    loadSofiaStats();
    return () => { mounted = false; };
  }, []);


  // "..." mientras carga, "—" si Meta no respondió, y el valor real solo
  // cuando de verdad hay dato. Sin esto, un fallo se veía igual que un cero
  // medido.
  const metaValue = (fn) => (metaLoading ? "..." : metaError ? "—" : fn());

  const totalInvestment = metaValue(
    () => `$${parseFloat(metaData?.totals?.spend || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
  );

  // Barras del embudo calculadas a partir de datos reales: cada paso mide su
  // propia tasa de conversión (impresiones por $ invertido, leads por
  // impresión) normalizada contra la mayor de esas dos tasas, para que el
  // ancho refleje la eficiencia real del paso y no un número inventado.
  const investment = parseFloat(metaData?.totals?.spend || 0);
  const impressions = parseInt(metaData?.totals?.impressions || 0);
  const leadsCount = parseInt(metaData?.totals?.leads || 0);
  const impressionsPerDollar = investment > 0 ? impressions / investment : 0;
  const leadsPerImpression = impressions > 0 ? leadsCount / impressions : 0;
  const maxRate = Math.max(impressionsPerDollar, leadsPerImpression, 1e-9);

  const pasos = [
    {
      color: SOURCE_COLORS.meta,
      label: "INVERSIÓN PUBLICITARIA",
      numero: metaValue(
        () => `$${parseFloat(metaData?.totals?.spend || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
      ),
      desc: "Meta Ads este mes",
      barra: 100,
    },
    {
      color: SOURCE_COLORS.organico,
      label: "IMPRESIONES",
      numero: metaValue(() => `${parseInt(metaData?.totals?.impressions || 0).toLocaleString()}`),
      desc: "Personas que vieron los anuncios",
      barra: metaLoading ? 0 : Math.round((impressionsPerDollar / maxRate) * 100),
    },
    {
      color: COLORS.gold,
      label: "LEADS GENERADOS",
      numero: metaValue(() => `${parseInt(metaData?.totals?.leads || 0)}`),
      desc: "Contactos que dejaron sus datos",
      barra: metaLoading ? 0 : Math.round((leadsPerImpression / maxRate) * 100),
    },
    {
      color: SOURCE_COLORS.sofia,
      label: "CONVERSACIONES SOFÍA ESTE MES",
      numero: sofiaLoading ? "..." : `${sofiaStats?.total || 0}`,
      // "Este mes" (mes a la fecha) es una ventana distinta al rango de 15
      // días que trae Métricas Sofía por default — se aclara acá para que
      // los dos números no parezcan contradecirse.
      desc: sofiaLoading
        ? "Cargando..."
        : sofiaStats?.total > 0
          ? `${Math.round((sofiaStats.escalated / sofiaStats.total) * 100)}% escaladas a un asesor`
          : "Sin conversaciones este mes todavía",
      // A diferencia de las barras de arriba (que sí forman un embudo real
      // de Meta Ads), Sofía es un canal aparte — la barra aquí representa el
      // % de conversaciones escaladas a un asesor, no un paso del embudo.
      barra: sofiaLoading || !sofiaStats?.total ? 0 : Math.round((sofiaStats.escalated / sofiaStats.total) * 100),
    },
  ];

  // Share relativo por fuente, basado en volumen de actividad real (leads de
  // Meta Ads vs conversaciones de Sofía). "Orgánico" no tiene una fuente de
  // datos conectada todavía (ver DATA_SOURCES en nav.js), así que se omite
  // en vez de inventar un número.
  const sofiaTotal = sofiaStats?.total || 0;
  const sourceVolumeTotal = leadsCount + sofiaTotal;
  const sourceShare = [
    { key: "meta", label: "Meta Ads", color: SOURCE_COLORS.meta, value: leadsCount },
    { key: "sofia", label: "Sofía", color: SOURCE_COLORS.sofia, value: sofiaTotal },
  ].map(s => ({
    ...s,
    pct: sourceVolumeTotal > 0 ? Math.round((s.value / sourceVolumeTotal) * 100) : 0,
  }));

  const sourceRowStyle = {
    display: "grid",
    gridTemplateColumns: "130px 1fr 1fr 1fr 80px",
    alignItems: "center",
    padding: "12px 0",
    borderBottom: `1px solid ${COLORS.border}`,
  };

  const metricCell = (label, value) => (
    <div>
      <p style={{ margin: "0 0 2px", fontSize: 11, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>{label}</p>
      <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: COLORS.green, fontFamily: "'Manrope', sans-serif" }}>{value}</p>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* SECCIÓN 1 — Resumen ejecutivo */}
      <Card style={{ background: COLORS.green, border: "none" }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
          gap: isMobile ? 24 : 0,
        }}>
          {[
            {
              label: "INVERSIÓN TOTAL",
              value: totalInvestment,
              sub: "Meta Ads este mes",
              border: !isMobile,
            },
            {
              label: "LEADS GENERADOS",
              value: metaValue(() => `${parseInt(metaData?.totals?.leads || 0)}`),
              sub: "Contactos desde Meta Ads",
              border: false,
            },
          ].map((kpi, i) => (
            // El padding se calcula como un solo valor en vez de mezclar el
            // atajo `padding` con `paddingLeft`/`paddingRight`: al mezclarlos,
            // React avisa que no puede resetear el longhand cuando pasa a
            // undefined en un rerender, y el espaciado puede quedar pegado.
            <div key={i} style={{
              padding: isMobile ? 0 : `0 ${i === 1 ? 0 : 24}px 0 ${i === 0 ? 0 : 24}px`,
              borderRight: kpi.border ? "1px solid rgba(255,255,255,0.12)" : "none",
            }}>
              <p style={{ margin: "0 0 6px", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, color: "rgba(255,255,255,0.6)", fontFamily: "'Manrope', sans-serif" }}>
                {kpi.label}
              </p>
              <p style={{ margin: "0 0 4px", fontSize: 38, fontWeight: 700, color: "#FFFFFF", fontFamily: "'Manrope', sans-serif", lineHeight: 1.1 }}>
                {kpi.value}
              </p>
              <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.5)", fontFamily: "'Manrope', sans-serif" }}>
                {kpi.sub}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {/* SECCIÓN 2 — Embudo + sidebar */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr", gap: 16 }}>

        {/* Columna izquierda — Embudo */}
        <Card>
          {/* Sin este aviso, los pasos del embudo se ven en "—" y no hay forma
              de saber si Meta no respondió o si de verdad no hubo inversión. */}
          {metaError && (
            <p style={{
              margin: "0 0 16px", fontSize: 12.5, lineHeight: 1.55,
              color: COLORS.warning, background: COLORS.warningBg,
              border: `1px solid ${COLORS.warningBorder}`,
              borderRadius: 8, padding: "10px 12px", fontFamily: "'Manrope', sans-serif",
            }}>
              No se pudieron cargar los datos de Meta Ads, así que los pasos de inversión,
              impresiones y leads aparecen sin valor. <strong>No significa que la inversión
              haya sido cero.</strong> Las conversaciones de Sofía sí son reales.
            </p>
          )}
          <h3 style={{ margin: "0 0 20px", fontSize: 18, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, color: COLORS.green }}>
            El embudo de este mes
          </h3>

          {pasos.map((paso, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "flex-start", gap: 16,
              padding: "14px 0",
              borderBottom: i < pasos.length - 1 ? `1px solid ${COLORS.border}` : "none",
            }}>
              <div style={{
                width: 3, alignSelf: "stretch", borderRadius: 2,
                background: paso.color, flexShrink: 0, minHeight: 40,
              }} />
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 2px", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
                  {paso.label}
                </p>
                <p style={{ margin: "0 0 4px", fontSize: 26, fontWeight: 700, color: paso.muted ? COLORS.textMuted : paso.color, fontFamily: "'Manrope', sans-serif", lineHeight: 1.1 }}>
                  {paso.numero}
                </p>
                <p style={{ margin: "0 0 8px", fontSize: 12, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
                  {paso.desc}
                </p>
                <div style={{ height: 4, background: COLORS.border, borderRadius: 2 }}>
                  <div style={{
                    height: "100%", width: `${paso.barra}%`,
                    background: paso.color, borderRadius: 2,
                    transition: "width 0.8s ease-out",
                  }} />
                </div>
              </div>
            </div>
          ))}

          {metaData?.totals?.leads > 0 && (
            <div style={{
              background: "rgba(201,162,78,0.08)", border: "1px solid rgba(201,162,78,0.2)",
              borderLeft: `3px solid ${COLORS.gold}`, borderRadius: 8,
              padding: "8px 16px", marginTop: 16,
              fontSize: 13, color: COLORS.text, fontFamily: "'Manrope', sans-serif", lineHeight: 1.6,
              animation: "calloutIn 0.5s ease-out both",
            }}>
              ✦ Cada lead de Meta Ads cuesta ${(parseFloat(metaData.totals.spend) / parseInt(metaData.totals.leads)).toFixed(2)} en promedio este mes.
            </div>
          )}
        </Card>

        {/* Columna derecha */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Sentimiento de conversaciones */}
          <Card>
            <h4 style={{ margin: "0 0 12px", fontSize: 15, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, color: COLORS.green }}>
              Sentimiento de conversaciones
            </h4>
            {sofiaLoading ? (
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>Cargando datos...</p>
            ) : sofiaStats?.total > 0 ? (
              (() => {
                const { total, positivo, neutral, negativo } = sofiaStats;
                // sentiment puede venir null en conversaciones muy cortas que
                // Sofía no llega a clasificar — se muestran aparte en vez de
                // omitirlas, para que el donut siempre sume el total real.
                const sinClasificar = Math.max(0, total - positivo - neutral - negativo);
                const donutData = [
                  { name: "Positivo", value: positivo, color: COLORS.success },
                  { name: "Neutral", value: neutral, color: COLORS.gold },
                  { name: "Negativo", value: negativo, color: COLORS.danger },
                  ...(sinClasificar > 0 ? [{ name: "Sin clasificar", value: sinClasificar, color: COLORS.textMuted }] : []),
                ];

                return (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                      <div style={{ position: "relative", width: 120, height: 120, flexShrink: 0 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={donutData}
                              dataKey="value"
                              innerRadius="60%"
                              outerRadius="80%"
                              startAngle={90}
                              endAngle={-270}
                              stroke="none"
                              isAnimationActive={true}
                            >
                              {donutData.map((d, i) => (
                                <Cell key={i} fill={d.color} />
                              ))}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                        <div style={{
                          position: "absolute", inset: 0,
                          display: "flex", flexDirection: "column",
                          alignItems: "center", justifyContent: "center",
                          pointerEvents: "none",
                        }}>
                          <span style={{ fontSize: 22, fontWeight: 700, color: COLORS.green, fontFamily: "'Manrope', sans-serif", lineHeight: 1.1 }}>
                            {total}
                          </span>
                          <span style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
                            total
                          </span>
                        </div>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                        {donutData.map((d, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
                            <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, fontFamily: "'Manrope', sans-serif" }}>
                              {d.value}
                            </span>
                            <span style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
                              {d.name}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <p style={{ margin: "12px 0 0", fontSize: 11, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", lineHeight: 1.5 }}>
                      Este mes, según el tono detectado en cada conversación con Sofía.
                    </p>
                  </>
                );
              })()
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", lineHeight: 1.6 }}>
                Sin conversaciones este mes todavía.
              </p>
            )}
          </Card>

        </div>
      </div>

      {/* SECCIÓN 3 — Rendimiento por fuente, con indicador de conexiones en el encabezado */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, color: COLORS.green }}>
            Rendimiento por fuente
          </h3>
          <ConnectionIndicator />
        </div>

        {/* Share relativo entre fuentes */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
          {sourceShare.map((s) => (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 62, fontSize: 12, fontWeight: 600, color: COLORS.text, fontFamily: "'Manrope', sans-serif", flexShrink: 0 }}>
                {s.label}
              </span>
              <div style={{ flex: 1, height: 8, background: COLORS.border, borderRadius: 4 }}>
                <div style={{
                  height: "100%", width: `${s.pct}%`,
                  background: s.color, borderRadius: 4,
                  transition: "width 0.8s ease-out",
                }} />
              </div>
              <span style={{ width: 36, textAlign: "right", fontSize: 12, fontWeight: 700, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", flexShrink: 0 }}>
                {s.pct}%
              </span>
            </div>
          ))}
        </div>

        {/* Meta Ads */}
        <div style={{ ...sourceRowStyle, borderBottom: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: SOURCE_COLORS.meta, flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, fontFamily: "'Manrope', sans-serif" }}>Meta Ads</span>
          </div>
          {metricCell("Gasto", metaValue(() => `$${parseFloat(metaData?.totals?.spend || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`))}
          {metricCell("CPL", metaLoading ? "..." : (metaData?.totals?.leads > 0
            ? `$${(parseFloat(metaData.totals.spend) / parseInt(metaData.totals.leads)).toFixed(2)}`
            : "—"))}
          {metricCell("Leads", metaLoading ? "..." : `${parseInt(metaData?.totals?.leads || 0)}`)}
          <div style={{ textAlign: "right" }}><ActiveBadge active={!!metaData} /></div>
        </div>
      </Card>

    </div>
  );
}
