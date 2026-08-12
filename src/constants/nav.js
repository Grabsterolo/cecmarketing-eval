import {
  Home, LayoutDashboard, Sparkles, Settings2, FlaskConical, ShieldCheck, Cake, Flame, MessageCircle, PhoneCall,
} from "lucide-react";

export const ROTATING_WORDS = ["campañas", "conversaciones", "métricas", "recomendaciones", "tu marca"];

// Items de navegación principal. La condición controla qué se muestra
// según si las integraciones ya están conectadas (ver Fase 3 del roadmap).
export const NAV_ITEMS = [
  { key: "inicio", label: "Inicio", icon: Home },
  { key: "metricas", label: "Métricas Meta", icon: LayoutDashboard },
  { key: "metricas-sofia", label: "Métricas Sofía", icon: MessageCircle },
  { key: "recomendaciones", label: "Recomendaciones", icon: Sparkles },
  { key: "leads-calientes", label: "Leads Potenciales", icon: Flame },
  { key: "auditoria-sofia", label: "Auditoría de Sofía", icon: ShieldCheck },
  { key: "configurar-sofia", label: "Configurar a Sofía", icon: Settings2 },
  { key: "probar-sofia", label: "Probar a Sofía", icon: FlaskConical },
  { key: "cumpleanos", label: "Cumpleaños", icon: Cake },
  { key: "seguimiento", label: "Seguimiento", icon: PhoneCall },
];

// Fuentes de datos que el dashboard puede mostrar. "connected: false" hasta
// que se complete la Fase 3 (acceso a Meta ya pedido a CEC). Google
// (Analytics/Ads) se sacó del dashboard — integrarlo resultó poco práctico.
export const DATA_SOURCES = [
  { key: "meta", label: "Meta Ads", connected: true },
  { key: "sofia", label: "Conversaciones de Sofía", connected: true },
];
