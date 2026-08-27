// Proxy hacia el Worker cec-sofia-whatsapp (GET /stats/conversion). El
// dashboard ya está detrás del login de Supabase, así que no hace falta
// ningún secret del lado del cliente — el secret que habla con el Worker
// (STATS_TRIGGER_SECRET) se queda solo en Cloudflare Pages, igual que
// SOFIA_WORKER_SEND_SECRET en send-birthday.js.
export async function onRequestGet({ request, env }) {
  const { SOFIA_WORKER_URL, SOFIA_WORKER_STATS_SECRET } = env;

  if (!SOFIA_WORKER_URL || !SOFIA_WORKER_STATS_SECRET) {
    return new Response(JSON.stringify({ error: "SOFIA_WORKER_URL o SOFIA_WORKER_STATS_SECRET no están configurados en Cloudflare Pages." }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }

  // El Worker acepta ?since=<ISO> para acotar el cálculo a las conversaciones
  // creadas desde esa fecha. Se pasa tal cual para que el dashboard pueda
  // pedir la conversión del mismo rango que muestra el resto de la sección.
  const since = new URL(request.url).searchParams.get("since");
  const target = new URL(`${SOFIA_WORKER_URL}/stats/conversion`);
  if (since) target.searchParams.set("since", since);

  try {
    const res = await fetch(target.toString(), {
      headers: { "x-stats-secret": SOFIA_WORKER_STATS_SECRET },
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
