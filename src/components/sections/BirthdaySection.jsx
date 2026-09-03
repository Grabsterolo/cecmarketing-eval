import React, { useState } from "react";
import { Cake, Send } from "lucide-react";
import { COLORS } from "../../constants/colors.js";
import { Card, CardHeader } from "../ui/Card.jsx";
import { Button } from "../ui/Button.jsx";
import { fetchApiAutenticado } from "../../lib/api.js";

const inputStyle = {
  width: "100%",
  border: `1px solid ${COLORS.border}`,
  borderRadius: 10,
  padding: "8px 16px",
  fontFamily: "'Manrope', sans-serif",
  fontSize: 14,
  background: COLORS.inputBg,
  color: COLORS.text,
  outline: "none",
  boxSizing: "border-box",
};

export function BirthdaySection() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null); // { ok: boolean, message: string }

  async function handleSend() {
    if (!phoneNumber.trim() || sending) return;
    setSending(true);
    setResult(null);
    try {
      await fetchApiAutenticado("/api/send-birthday", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phoneNumber: phoneNumber.trim() }),
      });
      setResult({ ok: true, message: "Mensaje de cumpleaños enviado." });
      setPhoneNumber("");
    } catch (e) {
      setResult({ ok: false, message: e.message || "Error al conectar con el servidor." });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Card style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 20 }}>
        <div style={{
          width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
          background: COLORS.panelAlt, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Cake size={18} color={COLORS.gold} />
        </div>
        <p style={{ fontSize: 14, color: COLORS.textMuted, lineHeight: 1.7, margin: 0 }}>
          Envía manualmente un mensaje de cumpleaños por WhatsApp a través de Sofía.
          El texto es fijo (la plantilla no personaliza con el nombre). Requiere que
          la plantilla ya esté aprobada por Meta en Zenvia — mientras tanto este botón
          mostrará un error explicando qué falta.
        </p>
      </Card>

      <Card style={{ maxWidth: 440 }}>
        <CardHeader title="Enviar mensaje de cumpleaños" />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: COLORS.textMuted, marginBottom: 6 }}>
              Número de WhatsApp
            </label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={e => setPhoneNumber(e.target.value)}
              placeholder="+506 8888 8888"
              disabled={sending}
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = COLORS.gold}
              onBlur={e => e.target.style.borderColor = COLORS.border}
            />
          </div>

          <Button
            onClick={handleSend}
            disabled={sending || !phoneNumber.trim()}
          >
            <Send size={15} />
            {sending ? "Enviando..." : "Enviar mensaje de cumpleaños"}
          </Button>

          {result && (
            <p style={{
              fontSize: 13, margin: 0, lineHeight: 1.6,
              color: result.ok ? COLORS.green : COLORS.danger,
            }}>
              {result.ok ? "✓ " : "✗ "}{result.message}
            </p>
          )}
        </div>
      </Card>
    </>
  );
}
