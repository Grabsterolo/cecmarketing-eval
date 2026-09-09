import React, { useState, useCallback } from "react";
import { Menu } from "lucide-react";
import { COLORS } from "../constants/colors.js";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { Logo } from "./ui/Logo.jsx";
import { Sidebar, MobileDrawer } from "./layout/Sidebar.jsx";
import { AvisoVersionNueva } from "./ui/AvisoVersionNueva.jsx";
import { useVersionNueva } from "../hooks/useVersionNueva.js";
import { DashboardHome } from "./sections/DashboardHome.jsx";
import { MetricsSection } from "./sections/MetricsSection.jsx";
import { SofiaMetricsSection } from "./sections/SofiaMetricsSection.jsx";
import { RecommendationsSection } from "./sections/RecommendationsSection.jsx";
import { SofiaAuditSection } from "./sections/SofiaAuditSection.jsx";
import { ConfigureSofiaSection } from "./sections/ConfigureSofiaSection.jsx";
import { TestSofiaSection } from "./sections/TestSofiaSection.jsx";
import { BirthdaySection } from "./sections/BirthdaySection.jsx";
import { ContactosSection } from "./sections/ContactosSection.jsx";
import { SeguimientoSection } from "./sections/SeguimientoSection.jsx";
import { ConfiguracionSection } from "./sections/ConfiguracionSection.jsx";

const SECTION_TITLES = {
  inicio: "Inicio",
  metricas: "Métricas Meta",
  "metricas-sofia": "Métricas Sofía",
  recomendaciones: "Recomendaciones",
  "auditoria-sofia": "Auditoría de Sofía",
  "configurar-sofia": "Configurar a Sofía",
  "probar-sofia": "Probar a Sofía",
  cumpleanos: "Cumpleaños",
  seguimiento: "Seguimiento",
  contactos: "Contactos",
  configuracion: "Configuración",
};

const DAYS = ["DOMINGO", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO"];
const MONTHS = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

function getDateLabel() {
  const now = new Date();
  return `${DAYS[now.getDay()]} ${now.getDate()} DE ${MONTHS[now.getMonth()]} DE ${now.getFullYear()}`;
}

function getGreeting(name) {
  const hour = new Date().getHours();
  const saludo = hour >= 5 && hour < 12 ? "Buenos días" : hour >= 12 && hour < 19 ? "Buenas tardes" : "Buenas noches";
  return name ? `${saludo}, ${name}` : saludo;
}

export function Dashboard({ onLogout, profile }) {
  const [active, setActive] = useState("inicio");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isMobile = useIsMobile();
  const hayVersionNueva = useVersionNueva();
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const noAnim = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [displayActive, setDisplayActive] = useState("inicio");
  const [sectionPhase, setSectionPhase] = useState(null);

  const navigate = useCallback((next) => {
    if (next === displayActive) return;
    setActive(next);
    if (noAnim) { setDisplayActive(next); return; }
    setSectionPhase("out");
    setTimeout(() => { setDisplayActive(next); setSectionPhase("in"); }, 170);
  }, [displayActive, noAnim]);

  const sectionAnim = (!sectionPhase || noAnim) ? {} : sectionPhase === "out"
    ? { animation: "sectionOut 0.17s ease-in both" }
    : { animation: "sectionIn 0.22s ease-out both" };

  const [dashDone, setDashDone] = useState(false);
  const dashboardInAnim = (!dashDone && !noAnim) ? { animation: "dashboardIn 0.45s ease-out both" } : {};

  const firstName = profile?.full_name ? profile.full_name.split(" ")[0] : "";
  const isInicio = displayActive === "inicio";

  function renderSection() {
    switch (displayActive) {
      case "inicio": return <DashboardHome profile={profile} />;
      case "metricas": return <MetricsSection />;
      case "metricas-sofia": return <SofiaMetricsSection setActive={navigate} />;
      case "recomendaciones": return <RecommendationsSection />;
      case "auditoria-sofia": return <SofiaAuditSection />;
      case "configurar-sofia": return <ConfigureSofiaSection />;
      case "probar-sofia": return <TestSofiaSection />;
      case "cumpleanos": return <BirthdaySection />;
      case "seguimiento": return <SeguimientoSection profile={profile} />;
      case "contactos": return <ContactosSection />;
      case "configuracion": return profile?.role === "admin" ? <ConfiguracionSection profile={profile} /> : null;
      default: return null;
    }
  }

  if (isMobile) {
    return (
      <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: "'Manrope', sans-serif" }}>
        <AvisoVersionNueva visible={hayVersionNueva} />
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px", background: COLORS.panel, borderBottom: `1px solid ${COLORS.border}`,
          position: "sticky", top: 0, zIndex: 20,
        }}>
          <Logo width={110} />
          <button onClick={openDrawer} style={{
            border: "none", background: COLORS.panelAlt, borderRadius: 8,
            width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: COLORS.green,
          }}>
            <Menu size={18} />
          </button>
        </div>
        <MobileDrawer open={drawerOpen} onClose={closeDrawer} active={active} setActive={navigate} onLogout={onLogout} profile={profile} />
        <div style={{ padding: "24px 16px 48px", ...dashboardInAnim }} onAnimationEnd={() => setDashDone(true)}>
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 10, letterSpacing: "0.25em", color: COLORS.gold, marginBottom: 6, textTransform: "uppercase", fontWeight: 600 }}>
              {getDateLabel()}
            </p>
            <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontWeight: 600, margin: "0 0 6px", color: COLORS.green }}>
              {isInicio ? getGreeting(firstName) : SECTION_TITLES[displayActive]}
            </h1>
            {isInicio && (
              <p style={{ fontSize: 13, color: COLORS.textMuted, margin: 0, lineHeight: 1.6, fontStyle: "italic" }}>
                Aquí tienes el resumen del mercadeo de hoy.
              </p>
            )}
          </div>
          <div style={sectionAnim}>{renderSection()}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: COLORS.bg, fontFamily: "'Manrope', sans-serif" }}>
      <AvisoVersionNueva visible={hayVersionNueva} />
      <Sidebar active={active} setActive={navigate} onLogout={onLogout} profile={profile} />
      <div style={{ flex: 1, minWidth: 0, padding: "36px 40px", ...dashboardInAnim }} onAnimationEnd={() => setDashDone(true)}>
        <div style={{ marginBottom: 32 }}>
          <p style={{ fontSize: 11, letterSpacing: "0.25em", color: COLORS.gold, marginBottom: 6, textTransform: "uppercase", fontWeight: 600 }}>
            {getDateLabel()}
          </p>
          <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 38, fontWeight: 600, margin: "0 0 6px", color: COLORS.green }}>
            {isInicio ? getGreeting(firstName) : SECTION_TITLES[displayActive]}
          </h1>
          {isInicio && (
            <p style={{ fontSize: 14, color: COLORS.textMuted, margin: 0, lineHeight: 1.6, fontStyle: "italic" }}>
              Aquí tienes el resumen del mercadeo de hoy.
            </p>
          )}
        </div>
        <div style={sectionAnim}>{renderSection()}</div>
      </div>
    </div>
  );
}
