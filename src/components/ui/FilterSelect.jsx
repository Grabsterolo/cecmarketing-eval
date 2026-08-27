import React from "react";
import { COLORS } from "../../constants/colors.js";

// Estilo de los <select> de filtro. Vivía duplicado, idéntico, en
// LeadsCalientesSection y SeguimientoSection, más una tercera copia en línea
// en SofiaMetricsSection — tres definiciones que había que mantener a mano
// para que los filtros de las tres secciones se vieran igual.
export const SELECT_STYLE = {
  background: COLORS.inputBg, border: `1.5px solid ${COLORS.border}`,
  borderRadius: 8, padding: "8px 12px", color: COLORS.text, fontSize: 13,
  outline: "none", fontFamily: "'Manrope', sans-serif", cursor: "pointer",
};

// Select de filtro con opciones { value, label }, para los filtros que se
// arman desde una lista (procedimiento, por ejemplo). Los filtros con
// opciones escritas a mano pueden seguir usando SELECT_STYLE directamente.
export function FilterSelect({ value, onChange, options, style }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={style ? { ...SELECT_STYLE, ...style } : SELECT_STYLE}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
