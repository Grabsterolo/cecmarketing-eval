// Espejo deliberado de la lógica de respuesta del Worker cec-sofia-whatsapp
// (callClaude/parseEscalation/mentionsHandoffPromise/ESCALATION_FALLBACK_REPLIES
// en src/index.js de ese repo) — este endpoint alimenta tanto el widget
// público /sofia como "Probar a Sofía" en el dashboard, y ambos deben
// comportarse igual que lo que reciben los pacientes reales de WhatsApp.
// Ver auditoría 2026-08-19 hallazgo #5: antes de este fix le faltaban 6
// fixes que el Worker ya tenía (sin retry, content[0] sin buscar el bloque
// de texto, sin fallback de escalación, sin detección de traspaso implícito,
// sin limpiar [CERRAR], y modelo distinto).

const RETRY_DELAYS_MS = [400, 900];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sent when Sofía escalates ([ESCALAR: motivo]) but wrote nothing before the
// tag. Phrasing lifted verbatim from the Worker's copy (see there for the
// "Un Día A La Vez" incident this fixes).
const ESCALATION_FALLBACK_REPLIES = [
  "Con gusto le paso la información al equipo para que le contacten a la brevedad.",
  "Nuestro equipo de asesores le va a estar contactando para coordinar eso.",
  "Le voy a pasar con el equipo para que le ayuden con ese proceso.",
  "Para coordinar eso le va a contactar uno de nuestros asesores.",
];

function pickEscalationFallbackReply() {
  return ESCALATION_FALLBACK_REPLIES[Math.floor(Math.random() * ESCALATION_FALLBACK_REPLIES.length)];
}

// Phrases pulled from the 2026-08-11 conversation audit where Sofía said one
// of these but never tagged [ESCALAR] — see the Worker's copy of this list.
const HANDOFF_PROMISE_PATTERNS = [
  /le voy a pasar/i,
  /equipo de seguimiento/i,
  /lo voy a escalar/i,
  /le voy a transferir/i,
  /le va a contactar (nuestro |el )?equipo/i,
  /nuestro equipo le va a (estar contactando|contactar)/i,
];

function mentionsHandoffPromise(text) {
  return HANDOFF_PROMISE_PATTERNS.some((re) => re.test(text));
}

function parseEscalation(rawText) {
  const escalationMatch = rawText.match(/\[ESCALAR:?\s*([^\]]*)\]/i);
  const escalated = !!escalationMatch;
  const escalation_reason = escalated ? escalationMatch[1].trim() || null : null;
  // [CERRAR] — el system_prompt (compartido con el Worker) puede emitirlo
  // para temas sin seguimiento (ej. vacantes). Si no se limpia, la etiqueta
  // literal aparece en el mensaje que ve el visitante del sitio público
  // (SofiaPublic.jsx renderiza msg.content tal cual, sin sanitizar).
  const closeMatch = rawText.match(/\[CERRAR\]/i);
  const shouldClose = !escalated && !!closeMatch;
  const reply = rawText
    .replace(/\s*\[ESCALAR:?\s*([^\]]*)\]\s*/i, " ")
    .replace(/\s*\[CERRAR\]\s*/i, " ")
    .trim();
  return { reply, escalated, escalation_reason, shouldClose };
}

// Reintenta hasta 3 veces ante fallas transitorias de Claude — antes este
// endpoint hacía un único fetch, a diferencia del Worker (callClaude), que
// sí reintenta. Devuelve { data, status } en éxito, o { error, status } tras
// agotar los 3 intentos.
async function callClaudeWithRetry(env, systemBlocks, claudeMessages) {
  let lastFailure = null;
  let lastErrorData = null;
  let lastStatus = 502;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "extended-cache-ttl-2025-04-11",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 1024,
          // claude-sonnet-5 corre thinking adaptativo por defecto, lo que
          // puede meter el texto en content[1] en vez de content[0] — mismo
          // ajuste que ya usa el Worker.
          thinking: { type: "disabled" },
          system: systemBlocks,
          messages: claudeMessages,
        }),
      });
      const data = await response.json();
      if (response.ok) {
        const hasTextBlock = Array.isArray(data?.content) && data.content.some((b) => b.type === "text");
        if (hasTextBlock) return { data, status: response.status };
        lastFailure = "response ok but no text block in content";
        lastErrorData = data;
        lastStatus = response.status;
      } else {
        lastFailure = `http ${response.status}`;
        lastErrorData = data;
        lastStatus = response.status;
      }
    } catch (err) {
      lastFailure = err?.message || "network error";
    }
    if (attempt < 3) await sleep(RETRY_DELAYS_MS[attempt - 1]);
  }

  console.error("callClaudeWithRetry exhausted 3 attempts", lastFailure);
  return { error: lastFailure, data: lastErrorData, status: lastStatus };
}

