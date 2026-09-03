// Proxy hacia el Worker cec-sofia-whatsapp (POST /send/birthday). Vive como
// Pages Function, no llamada directa desde el navegador, para que
// SOFIA_WORKER_SEND_SECRET (el x-send-secret que el Worker exige) nunca se
// exponga al cliente — a diferencia de VITE_SOFIA_SECRET en chat.js, este
// endpoint dispara un envío real de WhatsApp, no solo una prueba de chat.
import { exigirSesion } from "./_auth.js";

export async function onRequestPost({ request, env }) {
  // Solo el dashboard llama acá, siempre con un usuario logueado detrás.
  // Antes esto se protegía con x-sofia-secret, que es público por
  // construcción — ver el encabezado de _auth.js.
  const noAutorizado = await exigirSesion(env, request);
  if (noAutorizado) return noAutorizado;

  const { SOFIA_WORKER_URL, SOFIA_WORKER_SEND_SECRET } = env;

  if (!SOFIA_WORKER_URL || !SOFIA_WORKER_SEND_SECRET) {
    return new Response(JSON.stringify({ error: "SOFIA_WORKER_URL o SOFIA_WORKER_SEND_SECRET no están configurados en Cloudflare Pages." }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Body inválido." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const phoneNumber = (body.phoneNumber || "").trim();
  if (!phoneNumber) {
    return new Response(JSON.stringify({ error: "Se requiere número de teléfono." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const res = await fetch(`${SOFIA_WORKER_URL}/send/birthday`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-send-secret": SOFIA_WORKER_SEND_SECRET,
      },
      body: JSON.stringify({ phoneNumber }),
    });
    const data = await res.json().catch(() => ({}));
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: `No se pudo contactar al Worker de Sofía: ${e.message}` }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}
