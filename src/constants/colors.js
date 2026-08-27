export const COLORS = {
  bg: "#FAFAF8",
  panel: "#FFFFFF",
  panelAlt: "#F4F1EA",
  inputBg: "#F7F5F0",
  gold: "#C9A24E",
  goldSoft: "#E4C77A",
  green: "#1F4A40",
  text: "#1F4A40",
  textMuted: "#6B8C80",
  border: "rgba(31,74,64,0.12)",
  sidebarMuted: "rgba(255,255,255,0.55)",
  danger: "#DC2626",
  dangerBg: "rgba(220,38,38,0.06)",
  dangerBorder: "rgba(220,38,38,0.2)",
  success: "#4A7C5C",
  successBg: "rgba(74,124,92,0.15)",
  warning: "#A45B00",
  warningBg: "#FDF0D5",
  warningBorder: "#F0D29A",
  online: "#4ADE80",
};

// Escala tipográfica fija — usar siempre uno de estos valores para fontSize.
// El 10 es el escalón de micro-etiqueta: solo para texto en mayúsculas con
// letter-spacing (los "eyebrow" del sidebar, el login y las tarjetas de
// Inicio). No usarlo para texto corrido, que a ese tamaño no se lee.
export const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 26, 28, 34, 38];

// Escala de spacing (padding/margin/gap), siempre múltiplo de 4.
export const SPACING = [4, 8, 12, 16, 20, 24, 32];

// Colores reservados para fuentes de datos (Meta, Google, Sofía) — usados en
// gráficos y badges del dashboard de marketing.
export const SOURCE_COLORS = {
  meta: "#1877F2",
  google: "#EA4335",
  sofia: "#C9A24E",
  organico: "#7FA98C",
};

export const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Manrope:wght@400;500;600;700&display=swap');
* { -webkit-tap-highlight-color: transparent; }
@keyframes loginFadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes glowOrbit1 {
  0%   { transform: translate(0px,   0px); }
  25%  { transform: translate(60px, -80px); }
  50%  { transform: translate(120px, 20px); }
  75%  { transform: translate(40px,  90px); }
  100% { transform: translate(0px,   0px); }
}
@keyframes glowOrbit2 {
  0%   { transform: translate(0px,  0px); }
  30%  { transform: translate(-80px, 60px); }
  60%  { transform: translate(-40px,-90px); }
  80%  { transform: translate(30px, -30px); }
  100% { transform: translate(0px,  0px); }
}
@keyframes goldLineGrow {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}
@keyframes wordOut {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(-8px); }
}
@keyframes wordIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes dashboardIn {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes sectionOut {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(-5px); }
}
@keyframes sectionIn {
  from { opacity: 0; transform: translateY(5px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes calloutIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
}
.sidebar-nav { scrollbar-width: none; -ms-overflow-style: none; }
.sidebar-nav::-webkit-scrollbar { display: none; }
`;

export const SIDEBAR_BG = "linear-gradient(168deg, #24584C 0%, #1F4A40 40%, #152E27 100%)";