export async function onRequestPost({ request, env }) {
  if (request.headers.get("x-sofia-secret") !== env.SOFIA_CHAT_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const { system: systemFromClient, knowledge_base: kbFromClient, messages } = await request.json();

  let system = systemFromClient;
  let knowledge_base = kbFromClient;

  // Si no vienen del cliente (SofiaPublic), cargarlos desde Supabase
  if (!system || !knowledge_base) {
    try {
      const configRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/sofia_config?select=system_prompt,knowledge_base&limit=1`,
        {
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );
      if (configRes.ok) {
        const configData = await configRes.json();
        system = system || configData[0]?.system_prompt;
        knowledge_base = knowledge_base || configData[0]?.knowledge_base;
      }
    } catch {}
  }

  // 1. Generar embedding combinando los últimos 2 mensajes del usuario (contexto multi-turno)
  const searchQuery = messages
    .filter(m => m.role === "user")
    .slice(-2)
    .map(m => m.content)
    .join(" ");
  let chunks = [];

  try {
    const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: searchQuery,
      }),
    });

    if (embedRes.ok) {
      const embedData = await embedRes.json();
      const queryEmbedding = embedData.data[0].embedding;

      // 2. Buscar chunks relevantes en Supabase
      const ragRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/match_sofia_chunks`, {
        method: "POST",
        headers: {
          "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query_embedding: queryEmbedding,
          match_count: 6,
          // 0.5 estaba por debajo del "piso de ruido" real de este corpus:
          // pares de chunks NO relacionados ya promedian ~0.507 de similitud
          // coseno entre sí (medido sobre los 79 chunks reales), así que el
          // umbral casi nunca filtraba nada — match_sofia_chunks devolvía
          // resultados aunque no hubiera nada realmente relevante, lo cual
          // apagaba el fallback de mandar el knowledge_base completo.
          match_threshold: 0.3,
        }),
      });

      if (ragRes.ok) {
        chunks = await ragRes.json();
      }
    }
  } catch {
    // RAG falla silenciosamente — Sofía responde igual sin chunks
  }

  // Hora actual en Costa Rica (UTC-6)
  const nowCR = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const hourCR = nowCR.getUTCHours();
  let franjaHoraria;
  if (hourCR >= 4 && hourCR < 12) {
    franjaHoraria = "mañana (usar 'Buenos días')";
  } else if (hourCR >= 12 && hourCR < 19) {
    franjaHoraria = "tarde (usar 'Buenas tardes')";
  } else {
    franjaHoraria = "noche (usar 'Buenas noches')";
  }
  const horaContexto = `\n\nCONTEXTO DE HORA: Son las ${hourCR}:${String(nowCR.getUTCMinutes()).padStart(2,'0')} en Costa Rica. Es de ${franjaHoraria}.`;

  // 3. Construir system prompt con caching
  // El texto que cambia cada minuto (horaContexto) NO puede ir pegado al
  // bloque marcado con cache_control — un solo carácter distinto invalida
  // todo el prefijo cacheado. Por eso va en su propio bloque al final, sin
  // cache_control, y los bloques estáticos (system, y la base de
  // conocimiento completa cuando no hay RAG) van cacheados por separado.
  const systemBlocks = [
    {
      type: "text",
      text: system,
      cache_control: { type: "ephemeral", ttl: "1h" },
    },
  ];

  if (chunks.length > 0) {
    systemBlocks.push({
      type: "text",
      text: "BASE DE CONOCIMIENTO RELEVANTE PARA ESTA CONSULTA:\n\n" +
        chunks.map(c => c.content).join("\n\n---\n\n"),
    });
  } else if (knowledge_base) {
    systemBlocks.push({
      type: "text",
      text: "INFORMACIÓN COMPLETA DEL CEC (usa solo lo relevante para la pregunta del paciente):\n\n" + knowledge_base,
      cache_control: { type: "ephemeral", ttl: "1h" },
    });
  }

  systemBlocks.push({ type: "text", text: horaContexto.trim() });

  // 4. Llamar a Claude con prompt caching habilitado y reintentos ante
  // fallas transitorias. Los mensajes que vienen del cliente
  // (TestSofiaSection) traen campos propios de la UI (escalated,
  // escalation_reason) pegados a los turnos del asistente para pintar el
  // badge de escalación — la API de Claude rechaza con 400 cualquier campo
  // que no sea role/content ("Extra inputs are not permitted"), así que hay
  // que limpiarlos antes de reenviarlos.
  const claudeMessages = messages.map(({ role, content }) => ({ role, content }));

  const { data, status, error } = await callClaudeWithRetry(env, systemBlocks, claudeMessages);

  if (error || !data) {
    return new Response(JSON.stringify({ error: data?.error?.message || error || "Error llamando a Claude", detail: data }), {
      status: status || 502,
      headers: { "content-type": "application/json" },
    });
  }

  // claude-sonnet-5 devuelve thinking por defecto (aunque aquí lo
  // deshabilitamos arriba), así que igual buscamos el bloque de texto en
  // vez de asumir que es content[0] — mismo fix que el Worker.
  const textBlock = (data?.content || []).find((b) => b.type === "text");
  const rawText = textBlock?.text ?? "";
  const { reply, escalated: taggedEscalated, escalation_reason: taggedReason } = parseEscalation(rawText);

  // Detecta frases de traspaso sin la etiqueta [ESCALAR] — mismo fix que el
  // Worker (caso real: 88 conversaciones de la auditoría del 11 de agosto).
  const impliedHandoff = !taggedEscalated && mentionsHandoffPromise(reply);
  const escalated = taggedEscalated || impliedHandoff;
  const escalation_reason = taggedEscalated
    ? taggedReason
    : impliedHandoff
      ? "frase de traspaso detectada sin etiqueta [ESCALAR]"
      : null;

  // Cuando Sofía escala sin escribir nada antes del tag, reply queda vacío
  // — finalReply es lo que realmente se muestra, igual que el Worker.
  const finalReply = escalated && !reply ? pickEscalationFallbackReply() : reply;

  return new Response(JSON.stringify({ ...data, reply: finalReply, escalated, escalation_reason }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
