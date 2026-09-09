export function translateError(msg = "") {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials") || m.includes("invalid credentials")) return "Correo o contraseña incorrectos.";
  if (m.includes("email not confirmed")) return "El correo no ha sido confirmado. Revisa tu bandeja de entrada.";
  if (m.includes("user already registered") || m.includes("already registered")) return "Este correo ya está registrado.";
  if (m.includes("password should be at least")) return "La contraseña debe tener al menos 6 caracteres.";
  if (m.includes("signups not allowed") || m.includes("signup is disabled")) return "El registro no está disponible en este momento.";
  if (m.includes("too many requests") || m.includes("rate limit")) return "Demasiados intentos. Espera un momento e intenta de nuevo.";
  if (m.includes("network") || m.includes("failed to fetch") || m.includes("fetch")) return "Error de conexión. Verifica tu internet.";
  if (m.includes("jwt expired") || m.includes("session expired")) return "La sesión expiró. Inicie sesión de nuevo.";
  if (m.includes("row-level security") || m.includes("rls") || m.includes("policy")) return "No tienes permisos para realizar esta acción.";
  if (m.includes("duplicate") || m.includes("unique")) return "Ya existe un registro con estos datos.";
if (m.includes("not found") || m.includes("no rows")) return "No se encontró el registro solicitado.";
  if (m.includes("storage") || m.includes("upload")) return "Error al subir el archivo. Intenta de nuevo.";
  return msg || "Ocurrió un error inesperado. Intenta de nuevo.";
}
