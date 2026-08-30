import React, { useState, useEffect } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { LayoutDashboard } from "lucide-react";
import { COLORS, SOURCE_COLORS } from "../../constants/colors.js";
import { Card } from "../ui/Card.jsx";
import { PendingIntegrationCard } from "../ui/PendingIntegrationCard.jsx";
import { MetricKpi, SourceDot, tableStyles } from "../ui/MetricKpi.jsx";
import { fetchApiAutenticado } from "../../lib/api.js";

function getMetaInsight(campaigns, totals) {
  const withLeads = (campaigns ?? []).filter(c => {
    const leads = parseInt(c.actions?.find(a => a.action_type === "lead")?.value || 0);
    return leads > 0;
  });

  if (withLeads.length > 0) {
    const best = [...withLeads].sort((a, b) => {
      const leadsA = parseInt(a.actions.find(ac => ac.action_type === "lead").value);
      const leadsB = parseInt(b.actions.find(ac => ac.action_type === "lead").value);
      return (parseFloat(a.spend) / leadsA) - (parseFloat(b.spend) / leadsB);
    })[0];
    const bestLeads = parseInt(best.actions.find(a => a.action_type === "lead").value);
    const bestCpl = (parseFloat(best.spend) / bestLeads).toFixed(2);
    return `La campaña con mejor rendimiento este mes es "${best.campaign_name}" con un costo por lead de $${bestCpl}.`;
  }

  if (parseFloat(totals?.spend || 0) > 0) {
    return `Las campañas activas acumulan ${parseInt(totals.impressions).toLocaleString()} impresiones este mes con un gasto total de $${parseFloat(totals.spend).toFixed(2)}.`;
  }

  return null;
}

