import React, { useState, useEffect } from "react";
import { COLORS, SOURCE_COLORS } from "../../constants/colors.js";
import { Card } from "../ui/Card.jsx";
import { Badge } from "../ui/Badge.jsx";
import { ErrorBanner } from "../ui/ErrorBanner.jsx";
import { EmptyState } from "../ui/EmptyState.jsx";
import { SectionHeader } from "../ui/SectionHeader.jsx";
import { Button } from "../ui/Button.jsx";
import { supabase } from "../../lib/supabase.js";

const formatDate = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-CR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
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
      const res = await fetch("/api/daily-analysis", {
        method: "POST",
        headers: { "x-sofia-secret": import.meta.env.VITE_SOFIA_SECRET },
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
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
            {generating ? "Generando..." : "Generar análisis de hoy"}
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

      {/* Análisis de hoy */}
      {!loading && today && (
        <>
          <MetaVsSofiaSnapshot snapshot={today.data_snapshot} />
          <Card style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", textTransform: "capitalize" }}>
                {formatDate(today.date)}
              </p>
              <Badge variant="gold">
                Hoy
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
          description='Haz clic en "Generar análisis de hoy" para que Sofía analice los datos actuales.'
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
                  {formatDate(rec.date)}
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
