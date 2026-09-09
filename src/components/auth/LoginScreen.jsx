import React, { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase.js";
import { COLORS, SIDEBAR_BG } from "../../constants/colors.js";
import { ROTATING_WORDS } from "../../constants/nav.js";
import { inputStyle } from "../../styles/forms.js";
import { translateError } from "../../utils/errors.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { Logo } from "../ui/Logo.jsx";
import { PasswordInput } from "../ui/PasswordInput.jsx";

function RotatingWord({ noAnim }) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (noAnim) return;
    const id = setInterval(() => {
      setVisible(false);
      setTimeout(() => { setIdx(i => (i + 1) % ROTATING_WORDS.length); setVisible(true); }, 330);
    }, 2200);
    return () => clearInterval(id);
  }, [noAnim]);

  const wordAnim = noAnim ? {} : visible
    ? { animation: "wordIn 0.35s ease-out both" }
    : { animation: "wordOut 0.32s ease-in both" };

  return (
    <div style={{ display:"flex", alignItems:"baseline", flexWrap:"wrap", columnGap:4, fontSize:13, color:COLORS.textMuted, marginBottom:10, lineHeight:1.6 }}>
      <span>Analiza:</span>
      <span style={{ overflow:"hidden", display:"inline-block", height:"1.35em", verticalAlign:"text-bottom" }}>
        <span style={{ color:COLORS.gold, fontWeight:600, display:"block", ...wordAnim }}>
          {ROTATING_WORDS[noAnim ? 0 : idx]}
        </span>
      </span>
    </div>
  );
}

