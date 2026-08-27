import React, { useState, useEffect, useCallback } from "react";
import { Users, ExternalLink, Copy, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { COLORS } from "../../constants/colors.js";
import { PROCEDURE_OPTIONS, codesFor, procedureLabel } from "../../constants/procedures.js";
import { Card } from "../ui/Card.jsx";
import { Badge } from "../ui/Badge.jsx";
import { ErrorBanner } from "../ui/ErrorBanner.jsx";
import { EmptyState } from "../ui/EmptyState.jsx";
import { SectionHeader } from "../ui/SectionHeader.jsx";
import { MetricKpi } from "../ui/MetricKpi.jsx";
import { SELECT_STYLE, FilterSelect } from "../ui/FilterSelect.jsx";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { supabase } from "../../lib/supabase.js";

const PAGE_SIZE = 25;

// Códigos que no son un procedimiento — se agrupan bajo "sin interés
// definido" en vez de mostrarse como si fueran una categoría de tratamiento.
const NO_ES_PROCEDIMIENTO = new Set([
  "generico_sin_procedimiento", "generico_solo_precio", "generico_logistica",
  "generico_proceso", "no_paciente_laboral", "promociones", "sin_clasificar",
]);

function formatFecha(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CR", { day: "numeric", month: "short", year: "numeric" });
}

function TelefonoCell({ telefono }) {
  const [copiado, setCopiado] = useState(false);

  if (!telefono) {
    return (
      <span style={{ color: COLORS.textMuted, fontSize: 13, fontFamily: "'Manrope', sans-serif" }}>
        Sin teléfono
      </span>
    );
  }

  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(telefono).then(() => {
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1500);
        }).catch(() => {});
      }}
      title="Copiar número"
      style={{
        display: "flex", alignItems: "center", gap: 6, background: "none",
        border: "none", padding: 0, cursor: "pointer", color: COLORS.text,
        fontSize: 13.5, fontFamily: "'Manrope', sans-serif", fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {telefono}
      {copiado
        ? <Check size={13} color={COLORS.success} />
        : <Copy size={13} color={COLORS.textMuted} />}
    </button>
  );
}

function ZenviaLink({ prospectId }) {
  const base = import.meta.env.VITE_ZENVIA_WEB_BASE_URL;
  if (!prospectId || !base) return null;
  return (
    <a
      href={`${base}${prospectId}`}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 12, color: COLORS.green, textDecoration: "none",
        fontFamily: "'Manrope', sans-serif", fontWeight: 600,
      }}
    >
      Zenvia <ExternalLink size={11} />
    </a>
  );
}

