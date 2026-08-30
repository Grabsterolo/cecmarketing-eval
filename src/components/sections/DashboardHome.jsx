import React, { useState, useEffect, useCallback } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { RefreshCw } from "lucide-react";
import { COLORS, SOURCE_COLORS } from "../../constants/colors.js";
import { Card } from "../ui/Card.jsx";
import { Badge } from "../ui/Badge.jsx";
import { MetricKpi } from "../ui/MetricKpi.jsx";
import { PROCEDURE_FAMILIES } from "../../constants/procedures.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { supabase } from "../../lib/supabase.js";
import { fetchApiAutenticado } from "../../lib/api.js";

// created_at se guarda en UTC pero el equipo opera en hora de Costa Rica
// (UTC-6) — mismo patrón que el resto de las secciones. Sin esto, "este mes"
// arrancaba en la medianoche local del navegador de quien tuviera el
// dashboard abierto, no en la de Costa Rica.
function startOfMonthCR() {
  const todayCR = new Date().toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
  return `${todayCR.slice(0, 7)}-01T00:00:00-06:00`;
}

function familyCodes(value) {
  return PROCEDURE_FAMILIES.find((f) => f.value === value)?.codes ?? [];
}

// Correspondencia entre campañas de Meta y temas de conversación.
//
// IMPORTANTE — esto NO es atribución: Sofía no recibe de qué anuncio viene
// cada paciente (Meta lo manda en sus anuncios click-to-WhatsApp, pero los
// mensajes llegan vía Zenvia y ese dato no se está capturando). Lo que se
// compara es el gasto de una campaña con las conversaciones sobre ese mismo
// tema en el mismo período. Sirve para decidir presupuesto, no para afirmar
// que una conversación vino de una campaña puntual.
//
// El orden importa: "Cirugía Corporal" tiene que evaluarse antes que
// "Cirugía", que es más general.
const CAMPAIGN_THEMES = [
  { test: /preserv/i, label: "Preservé", codes: ["mamario_preserve"] },
  { test: /\bmia\b/i, label: "MIA Femtech", codes: ["mamario_mia"] },
  { test: /inyectables|faciales y corporales/i, label: "Inyectables y faciales", codes: familyCodes("fam_inyectables") },
  { test: /cirug[ií]a corporal/i, label: "Cirugía corporal", codes: familyCodes("fam_corporal_qx") },
  { test: /cirug[ií]a/i, label: "Cirugía", codes: [...familyCodes("fam_corporal_qx"), ...familyCodes("fam_facial_qx")] },
];

function themeForCampaign(name) {
  return CAMPAIGN_THEMES.find((t) => t.test.test(name || "")) || null;
}

