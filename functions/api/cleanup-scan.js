// Intermediate Pages Function so the dashboard's frontend never sees
// CLEANUP_TRIGGER_SECRET (the credential that talks to the Worker) — it
// only needs the same VITE_SOFIA_SECRET already used for /api/chat.
export async function onRequestPost({ request, env }) {
  if (request.headers.get("x-sofia-secret") !== env.SOFIA_CHAT_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

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
