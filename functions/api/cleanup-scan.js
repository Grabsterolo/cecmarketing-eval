// Intermediate Pages Function so the dashboard's frontend never sees
// CLEANUP_TRIGGER_SECRET (the credential that talks to the Worker). Desde el
// 2026-09-03 exige la sesión de Supabase de quien llama, no el viejo
// VITE_SOFIA_SECRET — ese viajaba en el bundle público (ver _auth.js).
import { exigirSesion } from "./_auth.js";

export async function onRequestPost({ request, env }) {
  // Solo el dashboard llama acá, siempre con un usuario logueado detrás.
  // Antes esto se protegía con x-sofia-secret, que es público por
  // construcción — ver el encabezado de _auth.js.
  const noAutorizado = await exigirSesion(env, request);
  if (noAutorizado) return noAutorizado;

  const { dryRun } = await request.json();

  const res = await fetch("https://cec-sofia-whatsapp.jpgamboa1309.workers.dev/cleanup/scan-and-warn", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cleanup-secret": env.CLEANUP_TRIGGER_SECRET,
    },
    body: JSON.stringify({ dryRun: dryRun !== false }),
  });

  const data = await res.json();
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
