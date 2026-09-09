import React from "react";
import { RefreshCw } from "lucide-react";
import { COLORS } from "../../constants/colors.js";

// Aviso de que hay una versión nueva del dashboard.
//
// NUNCA RECARGA SOLO. Es la decisión de diseño que manda acá: alguien puede
// estar a medio escribir una nota de seguimiento, y recargarle la página
// encima le borra el trabajo. El aviso espera; la persona decide cuándo.
//
// Tampoco se puede cerrar. No es para molestar: mientras siga ahí, el mensaje
// es cierto —esa pestaña está corriendo una versión vieja— y un botón de
// descartar solo serviría para esconder el problema. Desaparece al recargar,
// que es justo lo que se está pidiendo.
//
// Va abajo y flotando, no arriba. Arriba ya hay dos cosas pegadas al borde
// superior —el menú lateral en escritorio y la barra con el logo en móvil— y
// una tercera las taparía. Abajo no estorba nada, y al ser `fixed` no empuja
// ni descuadra la pantalla que hay debajo.
export function AvisoVersionNueva({ visible }) {
  if (!visible) return null;

  return (
    <div
      role="status"
      style={{
        position: "fixed", left: 16, right: 16, bottom: 16,
        margin: "0 auto", maxWidth: 560,
        display: "flex", alignItems: "center", justifyContent: "center",
        gap: 14, flexWrap: "wrap",
        padding: "12px 18px",
        background: COLORS.green, color: "#fff",
        borderRadius: 12,
        boxShadow: "0 8px 28px rgba(0,0,0,0.22)",
        fontFamily: "'Manrope', sans-serif", fontSize: 13.5,
        // Debajo del menú lateral de móvil (zIndex 90) para no taparlo cuando
        // está abierto, y encima de todo lo demás.
        zIndex: 80,
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, lineHeight: 1.45 }}>
        <RefreshCw size={15} style={{ flexShrink: 0 }} />
        <span>
          Hay una versión nueva del dashboard.
          <span style={{ opacity: 0.85 }}> Puede terminar lo que está haciendo y recargar después.</span>
        </span>
      </span>
      <button
        onClick={() => window.location.reload()}
        style={{
          background: "#fff", color: COLORS.green, border: "none",
          borderRadius: 8, padding: "7px 16px",
          fontSize: 13, fontWeight: 700, fontFamily: "'Manrope', sans-serif",
          cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        Recargar ahora
      </button>
    </div>
  );
}
// simulacion de despliegue - se revierte enseguida
