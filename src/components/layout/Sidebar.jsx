import React, { useEffect } from "react";
import { LogOut, X } from "lucide-react";
import { COLORS, SIDEBAR_BG } from "../../constants/colors.js";
import { getVisibleNavItems } from "../../constants/nav.js";
import { Logo } from "../ui/Logo.jsx";

function NavButton({ item, isActive, onClick, mobile }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: mobile ? 16 : 12,
        padding: mobile ? "12px 16px" : "8px 16px",
        borderRadius: mobile ? 10 : 8, border: "none",
        cursor: "pointer", textAlign: "left",
        fontSize: mobile ? 15 : 14, fontWeight: 600,
        fontFamily: "'Manrope', sans-serif",
        color: isActive ? "#FFFFFF" : COLORS.sidebarMuted,
        background: isActive ? `linear-gradient(135deg, ${COLORS.goldSoft}, ${COLORS.gold})` : "transparent",
        transition: "background 0.15s, color 0.15s",
        width: "100%",
      }}
      onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#FFFFFF"; } }}
      onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = COLORS.sidebarMuted; } }}
    >
      <Icon size={mobile ? 19 : 16} />
      {item.label}
    </button>
  );
}

export function MobileDrawer({ open, onClose, active, setActive, onLogout, profile }) {
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);
  const navItems = getVisibleNavItems(profile);

  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", top: 0, right: 0, bottom: 0, left: 0, background: "rgba(0,0,0,0.5)", zIndex: 90,
        opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none",
        transition: "opacity 0.25s ease",
      }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 272,
        background: SIDEBAR_BG, zIndex: 100,
        display: "flex", flexDirection: "column", padding: "24px 16px",
        boxShadow: "-6px 0 32px rgba(0,0,0,0.3)",
        transform: open ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        overflowY: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexShrink: 0 }}>
          <Logo width={130} />
          <button onClick={onClose} style={{
            border: "none", background: "rgba(255,255,255,0.1)", color: "#FFF",
            cursor: "pointer", borderRadius: 8, width: 34, height: 34,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ height: 1, background: "rgba(255,255,255,0.08)", marginBottom: 16, flexShrink: 0 }} />
        <nav className="sidebar-nav" style={{ display: "flex", flexDirection: "column", gap: 4, overflowY: "auto", flex: 1, paddingBottom: 8 }}>
          {navItems.map((item) => (
            <NavButton
              key={item.key}
              item={item}
              mobile
              isActive={active === item.key}
              onClick={() => { setActive(item.key); onClose(); }}
            />
          ))}
        </nav>
        <div style={{ flexShrink: 0, marginTop: 8 }}>
          <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "0 8px 14px" }} />
          <button
            onClick={() => { onClose(); onLogout(); }}
            style={{
              display: "flex", alignItems: "center", gap: 16, padding: "12px 16px",
              borderRadius: 10, border: "none", background: "transparent",
              color: COLORS.sidebarMuted, fontSize: 15, fontWeight: 600,
              fontFamily: "'Manrope', sans-serif", cursor: "pointer", width: "100%",
            }}
          >
            <LogOut size={19} />Cerrar sesión
          </button>
          <div style={{ textAlign: "center", paddingBottom: 8, paddingTop: 2 }}>
            <a
              href="https://aurevo-3nr.pages.dev"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "'Manrope', sans-serif", letterSpacing: "0.04em",
                textDecoration: "none", opacity: 0.6, transition: "opacity 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = "1"}
              onMouseLeave={e => e.currentTarget.style.opacity = "0.6"}
            >
              Powered by Aurevo
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

export function Sidebar({ active, setActive, onLogout, profile }) {
  const navItems = getVisibleNavItems(profile);
  return (
    <div style={{
      width: 252,
      background: SIDEBAR_BG,
      display: "flex",
      flexDirection: "column",
      padding: "28px 16px",
      height: "100vh",
      boxSizing: "border-box",
      position: "sticky",
      top: 0,
      flexShrink: 0,
    }}>
      <div style={{ padding: "0 8px 28px", borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: 16, flexShrink: 0 }}>
        <Logo width={160} />
        <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", fontWeight: 700, marginTop: 10, textAlign: "center" }}>
          Marketing Dashboard
        </div>
      </div>

      <nav className="sidebar-nav" style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", minHeight: 0, flex: 1, justifyContent: "flex-start" }}>
        {navItems.map((item) => (
          <NavButton
            key={item.key}
            item={item}
            isActive={active === item.key}
            onClick={() => setActive(item.key)}
          />
        ))}
      </nav>

      <div style={{ flexShrink: 0, marginTop: 8 }}>
        <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "0 4px 14px" }} />
        <button
          onClick={onLogout}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "8px 16px", borderRadius: 8, border: "none",
            background: "transparent", color: COLORS.sidebarMuted,
            fontSize: 14, fontWeight: 600,
            fontFamily: "'Manrope', sans-serif",
            cursor: "pointer", width: "100%", textAlign: "left",
            transition: "color 0.15s",
          }}
          onMouseEnter={e => e.currentTarget.style.color = "#FFFFFF"}
          onMouseLeave={e => e.currentTarget.style.color = COLORS.sidebarMuted}
        >
          <LogOut size={16} />
          Cerrar sesión
        </button>
        <div style={{ textAlign: "center", paddingBottom: 8, paddingTop: 2 }}>
          <a
            href="https://aurevo-3nr.pages.dev"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "'Manrope', sans-serif", letterSpacing: "0.04em",
              textDecoration: "none", opacity: 0.6, transition: "opacity 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = "1"}
            onMouseLeave={e => e.currentTarget.style.opacity = "0.6"}
          >
            Powered by Aurevo
          </a>
        </div>
      </div>
    </div>
  );
}