export function PacientesSection() {
  const isMobile = useIsMobile();

  const [filas, setFilas] = useState([]);
  const [total, setTotal] = useState(0);
  const [kpis, setKpis] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const [pagina, setPagina] = useState(1);
  const [procedimiento, setProcedimiento] = useState("todos");
  const [contacto, setContacto] = useState("todos");
  const [busqueda, setBusqueda] = useState("");
  // La búsqueda se aplica con un retraso para no disparar una consulta por
  // cada tecla — el listado son 9.255 personas.
  const [busquedaAplicada, setBusquedaAplicada] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setBusquedaAplicada(busqueda.trim()), 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  useEffect(() => { setPagina(1); }, [procedimiento, contacto, busquedaAplicada]);

  const aplicarFiltros = useCallback((q) => {
    const codes = codesFor(procedimiento);
    if (codes) q = q.in("procedure_code", codes);
    if (contacto === "con") q = q.not("telefono", "is", null);
    if (contacto === "sin") q = q.is("telefono", null);
    if (busquedaAplicada) q = q.ilike("telefono", `%${busquedaAplicada}%`);
    return q;
  }, [procedimiento, contacto, busquedaAplicada]);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setCargando(true);
      setError(null);
      const desde = (pagina - 1) * PAGE_SIZE;

      const [datos, conteo] = await Promise.all([
        aplicarFiltros(
          supabase.from("sofia_pacientes").select(
            "phone_hash, telefono, prospect_id, procedure_code, sentiment, alguna_vez_escalada, conversaciones, ultima_actividad"
          )
        ).order("ultima_actividad", { ascending: false }).range(desde, desde + PAGE_SIZE - 1),
        aplicarFiltros(supabase.from("sofia_pacientes").select("phone_hash", { count: "exact", head: true })),
      ]);

      if (cancelado) return;
      if (datos.error) setError(datos.error.message);
      else if (conteo.error) setError(conteo.error.message);
      else {
        setFilas(datos.data || []);
        setTotal(conteo.count ?? 0);
      }
      setCargando(false);
    })();
    return () => { cancelado = true; };
  }, [pagina, aplicarFiltros]);

  // KPIs del total, sin filtros — se piden una sola vez.
  useEffect(() => {
    (async () => {
      const [t, conTel, esc] = await Promise.all([
        supabase.from("sofia_pacientes").select("phone_hash", { count: "exact", head: true }),
        supabase.from("sofia_pacientes").select("phone_hash", { count: "exact", head: true }).not("telefono", "is", null),
        supabase.from("sofia_pacientes").select("phone_hash", { count: "exact", head: true }).eq("alguna_vez_escalada", true),
      ]);
      if (t.count != null) {
        setKpis({ total: t.count, conTelefono: conTel.count ?? 0, escaladas: esc.count ?? 0 });
      }
    })();
  }, []);

  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <SectionHeader
        icon={<Users size={20} color={COLORS.gold} />}
        subtitle="Personas que han conversado con Sofía, con su número y el procedimiento que consultaron."
      />

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3,1fr)", gap: 16, marginBottom: 20 }}>
        <Card>
          <MetricKpi label="Pacientes" value={kpis ? `${kpis.total}` : "..."} sub="Personas distintas" />
        </Card>
        <Card>
          <MetricKpi
            label="Con teléfono"
            value={kpis ? `${kpis.conTelefono}` : "..."}
            sub={kpis && kpis.conTelefono === 0 ? "Falta sincronizar desde Zenvia" : "Contactables"}
          />
        </Card>
        <Card>
          <MetricKpi label="Llegaron a un asesor" value={kpis ? `${kpis.escaladas}` : "..."} sub="Alguna vez escalaron" />
        </Card>
      </div>

      {kpis && kpis.conTelefono === 0 && (
        <p style={{
          margin: "0 0 20px", fontSize: 12.5, lineHeight: 1.55,
          color: COLORS.warning, background: COLORS.warningBg,
          border: `1px solid ${COLORS.warningBorder}`,
          borderRadius: 8, padding: "10px 12px", fontFamily: "'Manrope', sans-serif",
        }}>
          Todavía no hay teléfonos cargados. Sofía solo guarda una versión cifrada del número;
          los reales están en Zenvia y hay que traerlos con una sincronización antes de poder
          buscarlos acá.
        </p>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por teléfono..."
          style={{
            background: COLORS.inputBg, border: `1.5px solid ${COLORS.border}`,
            borderRadius: 8, padding: "8px 12px", color: COLORS.text, fontSize: 13,
            outline: "none", fontFamily: "'Manrope', sans-serif", minWidth: 220,
          }}
        />
        <FilterSelect value={procedimiento} onChange={setProcedimiento} options={PROCEDURE_OPTIONS} />
        <select value={contacto} onChange={(e) => setContacto(e.target.value)} style={SELECT_STYLE}>
          <option value="todos">Contacto: todos</option>
          <option value="con">Con teléfono</option>
          <option value="sin">Sin teléfono</option>
        </select>
        <span style={{ fontSize: 12.5, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
          {cargando ? "Buscando..." : `${total.toLocaleString("es-CR")} ${total === 1 ? "paciente" : "pacientes"}`}
        </span>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {!cargando && !error && filas.length === 0 && (
        <EmptyState title="Sin pacientes para estos filtros" description="Probá con otro procedimiento o limpiá la búsqueda." />
      )}

      {filas.length > 0 && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "'Manrope', sans-serif" }}>
              <thead>
                <tr>
                  {["Teléfono", "Interés", "Conversaciones", "Última actividad", ""].map((h, i) => (
                    <th key={h || i} style={{
                      textAlign: i === 2 ? "right" : "left",
                      padding: "14px 16px",
                      fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
                      color: COLORS.textMuted, fontWeight: 700,
                      borderBottom: `1px solid ${COLORS.border}`, whiteSpace: "nowrap",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const generico = !f.procedure_code || NO_ES_PROCEDIMIENTO.has(f.procedure_code);
                  return (
                    <tr key={f.phone_hash}>
                      <td style={{ padding: "12px 16px", borderBottom: `1px solid ${COLORS.border}` }}>
                        <TelefonoCell telefono={f.telefono} />
                      </td>
                      <td style={{ padding: "12px 16px", borderBottom: `1px solid ${COLORS.border}` }}>
                        {generico ? (
                          <span style={{ color: COLORS.textMuted }}>Sin interés definido</span>
                        ) : (
                          <Badge variant="gold">{procedureLabel(f.procedure_code)}</Badge>
                        )}
                        {f.alguna_vez_escalada && (
                          <Badge variant="success" style={{ marginLeft: 6 }}>Escaló</Badge>
                        )}
                      </td>
                      <td style={{ padding: "12px 16px", borderBottom: `1px solid ${COLORS.border}`, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {f.conversaciones}
                      </td>
                      <td style={{ padding: "12px 16px", borderBottom: `1px solid ${COLORS.border}`, color: COLORS.textMuted, whiteSpace: "nowrap" }}>
                        {formatFecha(f.ultima_actividad)}
                      </td>
                      <td style={{ padding: "12px 16px", borderBottom: `1px solid ${COLORS.border}`, textAlign: "right" }}>
                        <ZenviaLink prospectId={f.prospect_id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {totalPaginas > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginTop: 20 }}>
          <button
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
            disabled={pagina <= 1}
            style={{
              display: "flex", alignItems: "center", gap: 4, background: COLORS.panelAlt,
              color: COLORS.green, border: `1px solid ${COLORS.border}`, borderRadius: 8,
              padding: "8px 12px", fontSize: 13, fontWeight: 600, fontFamily: "'Manrope', sans-serif",
              cursor: pagina <= 1 ? "not-allowed" : "pointer", opacity: pagina <= 1 ? 0.5 : 1,
            }}
          >
            <ChevronLeft size={14} /> Anterior
          </button>
          <span style={{ fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>
            Página {pagina} de {totalPaginas}
          </span>
          <button
            onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
            disabled={pagina >= totalPaginas}
            style={{
              display: "flex", alignItems: "center", gap: 4, background: COLORS.panelAlt,
              color: COLORS.green, border: `1px solid ${COLORS.border}`, borderRadius: 8,
              padding: "8px 12px", fontSize: 13, fontWeight: 600, fontFamily: "'Manrope', sans-serif",
              cursor: pagina >= totalPaginas ? "not-allowed" : "pointer", opacity: pagina >= totalPaginas ? 0.5 : 1,
            }}
          >
            Siguiente <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
