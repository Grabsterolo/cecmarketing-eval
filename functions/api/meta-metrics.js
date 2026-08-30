// Proxy a Meta Ads Insights (mes a la fecha, por campaña).
//
// AUTENTICACIÓN — hasta el 2026-08-30 este endpoint era público: un GET sin
// credenciales devolvía el gasto, las campañas y el rendimiento completo de
// la cuenta publicitaria del CEC a cualquiera que supiera la URL. Ahora exige
// el access_token de Supabase del usuario que ya está logueado en el
// dashboard (mismo patrón de verificación que admin-users.js). No se usa el
// secreto compartido x-sofia-secret a propósito: ese viaja en el bundle de
// JavaScript (VITE_*) y por lo tanto es público.
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function callerIsAuthenticated(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, accessToken) {
  if (!accessToken) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) return false;
    const user = await res.json();
    return Boolean(user?.id);
  } catch {
    return false;
  }
}

// Meta pagina los insights (25 por página por defecto). Con 15 campañas hoy
// no se nota, pero al pasar de 25 las campañas sobrantes desaparecían en
// silencio y TODOS los totales quedaban subcontados sin ningún aviso. Se
// sigue `paging.next` hasta agotar, con un tope duro por seguridad.
const MAX_PAGES = 20;

async function fetchAllInsights(url) {
  const all = [];
  let next = url;
  for (let i = 0; i < MAX_PAGES && next; i++) {
    const res = await fetch(next);
    const page = await res.json();
    if (page.error) throw new Error(page.error.message);
    all.push(...(page.data || []));
    next = page.paging?.next || null;
  }
  return all;
}

function actionValue(campaign, type) {
  return parseInt(campaign.actions?.find((a) => a.action_type === type)?.value || 0, 10);
}

export async function onRequestGet({ request, env }) {
  const {
    META_AD_ACCOUNT_ID, META_ACCESS_TOKEN,
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  } = env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no están configurados en Cloudflare Pages." }, 503);
  }

  const accessToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!(await callerIsAuthenticated(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, accessToken))) {
    return json({ error: "No autorizado." }, 401);
  }

  if (!META_AD_ACCOUNT_ID || !META_ACCESS_TOKEN) {
    return json({ error: "META_AD_ACCOUNT_ID o META_ACCESS_TOKEN no están configurados en Cloudflare Pages." }, 503);
  }

  const fields = [
    "campaign_name",
    "spend",
    "impressions",
    "clicks",
    "inline_link_clicks",
    "reach",
    "cpc",
    "ctr",
    "actions",
  ].join(",");

  // El mes se calcula en hora de Costa Rica, no en la del servidor. Cloudflare
  // corre en UTC: entre las 00:00 y las 06:00 UTC del día 1, el servidor ya
  // está en el mes nuevo mientras que en Costa Rica todavía es el último día
  // del mes anterior, y el dashboard mostraba un mes casi vacío.
  const hoyCR = new Date().toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
  const firstDay = `${hoyCR.slice(0, 7)}-01`;
  const lastDay = hoyCR;

  const url = `https://graph.facebook.com/v19.0/${META_AD_ACCOUNT_ID}/insights`
    + `?fields=${fields}`
    + `&time_range=${encodeURIComponent(JSON.stringify({ since: firstDay, until: lastDay }))}`
    + `&level=campaign&limit=100&access_token=${META_ACCESS_TOKEN}`;

  try {
    const campaigns = await fetchAllInsights(url);

    const totals = campaigns.reduce((acc, c) => {
      acc.spend += parseFloat(c.spend || 0);
      acc.impressions += parseInt(c.impressions || 0, 10);
      acc.clicks += parseInt(c.clicks || 0, 10);
      // Clics al enlace: es lo que la gente entiende por "clic al sitio".
      // `clicks` incluye reacciones, comentarios y clics en el perfil, y
      // venía etiquetado como "Al sitio web" — 2,6x inflado en agosto 2026.
      acc.linkClicks += parseInt(c.inline_link_clicks || 0, 10);
      acc.leads += actionValue(c, "lead");
      // Conversaciones iniciadas desde los anuncios click-to-WhatsApp. Es la
      // métrica que corresponde al objetivo real de la mayoría de campañas
      // del CEC, y no coincide con `lead` (6.963 vs 4.824 en agosto 2026).
      acc.messagingStarted += actionValue(c, "onsite_conversion.messaging_conversation_started_7d");
      return acc;
    }, { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0, messagingStarted: 0 });

    // `reach` NO se suma: es una métrica de personas únicas ya deduplicada
    // por campaña, y sumarla cuenta varias veces a quien vio dos campañas.
    // Se devuelve null y se explica, en vez de publicar un número inflado.
    totals.reach = null;
    totals.reachNota = "Meta deduplica el alcance por campaña; no es sumable entre campañas.";

    totals.cpl = totals.leads > 0 ? (totals.spend / totals.leads).toFixed(2) : null;
    totals.costoPorConversacion = totals.messagingStarted > 0
      ? (totals.spend / totals.messagingStarted).toFixed(2)
      : null;

    return new Response(JSON.stringify({
      campaigns,
      totals,
      periodo: { desde: firstDay, hasta: lastDay, zona: "America/Costa_Rica" },
    }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (err) {
    return json({ error: err.message }, 502);
  }
}
