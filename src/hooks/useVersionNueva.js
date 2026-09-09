import { useState, useEffect, useCallback } from "react";

// Detecta que se desplegó una versión nueva mientras la pestaña estaba abierta.
//
// EL PROBLEMA QUE RESUELVE
//
// El equipo deja el dashboard abierto todo el día. Un navegador que cargó la
// página el lunes sigue ejecutando el paquete del lunes: no hay nada que le
// avise de un despliegue, así que puede pasar días sin ver una corrección. En
// la semana del 8 al 9 de septiembre hubo doce despliegues.
//
// CÓMO LO DETECTA
//
// Vite le pone una huella al nombre del paquete (index-DQWKyOZV.js) que cambia
// en cada compilación. `import.meta.url` es la dirección de ESTE archivo, así
// que trae la huella con la que se cargó la pestaña. Comparándola contra la que
// anuncia el index.html servido en este momento, se sabe si hay algo nuevo.
//
// No hace falta un endpoint ni un número de versión que alguien deba acordarse
// de subir: la huella la genera la propia compilación.
const MI_VERSION = import.meta.url.match(/index-([A-Za-z0-9_-]+)\.js/)?.[1] ?? null;

// Cada 10 minutos, y además cada vez que la persona vuelve a la pestaña — que
// es cuando de verdad importa: se fue a almorzar, mientras tanto se desplegó, y
// al volver conviene que lo sepa antes de seguir trabajando.
const CADA_MS = 10 * 60 * 1000;

async function versionPublicada() {
  // no-store y un parámetro único: sin esto el navegador puede devolver el
  // index.html que ya tenía en caché, que es justamente el viejo.
  const res = await fetch(`/index.html?v=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  const html = await res.text();
  return html.match(/\/assets\/index-([A-Za-z0-9_-]+)\.js/)?.[1] ?? null;
}

export function useVersionNueva() {
  const [hayVersionNueva, setHayVersionNueva] = useState(false);

  const revisar = useCallback(async () => {
    // En desarrollo el módulo no lleva huella, así que no hay nada que
    // comparar. Y si ya se detectó, no se vuelve a preguntar.
    if (!MI_VERSION || hayVersionNueva) return;
    try {
      const publicada = await versionPublicada();
      if (publicada && publicada !== MI_VERSION) setHayVersionNueva(true);
    } catch {
      // Sin conexión o el servidor no responde. Se reintenta en la siguiente
      // vuelta; un fallo acá nunca puede molestar a quien está trabajando.
    }
  }, [hayVersionNueva]);

  useEffect(() => {
    if (!MI_VERSION) return;
    const id = setInterval(revisar, CADA_MS);
    const alVolver = () => { if (document.visibilityState === "visible") revisar(); };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", revisar);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", revisar);
    };
  }, [revisar]);

  return hayVersionNueva;
}
