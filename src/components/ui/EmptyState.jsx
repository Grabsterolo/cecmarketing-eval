import React from "react";
import { SearchX } from "lucide-react";
import { COLORS } from "../../constants/colors.js";
import { Card } from "./Card.jsx";

export function EmptyState({ icon, title, description }) {
  return (
    <Card>
      <div style={{ textAlign: "center", padding: "32px 0" }}>
        {/* Icono en vez del rombo ✦: ese carácter lo dibuja cada sistema a su
            manera y en varios sale como emoji a color. Además decoraba sin
            decir nada — este al menos nombra la situación (no hay resultados). */}
        {icon || (
          <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}>
            <SearchX size={26} color={COLORS.gold} strokeWidth={1.75} />
          </div>
        )}
        <p style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 600, color: COLORS.green, fontFamily: "'Manrope', sans-serif" }}>
          {title}
        </p>
        <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", lineHeight: 1.6 }}>
          {description}
        </p>
      </div>
    </Card>
  );
}