function LoginForm({ onLogin }) {
  const [emailValue, setEmailValue] = useState("");
  const [passwordValue, setPasswordValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const noAnim = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const anim = (delay) => noAnim ? {} : { animation: `loginFadeUp 0.55s ease-out ${delay}ms both` };

  async function handleLogin() {
    setError(null);
    if (!emailValue.trim()) { setError("Escriba su correo corporativo."); return; }
    if (!passwordValue) { setError("Escriba su contraseña."); return; }
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email: emailValue.trim(), password: passwordValue });
    setLoading(false);
    if (authError) setError(translateError(authError.message));
  }

  return (
    <>
      <div style={{
        width: 100, height: 3,
        background: `linear-gradient(90deg, ${COLORS.gold}, ${COLORS.goldSoft})`,
        borderRadius: 2, marginBottom: 20, transformOrigin: "left center",
        ...(noAnim ? {} : { animation: "goldLineGrow 0.65s ease-out both" }),
      }} />
      <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 34, fontWeight: 600, marginBottom: 12, color: COLORS.green, lineHeight: 1.15, ...anim(80) }}>
        CEC Marketing<br />Dashboard
      </h1>
      <div style={anim(160)}><RotatingWord noAnim={noAnim} /></div>
      <p style={{ color: COLORS.textMuted, fontSize: 13, marginBottom: 28, lineHeight: 1.6, ...anim(220) }}>
        Inicie sesión con su correo institucional.
      </p>
      <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6, fontWeight: 600, letterSpacing: "0.02em", ...anim(280) }}>Correo corporativo</label>
      <input
        type="email" placeholder="nombre@cec.co.cr" value={emailValue}
        onChange={e => setEmailValue(e.target.value)}
        style={{ ...inputStyle, marginBottom: 14, ...anim(320) }}
        onFocus={e => e.target.style.borderColor = COLORS.gold}
        onBlur={e => e.target.style.borderColor = COLORS.border}
      />
      <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6, fontWeight: 600, letterSpacing: "0.02em", ...anim(360) }}>Contraseña</label>
      <PasswordInput
        value={passwordValue}
        onChange={e => setPasswordValue(e.target.value)}
        onKeyDown={e => e.key === "Enter" && !loading && handleLogin()}
        placeholder="••••••••"
        style={{ ...inputStyle, marginBottom: 24, ...anim(400) }}
        onFocus={e => e.target.style.borderColor = COLORS.gold}
        onBlur={e => e.target.style.borderColor = COLORS.border}
      />
      {error && (
        <p style={{ fontSize: 12, color: COLORS.danger, marginBottom: 14, marginTop: -10, lineHeight: 1.5 }}>{error}</p>
      )}
      <button
        type="button" onClick={handleLogin} disabled={loading}
        style={{
          ...anim(460),
          width: "100%", background: `linear-gradient(135deg, ${COLORS.goldSoft}, ${COLORS.gold})`,
          border: "none", borderRadius: 8, padding: "12px 16px", color: "#FFF",
          fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
          letterSpacing: "0.04em", fontFamily: "'Manrope', sans-serif",
          boxShadow: "0 4px 16px rgba(201,162,78,0.4)", transition: "box-shadow 0.2s, transform 0.15s",
          opacity: loading ? 0.75 : 1,
        }}
        onMouseEnter={e => { if (!loading) { e.currentTarget.style.boxShadow = "0 6px 22px rgba(201,162,78,0.55)"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
        onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 4px 16px rgba(201,162,78,0.4)"; e.currentTarget.style.transform = "none"; }}
      >
        {loading ? "Ingresando..." : "Iniciar sesión"}
      </button>
    </>
  );
}

export function LoginScreen({ onLogin }) {
  const isMobile = useIsMobile();
  const noAnim = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const anim = (delay) => noAnim ? {} : { animation: `loginFadeUp 0.55s ease-out ${delay}ms both` };

  if (isMobile) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "'Manrope', sans-serif", background: "#FFF" }}>
        <div style={{ background: SIDEBAR_BG, padding: "28px 32px 22px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={anim(0)}><Logo width={200} /></div>
          <div style={{ width: 50, height: 1.5, background: COLORS.gold, opacity: 0.6, ...anim(80) }} />
          <div style={{ fontSize: 10, letterSpacing: "0.4em", color: "rgba(255,255,255,0.5)", textTransform: "uppercase", ...anim(140) }}>
            Marketing Dashboard
          </div>
        </div>
        <div style={{ flex: 1, padding: "28px 28px 48px", position: "relative", overflow: "hidden" }}>
          <div style={{ position:"absolute", width:360, height:360, borderRadius:"50%", background:"radial-gradient(circle, rgba(201,162,78,0.20) 0%, transparent 65%)", filter:"blur(60px)", top:"-10%", right:"-15%", pointerEvents:"none", zIndex:0, animation: noAnim ? "none" : "glowOrbit1 32s ease-in-out infinite" }} />
          <div style={{ position:"absolute", width:300, height:300, borderRadius:"50%", background:"radial-gradient(circle, rgba(31,74,64,0.13) 0%, transparent 65%)", filter:"blur(70px)", bottom:"0%", left:"-10%", pointerEvents:"none", zIndex:0, animation: noAnim ? "none" : "glowOrbit2 41s ease-in-out infinite" }} />
          <div style={{ position:"relative", zIndex:1 }}>
            <LoginForm onLogin={onLogin} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", fontFamily: "'Manrope', sans-serif" }}>
      <div style={{
        flex: "0 0 45%", background: SIDEBAR_BG,
        display: "flex", flexDirection: "column", justifyContent: "center",
        alignItems: "center", padding: "60px 56px", gap: 10,
      }}>
        <div style={anim(0)}><Logo width={380} /></div>
        <div style={{ width: 80, height: 2, background: COLORS.gold, opacity: 0.7, ...anim(100) }} />
        <div style={{ fontSize: 14, letterSpacing: "0.35em", color: "rgba(255,255,255,0.55)", textTransform: "uppercase", textAlign: "center", fontWeight: 500, ...anim(180) }}>
          Marketing Dashboard
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 56px", background: "#FFF", position: "relative", overflow: "hidden" }}>
        <div style={{ position:"absolute", width:500, height:500, borderRadius:"50%", background:"radial-gradient(circle, rgba(201,162,78,0.22) 0%, transparent 65%)", filter:"blur(70px)", top:"0%", right:"-15%", pointerEvents:"none", zIndex:0, animation: noAnim ? "none" : "glowOrbit1 32s ease-in-out infinite" }} />
        <div style={{ position:"absolute", width:420, height:420, borderRadius:"50%", background:"radial-gradient(circle, rgba(31,74,64,0.15) 0%, transparent 65%)", filter:"blur(80px)", bottom:"5%", left:"-12%", pointerEvents:"none", zIndex:0, animation: noAnim ? "none" : "glowOrbit2 41s ease-in-out infinite" }} />
        <div style={{ width: "100%", maxWidth: 360, position: "relative", zIndex: 1 }}>
          <LoginForm onLogin={onLogin} />
        </div>
      </div>
    </div>
  );
}
