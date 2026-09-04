// Espejo deliberado de la lógica de respuesta del Worker cec-sofia-whatsapp
// (callClaude/parseEscalation/mentionsHandoffPromise/ESCALATION_FALLBACK_REPLIES
// en src/index.js de ese repo) — este endpoint alimenta tanto el widget
// público /sofia como "Probar a Sofía" en el dashboard, y ambos deben
// comportarse igual que lo que reciben los pacientes reales de WhatsApp.
// Ver auditoría 2026-08-19 hallazgo #5: antes de este fix le faltaban 6
// fixes que el Worker ya tenía (sin retry, content[0] sin buscar el bloque
// de texto, sin fallback de escalación, sin detección de traspaso implícito,
// sin limpiar [CERRAR], y modelo distinto).

import { callerIsAuthenticated } from "./_auth.js";

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

// De quién se acepta el prompt de Sofía.
//
// Este endpoint es el único de functions/api/ que NO puede exigir sesión: lo
// llama también el widget público /sofia, donde el visitante es anónimo por
// diseño. Los otros cinco sí la exigen desde el 2026-09-03 (ver _auth.js).
//
// Lo que sí se cerró acá: hasta esa fecha tomaba `system` y `knowledge_base`
// del cuerpo de la petición viniera de donde viniera, y como el único candado
// era x-sofia-secret —que se compila en el bundle público— cualquiera podía
// mandar SUS PROPIAS instrucciones y usar la cuenta de Anthropic del CEC como
// un Claude de propósito general. Ahora esos dos campos solo se respetan si
// quien llama trae la sesión de un usuario del dashboard, que es el caso de
// "Probar a Sofía". El widget público nunca los mandó — manda solo `messages`.
//
// PENDIENTE: el camino anónimo sigue abierto y sin techo de gasto. Eso lo
// cierra Turnstile más un límite de tasa, no la autenticación.

