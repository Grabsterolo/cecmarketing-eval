import React from "react";
import { COLORS } from "../../constants/colors.js";

// Estilo de los <select> de filtro. Vivía duplicado, idéntico, en varias
// secciones — definiciones sueltas que había que mantener a mano para que los
// filtros de todas se vieran igual.
export const SELECT_STYLE = {
  background: COLORS.inputBg, border: `1.5px solid ${COLORS.border}`,
  borderRadius: 8, padding: "8px 12px", color: COLORS.text, fontSize: 13,
  outline: "none", fontFamily: "'Manrope', sans-serif", cursor: "pointer",
};

// Select de filtro con opciones { value, label, group? }. Si una opción trae
// `group`, se agrupa con <optgroup> — así el filtro de procedimiento puede
// ofrecer la familia entera y sus procedimientos sueltos sin que la lista se
// vuelva una tirada plana de 45 entradas.
export function FilterSelect({ value, onChange, options, style }) {
  const sueltas = options.filter((o) => !o.group);
  const grupos = [];
  for (const o of options) {
    if (!o.group) continue;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.name === o.group) ultimo.items.push(o);
    else grupos.push({ name: o.group, items: [o] });
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={style ? { ...SELECT_STYLE, ...style } : SELECT_STYLE}
    >
      {sueltas.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
      {grupos.map((g) => (
        <optgroup key={g.name} label={g.name}>
          {g.items.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