function money(n) {
  return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function leadsOf(campaign) {
  return parseInt(campaign.actions?.find((a) => a.action_type === "lead")?.value || 0, 10);
}

export function DashboardHome({ profile }) {
  const isMobile = useIsMobile();

  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState(null);
  const [sofia, setSofia] = useState(null);
  const [sofiaError, setSofiaError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMetaError(null);
    setSofiaError(null);
    const since = startOfMonthCR();

    // Meta y Sofía se piden en paralelo y se guardan por separado a
    // propósito: si Meta falla, las cifras de Sofía siguen siendo válidas y
    // se muestran igual. Un fallo nunca puede terminar pintando 0.
    const metaPromise = fetchApiAutenticado("/api/meta-metrics");

    // Una sola llamada en vez de 11 conteos por separado. En Postgres cada
    // conteo tarda 2-4 ms, pero eran 11 peticiones HTTP concurrentes: el
    // navegador limita conexiones por host y PostgREST las encola, así que
    // en producción una llegó a tardar 10 segundos y la pantalla se quedaba
    // en "Cargando...". Ver la función sofia_home_stats en Supabase.
    const sofiaPromise = supabase
      .rpc("sofia_home_stats", { desde: since })
      .then(({ data, error }) => {
        if (error) return Promise.reject(new Error(error.message));
        if (!data) return Promise.reject(new Error("Sin datos de conversaciones"));
        return data;
      });

    const [metaRes, sofiaRes] = await Promise.allSettled([metaPromise, sofiaPromise]);

    if (metaRes.status === "fulfilled") setMeta(metaRes.value);
    else setMetaError(metaRes.reason?.message || "No se pudo consultar Meta Ads");

    if (sofiaRes.status === "fulfilled") {
      const d = sofiaRes.value;
      setSofia({
        total: d.total ?? 0,
        escaladas: d.escaladas ?? 0,
        positivo: d.positivo ?? 0,
        neutral: d.neutral ?? 0,
        negativo: d.negativo ?? 0,
        // Las familias se suman acá y no en Postgres: la taxonomía ya vive
        // en constants/procedures.js y duplicarla en la base obligaría a
        // cambiarla en dos lugares.
        porTema: Object.fromEntries(
          CAMPAIGN_THEMES.map((t) => [
            t.label,
            t.codes.reduce((acc, code) => acc + (d.porCodigo?.[code] ?? 0), 0),
          ])
        ),
      });
    } else {
      setSofiaError(sofiaRes.reason?.message || "No se pudieron contar las conversaciones");
    }

    setUpdatedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const pctEscalado = sofia && sofia.total > 0
    ? Math.round((sofia.escaladas / sofia.total) * 100)
    : null;

  // Campañas con tema reconocible, cruzadas contra las conversaciones de ese
  // tema. Las que no tienen tema (Alcance, Institucional, Doctores...) se
  // cuentan aparte en vez de forzarles una correspondencia inventada.
  const campanas = (meta?.campaigns || []).map((c) => ({
    nombre: c.campaign_name,
    gasto: parseFloat(c.spend || 0),
    leads: leadsOf(c),
    tema: themeForCampaign(c.campaign_name),
  }));
  const conTema = campanas.filter((c) => c.tema && c.gasto > 0);
  const sinTema = campanas.filter((c) => !c.tema && c.gasto > 0);
  const gastoSinTema = sinTema.reduce((s, c) => s + c.gasto, 0);

  // El centro del donut muestra sofia.total, así que los segmentos tienen que
  // sumar exactamente eso. Las conversaciones que Claude no logró clasificar
  // se muestran como "Sin clasificar" en vez de desaparecer del gráfico
  // dejando que las partes no cuadren con el total.
  const sinClasificar = sofia
    ? Math.max(0, sofia.total - sofia.positivo - sofia.neutral - sofia.negativo)
    : 0;
  const sentimentData = sofia ? [
    { name: "Positivo", value: sofia.positivo, color: COLORS.success },
    { name: "Neutral", value: sofia.neutral, color: COLORS.gold },
    { name: "Negativo", value: sofia.negativo, color: COLORS.danger },
    { name: "Sin clasificar", value: sinClasificar, color: COLORS.border },
  ].filter((d) => d.value > 0) : [];

  const mesLabel = new Date().toLocaleDateString("es-CR", { month: "long", timeZone: "America/Costa_Rica" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Barra de estado: de cuándo son los datos y cómo actualizarlos. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
          {loading
            ? "Actualizando..."
            : updatedAt
              ? `Datos de ${mesLabel} · actualizado ${updatedAt.toLocaleTimeString("es-CR", { hour: "numeric", minute: "2-digit" })}`
              : ""}
        </span>
        <button
          onClick={load}
          disabled={loading}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: COLORS.panelAlt, color: COLORS.green,
            border: `1px solid ${COLORS.border}`, borderRadius: 8,
            padding: "6px 12px", fontSize: 12.5, fontWeight: 600,
            fontFamily: "'Manrope', sans-serif",
            cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1,
          }}
        >
          <RefreshCw size={13} /> Actualizar
        </button>
      </div>

      {/* KPIs del mes */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", gap: 16 }}>
        <Card>
          <MetricKpi
            label="Inversión Meta"
            value={metaError ? "—" : loading ? "..." : money(meta?.totals?.spend)}
            sub={metaError ? "No se pudo consultar" : "En lo que va del mes"}
          />
        </Card>
        <Card>
          <MetricKpi
            label="Leads Meta"
            value={metaError ? "—" : loading ? "..." : `${meta?.totals?.leads ?? 0}`}
            sub={metaError ? "No se pudo consultar" : "Dejaron sus datos"}
          />
        </Card>
        <Card>
          <MetricKpi
            label="Conversaciones"
            value={sofiaError ? "—" : loading ? "..." : `${sofia?.total ?? 0}`}
            sub={sofiaError ? "No se pudo consultar" : "Atendidas por Sofía"}
          />
        </Card>
        <Card>
          <MetricKpi
            label="Escaladas"
            value={sofiaError || pctEscalado === null ? "—" : loading ? "..." : `${pctEscalado}%`}
            sub={sofiaError ? "No se pudo consultar" : "Pasaron a un asesor"}
          />
        </Card>
      </div>

      {metaError && (
        <p style={{
          margin: 0, fontSize: 12.5, lineHeight: 1.55,
          color: COLORS.warning, background: COLORS.warningBg,
          border: `1px solid ${COLORS.warningBorder}`,
          borderRadius: 8, padding: "10px 12px", fontFamily: "'Manrope', sans-serif",
        }}>
          No se pudieron cargar los datos de Meta Ads ({metaError}). Las cifras de inversión
          aparecen sin valor — <strong>no significa que la inversión haya sido cero.</strong> Lo de
          Sofía sí es real.
        </p>
      )}

      {/* Campañas vs conversaciones — el cruce temático */}
      <Card>
        <h3 style={{ margin: "0 0 4px", fontSize: 18, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, color: COLORS.green }}>
          Campañas y conversaciones
        </h3>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
          Cuánto se invirtió en cada tema y cuántas conversaciones hubo sobre ese mismo tema, en el mes.
        </p>

        {metaError || sofiaError ? (
          <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
            Hace falta que Meta y Sofía respondan para poder cruzarlos.
          </p>
        ) : loading ? (
          <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
            Cargando...
          </p>
        ) : conTema.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
            Ninguna campaña activa este mes corresponde a un tema de conversación identificable.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "'Manrope', sans-serif" }}>
              <thead>
                <tr>
                  {["Campaña", "Tema", "Invertido", "Leads", "Conversaciones"].map((h, i) => (
                    <th key={h} style={{
                      textAlign: i >= 2 ? "right" : "left", padding: "0 0 8px",
                      fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
                      color: COLORS.textMuted, fontWeight: 700,
                      borderBottom: `1px solid ${COLORS.border}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {conTema.map((c, i) => (
                  // La clave incluye el índice: la cuenta tiene dos campañas
                  // distintas con el mismo nombre ("MIA | Mensajes"), y con
                  // key={c.nombre} React colapsaba/confundía ambas filas.
                  <tr key={`${c.nombre}-${i}`}>
                    <td style={{ padding: "10px 12px 10px 0", borderBottom: `1px solid ${COLORS.border}`, color: COLORS.text }}>
                      {c.nombre}
                    </td>
                    <td style={{ padding: "10px 12px 10px 0", borderBottom: `1px solid ${COLORS.border}` }}>
                      <Badge variant="gold">{c.tema.label}</Badge>
                    </td>
                    <td style={{ padding: "10px 0", borderBottom: `1px solid ${COLORS.border}`, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {money(c.gasto)}
                    </td>
                    <td style={{ padding: "10px 0", borderBottom: `1px solid ${COLORS.border}`, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {c.leads}
                    </td>
                    <td style={{ padding: "10px 0", borderBottom: `1px solid ${COLORS.border}`, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: COLORS.green }}>
                      {sofia?.porTema?.[c.tema.label] ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {sinTema.length > 0 && (
          <p style={{ margin: "14px 0 0", fontSize: 12, lineHeight: 1.5, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
            Otras {sinTema.length} campañas ({money(gastoSinTema)}) no apuntan a un procedimiento
            concreto — Alcance, Institucional, Doctores, Tráfico al sitio — así que no se les puede
            asignar un tema de conversación.
          </p>
        )}

        <p style={{ margin: "10px 0 0", fontSize: 11.5, lineHeight: 1.5, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
          <strong>Esto no es atribución.</strong> Sofía no recibe de qué anuncio viene cada paciente,
          así que se comparan dos cosas medidas por separado en el mismo período: lo invertido en un
          tema y las conversaciones sobre ese tema.
        </p>
      </Card>

      {/* Sentimiento */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
        <Card>
          <h3 style={{ margin: "0 0 16px", fontSize: 18, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, color: COLORS.green }}>
            Tono de las conversaciones
          </h3>
          {sofiaError ? (
            <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
              No se pudo consultar.
            </p>
          ) : loading || !sofia ? (
            <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
              Cargando...
            </p>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
              <div style={{ width: 130, height: 130, position: "relative", flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={sentimentData} dataKey="value" innerRadius={42} outerRadius={62} paddingAngle={2} stroke="none">
                      {sentimentData.map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                  <span style={{ fontSize: 20, fontWeight: 700, color: COLORS.green, fontFamily: "'Manrope', sans-serif", lineHeight: 1 }}>
                    {sofia.total}
                  </span>
                  <span style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>total</span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {sentimentData.map((d) => (
                  <span key={d.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontFamily: "'Manrope', sans-serif", color: COLORS.text }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
                    <strong style={{ fontVariantNumeric: "tabular-nums" }}>{d.value}</strong> {d.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <h3 style={{ margin: "0 0 16px", fontSize: 18, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, color: COLORS.green }}>
            Eficiencia del mes
          </h3>
          {metaError || sofiaError || loading ? (
            <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
              {metaError || sofiaError ? "No se pudo calcular." : "Cargando..."}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <MetricKpi
                label="Costo por lead"
                value={meta?.totals?.leads > 0 ? money(meta.totals.spend / meta.totals.leads) : "—"}
                sub={meta?.totals?.leads > 0 ? "Promedio de todas las campañas" : "Sin leads registrados este mes"}
              />
              {/* Divide dos cosas que NO son la misma población: a Sofía le
                  llegan también conversaciones orgánicas, de Facebook y de
                  anuncios de TikTok (canal sin inversión registrada acá), así
                  que este número subestima el costo real por conversación
                  pagada. Se deja porque sirve de referencia, pero avisando. */}
              <MetricKpi
                label="Costo por conversación"
                value={sofia?.total > 0 ? money((meta?.totals?.spend || 0) / sofia.total) : "—"}
                sub="Inversión Meta entre TODAS las conversaciones de Sofía"
                note="Incluye conversaciones orgánicas y de otros canales: es un piso, no el costo real"
              />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
