import { exigirSesion } from "./_auth.js";

export async function onRequestPost({ request, env }) {
  // Solo el dashboard llama acá, siempre con un usuario logueado detrás.
  // Antes esto se protegía con x-sofia-secret, que es público por
  // construcción — ver el encabezado de _auth.js.
  const noAutorizado = await exigirSesion(env, request);
  if (noAutorizado) return noAutorizado;

  const {
    META_ACCESS_TOKEN, META_AD_ACCOUNT_ID,
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY,
  } = env;

  try {
    // 1. Obtener datos de Meta Ads
    // Costa Rica es UTC-6
    const now = new Date();
    const crOffset = -6 * 60;
    const crTime = new Date(now.getTime() + (crOffset - now.getTimezoneOffset()) * 60000);

    // El reporte cubre una ventana de PERIOD_DAYS días que termina ayer.
    // Con 5, un día de mal rendimiento aislado deja de leerse como tendencia
    // y el CPL por campaña se calcula sobre suficiente volumen para ser
    // confiable (con 1 día, campañas chicas daban CPL que saltaba mucho).
    const PERIOD_DAYS = 5;

    const fmt = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    // Ayer en Costa Rica = último día de la ventana.
    const yesterday = new Date(crTime);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastDay = fmt(yesterday);

    // Primer día de la ventana: PERIOD_DAYS - 1 días antes, para que la
    // ventana sea inclusiva en ambos extremos (5 días = ayer y los 4 previos).
    const firstDate = new Date(yesterday);
    firstDate.setDate(firstDate.getDate() - (PERIOD_DAYS - 1));
    const firstDay = fmt(firstDate);

    const metaFields = "campaign_name,spend,impressions,clicks,reach,cpc,ctr,actions";
    const metaUrl = `https://graph.facebook.com/v19.0/${META_AD_ACCOUNT_ID}/insights?fields=${metaFields}&time_range={"since":"${firstDay}","until":"${lastDay}"}&level=campaign&access_token=${META_ACCESS_TOKEN}`;
    const metaRes = await fetch(metaUrl);
    const metaData = await metaRes.json();

    const metaCampaigns = (metaData.data || []).map(c => ({
      name: c.campaign_name,
      spend: parseFloat(c.spend || 0),
      impressions: parseInt(c.impressions || 0),
      clicks: parseInt(c.clicks || 0),
      leads: parseInt(c.actions?.find(a => a.action_type === "lead")?.value || 0),
      cpl: c.actions?.find(a => a.action_type === "lead")?.value > 0
        ? (parseFloat(c.spend) / parseInt(c.actions.find(a => a.action_type === "lead").value)).toFixed(2)
        : null,
    }));

    const metaTotals = {
      spend: metaCampaigns.reduce((s, c) => s + c.spend, 0).toFixed(2),
      leads: metaCampaigns.reduce((s, c) => s + c.leads, 0),
      impressions: metaCampaigns.reduce((s, c) => s + c.impressions, 0),
    };

    // 1b. Conversaciones de Sofía de la misma ventana (mismo rango CR → UTC
    // que usa Meta arriba), para poder cruzar gasto/alcance publicitario
    // contra conversaciones reales — no solo mirar cada dato por separado.
    const dayStartUTC = new Date(`${firstDay}T00:00:00-06:00`);
    const dayEndUTC = new Date(new Date(`${lastDay}T00:00:00-06:00`).getTime() + 24 * 60 * 60 * 1000);

    const sofiaRes = await fetch(
      `${SUPABASE_URL}/rest/v1/sofia_conversations?select=channel,escalated,sentiment,procedure_interest` +
      `&created_at=gte.${dayStartUTC.toISOString()}&created_at=lt.${dayEndUTC.toISOString()}`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    const sofiaRows = sofiaRes.ok ? await sofiaRes.json() : [];

    const byChannel = sofiaRows.reduce((acc, r) => {
      const ch = r.channel || "whatsapp";
      acc[ch] = (acc[ch] || 0) + 1;
      return acc;
    }, {});
    const escalatedCount = sofiaRows.filter(r => r.escalated).length;
    const sentimentCounts = sofiaRows.reduce((acc, r) => {
      if (r.sentiment) acc[r.sentiment] = (acc[r.sentiment] || 0) + 1;
      return acc;
    }, {});
    const topicCounts = sofiaRows.reduce((acc, r) => {
      if (r.procedure_interest) acc[r.procedure_interest] = (acc[r.procedure_interest] || 0) + 1;
      return acc;
    }, {});
    const topTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const sofiaTotals = {
      total: sofiaRows.length,
      byChannel,
      escalated: escalatedCount,
      escalationRate: sofiaRows.length > 0 ? Math.round((escalatedCount / sofiaRows.length) * 100) : 0,
      sentimentCounts,
      topTopics: topTopics.map(([topic, count]) => ({ topic, count })),
    };

    // 2. Construir contexto para Sofía
    const dataContext = {
      fecha: lastDay,
      periodo: { desde: firstDay, hasta: lastDay, dias: PERIOD_DAYS },
      meta: { totals: metaTotals, campaigns: metaCampaigns },
      sofia: sofiaTotals,
    };

    const prompt = `Eres Sofía, la asistente de marketing del Centro Europeo de Cirugía (CEC) en Costa Rica.
Analiza los datos de marketing Y de conversaciones del período, y genera un reporte ejecutivo breve, claro y accionable que cruce ambas fuentes — no las trates como dos temas separados.

DATOS DEL PERÍODO — ${PERIOD_DAYS} días, del ${firstDay} al ${lastDay} (todas las cifras son acumuladas de esos ${PERIOD_DAYS} días, no de un solo día):

META ADS:
- Gasto total: $${metaTotals.spend}
- Leads generados: ${metaTotals.leads}
- CPL promedio (solo campañas con leads): ${metaTotals.leads > 0 ? "$" + (parseFloat(metaTotals.spend) / metaTotals.leads).toFixed(2) : "N/A"}

Detalle por campaña:
${metaCampaigns.map(c => `  • ${c.name}: gasto $${c.spend.toFixed(2)}, leads: ${c.leads}${c.cpl ? ", CPL: $" + c.cpl : " (sin leads)"}`).join('\n')}

CONVERSACIONES DE SOFÍA (misma ventana de ${PERIOD_DAYS} días):
- Total: ${sofiaTotals.total}
- Por canal: WhatsApp: ${sofiaTotals.byChannel.whatsapp || 0}, Facebook/Instagram (redes sociales): ${sofiaTotals.byChannel.facebook || 0}
- Escaladas a un asesor humano: ${sofiaTotals.escalated} (${sofiaTotals.escalationRate}%)
- Sentimiento del paciente: positivo ${sofiaTotals.sentimentCounts.positivo || 0}, neutral ${sofiaTotals.sentimentCounts.neutral || 0}, negativo ${sofiaTotals.sentimentCounts.negativo || 0}
- Temas más consultados: ${sofiaTotals.topTopics.length > 0 ? sofiaTotals.topTopics.map(t => `${t.topic} (${t.count})`).join(", ") : "sin datos suficientes"}

Genera un análisis en español de los resultados del período analizado.
Escribe como si le explicaras los resultados a alguien del equipo del CEC que no es experto en marketing digital — usa lenguaje simple, directo y humano. Evita tecnicismos. Cuando uses un número, explica qué significa.

Por ejemplo:
- En lugar de "CPL de $3.81" → "cada persona que dejó sus datos costó $3.81"
- En lugar de "tasa de conversión del 8.8%" → "de cada 100 personas que vieron el anuncio, casi 9 hicieron clic"

IMPORTANTE — cruza los dos datasets, no los reportes por separado: ¿el gasto y alcance en redes sociales (Meta/Facebook) se está traduciendo en conversaciones reales por WhatsApp/Facebook? ¿qué canal trae más conversaciones? ¿la gente que le escribe a Sofía muestra intención real de compra (tasa de escalación, sentimiento, temas de precio)? Si el gasto en Meta no se tradujo en conversaciones (o viceversa), decilo explícitamente — es justo el tipo de desconexión que el equipo necesita ver.

IMPORTANTE — es un corte de ${PERIOD_DAYS} días, no de un día: hablá de "estos ${PERIOD_DAYS} días" o "el período", nunca de "ayer" ni "el día de ayer". Como hay más volumen que en un corte diario, señalá lo que se sostiene en el tiempo y no un pico aislado: una campaña que rinde mal ${PERIOD_DAYS} días seguidos es una señal real, y ahí sí vale recomendar pausarla.

IMPORTANTE: En las secciones de 'LO QUE ESTÁ FUNCIONANDO' y 'ÁREAS DE ATENCIÓN', SIEMPRE menciona el nombre exacto de cada campaña relevante. Nunca digas 'algunas campañas' o 'varias campañas' sin nombrarlas. Si hay campañas que gastaron sin generar leads, lista cada una por nombre.

Con EXACTAMENTE este formato, sin agregar títulos extra, sin ##, sin --:

**RESUMEN DEL PERÍODO**
[2-3 oraciones simples explicando cómo le fue al CEC en publicidad en estos ${PERIOD_DAYS} días. Como si le contaras a un colega en el pasillo.]

**LO QUE ESTÁ FUNCIONANDO**
- [observación positiva en lenguaje simple, con el número y su significado]
- [observación positiva 2]
- [observación positiva 3 si aplica]

**ÁREAS DE ATENCIÓN**
- [algo que merece revisión, explicado simplemente]
- [otro punto si aplica]

**QUÉ HACER AHORA**
1. [acción concreta, específica y simple — que cualquiera entienda qué hacer]
2. [acción concreta 2]
3. [acción concreta 3 si aplica]

Máximo 250 palabras. Empieza directamente con **RESUMEN DEL PERÍODO**.`;

    // 3. Llamar a Claude API
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
        max_tokens: 1024,
        system: [
          {
            type: "text",
            text: "Eres Sofía, la asistente de marketing del Centro Europeo de Cirugía (CEC) en Costa Rica. Generas reportes ejecutivos diarios que cruzan el desempeño de Meta Ads con las conversaciones reales de pacientes, en lenguaje simple y accionable para el equipo del CEC.",
            cache_control: { type: "ephemeral" },
          }
        ],
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const claudeData = await claudeRes.json();
    const analysis = claudeData.content?.[0]?.text || "No se pudo generar el análisis.";

    // 4. Guardar en Supabase
    const supaRes = await fetch(`${SUPABASE_URL}/rest/v1/sofia_recommendations?on_conflict=date`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        date: lastDay,
        period_days: PERIOD_DAYS,
        analysis,
        data_snapshot: dataContext,
      }),
    });

    if (!supaRes.ok) {
      const err = await supaRes.text();
      return new Response(JSON.stringify({ error: "Error guardando en Supabase", detail: err }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, date: lastDay, periodo: { desde: firstDay, hasta: lastDay, dias: PERIOD_DAYS }, analysis }), {
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
