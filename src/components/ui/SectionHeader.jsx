import React from "react";
import { COLORS } from "../../constants/colors.js";

// `title` es opcional a propósito: Dashboard.jsx ya pinta el nombre de la
// sección como <h1>, así que las secciones cuyo encabezado repetía ese mismo
// nombre lo omiten y pasan solo el icono y el subtítulo. Se mantiene el
// parámetro para los encabezados que sí dicen algo distinto del nombre de la
// sección (por ejemplo "Análisis de Sofía" dentro de Recomendaciones).
export function SectionHeader({ icon, title, subtitle, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 16 }}>
      <div>
        {title ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: subtitle ? 4 : 0 }}>
              {icon}
              <h2 style={{ margin: 0, fontSize: 22, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, color: COLORS.green }}>
                {title}
              </h2>
            </div>
            {subtitle && (
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
                {subtitle}
              </p>
            )}
          </>
        ) : (
          // Sin título, el icono acompaña al subtítulo en la misma línea en
          // vez de quedar suelto sobre un hueco.
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {icon}
            {subtitle && (
              <p style={{ margin: 0, fontSize: 14, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
                {subtitle}
              </p>
            )}
          </div>
        )}
      </div>
      {action}
    </div>
  );
}