export function MetricsSection() {
  const [metaData, setMetaData] = useState(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchApiAutenticado("/api/meta-metrics")
      .then(data => { if (!cancelled) setMetaData(data); })
      .catch(err => { if (!cancelled) setMetaError(err.message); })
      .finally(() => { if (!cancelled) setMetaLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const metaCampaigns = (metaData?.campaigns ?? []).map(c => {
    const leads = parseInt(c.actions?.find(a => a.action_type === "lead")?.value || 0);
    const cpl = leads > 0 ? `$${(parseFloat(c.spend) / leads).toFixed(2)}` : "—";
    return {
      nombre: c.campaign_name,
      gasto: `$${parseFloat(c.spend).toFixed(2)}`,
      impresiones: parseInt(c.impressions).toLocaleString(),
      clics: parseInt(c.clicks).toLocaleString(),
      leads,
      cpl,
    };
  });

  const chartData = (metaData?.campaigns ?? []).map(c => ({
    name: c.campaign_name.length > 20 ? c.campaign_name.substring(0, 20) + "..." : c.campaign_name,
    Gasto: parseFloat(c.spend),
    Leads: parseInt(c.actions?.find(a => a.action_type === "lead")?.value || 0),
  }));

  const campanasConLeads = (metaData?.campaigns ?? []).filter(c =>
    parseInt(c.actions?.find(a => a.action_type === "lead")?.value || 0) > 0
  );
  const cplReal = campanasConLeads.length > 0
    ? (
        campanasConLeads.reduce((sum, c) => sum + parseFloat(c.spend || 0), 0) /
        campanasConLeads.reduce((sum, c) => sum + parseInt(c.actions?.find(a => a.action_type === "lead")?.value || 0), 0)
      ).toFixed(2)
    : 0;
  const cplValue = campanasConLeads.length > 0 ? `$${cplReal}` : "—";

  const insight = metaData ? getMetaInsight(metaData.campaigns, metaData.totals) : null;

  const bestCampaign = (metaData?.campaigns ?? [])
    .filter(c => parseInt(c.actions?.find(a => a.action_type === "lead")?.value || 0) > 0)
    .sort((a, b) => {
      const cplA = parseFloat(a.spend) / parseInt(a.actions?.find(x => x.action_type === "lead")?.value || 1);
      const cplB = parseFloat(b.spend) / parseInt(b.actions?.find(x => x.action_type === "lead")?.value || 1);
      return cplA - cplB;
    })[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Bloque Meta Ads */}
      <Card>
        <SourceDot color={SOURCE_COLORS.meta} label="Meta Ads" />

        {metaLoading && (
          <p style={{ fontSize: 14, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", textAlign: "center", padding: "32px 0", margin: 0 }}>
            Cargando métricas...
          </p>
        )}

        {!metaLoading && metaError && (
          <PendingIntegrationCard
            icon={LayoutDashboard}
            title="No se pudo conectar con Meta Ads"
            description={metaError}
          />
        )}

        {!metaLoading && !metaError && metaData && (
          <>
            {/* Insight automático */}
            {insight && (
              <div style={{
                background: "rgba(201,162,78,0.08)",
                border: `1px solid rgba(201,162,78,0.25)`,
                borderLeft: `3px solid ${COLORS.gold}`,
                borderRadius: 8,
                padding: "12px 16px",
                marginTop: 16,
                marginBottom: 4,
                fontSize: 13,
                color: COLORS.text,
                fontFamily: "'Manrope', sans-serif",
                lineHeight: 1.6,
                animation: "calloutIn 0.5s ease-out both",
              }}>
                <span style={{ color: COLORS.gold, marginRight: 8 }}>✦</span>
                {insight}
              </div>
            )}

            {/* KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 16, marginTop: 20 }}>
              <MetricKpi
                label="Gasto"
                value={`$${parseFloat(metaData.totals.spend).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
                sub="Este mes"
              />
              <MetricKpi
                label="Impresiones"
                value={`${parseInt(metaData.totals.impressions).toLocaleString()}`}
                sub="Veces que se mostró el anuncio"
                note="No es alcance: una persona puede verlo varias veces"
              />
              {/* `clicks` incluye reacciones, comentarios y clics al perfil.
                  Lo que la gente entiende por "clic" es el clic al enlace. */}
              <MetricKpi
                label="Clics al enlace"
                value={`${parseInt(metaData.totals.linkClicks ?? 0).toLocaleString()}`}
                sub={`De ${parseInt(metaData.totals.clicks).toLocaleString()} interacciones totales`}
              />
            </div>

            {/* Dos definiciones distintas de "resultado", separadas a
                propósito: casi todas las campañas del CEC son de mensajes,
                y ahí la conversación iniciada es el resultado real. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 20 }}>
              <MetricKpi
                label="Conversaciones iniciadas"
                value={`${(metaData.totals.messagingStarted ?? 0).toLocaleString()}`}
                sub="Anuncios de mensajes (7 días)"
              />
              <MetricKpi
                label="Costo por conversación"
                value={metaData.totals.costoPorConversacion ? `$${metaData.totals.costoPorConversacion}` : "—"}
                sub="Gasto entre conversaciones iniciadas"
              />
              <MetricKpi
                label="Leads"
                value={`${metaData.totals.leads}`}
                sub="Formulario / evento de lead"
                note="Definición distinta a conversaciones"
              />
              <MetricKpi
                label="Costo por lead"
                value={cplValue}
                sub="Promedio Meta Ads"
                note="Solo campañas con leads"
              />
            </div>

            {/* Mejor campaña Meta */}
            {bestCampaign && (
              <div style={{
                background: COLORS.panelAlt, border: `1px solid ${COLORS.border}`,
                borderRadius: 10, padding: "14px 18px", marginBottom: 20,
                display: "flex", alignItems: "center", justifyContent: "space-between",
                flexWrap: "wrap", gap: 12,
              }}>
                <div>
                  <p style={{ margin: "0 0 2px", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
                    Mejor campaña
                  </p>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: COLORS.green, fontFamily: "'Manrope', sans-serif" }}>
                    {bestCampaign.campaign_name}
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ margin: "0 0 2px", fontSize: 20, fontWeight: 700, color: COLORS.gold, fontFamily: "'Manrope', sans-serif", lineHeight: 1.1 }}>
                    {`$${(parseFloat(bestCampaign.spend) / parseInt(bestCampaign.actions?.find(a => a.action_type === "lead")?.value || 1)).toFixed(2)}`}
                  </p>
                  <p style={{ margin: 0, fontSize: 11, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
                    Costo por lead
                  </p>
                </div>
              </div>
            )}

            {/* Tabla campañas */}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                <thead>
                  <tr>
                    {["Campaña", "Gasto", "Impresiones", "Clics", "Leads", "Costo / Lead"].map(h => (
                      <th key={h} style={{ ...tableStyles.head, textAlign: h === "Campaña" ? "left" : "right" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metaCampaigns.map((c, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? COLORS.panel : COLORS.panelAlt }}>
                      <td style={{ ...tableStyles.cell, fontWeight: 600 }}>{c.nombre}</td>
                      <td style={{ ...tableStyles.cell, textAlign: "right" }}>{c.gasto}</td>
                      <td style={{ ...tableStyles.cell, textAlign: "right" }}>{c.impresiones}</td>
                      <td style={{ ...tableStyles.cell, textAlign: "right" }}>{c.clics}</td>
                      <td style={{ ...tableStyles.cell, textAlign: "right", fontWeight: 700, color: COLORS.green }}>{c.leads}</td>
                      <td style={{
                        ...tableStyles.cell, textAlign: "right",
                        fontWeight: c.cpl !== "—" ? 700 : 400,
                        color: c.cpl !== "—" ? COLORS.green : COLORS.textMuted,
                      }}>{c.cpl}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p style={{ margin: "8px 0 0", fontSize: 11, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", fontStyle: "italic" }}>
              * Las campañas de alcance y tráfico no tienen como objetivo generar leads — su costo por lead no es comparable con campañas de conversión.
            </p>

            {/* Gráfico gasto vs leads */}
            <h3 style={{ margin: "24px 0 12px", fontSize: 16, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, color: COLORS.green }}>
              Gasto vs Leads por campaña
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={chartData} barGap={4} barCategoryGap="30%">
                <defs>
                  <linearGradient id="gastoGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SOURCE_COLORS.meta} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={COLORS.gold} stopOpacity={0.9} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                <XAxis dataKey="name" tick={tableStyles.tick} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left"  orientation="left"  tick={tableStyles.tick} axisLine={false} tickLine={false} width={50} />
                <YAxis yAxisId="right" orientation="right" tick={tableStyles.tick} axisLine={false} tickLine={false} width={28} />
                <Tooltip
                  contentStyle={{
                    fontFamily: "'Manrope', sans-serif", fontSize: 12,
                    borderRadius: 8, border: `1px solid ${COLORS.border}`,
                    background: COLORS.panel,
                  }}
                  cursor={{ fill: COLORS.panelAlt }}
                />
                <Legend wrapperStyle={{ fontFamily: "'Manrope', sans-serif", fontSize: 12, paddingTop: 8 }} />
                <Bar yAxisId="left" dataKey="Gasto" fill="url(#gastoGradient)" radius={[4, 4, 0, 0]} />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="Leads"
                  stroke={COLORS.green}
                  strokeWidth={2}
                  dot={{ r: 3, fill: COLORS.green }}
                  activeDot={{ r: 5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </>
        )}
      </Card>

    </div>
  );
}
