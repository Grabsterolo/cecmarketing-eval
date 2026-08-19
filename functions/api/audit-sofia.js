export async function onRequestPost({ request, env }) {
  if (request.headers.get("x-sofia-secret") !== env.SOFIA_CHAT_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const {
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY,
  } = env;

  const SUPABASE_HEADERS = {
    "Content-Type": "application/json",
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  try {
    // 1. Leer el system_prompt de Sofía — es la vara contra la que se evalúa
    const configRes = await fetch(
      `${SUPABASE_URL}/rest/v1/sofia_config?id=eq.1&select=system_prompt`,
      { headers: SUPABASE_HEADERS }
    );
    if (!configRes.ok) throw new Error(`Error leyendo sofia_config: ${configRes.status}`);
    const [configRow] = await configRes.json();
    const systemPrompt = configRow?.system_prompt;
    if (!systemPrompt) throw new Error("sofia_config.system_prompt está vacío.");

    // 2. Muestra representativa de ~25 conversaciones: mezcla escaladas y no
    // escaladas, y distintos sentimientos, no solo las más recientes.
    const sampleParts = await Promise.all([
      fetchConversations(SUPABASE_URL, SUPABASE_HEADERS, "escalated=eq.true", 10),
      fetchConversations(SUPABASE_URL, SUPABASE_HEADERS, "escalated=eq.false", 10),
      fetchConversations(SUPABASE_URL, SUPABASE_HEADERS, "sentiment=eq.negativo", 5),
    ]);

    const seen = new Set();
    const sample = [];
    for (const part of sampleParts) {
      for (const conv of part) {
        if (seen.has(conv.id)) continue;
        seen.add(conv.id);
        sample.push(conv);
      }
    }

    if (sample.length === 0) {
      return new Response(JSON.stringify({ error: "No hay conversaciones para auditar todavía." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    // 3. Traer el transcript completo de cada conversación por phone_hash
    const transcripts = await Promise.all(
      sample.map(async (conv) => {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/sofia_whatsapp_sessions?phone_hash=eq.${encodeURIComponent(conv.phone_hash)}&select=messages&limit=1`,
          { headers: SUPABASE_HEADERS }
        );
        if (!res.ok) return { ...conv, messages: [] };
        const [row] = await res.json();
        return { ...conv, messages: row?.messages || [] };
      })
    );

    const withTranscript = transcripts.filter((t) => t.messages.length > 0);
    if (withTranscript.length === 0) {
      return new Response(JSON.stringify({ error: "No se encontró transcript para ninguna conversación de la muestra." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    // 4. Construir el prompt de auditoría para Claude
    const transcriptsText = withTranscript.map((conv, i) => {
      const header = `--- Conversación ${i + 1} (canal: ${conv.channel || "whatsapp"}, escalada: ${conv.escalated ? "sí" : "no"}${conv.escalation_reason ? " — " + conv.escalation_reason : ""}, sentimiento: ${conv.sentiment || "sin clasificar"}, tema: ${conv.procedure_interest || "sin clasificar"}) ---`;
      const body = conv.messages
        .map((m) => `${m.role === "user" ? "Paciente" : "Sofía"}: ${m.content}`)
        .join("\n");
      return `${header}\n${body}`;
    }).join("\n\n");

    const prompt = `A continuación tienes las REGLAS DE COMPORTAMIENTO de Sofía (su system_prompt real, tal cual se usa en producción) y una muestra de ${withTranscript.length} conversaciones reales entre Sofía y pacientes del Centro Europeo de Cirugía (CEC) por WhatsApp/Meta.

REGLAS DE SOFÍA (system_prompt):
"""
${systemPrompt}
"""

MUESTRA DE CONVERSACIONES REALES:
"""
${transcriptsText}
"""

Audita el comportamiento real de Sofía en estas conversaciones contra sus propias reglas. Evalúa específicamente:
- Escucha activa antes de dar información (¿responde a lo que preguntó el paciente, o se adelanta a soltar información no pedida?)
- Longitud de respuesta (máximo 4 líneas en WhatsApp)
- No inventar datos que no estén en la base de conocimiento
- Ofrecer promociones vigentes cuando aplique
- Escalar correctamente cuando corresponde (precios de cirugía, candidatura médica, síntomas post-operatorios, etc.) — ni de más ni de menos
- Tono cálido y trato de usted
- No usar símbolos de markdown en las respuestas (asteriscos, guiones, etc.)

Cita 2-3 ejemplos concretos con fragmentos reales de las conversaciones (entre comillas) de qué está funcionando bien, y 2-3 ejemplos concretos de dónde falló o se desvió de las reglas. Da sugerencias específicas y accionables — si algo se puede arreglar ajustando una frase puntual del system_prompt, decí cuál frase y cómo cambiarla.

Responde en español, con EXACTAMENTE este formato (tres encabezados exactos, sin agregar otros):

## Lo que está funcionando bien
[2-3 ejemplos concretos con fragmentos reales entre comillas]

## Lo que está fallando
[2-3 ejemplos concretos con fragmentos reales entre comillas]

## Cómo mejorarlo
[sugerencias específicas y accionables, citando la frase exacta del system_prompt a ajustar cuando aplique]`;

    // 5. Llamar a Claude API
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: [
          {
            type: "text",
            text: "Eres un auditor de calidad de conversación para Sofía, la asistente de WhatsApp del Centro Europeo de Cirugía (CEC) en Costa Rica. Tu trabajo es evaluar honesta y específicamente si Sofía sigue sus propias reglas de comportamiento en conversaciones reales, citando evidencia textual — no evalúes en abstracto.",
            cache_control: { type: "ephemeral" },
          }
        ],
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const claudeData = await claudeRes.json();
    const rawReport = claudeData.content?.[0]?.text || "No se pudo generar el reporte.";

    // 6. Parsear los tres bloques
    const { strengths, weaknesses, suggestions } = parseReport(rawReport);

    // 7. Guardar en Supabase
    const supaRes = await fetch(`${SUPABASE_URL}/rest/v1/sofia_audits`, {
      method: "POST",
      headers: { ...SUPABASE_HEADERS, "Prefer": "return=representation" },
      body: JSON.stringify({
        sample_size: withTranscript.length,
        strengths,
        weaknesses,
        suggestions,
        raw_report: rawReport,
      }),
    });

    if (!supaRes.ok) {
      const err = await supaRes.text();
      return new Response(JSON.stringify({ error: "Error guardando en Supabase", detail: err }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    const [savedRow] = await supaRes.json();

    return new Response(JSON.stringify({ success: true, audit: savedRow }), {
      status: 200,
      headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

async function fetchConversations(SUPABASE_URL, headers, filter, limit) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sofia_conversations?${filter}&select=id,phone_hash,procedure_interest,escalation_reason,escalated,sentiment,channel,message_count,created_at&order=created_at.desc&limit=${limit}`,
    { headers }
  );
  if (!res.ok) return [];
  return res.json();
}

function parseReport(rawReport) {
  const extract = (startHeader, endHeader) => {
    const startIdx = rawReport.indexOf(startHeader);
    if (startIdx === -1) return "";
    const contentStart = startIdx + startHeader.length;
    const endIdx = endHeader ? rawReport.indexOf(endHeader, contentStart) : rawReport.length;
    const slice = endIdx === -1 ? rawReport.slice(contentStart) : rawReport.slice(contentStart, endIdx);
    return slice.trim();
  };

  const strengths = extract("## Lo que está funcionando bien", "## Lo que está fallando");
  const weaknesses = extract("## Lo que está fallando", "## Cómo mejorarlo");
  const suggestions = extract("## Cómo mejorarlo", null);

  return { strengths, weaknesses, suggestions };
}
