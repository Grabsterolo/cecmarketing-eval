import { exigirSesion } from "./_auth.js";

export async function onRequestPost({ request, env }) {
  // Solo el dashboard llama acá, siempre con un usuario logueado detrás.
  // Antes esto se protegía con x-sofia-secret, que es público por
  // construcción — ver el encabezado de _auth.js.
  const noAutorizado = await exigirSesion(env, request);
  if (noAutorizado) return noAutorizado;

  const SUPABASE_URL = env.SUPABASE_URL;
  const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  const OPENAI_KEY = env.OPENAI_API_KEY;

  const SUPABASE_HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    // 1. Leer knowledge_base de Supabase
    const configRes = await fetch(
      `${SUPABASE_URL}/rest/v1/sofia_config?id=eq.1&select=knowledge_base`,
      { headers: SUPABASE_HEADERS }
    );
    if (!configRes.ok) throw new Error(`Error leyendo sofia_config: ${configRes.status}`);
    const [row] = await configRes.json();
    if (!row?.knowledge_base) throw new Error("knowledge_base está vacío.");

    // 2. Dividir en chunks granulares (un chunk por procedimiento)
    // Antes exigía que la línea fuera ÚNICAMENTE "**Nombre**" (nada más en
    // la línea). Eso descartaba silenciosamente cualquier línea con formato
    // "**Nombre** — $precio (detalle)" — exactamente el formato real de la
    // sección de promociones, que por eso nunca llegó a los embeddings.
    // Ahora basta con que la línea EMPIECE con un segmento en negrita.
    const isProcedureLine = l => /^\*\*[^*]+\*\*/.test(l.trim());
    const procedureLineName = l => l.trim().match(/^\*\*([^*]+)\*\*/)?.[1]?.trim() ?? null;

    function splitIntoChunks(text) {
      const result = [];
      const sections = text.split(/(?=^## )/m).map(s => s.trim()).filter(Boolean);

      for (const section of sections) {
        const sectionLines = section.split("\n");
        const hasProcedures = sectionLines.some(l => isProcedureLine(l));

        if (!hasProcedures) {
          if (section.length >= 80) {
            const category = sectionLines[0].replace(/^#+\s*/, "").trim();
            result.push({ category, content: section });
          }
          continue;
        }

        const subsections = section.split(/(?=^### )/m).map(s => s.trim()).filter(Boolean);

        for (const sub of subsections) {
          const subLines = sub.split("\n");
          const subHeader = subLines[0];
          const subHasProcedures = subLines.some(l => isProcedureLine(l));

          if (!subHasProcedures) {
            if (sub.length >= 80) {
              const category = subHeader.replace(/^#+\s*/, "").trim();
              result.push({ category, content: sub });
            }
            continue;
          }

          let currentName = null;
          let currentLines = [];
          // Líneas vistas antes del primer "**Nombre**" de esta subsección.
          // Antes se descartaban en silencio (el `else if (currentName)` de
          // abajo solo acumulaba una vez que currentName ya existía) — eso
          // es lo que se comió el texto introductorio de "Precios y
          // promociones" antes de la primera oferta con nombre.
          let preambleLines = [];

          for (const line of subLines) {
            if (isProcedureLine(line)) {
              if (currentName) {
                const content = currentLines.join("\n").trim();
                if (content.length >= 80) result.push({ category: currentName, content });
              } else {
                const preambleContent = preambleLines.join("\n").trim();
                if (preambleContent.length >= 80) {
                  const category = subHeader.replace(/^#+\s*/, "").trim();
                  result.push({ category, content: preambleContent });
                }
              }
              currentName = procedureLineName(line);
              currentLines = [subHeader, line];
            } else if (currentName) {
              currentLines.push(line);
            } else {
              preambleLines.push(line);
            }
          }

          if (currentName) {
            const content = currentLines.join("\n").trim();
            if (content.length >= 80) result.push({ category: currentName, content });
          } else {
            const preambleContent = preambleLines.join("\n").trim();
            if (preambleContent.length >= 80) {
              const category = subHeader.replace(/^#+\s*/, "").trim();
              result.push({ category, content: preambleContent });
            }
          }
        }
      }

      return result;
    }

    const chunks = splitIntoChunks(row.knowledge_base);

    // 3. Generar embeddings con OpenAI — una sola llamada con todos los
    // chunks como array de input. Antes esto era un fetch por chunk en
    // paralelo (Promise.all), que con ~79+ chunks choca contra el límite de
    // subrequests por invocación de Cloudflare ("Too many subrequests by
    // single Worker invocation"). La API de embeddings acepta `input` como
    // array (hasta 2048 elementos), así que un solo request resuelve todos.
    const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: chunks.map(c => c.content),
      }),
    });
    if (!embedRes.ok) throw new Error(`OpenAI error generando embeddings: ${embedRes.status}`);
    const embedData = await embedRes.json();
    // embedData.data trae un `index` por elemento — se usa para emparejar
    // con el chunk correcto en vez de asumir que el orden se preserva.
    const chunksWithEmbeddings = chunks.map((chunk, i) => ({
      ...chunk,
      embedding: embedData.data.find(d => d.index === i)?.embedding,
    }));

    // Verificar antes de borrar nada — si a algún chunk le falta el
    // embedding, mejor abortar aquí que borrar los chunks existentes y
    // dejar la tabla con filas rotas.
    const missing = chunksWithEmbeddings.filter(c => !c.embedding);
    if (missing.length > 0) {
      throw new Error(`Faltan embeddings para ${missing.length} chunk(s): ${missing.map(c => c.category).join(", ")}`);
    }

    // 4. Borrar chunks existentes
    const deleteRes = await fetch(
      `${SUPABASE_URL}/rest/v1/sofia_knowledge_chunks?id=gte.0`,
      { method: "DELETE", headers: SUPABASE_HEADERS }
    );
    if (!deleteRes.ok) throw new Error(`Error borrando chunks: ${deleteRes.status}`);

    // 5. Insertar nuevos chunks
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/sofia_knowledge_chunks`, {
      method: "POST",
      headers: { ...SUPABASE_HEADERS, "Prefer": "return=minimal" },
      body: JSON.stringify(chunksWithEmbeddings.map(({ category, content, embedding }) => ({
        category, content, embedding,
      }))),
    });
    if (!insertRes.ok) throw new Error(`Error insertando chunks: ${insertRes.status}`);

    return new Response(JSON.stringify({ success: true, chunks: chunks.length }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
