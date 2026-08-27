import React, { useState, useEffect } from "react";
import { ShieldCheck, Lightbulb } from "lucide-react";
import { COLORS } from "../../constants/colors.js";
import { Card, CardHeader } from "../ui/Card.jsx";
import { Badge } from "../ui/Badge.jsx";
import { ErrorBanner } from "../ui/ErrorBanner.jsx";
import { EmptyState } from "../ui/EmptyState.jsx";
import { SectionHeader } from "../ui/SectionHeader.jsx";
import { Button } from "../ui/Button.jsx";
import { supabase } from "../../lib/supabase.js";

const formatDate = (dateStr) => {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("es-CR", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

const renderBlock = (text) => {
  if (!text) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
        Sin contenido en esta sección.
      </p>
    );
  }
  return text.split("\n").map((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      return (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
          <span style={{ color: COLORS.gold, fontWeight: 700, marginTop: 1, flexShrink: 0 }}>✦</span>
          <p style={{ margin: 0, fontSize: 13, color: COLORS.text, fontFamily: "'Manrope', sans-serif", lineHeight: 1.6 }}>
            {trimmed.replace(/^[-*] /, "")}
          </p>
        </div>
      );
    }
    if (trimmed === "") return <div key={i} style={{ height: 4 }} />;
    return (
      <p key={i} style={{ margin: "0 0 8px", fontSize: 13, color: COLORS.text, fontFamily: "'Manrope', sans-serif", lineHeight: 1.6 }}>
        {trimmed}
      </p>
    );
  });
};

function AuditBlockCard({ title, icon, accentColor, text }) {
  return (
    <Card style={{ flex: 1, minWidth: 260 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ color: accentColor }}>{icon}</span>
        <h4 style={{ margin: 0, fontFamily: "'Cormorant Garamond', serif", fontSize: 18, fontWeight: 600, color: COLORS.green }}>
          {title}
        </h4>
      </div>
      {renderBlock(text)}
    </Card>
  );
}

export function SofiaAuditSection() {
  const [audits, setAudits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const loadAudits = async () => {
    const { data, error: fetchError } = await supabase
      .from("sofia_audits")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);
    if (fetchError) setError(fetchError.message);
    else setAudits(data || []);
    setLoading(false);
  };

  useEffect(() => {
    loadAudits();
  }, []);

  const runAudit = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/audit-sofia", {
        method: "POST",
        headers: { "x-sofia-secret": import.meta.env.VITE_SOFIA_SECRET },
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await loadAudits();
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const latest = audits[0];
  const previous = audits.slice(1);

  return (
    <div>
      <SectionHeader
        title="Auditoría de Sofía"
        subtitle="Revisa una muestra de conversaciones reales contra las reglas de Sofía y reporta qué funciona y qué no"
        action={
          <Button onClick={runAudit} disabled={generating} style={{ flexShrink: 0 }}>
            <ShieldCheck size={15} />
            {generating ? "Analizando conversaciones..." : "Auditar a Sofía"}
          </Button>
        }
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {loading && (
        <p style={{ textAlign: "center", fontSize: 14, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", padding: "40px 0" }}>
          Cargando auditorías...
        </p>
      )}

      {generating && (
        <p style={{ fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", marginBottom: 16, fontStyle: "italic" }}>
          Esto puede tardar un poco — Sofía está leyendo una muestra de conversaciones reales y comparándolas contra sus propias reglas.
        </p>
      )}

      {/* Auditoría más reciente */}
      {!loading && latest && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", textTransform: "capitalize" }}>
              {formatDate(latest.created_at)} · muestra de {latest.sample_size} conversaciones
            </p>
            <Badge variant="gold">
              Más reciente
            </Badge>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <AuditBlockCard
              title="Lo que está funcionando bien"
              icon={<span style={{ fontSize: 16, fontWeight: 700 }}>✦</span>}
              accentColor={COLORS.green}
              text={latest.strengths}
            />
            <AuditBlockCard
              title="Lo que está fallando"
              icon={<span style={{ fontSize: 16, fontWeight: 700 }}>✦</span>}
              accentColor={COLORS.gold}
              text={latest.weaknesses}
            />
            <AuditBlockCard
              title="Cómo mejorarlo"
              icon={<Lightbulb size={16} />}
              accentColor={COLORS.textMuted}
              text={latest.suggestions}
            />
          </div>
        </div>
      )}

      {/* Sin auditorías */}
      {!loading && !latest && (
        <EmptyState
          icon={<ShieldCheck size={28} color={COLORS.gold} style={{ marginBottom: 12 }} />}
          title="Sin auditorías todavía"
          description='Haz clic en "Auditar a Sofía" para revisar una muestra de conversaciones reales contra sus reglas.'
        />
      )}

      {/* Historial */}
      {!loading && previous.length > 0 && (
        <>
          <h3 style={{ margin: "8px 0 12px", fontSize: 16, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, color: COLORS.green }}>
            Auditorías anteriores
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {previous.map((audit) => {
              const isExpanded = expandedId === audit.id;
              return (
                <Card key={audit.id} style={{ padding: 0, overflow: "hidden" }}>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : audit.id)}
                    style={{
                      width: "100%", background: "none", border: "none", cursor: "pointer",
                      padding: "16px 24px", display: "flex", justifyContent: "space-between",
                      alignItems: "center", textAlign: "left",
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, fontFamily: "'Manrope', sans-serif", textTransform: "capitalize" }}>
                      {formatDate(audit.created_at)}
                    </span>
                    <span style={{ fontSize: 12, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
                      {audit.sample_size} conversaciones {isExpanded ? "▲" : "▼"}
                    </span>
                  </button>
                  {isExpanded && (
                    <div style={{ padding: "0 24px 20px", display: "flex", gap: 16, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <CardHeader title="Bien" />
                        {renderBlock(audit.strengths)}
                      </div>
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <CardHeader title="Fallas" />
                        {renderBlock(audit.weaknesses)}
                      </div>
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <CardHeader title="Sugerencias" />
                        {renderBlock(audit.suggestions)}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