// La sección 6 del knowledge_base (promociones del mes) es la única que Sofía
// DEBE tener siempre delante, aunque el RAG no la traiga.
//
// El motivo, medido el 2026-09-04: el system_prompt le ordena mencionar el
// precio promocional "de forma proactiva, aunque no te lo pidan", para los
// tratamientos "que tienen promoción vigente en la sección 6" — y le da un
// ejemplo textual ("Este mes tenemos Botox full face en $400, antes $550").
// Pero el RAG casi nunca le entrega la sección 6: ante "flacidez abdominal"
// le llega el fragmento de Trilipo y ningún fragmento de promociones. O sea
// que se le pide comprobar si un tratamiento está en una lista que no puede
// ver. Sin poder verificar, la instrucción proactiva gana y Sofía emite el
// molde del ejemplo con los números borrados: "Este mes tenemos una promoción
// especial en el tratamiento, con precio preferencial frente al valor
// regular". Trilipo no tiene promoción. 26 mensajes en 11 días lo hicieron,
// y varios terminaron escalados a un asesor con el paciente ya comprometido.
//
// El RAG, al enfocar el contexto, le quita justamente la evidencia NEGATIVA:
// con la base completa vería la lista entera y notaría que su tratamiento no
// está en ella. Por eso la sección va aparte y siempre.
//
// Solo se agrega en la rama del RAG: en la del respaldo, el knowledge_base
// completo ya la contiene y duplicarla no aporta nada.
function extraerPromociones(knowledgeBase) {
  if (!knowledgeBase) return null;
  const inicio = knowledgeBase.search(/^## 6\.\s/m);
  if (inicio === -1) return null;
  const resto = knowledgeBase.slice(inicio);
  const finPrimeraLinea = resto.indexOf("\n");
  if (finPrimeraLinea === -1) return resto.trim() || null;
  const siguiente = resto.slice(finPrimeraLinea).search(/^## /m);
  const seccion = siguiente === -1 ? resto : resto.slice(0, finPrimeraLinea + siguiente);
  return seccion.trim() || null;
}

export async function onRequestPost({ request, env }) {
  if (request.headers.get("x-sofia-secret") !== env.SOFIA_CHAT_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const { system: systemFromClient, knowledge_base: kbFromClient, messages } = await request.json();

  // Solo se consulta a Supabase cuando el cliente realmente mandó un prompt
  // propio; el widget público no paga ese viaje extra en cada mensaje.
  const clientSentPrompt = Boolean(systemFromClient || kbFromClient);
  const clientPromptTrusted = clientSentPrompt && await callerIsAuthenticated(env, request);

  let system = clientPromptTrusted ? systemFromClient : null;
  let knowledge_base = clientPromptTrusted ? kbFromClient : null;

  // Lo que no venga de un cliente autenticado se carga desde Supabase, que es
  // la única fuente de verdad para el widget público.
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
  //
  // Las notas de voz, imágenes y stickers llegan como el literal
  // "[mensaje sin texto]" — el 1,7% de los mensajes de paciente (49 de 2.937
  // medidos sobre 1.000 sesiones). Buscarlos no puede dar nada: no hay nada
  // que buscar. Hoy igual se embeben en OpenAI y recuperan seis fragmentos al
  // azar que se le mandan a Claude, unos 290 viajes completos al mes para
  // nada. Ojo con no filtrar de más: "[transcripción de nota de voz]: ..." SÍ
  // trae contenido y tiene que seguir buscándose.
  const PLACEHOLDER_SIN_TEXTO = /^\s*\[\s*mensaje sin texto\s*\]\s*$/i;

  const searchQuery = messages
    .filter(m => m.role === "user" && !PLACEHOLDER_SIN_TEXTO.test(m.content || ""))
    .slice(-2)
    .map(m => m.content)
    .join(" ");
  let chunks = [];

  // Sin texto que buscar se salta el RAG entero y Sofía responde con la base
  // de conocimiento completa, que es la rama cacheada y barata.
  if (searchQuery.trim()) try {
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
          // Medido sobre 180 consultas reconstruidas de conversaciones reales
          // (auditoría 2026-09-03, sección C), no sobre consultas inventadas.
          //
          // El 0.3 anterior se calibró contra la distribución equivocada: la
          // similitud entre PARES DE CHUNKS (media 0.507), que son textos
          // largos del mismo dominio y por eso se parecen mucho entre sí. La
          // que importa es consulta↔chunk, que no pasa de 0.74 ni en el mejor
          // caso. Con 0.3 el RAG se llevaba el 95% de los mensajes y el 27%
          // del contexto inyectado eran chunks sin relación con la pregunta.
          //
          // La distribución real tiene un valle entre 0.40 y 0.45: 70
          // consultas por debajo de 0.40, 99 por encima de 0.45, y solo 10 en
          // el medio. Cortar en 0.45 separa las dos poblaciones: baja al 55%
          // los mensajes que usan RAG y sube la similitud media de lo
          // inyectado de 0.460 a 0.552.
          //
          // Lo que no llega cae al knowledge_base completo, que es la rama
          // CACHEADA — más barata por token que los chunks sin cachear — y
          // que contiene todo lo que contenían los chunks, nunca menos. Es
          // además la red que atrapa aquello en lo que la búsqueda semántica
          // es peor: los nombres de marca del CEC. "Preservé™" no supera 0.45
          // ni escrito perfecto, porque un embedding no tiene con qué
          // relacionar un nombre inventado.
          match_threshold: 0.45,
        }),
      });

      if (ragRes.ok) {
        chunks = await ragRes.json();
      }
    }
  } catch (err) {
    // El RAG falla en silencio a propósito: Sofía responde igual con la base
    // completa y el paciente no ve nada raro. Pero SIN dejar rastro, si la
    // llave de OpenAI vence o su API se degrada, el RAG queda apagado
    // indefinidamente —el costo sube, la calidad cambia— y nadie se entera.
    console.error("[sofia_chat] RAG falló, se responde con la base completa:", err?.message || err);
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
    // Va ANTES de los fragmentos y con su propio cache_control: es estático
    // entre mensajes (cambia una vez al mes), así que se lee a 0,1x en vez de
    // pagarse como entrada nueva. Sin cachear costaría 10 veces más.
    const promociones = extraerPromociones(knowledge_base);
    if (promociones) {
      systemBlocks.push({
        type: "text",
        text: "PROMOCIONES VIGENTES — ESTA ES LA LISTA COMPLETA.\n" +
          "Si el tratamiento por el que pregunta el paciente NO aparece acá, no tiene promoción este mes: " +
          "no le ofrezcas precio promocional ni le digas que hay una promoción para él.\n\n" + promociones,
        cache_control: { type: "ephemeral", ttl: "1h" },
      });
    } else {
      // Si alguien renombra el encabezado "## 6." en el dashboard, esta
      // protección desaparece en silencio y Sofía vuelve a inventar promos.
      console.error("[sofia_chat] no se pudo extraer la sección 6 del knowledge_base");
    }

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

  // prompt_source le dice al dashboard qué prompt se usó realmente. Sin esto,
  // una sesión vencida en "Probar a Sofía" haría que se probara en silencio el
  // prompt GUARDADO en vez del que está en pantalla — y el resultado se leería
  // como si el borrador funcionara. Ver TestSofiaSection.
  const prompt_source = clientPromptTrusted ? "client" : "saved";

  // Una línea por mensaje con lo único que demuestra que el caching y el RAG
  // están funcionando. Es el modo de falla más caro que existe porque es
  // silencioso: si mañana alguien mete un campo dinámico en el `system`, el
  // caché deja de acertar, todo sigue respondiendo bien y la factura sube 10×
  // sin que nada avise. Qué mirar:
  //
  //   cache_lectura en 0 varias veces seguidas → el caché dejó de acertar.
  //   rag_fragmentos en 0 de forma sostenida   → el RAG está caído (ver el
  //                                              console.error de arriba).
  //   rag_mejor_similitud                      → para vigilar el umbral de
  //                                              0.45 con tráfico real.
  const uso = data?.usage || {};
  console.log(JSON.stringify({
    evento: "sofia_chat",
    cache_lectura: uso.cache_read_input_tokens ?? 0,
    cache_escritura: uso.cache_creation_input_tokens ?? 0,
    entrada_sin_cachear: uso.input_tokens ?? 0,
    salida: uso.output_tokens ?? 0,
    rag_fragmentos: chunks.length,
    rag_mejor_similitud: chunks[0]?.similarity ?? null,
    prompt_source,
  }));

  return new Response(JSON.stringify({ ...data, reply: finalReply, escalated, escalation_reason, prompt_source }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
