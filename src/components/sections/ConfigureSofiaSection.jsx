import React, { useEffect, useState } from "react";
import { Settings2, Save, Check, Zap, Power, Search, Send } from "lucide-react";
import { COLORS } from "../../constants/colors.js";
import { Card, CardHeader } from "../ui/Card.jsx";
import { taStyle, btnSubmitStyle } from "../../styles/forms.js";
import { supabase } from "../../lib/supabase.js";
import { fetchApiAutenticado } from "../../lib/api.js";

// El Worker procesa como máximo ~20 conversaciones por invocación (límite
// de subrequests de Cloudflare — ver comentario en scanAndWarn). Cuando
// quedan más, el response trae batchRemaining > 0 y hay que volver a
// llamar. Cada lote cierra en segundo plano (ctx.waitUntil) después de
// responder, así que hay que esperar antes del siguiente para no
// re-seleccionar los mismos prospectos que todavía no terminaron.
const BATCH_WAIT_MS = 15000;
const MAX_BATCHES = 15; // tope de seguridad — ~300 conversaciones por corrida

function InactivityCleanupCard() {
  const [scanning, setScanning] = useState(false);
  const [warning, setWarning] = useState(false);
  const [result, setResult] = useState(null);
  const [dryRunDone, setDryRunDone] = useState(false);
  const [error, setError] = useState(null);
  const [batchProgress, setBatchProgress] = useState(null);

  async function callCleanupScan(dryRun) {
    return await fetchApiAutenticado("/api/cleanup-scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun }),
    });
  }

  async function runScan(dryRun) {
    setError(null);
    setBatchProgress(null);
    dryRun ? setScanning(true) : setWarning(true);
    try {
      if (dryRun) {
        const data = await callCleanupScan(true);
        setResult(data);
        setDryRunDone(true);
        return;
      }

      // Cierre real — repite en lotes hasta que no quede nada pendiente.
      let closedTotal = 0;
      let data = await callCleanupScan(false);
      closedTotal += data.warned;

      for (let i = 0; data.batchRemaining > 0 && i < MAX_BATCHES; i++) {
        setBatchProgress({ closed: closedTotal, remaining: data.batchRemaining });
        await new Promise((r) => setTimeout(r, BATCH_WAIT_MS));
        data = await callCleanupScan(false);
        closedTotal += data.warned;
      }

      setResult({ ...data, warned: closedTotal });
      setDryRunDone(false); // fuerza un nuevo dry-run antes de volver a cerrar
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
      setWarning(false);
      setBatchProgress(null);
    }
  }

  return (
    <Card>
      <CardHeader title="Limpieza de buzón por inactividad" />
      <p style={{ fontSize: 13, color: COLORS.textMuted, margin: "-8px 0 14px", lineHeight: 1.6 }}>
        Revisa conversaciones (de Sofía y de los asesores) sin actividad hace 24 horas o más y las
        cierra directamente en Zenvia — sin mandarles ningún mensaje de WhatsApp. Primero corre la
        revisión sin cerrar nada — luego confirma para cerrar de verdad.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={() => runScan(true)}
          disabled={scanning || warning}
          style={{ ...btnSubmitStyle, flex: "none", display: "flex", alignItems: "center", gap: 8, opacity: scanning ? 0.7 : 1 }}
        >
          <Search size={15} />
          {scanning ? "Revisando..." : "Revisar (sin cerrar nada)"}
        </button>

        {dryRunDone && result?.wouldWarn > 0 && (
          <button
            onClick={() => {
              if (!window.confirm(`Se cerrarán ${result.wouldWarn} conversación(es) inactiva(s) en Zenvia, sin mandarles ningún mensaje. ¿Confirmas?`)) return;
              runScan(false);
            }}
            disabled={scanning || warning}
            style={{
              ...btnSubmitStyle, flex: "none", display: "flex", alignItems: "center", gap: 8,
              background: COLORS.gold, opacity: warning ? 0.7 : 1,
            }}
          >
            <Send size={15} />
            {warning
              ? (batchProgress ? `Cerrando... (${batchProgress.closed} listas, ${batchProgress.remaining} en cola)` : "Cerrando...")
              : `Confirmar y cerrar ${result.wouldWarn}`}
          </button>
        )}
      </div>

      {error && (
        <p style={{ fontSize: 13, color: COLORS.danger, marginTop: 12, lineHeight: 1.6 }}>{error}</p>
      )}

      {result && !error && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6 }}>
          <p style={{ fontSize: 13, color: COLORS.text, margin: 0 }}>
            <strong>{result.openConversations}</strong> conversaciones abiertas revisadas —{" "}
            <strong>{result.staleConversations}</strong> sin actividad hace 24h+.
          </p>
          {result.dryRun ? (
            <p style={{ fontSize: 13, color: COLORS.gold, margin: 0, fontWeight: 600 }}>
              Se cerrarían {result.wouldWarn} conversación(es) nuevas. Nada se cerró todavía.
            </p>
          ) : (
            <p style={{ fontSize: 13, color: COLORS.green, margin: 0, fontWeight: 600 }}>
              {result.warned} conversación(es) cerradas
              {result.batchRemaining > 0 ? ` — quedaron ${result.batchRemaining} pendientes, dale clic a "Revisar" y "Confirmar" de nuevo para terminarlas.` : "."}
              {" "}No se envía ningún mensaje.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

const TEXTAREA_STYLE = {
  ...taStyle,
  minHeight: 360,
  fontFamily: "'SF Mono', 'Monaco', monospace",
  fontSize: 13,
  lineHeight: 1.6,
};

function EditableBlock({ title, description, fieldKey, value, onChange, onSave, saving, saved }) {
  return (
    <Card>
      <CardHeader title={title} />
      <p style={{ fontSize: 13, color: COLORS.textMuted, margin: "-8px 0 14px", lineHeight: 1.6 }}>
        {description}
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(fieldKey, e.target.value)}
        style={TEXTAREA_STYLE}
        onFocus={e => e.target.style.borderColor = COLORS.gold}
        onBlur={e => e.target.style.borderColor = COLORS.border}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <button
          onClick={() => onSave(fieldKey)}
          disabled={saving}
          style={{ ...btnSubmitStyle, flex: "none", display: "flex", alignItems: "center", gap: 8, opacity: saving ? 0.7 : 1 }}
        >
          {saved ? <Check size={15} /> : <Save size={15} />}
          {saving ? "Guardando..." : saved ? "Guardado" : "Guardar cambios"}
        </button>
      </div>
    </Card>
  );
}

export function ConfigureSofiaSection() {
  const [systemPrompt, setSystemPrompt] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);
  const [togglingWhatsapp, setTogglingWhatsapp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingField, setSavingField] = useState(null);
  const [savedField, setSavedField] = useState(null);
  const [error, setError] = useState(null);
  const [reindexing, setReindexing] = useState(false);
  const [reindexResult, setReindexResult] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      // Tabla esperada: sofia_config con una fila única (id = 1) y columnas
      // system_prompt / knowledge_base / whatsapp_enabled. Ver nota de
      // implementación al final del archivo para el SQL de creación.
      const { data, error: fetchError } = await supabase
        .from("sofia_config")
        .select("system_prompt, knowledge_base, whatsapp_enabled")
        .eq("id", 1)
        .maybeSingle();
      if (!mounted) return;
      if (fetchError) {
        setError(fetchError.message);
      } else if (data) {
        setSystemPrompt(data.system_prompt || "");
        setKnowledge(data.knowledge_base || "");
        setWhatsappEnabled(data.whatsapp_enabled ?? true);
      }
      setLoading(false);
    }
    load();
    return () => { mounted = false; };
  }, []);

  async function handleToggleWhatsapp() {
    const next = !whatsappEnabled;
    setWhatsappEnabled(next);
    setTogglingWhatsapp(true);
    const { error: toggleError } = await supabase
      .from("sofia_config")
      .update({ whatsapp_enabled: next, updated_at: new Date().toISOString() })
      .eq("id", 1);
    setTogglingWhatsapp(false);
    if (toggleError) {
      setWhatsappEnabled(!next);
      setError(toggleError.message);
    }
  }

  async function handleReindex() {
    setReindexing(true);
    setReindexResult(null);
    try {
      const data = await fetchApiAutenticado("/api/reindex", { method: "POST" });
      setReindexResult({ ok: true, chunks: data.chunks });
    } catch (err) {
      setReindexResult({ ok: false, message: err.message });
    } finally {
      setReindexing(false);
    }
  }

  function handleChange(fieldKey, value) {
    if (fieldKey === "system_prompt") setSystemPrompt(value);
    else setKnowledge(value);
  }

  async function handleSave(fieldKey) {
    setSavingField(fieldKey);
    setSavedField(null);
    const payload = fieldKey === "system_prompt"
      ? { system_prompt: systemPrompt }
      : { knowledge_base: knowledge };
    const { error: saveError } = await supabase
      .from("sofia_config")
      .upsert({ id: 1, ...payload, updated_at: new Date().toISOString() });
    setSavingField(null);
    if (saveError) {
      setError(saveError.message);
    } else {
      setSavedField(fieldKey);
      setTimeout(() => setSavedField(null), 2000);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{
          width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
          background: COLORS.panelAlt, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Settings2 size={18} color={COLORS.gold} />
        </div>
        <p style={{ fontSize: 14, color: COLORS.textMuted, lineHeight: 1.7, margin: 0 }}>
          Estos cambios se guardan directamente en la base de datos que usa Sofía en WhatsApp. No es necesario tocar código ni volver a desplegar nada — el siguiente mensaje que responda ya va a usar la versión más reciente.
        </p>
      </Card>

      {loading && <p style={{ fontSize: 14, color: COLORS.textMuted }}>Cargando configuración...</p>}

      {error && (
        <Card>
          <p style={{ fontSize: 13, color: COLORS.danger, lineHeight: 1.6, margin: 0 }}>
            No se pudo conectar a la tabla de configuración todavía ({error}). Esto es esperado si la tabla <code>sofia_config</code> aún no existe en Supabase.
          </p>
        </Card>
      )}

      {!loading && (
        <>
          <Card style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 16, padding: "16px 24px",
            background: whatsappEnabled ? "rgba(31,74,64,0.06)" : COLORS.dangerBg,
            border: `1.5px solid ${whatsappEnabled ? COLORS.green : COLORS.danger}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{
                width: 42, height: 42, borderRadius: "50%", flexShrink: 0,
                background: whatsappEnabled ? COLORS.green : COLORS.danger,
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background 0.15s",
              }}>
                <Power size={19} color="#fff" />
              </div>
              <div>
                <h4 style={{
                  margin: 0, fontWeight: 700, fontSize: 15,
                  color: whatsappEnabled ? COLORS.green : COLORS.danger,
                }}>
                  {whatsappEnabled ? "Sofía al aire" : "Sofía en pausa"}
                </h4>
                <p style={{ margin: "2px 0 0", fontSize: 13, color: COLORS.textMuted, lineHeight: 1.5 }}>
                  {whatsappEnabled
                    ? "Está respondiendo mensajes de WhatsApp automáticamente."
                    : "No está respondiendo ningún mensaje de WhatsApp ahora mismo."}
                </p>
              </div>
            </div>
            <button
              onClick={handleToggleWhatsapp}
              disabled={togglingWhatsapp}
              role="switch"
              aria-checked={whatsappEnabled}
              aria-label="Activar o pausar a Sofía en WhatsApp"
              style={{
                position: "relative", width: 56, height: 30, borderRadius: 999,
                border: "none", flexShrink: 0,
                cursor: togglingWhatsapp ? "wait" : "pointer",
                background: whatsappEnabled ? COLORS.green : COLORS.danger,
                opacity: togglingWhatsapp ? 0.6 : 1,
                transition: "background 0.15s",
              }}
            >
              <span style={{
                position: "absolute", top: 3, left: whatsappEnabled ? 29 : 3,
                width: 24, height: 24, borderRadius: "50%", background: "#fff",
                transition: "left 0.15s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
              }} />
            </button>
          </Card>

          <InactivityCleanupCard />

          <EditableBlock
            title="Reglas de comportamiento"
            description="Tono, escalamiento, y reglas críticas — lo que define cómo se comporta Sofía."
            fieldKey="system_prompt"
            value={systemPrompt}
            onChange={handleChange}
            onSave={handleSave}
            saving={savingField === "system_prompt"}
            saved={savedField === "system_prompt"}
          />
          <EditableBlock
            title="Base de conocimiento"
            description="Hechos sobre CEC: doctores, procedimientos, paquetes, políticas. Edita aquí cuando haya información nueva o algo cambie."
            fieldKey="knowledge_base"
            value={knowledge}
            onChange={handleChange}
            onSave={handleSave}
            saving={savingField === "knowledge_base"}
            saved={savedField === "knowledge_base"}
          />

          <Card>
            <p style={{ fontSize: 13, color: COLORS.textMuted, margin: "0 0 14px", lineHeight: 1.6 }}>
              Después de guardar cambios en la base de conocimiento, re-indexa para que Sofía pueda encontrar la información relevante mediante búsqueda semántica. Borra y regenera todos los chunks — tarda unos segundos.
            </p>
            <button
              onClick={handleReindex}
              disabled={reindexing}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                background: COLORS.green, border: "none", borderRadius: 8,
                padding: "12px 20px", color: "#fff", fontSize: 14, fontWeight: 700,
                cursor: reindexing ? "not-allowed" : "pointer", fontFamily: "'Manrope', sans-serif",
                boxShadow: "0 4px 14px rgba(31,74,64,0.3)", opacity: reindexing ? 0.7 : 1,
              }}
            >
              <Zap size={15} />
              {reindexing ? "Re-indexando..." : "Re-indexar para Sofía"}
            </button>
            {reindexResult && (
              <p style={{
                marginTop: 12, fontSize: 13, lineHeight: 1.6,
                color: reindexResult.ok ? COLORS.green : COLORS.danger,
              }}>
                {reindexResult.ok
                  ? `✓ Listo — ${reindexResult.chunks} chunks indexados.`
                  : `Error al re-indexar: ${reindexResult.message}`}
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// Nota de implementación — SQL para crear la tabla en Supabase:
//
// create table sofia_config (
//   id int primary key default 1,
//   system_prompt text,
//   knowledge_base text,
//   whatsapp_enabled boolean default true,
//   updated_at timestamptz default now(),
//   constraint single_row check (id = 1)
// );
//
// El backend del webhook de WhatsApp debe leer esta misma fila en cada
// mensaje (o cachear con invalidación corta) para armar el prompt completo
// que se envía a Claude. whatsapp_enabled es el interruptor de emergencia:
// el Worker (cec-sofia-whatsapp) lo revisa antes que cualquier otra cosa y,
// si es false, ignora el mensaje entrante por completo.
