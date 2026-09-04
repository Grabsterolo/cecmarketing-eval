import React, { useState, useEffect } from "react";
import { COLORS, SOURCE_COLORS } from "../../constants/colors.js";
import { Card } from "../ui/Card.jsx";
import { Badge } from "../ui/Badge.jsx";
import { ErrorBanner } from "../ui/ErrorBanner.jsx";
import { EmptyState } from "../ui/EmptyState.jsx";
import { SectionHeader } from "../ui/SectionHeader.jsx";
import { Button } from "../ui/Button.jsx";
import { supabase } from "../../lib/supabase.js";
import { fetchApiAutenticado } from "../../lib/api.js";

const formatDate = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-CR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
};

// Versión corta, para el extremo "desde" de un rango — el día de la semana y
// el año se leen del extremo "hasta", repetirlos alarga sin aportar.
const formatDateShort = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-CR", { month: "long", day: "numeric" });
};

// Los análisis viejos son diarios (period_days = 1) y los nuevos cubren una
// ventana de varios días. Una fila sin period_days es histórica, de antes de
// que existiera la columna, así que se asume diaria.
const formatPeriod = (rec) => {
  if (!rec) return "";
  const days = rec.period_days || 1;
  if (days <= 1) return formatDate(rec.date);

  const end = new Date(rec.date + "T12:00:00");
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  return `${formatDateShort(startStr)} — ${formatDate(rec.date)}`;
};

const periodLabel = (rec) => {
  const days = rec?.period_days || 1;
  return days <= 1 ? "Último día" : `Últimos ${days} días`;
};

