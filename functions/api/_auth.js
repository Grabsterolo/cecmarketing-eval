// Verificación de quién llama, compartida por las Pages Functions.
//
// El prefijo "_" es lo que hace que Cloudflare Pages NO enrute este archivo
// como endpoint: es un módulo, no una ruta.
//
// POR QUÉ EXISTE — hasta el 2026-09-03 casi todas las funciones de esta
// carpeta se protegían con el header `x-sofia-secret`, cuyo valor sale de
// `VITE_SOFIA_SECRET`. Toda variable `VITE_*` se compila dentro del bundle
// que sirve el navegador, así que ese "secreto" es público por construcción:
// se lee bajando el JavaScript del sitio. No era un candado.
//
// Se verificó antes de migrar que ninguno de estos endpoints se dispara solo:
// sofia_recommendations tiene 20 filas en 68 días y sofia_audits no corre
// desde el 2026-08-27. Todos se llaman desde el dashboard, con un usuario
// logueado detrás — así que exigir su sesión no rompe ningún automatismo.
//
// Del lado del cliente el par de esto es fetchApiAutenticado() en
// src/lib/api.js, que adjunta el access_token de la sesión de Supabase.

// Devuelve el usuario de Supabase si quien llama trae una sesión válida, y
// null si no. Nunca lanza: un fallo de red se trata como "no autenticado".
export async function getCallerUser(env, request) {
  const accessToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!accessToken) return null;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

export async function callerIsAuthenticated(env, request) {
  return (await getCallerUser(env, request)) !== null;
}

// Respuesta 401 estándar. El texto lo lee una persona en el dashboard, así
// que dice qué hacer y no solo qué pasó.
export function respuestaNoAutorizado() {
  return new Response(
    JSON.stringify({ error: "Tu sesión venció o no está iniciada. Volvé a iniciar sesión e intentá de nuevo." }),
    { status: 401, headers: { "content-type": "application/json" } }
  );
}

// Guardia para los endpoints que solo usa el dashboard. Devuelve null si
// puede seguir, o la Response 401 que hay que retornar tal cual.
export async function exigirSesion(env, request) {
  return (await callerIsAuthenticated(env, request)) ? null : respuestaNoAutorizado();
}
