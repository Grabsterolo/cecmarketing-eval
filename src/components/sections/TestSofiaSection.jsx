import React, { useEffect, useRef, useState } from "react";
import { FlaskConical, RotateCcw, Send } from "lucide-react";
import { COLORS } from "../../constants/colors.js";
import { Card } from "../ui/Card.jsx";
import { supabase } from "../../lib/supabase.js";

function TypingIndicator() {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 12 }}>
      <div style={avatarStyle}>S</div>
      <div style={{ ...bubbleStyle(false), padding: "8px 16px", display: "flex", gap: 4, alignItems: "center" }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            width: 7, height: 7, borderRadius: "50%",
            background: COLORS.textMuted,
            animation: `typing-dot 1.2s ${i * 0.2}s ease-in-out infinite`,
          }} />
        ))}
      </div>
    </div>
  );
}

const avatarStyle = {
  width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
  background: COLORS.green, color: "#fff",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: 13, fontWeight: 700, alignSelf: "flex-end",
};

function bubbleStyle(isUser) {
  return {
    padding: "8px 16px",
    borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
    background: isUser ? COLORS.green : COLORS.panelAlt,
    color: isUser ? "#fff" : COLORS.text,
    fontSize: 14,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  };
}

export function TestSofiaSection() {
  const [systemPrompt, setSystemPrompt] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [sendError, setSendError] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const { data, error: fetchError } = await supabase
        .from("sofia_config")
        .select("system_prompt, knowledge_base")
        .eq("id", 1)
        .maybeSingle();
      if (!mounted) return;
      if (fetchError) {
        setError(fetchError.message);
      } else if (data) {
        setSystemPrompt(data.system_prompt || "");
        setKnowledge(data.knowledge_base || "");
      }
      setLoading(false);
    }
    load();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || typing) return;
    setSendError(null);
    const newMessages = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    setTyping(true);

    try {
      // El backend solo acepta un prompt distinto al guardado si viene de un
      // usuario logueado — sin este token probaría el prompt guardado y no el
      // que está en pantalla. Ver functions/api/chat.js.
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sofia-secret": import.meta.env.VITE_SOFIA_SECRET,
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ system: systemPrompt, knowledge_base: knowledge, messages: newMessages }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        setSendError(data?.error || "Error al generar la respuesta. Intenta de nuevo.");
        setMessages(prev => prev.slice(0, -1)); // quita el mensaje del usuario que no se pudo procesar
        setInput(text);
        return;
      }
      // Si la sesión venció, el backend responde con el prompt guardado. Sin
      // este aviso, la respuesta se leería como si el borrador en pantalla
      // fuera el que se probó.
      if (data?.prompt_source === "saved") {
        setSendError("La sesión venció, así que esta respuesta usó el prompt guardado y no el que está en pantalla. Inicie sesión de nuevo para probar los cambios.");
      }
      const reply = data?.reply ?? "(Sin respuesta)";
      setMessages(prev => [...prev, {
        role: "assistant",
        content: reply,
        escalated: !!data?.escalated,
        escalation_reason: data?.escalation_reason ?? null,
      }]);
    } catch (e) {
      setSendError("Error al conectar con la API. Intenta de nuevo.");
    } finally {
      setTyping(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function resetConversation() {
    setMessages([]);
    setSendError(null);
    inputRef.current?.focus();
  }

  return (
    <>
      <style>{`
        @keyframes typing-dot {
          0%, 80%, 100% { transform: scale(0.7); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      {/* Aviso informativo */}
      <Card style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 20 }}>
        <div style={{
          width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
          background: COLORS.panelAlt, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <FlaskConical size={18} color={COLORS.gold} />
        </div>
        <p style={{ fontSize: 14, color: COLORS.textMuted, lineHeight: 1.7, margin: 0 }}>
          Estás probando la versión actual guardada en Supabase. Cualquier cambio que hagas en{" "}
          <strong style={{ color: COLORS.green }}>Configurar a Sofía</strong> se reflejará aquí al recargar.
        </p>
      </Card>

      {loading && (
        <p style={{ fontSize: 14, color: COLORS.textMuted }}>Cargando...</p>
      )}

      {error && (
        <Card>
          <p style={{ fontSize: 13, color: COLORS.danger, lineHeight: 1.6, margin: 0 }}>
            No se pudo cargar la configuración ({error}).
          </p>
        </Card>
      )}

      {!loading && !error && (
        <Card style={{ display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
          {/* Header del chat */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 20px", borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ ...avatarStyle, width: 34, height: 34 }}>S</div>
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: COLORS.green }}>Sofía</p>
                <p style={{ margin: 0, fontSize: 11, color: COLORS.textMuted }}>Asistente de CEC</p>
              </div>
            </div>
            <button
              onClick={resetConversation}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 13, fontWeight: 600, color: COLORS.textMuted,
                background: COLORS.panelAlt, border: "none", borderRadius: 8,
                padding: "8px 12px", cursor: "pointer",
              }}
            >
              <RotateCcw size={13} />
              Reiniciar conversación
            </button>
          </div>

          {/* Área de mensajes */}
          <div style={{
            flex: 1, minHeight: 380, maxHeight: 480,
            overflowY: "auto", padding: "20px 20px 8px",
            display: "flex", flexDirection: "column",
          }}>
            {messages.length === 0 && !typing && (
              <p style={{
                fontSize: 14, color: COLORS.textMuted,
                textAlign: "center", margin: "auto",
                fontStyle: "italic", lineHeight: 1.7,
              }}>
                Escribe un mensaje para comenzar la conversación con Sofía.
              </p>
            )}

            {messages.map((msg, i) => (
              <div key={i} style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-end",
                flexDirection: msg.role === "user" ? "row-reverse" : "row",
                marginBottom: 12,
              }}>
                {msg.role === "assistant" && <div style={avatarStyle}>S</div>}
                <div style={{ minWidth: 0, maxWidth: "72%" }}>
                  <div style={bubbleStyle(msg.role === "user")}>{msg.content}</div>
                  {msg.role === "assistant" && msg.escalated && (
                    <div style={{
                      marginTop: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      color: COLORS.warning,
                      background: COLORS.warningBg,
                      border: `1px solid ${COLORS.warningBorder}`,
                      borderRadius: 8,
                      padding: "4px 8px",
                      display: "inline-block",
                    }}>
                      ⚠ Escalado{msg.escalation_reason ? `: ${msg.escalation_reason}` : ""}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {typing && <TypingIndicator />}
            {sendError && (
              <p style={{ fontSize: 13, color: COLORS.danger, textAlign: "center", marginTop: 8 }}>{sendError}</p>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{
            display: "flex", gap: 10, padding: "12px 16px",
            borderTop: `1px solid ${COLORS.border}`,
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escribe un mensaje... (Enter para enviar)"
              rows={1}
              disabled={typing}
              style={{
                flex: 1, resize: "none", border: `1px solid ${COLORS.border}`,
                borderRadius: 10, padding: "8px 16px",
                fontFamily: "'Manrope', sans-serif", fontSize: 14,
                background: COLORS.inputBg, color: COLORS.text,
                outline: "none", lineHeight: 1.5,
                opacity: typing ? 0.6 : 1,
              }}
              onFocus={e => e.target.style.borderColor = COLORS.gold}
              onBlur={e => e.target.style.borderColor = COLORS.border}
            />
            <button
              onClick={sendMessage}
              disabled={typing || !input.trim()}
              style={{
                width: 42, height: 42, borderRadius: 10, flexShrink: 0,
                background: COLORS.green, border: "none",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: typing || !input.trim() ? "not-allowed" : "pointer",
                opacity: typing || !input.trim() ? 0.5 : 1,
                alignSelf: "flex-end",
              }}
            >
              <Send size={16} color="#fff" />
            </button>
          </div>
        </Card>
      )}
    </>
  );
}