const renderAnalysis = (text) => {
  return text.split('\n').map((line, i) => {
    if (line.startsWith('**') && line.endsWith('**')) {
      return <p key={i} style={{ margin: "16px 0 8px", fontSize: 13,
        fontWeight: 700, color: COLORS.green, fontFamily: "'Manrope', sans-serif",
        textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {line.replace(/\*\*/g, '')}
      </p>;
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      return <div key={i} style={{ display: "flex", gap: 8,
        marginBottom: 6, alignItems: "flex-start" }}>
        <span style={{ color: COLORS.gold, fontWeight: 700,
          marginTop: 1, flexShrink: 0 }}>✦</span>
        <p style={{ margin: 0, fontSize: 13, color: COLORS.text,
          fontFamily: "'Manrope', sans-serif", lineHeight: 1.6 }}>
          {line.replace(/^[-*] /, '')}
        </p>
      </div>;
    }
    if (line.match(/^\d+\. /)) {
      const num = line.match(/^(\d+)\. /)[1];
      return <div key={i} style={{ display: "flex", gap: 10,
        marginBottom: 8, alignItems: "flex-start" }}>
        <span style={{ background: COLORS.green, color: "white",
          borderRadius: "50%", width: 20, height: 20, display: "flex",
          alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 700, flexShrink: 0,
          fontFamily: "'Manrope', sans-serif", marginTop: 1 }}>
          {num}
        </span>
        <p style={{ margin: 0, fontSize: 13, color: COLORS.text,
          fontFamily: "'Manrope', sans-serif", lineHeight: 1.6 }}>
          {line.replace(/^\d+\. /, '')}
        </p>
      </div>;
    }
    if (line.trim() === '') return <div key={i} style={{ height: 4 }} />;
    return <p key={i} style={{ margin: "0 0 8px", fontSize: 13,
      color: COLORS.text, fontFamily: "'Manrope', sans-serif",
      lineHeight: 1.6 }}>{line}</p>;
  });
};

const statCell = (label, value) => (
  <div>
    <p style={{ margin: "0 0 2px", fontSize: 11, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>{label}</p>
    <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: COLORS.green, fontFamily: "'Manrope', sans-serif" }}>{value}</p>
  </div>
);

function MetaVsSofiaSnapshot({ snapshot }) {
  const meta = snapshot?.meta?.totals;
  const sofia = snapshot?.sofia;
  if (!meta || !sofia) return null;

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div>
          <p style={{ margin: "0 0 12px", fontSize: 12, fontWeight: 700, color: SOURCE_COLORS.meta, fontFamily: "'Manrope', sans-serif", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Meta Ads
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {statCell("Gasto", `$${parseFloat(meta.spend || 0).toFixed(2)}`)}
            {statCell("Leads", meta.leads || 0)}
          </div>
        </div>
        <div style={{ borderLeft: `1px solid ${COLORS.border}`, paddingLeft: 20 }}>
          <p style={{ margin: "0 0 12px", fontSize: 12, fontWeight: 700, color: COLORS.gold, fontFamily: "'Manrope', sans-serif", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Conversaciones de Sofía
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {statCell("Total", sofia.total || 0)}
            {statCell("Escaladas", sofia.total > 0 ? `${sofia.escalationRate}%` : "—")}
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 12, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
            {(sofia.byChannel?.facebook || 0)} desde redes sociales · {(sofia.byChannel?.whatsapp || 0)} desde WhatsApp directo
          </p>
        </div>
      </div>
    </Card>
  );
}

// Días transcurridos desde el último día que cubre el análisis, en fecha de
// Costa Rica (rec.date es un DATE, sin hora).
function diasDeAntiguedad(rec) {
  if (!rec?.date) return 0;
  const hoyCR = new Date().toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
  const ms = Date.parse(`${hoyCR}T00:00:00Z`) - Date.parse(`${rec.date}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86400000));
}

export function RecommendationsSection() {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [today, setToday] = useState(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("sofia_recommendations")
        .select("*")
        .order("date", { ascending: false })
        .limit(7);

      if (error) setError(error.message);
      else {
        setRecommendations(data || []);
        setToday(data?.[0]);
      }
      setLoading(false);
    })();
  }, []);

  const generateAnalysis = async () => {
    setGenerating(true);
    try {
      await fetchApiAutenticado("/api/daily-analysis", { method: "POST" });
      const { data: newData } = await supabase
        .from("sofia_recommendations")
        .select("*")
        .order("date", { ascending: false })
        .limit(7);
      setRecommendations(newData || []);
      setToday(newData?.[0]);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const previous = recommendations.slice(1);

  return (
    <div>
      <SectionHeader
        title="Análisis de Sofía"
        subtitle="Reporte diario que cruza Meta Ads con las conversaciones reales de Sofía"
        action={
          <Button onClick={generateAnalysis} disabled={generating} style={{ flexShrink: 0, marginLeft: 16 }}>
            {generating ? "Generando..." : "Generar corte de 5 días"}
          </Button>
        }
      />

      {/* Error */}
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {/* Loading */}
      {loading && (
        <p style={{ textAlign: "center", fontSize: 14, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", padding: "40px 0" }}>
          Cargando análisis...
        </p>
      )}

      {/* Análisis más reciente */}
      {!loading && today && (
        <>
          {/* El análisis más reciente se mostraba sin decir de cuándo es: la
              variable se llama `today` pero es simplemente la fila con la
              fecha más alta, que puede tener días. El 2026-08-30 el reporte
              visible era del 26 de agosto y nada en pantalla lo advertía —
              se leía como el estado de hoy. El reporte lo genera un
              disparador de Cloudflare; si deja de correr, esta pantalla
              seguiría mostrando el último indefinidamente. */}
          {diasDeAntiguedad(today) > (today.period_days || 1) + 1 && (
            <div style={{
              margin: "0 0 16px", fontSize: 12.5, lineHeight: 1.55,
              color: COLORS.warning, background: COLORS.warningBg,
              border: `1px solid ${COLORS.warningBorder}`,
              borderRadius: 8, padding: "10px 12px", fontFamily: "'Manrope', sans-serif",
            }}>
              Este análisis es el más reciente que hay, pero cubre hasta el{" "}
              <strong>{formatPeriod(today)}</strong> — hace {diasDeAntiguedad(today)} días.
              No describe lo que está pasando hoy. Si el reporte automático debería
              correr más seguido, hay que revisar el disparador en Cloudflare.
            </div>
          )}
          <MetaVsSofiaSnapshot snapshot={today.data_snapshot} />
          <Card style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", textTransform: "capitalize" }}>
                {formatPeriod(today)}
              </p>
              <Badge variant="gold">
                {periodLabel(today)}
              </Badge>
            </div>
            <div>{renderAnalysis(today.analysis)}</div>
          </Card>
        </>
      )}

      {/* Sin análisis */}
      {!loading && !today && (
        <EmptyState
          title="Sin análisis todavía"
          description='Haz clic en "Generar corte de 5 días" para que Sofía analice el período más reciente.'
        />
      )}

      {/* Análisis anteriores */}
      {!loading && previous.length > 0 && (
        <>
          <h3 style={{ margin: "24px 0 12px", fontSize: 16, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, color: COLORS.green }}>
            Análisis anteriores
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {previous.map((rec) => (
              <Card key={rec.id || rec.date}>
                <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 600, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", textTransform: "capitalize" }}>
                  {formatPeriod(rec)}
                </p>
                <p style={{ margin: 0, fontSize: 12, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", lineHeight: 1.5 }}>
                  {rec.analysis?.substring(0, 150)}{rec.analysis?.length > 150 ? "..." : ""}
                </p>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
