import React, { useState, useEffect, useCallback } from "react";
import { Settings, Plus, Pencil, X, Shield, ShieldOff } from "lucide-react";
import { COLORS } from "../../constants/colors.js";
import { NAV_ITEMS } from "../../constants/nav.js";
import { supabase } from "../../lib/supabase.js";
import { translateError } from "../../utils/errors.js";
import { inputStyle, btnCancelStyle, btnSubmitStyle } from "../../styles/forms.js";
import { Card, CardHeader } from "../ui/Card.jsx";
import { Badge } from "../ui/Badge.jsx";
import { Button } from "../ui/Button.jsx";
import { ErrorBanner } from "../ui/ErrorBanner.jsx";
import { EmptyState } from "../ui/EmptyState.jsx";
import { SectionHeader } from "../ui/SectionHeader.jsx";
import { PasswordInput } from "../ui/PasswordInput.jsx";

async function callAdminUsers(payload) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("La sesión expiró. Inicie sesión de nuevo.");
  const res = await fetch("/api/admin-users", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Ocurrió un error inesperado.");
  return data;
}

const checkboxRowStyle = {
  display: "flex", alignItems: "center", gap: 8, padding: "6px 0",
  fontSize: 13.5, color: COLORS.text, fontFamily: "'Manrope', sans-serif", cursor: "pointer",
};

function ModuleChecklist({ selected, onChange, disabled }) {
  const toggle = (key) => {
    if (disabled) return;
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  };
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
      gap: 2, opacity: disabled ? 0.5 : 1,
      background: COLORS.inputBg, border: `1.5px solid ${COLORS.border}`, borderRadius: 8,
      padding: "8px 14px",
    }}>
      {NAV_ITEMS.map((item) => (
        <label key={item.key} style={checkboxRowStyle}>
          <input
            type="checkbox"
            checked={selected.includes(item.key)}
            onChange={() => toggle(item.key)}
            disabled={disabled}
          />
          {item.label}
        </label>
      ))}
    </div>
  );
}

function UserForm({ initial, onCancel, onSaved }) {
  const isEdit = !!initial;
  const [fullName, setFullName] = useState(initial?.full_name || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(initial?.role || "user");
  const [modules, setModules] = useState(initial?.allowed_modules ?? NAV_ITEMS.map((i) => i.key));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit() {
    setError(null);
    if (!fullName.trim()) { setError("Ingresa el nombre completo."); return; }
    if (!isEdit && !email.trim()) { setError("Ingresa el correo."); return; }
    if (!isEdit && password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres."); return; }
    if (isEdit && password && password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres."); return; }

    setSaving(true);
    try {
      if (isEdit) {
        await callAdminUsers({
          action: "update",
          id: initial.id,
          full_name: fullName.trim(),
          role,
          allowed_modules: modules,
          ...(password ? { password } : {}),
        });
      } else {
        await callAdminUsers({
          action: "create",
          full_name: fullName.trim(),
          email: email.trim(),
          password,
          role,
          allowed_modules: modules,
        });
      }
      onSaved();
    } catch (e) {
      setError(translateError(e.message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card style={{ marginBottom: 20 }}>
      <CardHeader
        title={isEdit ? `Editar a ${initial.full_name}` : "Crear usuario"}
        action={(
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.textMuted }}>
            <X size={18} />
          </button>
        )}
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6, fontWeight: 600 }}>Nombre completo</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nombre Apellido" style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6, fontWeight: 600 }}>Correo</label>
          <input
            value={isEdit ? initial.email || "" : email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nombre@cec.co.cr"
            disabled={isEdit}
            style={{ ...inputStyle, opacity: isEdit ? 0.6 : 1 }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6, fontWeight: 600 }}>
            {isEdit ? "Restablecer contraseña (opcional)" : "Contraseña"}
          </label>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isEdit ? "Dejar en blanco para no cambiarla" : "Mínimo 8 caracteres"}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6, fontWeight: 600 }}>Rol</label>
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
            <option value="user">Usuario</option>
            <option value="admin">Administrador</option>
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6, fontWeight: 600 }}>
          Módulos visibles {role === "admin" && "— un administrador ve todos"}
        </label>
        <ModuleChecklist selected={modules} onChange={setModules} disabled={role === "admin"} />
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={onCancel} style={btnCancelStyle}>Cancelar</button>
        <button onClick={handleSubmit} disabled={saving} style={{ ...btnSubmitStyle, opacity: saving ? 0.7 : 1 }}>
          {saving ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear usuario"}
        </button>
      </div>
    </Card>
  );
}

export function ConfiguracionSection({ profile }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { users: list } = await callAdminUsers({ action: "list" });
      setUsers(list);
    } catch (e) {
      setError(translateError(e.message));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const closeForm = () => { setFormOpen(false); setEditing(null); };
  const onSaved = () => { closeForm(); load(); };

  return (
    <div>
      <SectionHeader
        icon={<Settings size={20} color={COLORS.gold} />}
        subtitle="Crea accesos al dashboard, define quién es administrador y qué módulos ve cada usuario."
        action={!formOpen && (
          <Button onClick={() => setFormOpen(true)}>
            <Plus size={15} /> Crear usuario
          </Button>
        )}
      />

      {formOpen && (
        <UserForm
          initial={editing}
          onCancel={closeForm}
          onSaved={onSaved}
        />
      )}

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {users === null && !error && (
        <p style={{ fontSize: 13, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif" }}>Cargando...</p>
      )}

      {users && users.length === 0 && (
        <EmptyState title="Sin usuarios" description="Todavía no hay usuarios registrados." />
      )}

      {users && users.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {users.map((u) => {
            const isAdmin = u.role === "admin";
            const moduleCount = isAdmin || !u.allowed_modules ? NAV_ITEMS.length : u.allowed_modules.length;
            return (
              <Card key={u.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
                    background: isAdmin ? `linear-gradient(135deg, ${COLORS.goldSoft}, ${COLORS.gold})` : COLORS.panelAlt,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: isAdmin ? "#fff" : COLORS.textMuted,
                  }}>
                    {isAdmin ? <Shield size={16} /> : <ShieldOff size={15} />}
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 14.5, fontWeight: 700, color: COLORS.green, fontFamily: "'Manrope', sans-serif" }}>
                        {u.full_name || "Sin nombre"}
                      </span>
                      <Badge variant={isAdmin ? "gold" : "default"}>{isAdmin ? "Administrador" : "Usuario"}</Badge>
                      {u.id === profile?.id && <Badge variant="success">Tú</Badge>}
                    </div>
                    <div style={{ fontSize: 12.5, color: COLORS.textMuted, fontFamily: "'Manrope', sans-serif", marginTop: 2 }}>
                      {u.email || "—"} · {moduleCount} de {NAV_ITEMS.length} módulos
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => { setEditing(u); setFormOpen(true); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, background: COLORS.panelAlt,
                    color: COLORS.green, border: `1px solid ${COLORS.border}`, borderRadius: 8,
                    padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                    fontFamily: "'Manrope', sans-serif",
                  }}
                >
                  <Pencil size={13} /> Editar
                </button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
