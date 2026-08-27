import React, { useEffect, useRef, useState } from "react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { COLORS } from "../../constants/colors.js";

// Extrae el primer número (con signo/decimales) de un string tipo "$1,234.56"
// o "38%" para poder animar el conteo y luego reinsertarlo en el texto original.
function parseNumericValue(value) {
  if (typeof value === "number") return { number: value, prefix: "", suffix: "" };
  if (typeof value !== "string") return null;
  const match = value.match(/-?[\d,]+(\.\d+)?/);
  if (!match) return null;
  const number = parseFloat(match[0].replace(/,/g, ""));
  if (Number.isNaN(number)) return null;
  return {
    number,
    prefix: value.slice(0, match.index),
    suffix: value.slice(match.index + match[0].length),
    decimals: match[0].includes(".") ? match[0].split(".")[1].length : 0,
    hasCommas: match[0].includes(","),
  };
}

function useCountUp(value, durationMs = 800) {
  const parsed = parseNumericValue(value);
  const [display, setDisplay] = useState(parsed ? parsed.number : null);
  const fromRef = useRef(0);

  useEffect(() => {
    if (!parsed) return;
    const from = fromRef.current;
    const to = parsed.number;
    const start = performance.now();
    let raf;

    function tick(now) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  if (!parsed) return value;

  // `display` arranca en null cuando el primer render trae un valor no
  // numérico ("...", "—"), y useState no vuelve a aplicar su inicializador:
  // sigue en null hasta que el efecto de arriba corra. Pero el render pasa
  // ANTES del efecto, así que en el primer render con un valor numérico
  // real había que leer null — y `null.toFixed()` tira una excepción que
  // desmonta todo el árbol y deja la pantalla en blanco. Con valores
  // enteros no se notaba, porque Math.round(null) da 0.
  const current = display == null ? parsed.number : display;

  const formatted = parsed.decimals
    ? current.toFixed(parsed.decimals)
    : Math.round(current).toString();
  const withCommas = parsed.hasCommas
    ? formatted.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : formatted;

  return `${parsed.prefix}${withCommas}${parsed.suffix}`;
}

function Sparkline({ trend }) {
  const data = trend.map((v, i) => ({ i, v }));
  return (
    <div style={{ width: 60, height: 24 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line
            type="monotone"
            dataKey="v"
            stroke={COLORS.gold}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MetricKpi({ label, value, sub, note, trend }) {
  const animatedValue = useCountUp(value);

  return (
    <div>
      <p style={{ margin: "0 0 4px", fontSize: 11, letterSpacing: "0.1em",
        textTransform: "uppercase", fontWeight: 600, color: COLORS.textMuted,
        fontFamily: "'Manrope', sans-serif" }}>
        {label}
      </p>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <p style={{ margin: 0, fontSize: 28, fontFamily: "'Manrope', sans-serif",
          fontWeight: 700, color: COLORS.green, lineHeight: 1.1 }}>
          {animatedValue}
        </p>
        {trend && trend.length > 1 && <Sparkline trend={trend} />}
      </div>
      <p style={{ margin: "4px 0 0", fontSize: 12, color: COLORS.textMuted,
        fontFamily: "'Manrope', sans-serif" }}>
        {sub}
      </p>
      {note && (
        <p style={{ margin: "2px 0 0", fontSize: 11, color: COLORS.textMuted,
          fontFamily: "'Manrope', sans-serif", fontStyle: "italic" }}>
          {note}
        </p>
      )}
    </div>
  );
}

export function SourceDot({ color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
      <div style={{ width: 10, height: 10, borderRadius: "50%",
        background: color, flexShrink: 0 }} />
      <h4 style={{ margin: 0, fontSize: 15, fontFamily: "'Cormorant Garamond', serif",
        fontWeight: 600, color: COLORS.green }}>
        {label}
      </h4>
    </div>
  );
}

export const tableStyles = {
  cell: {
    padding: "12px 16px", fontSize: 13, fontFamily: "'Manrope', sans-serif",
    color: COLORS.text, borderBottom: `1px solid ${COLORS.border}`,
    whiteSpace: "nowrap",
  },
  head: {
    padding: "12px 16px", fontSize: 11, fontWeight: 700,
    textTransform: "uppercase", letterSpacing: "0.08em",
    color: COLORS.textMuted, background: COLORS.panelAlt,
    fontFamily: "'Manrope', sans-serif", whiteSpace: "nowrap",
  },
  tick: {
    fontSize: 11, fontFamily: "'Manrope', sans-serif", fill: COLORS.textMuted,
  },
};
