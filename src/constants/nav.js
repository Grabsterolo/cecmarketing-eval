import {
  Home, LayoutDashboard, Sparkles, Settings2, Settings, FlaskConical, ShieldCheck, Cake, MessageCircle, PhoneCall, Users,
} from "lucide-react";

export const ROTATING_WORDS = ["campañas", "conversaciones", "métricas", "recomendaciones", "su marca"];

// Items de navegación principal. La condición controla qué se muestra
// según si las integraciones ya están conectadas (ver Fase 3 del roadmap).
export const NAV_ITEMS = [
  { key: "inicio", label: "Inicio", icon: Home },
  { key: "metricas", label: "Métricas Meta", icon: LayoutDashboard },
  { key: "metricas-sofia", label: "Métricas Sofía", icon: MessageCircle },
  { key: "recomendaciones", label: "Recomendaciones", icon: Sparkles },
  { key: "seguimiento", label: "Seguimiento", icon: PhoneCall },
  { key: "contactos", label: "Contactos", icon: Users },
  { key: "auditoria-sofia", label: "Auditoría de Sofía", icon: ShieldCheck },
  { key: "configurar-sofia", label: "Configurar a Sofía", icon: Settings2 },
  { key: "probar-sofia", label: "Probar a Sofía", icon: FlaskConical },
  { key: "cumpleanos", label: "Cumpleaños", icon: Cake },
];

// Fuentes de datos que el dashboard puede mostrar. "connected: false" hasta
// que se complete la Fase 3 (acceso a Meta ya pedido a CEC). Google
// (Analytics/Ads) se sacó del dashboard — integrarlo resultó poco práctico.
export const DATA_SOURCES = [
  { key: "meta", label: "Meta Ads", connected: true },
  { key: "sofia", label: "Conversaciones de Sofía", connected: true },
];

// Configuración no es un módulo que un admin le pueda dar o quitar a otro
// usuario (solo administradores la ven) — por eso vive aparte de NAV_ITEMS,
// que además de armar el sidebar es la lista de módulos que se ofrecen para
// marcar por usuario en la sección Configuración.
const CONFIG_NAV_ITEM = { key: "configuracion", label: "Configuración", icon: Settings };

// Arma el menú visible para un perfil dado. profile.allowed_modules === null
// (o el perfil no tiene la columna todavía) significa "todos los módulos" —
// así los usuarios que ya existían antes de esta sección no pierden acceso.
export function getVisibleNavItems(profile) {
  const isAdmin = profile?.role === "admin";
  const allowed = profile?.allowed_modules;
  const items = isAdmin || !allowed
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => allowed.includes(item.key));
  return isAdmin ? [...items, CONFIG_NAV_ITEM] : items;
}
