// Gestión de usuarios del dashboard (sección Configuración). A diferencia de
// las demás funciones en functions/api/, que se protegen con el secreto
// compartido x-sofia-secret, esto crea credenciales de acceso reales: hay
// que verificar quién llama, no solo que conoce un secreto. Se valida el
// access_token de Supabase del que llama y se confirma que su perfil tiene
// role = 'admin' antes de tocar auth.users o profiles.
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function getCallerProfile(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, accessToken) {
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  if (!user?.id) return null;

  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=id,role`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  if (!profileRes.ok) return null;
  const [profile] = await profileRes.json();
  if (!profile) return null;
  return { id: user.id, email: user.email, role: profile.role };
}

export async function onRequestPost({ request, env }) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no están configurados en Cloudflare Pages." }, 503);
  }

  const authHeader = request.headers.get("authorization") || "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!accessToken) return json({ error: "Falta la sesión." }, 401);

  const caller = await getCallerProfile(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, accessToken);
  if (!caller) return json({ error: "Sesión inválida." }, 401);
  if (caller.role !== "admin") return json({ error: "Solo un administrador puede gestionar usuarios." }, 403);

  const SUPABASE_HEADERS = {
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body inválido." }, 400);
  }

  const { action } = body;

  if (action === "list") {
    const [profilesRes, usersRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,full_name,role,allowed_modules,created_at&order=created_at.asc`, {
        headers: SUPABASE_HEADERS,
      }),
      fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: SUPABASE_HEADERS }),
    ]);
    if (!profilesRes.ok) return json({ error: "No se pudieron leer los perfiles." }, 500);
    if (!usersRes.ok) return json({ error: "No se pudo leer la lista de usuarios de Supabase Auth." }, 500);

    const profiles = await profilesRes.json();
    const { users } = await usersRes.json();
    const emailById = new Map(users.map((u) => [u.id, u.email]));

    const list = profiles.map((p) => ({ ...p, email: emailById.get(p.id) || null }));
    return json({ users: list });
  }

  if (action === "create") {
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";
    const fullName = (body.full_name || "").trim();
    const role = body.role === "admin" ? "admin" : "user";
    const allowedModules = role === "admin" ? null : (Array.isArray(body.allowed_modules) ? body.allowed_modules : []);

    if (!email) return json({ error: "El correo es obligatorio." }, 400);
    if (password.length < 8) return json({ error: "La contraseña debe tener al menos 8 caracteres." }, 400);
    if (!fullName) return json({ error: "El nombre es obligatorio." }, 400);

    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: SUPABASE_HEADERS,
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      }),
    });
    const created = await createRes.json();
    if (!createRes.ok) {
      const msg = created?.msg || created?.message || created?.error_description || "No se pudo crear el usuario.";
      return json({ error: msg }, createRes.status === 422 ? 409 : 500);
    }

    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: "POST",
      headers: { ...SUPABASE_HEADERS, Prefer: "return=representation" },
      body: JSON.stringify({
        id: created.id,
        full_name: fullName,
        role,
        allowed_modules: allowedModules,
      }),
    });
    if (!profileRes.ok) {
      const err = await profileRes.text();
      return json({ error: `Usuario creado en Auth, pero falló al guardar el perfil: ${err}` }, 500);
    }
    const [profile] = await profileRes.json();
    return json({ user: { ...profile, email } });
  }

  if (action === "update") {
    const { id } = body;
    if (!id) return json({ error: "Falta el id del usuario." }, 400);

    const role = body.role === "admin" ? "admin" : "user";
    const fullName = (body.full_name || "").trim();
    const allowedModules = role === "admin" ? null : (Array.isArray(body.allowed_modules) ? body.allowed_modules : []);
    if (!fullName) return json({ error: "El nombre es obligatorio." }, 400);

    if (id === caller.id && role !== "admin") {
      const othersRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?role=eq.admin&id=neq.${id}&select=id`,
        { headers: SUPABASE_HEADERS }
      );
      const others = othersRes.ok ? await othersRes.json() : [];
      if (others.length === 0) {
        return json({ error: "No podés quitarte el rol de administrador: sos el único admin." }, 400);
      }
    }

    if (body.password) {
      if (body.password.length < 8) return json({ error: "La contraseña debe tener al menos 8 caracteres." }, 400);
      const pwRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
        method: "PUT",
        headers: SUPABASE_HEADERS,
        body: JSON.stringify({ password: body.password }),
      });
      if (!pwRes.ok) {
        const err = await pwRes.json().catch(() => ({}));
        return json({ error: err?.msg || "No se pudo cambiar la contraseña." }, 500);
      }
    }

    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...SUPABASE_HEADERS, Prefer: "return=representation" },
      body: JSON.stringify({ full_name: fullName, role, allowed_modules: allowedModules }),
    });
    if (!updateRes.ok) {
      const err = await updateRes.text();
      return json({ error: `No se pudo actualizar el perfil: ${err}` }, 500);
    }
    const [profile] = await updateRes.json();
    return json({ user: profile });
  }

  return json({ error: "Acción desconocida." }, 400);
}
