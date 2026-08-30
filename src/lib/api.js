import { supabase } from "./supabase.js";

// Llama a una Pages Function de /api/* adjuntando el access_token de la
// sesión de Supabase. Se usa para los endpoints que exponen datos del
// negocio (p. ej. el gasto de Meta Ads) y que por lo tanto tienen que
// verificar quién llama, en vez del secreto compartido x-sofia-secret: ese
// viaja dentro del bundle de JavaScript (VITE_*) y cualquiera puede leerlo.
export async function fetchApiAutenticado(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Sesión expirada. Volvé a iniciar sesión.");
  }
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || `La petición a ${path} falló (${res.status}).`);
  }
  return data;
}
