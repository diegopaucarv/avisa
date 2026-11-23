/**
 * Cliente de login de la UI Next (congelada). **No es código muerto**:
 * `components/avisa-login.tsx` lo importa, y si falta, `next build` falla con
 * «Module not found: Can't resolve '@/frontend/api'». La SPA Angular tiene su
 * propio cliente en `angular/src/app/core/auth/`.
 */
import type { Session } from "./types";

export async function login(dni: string, password: string): Promise<Session> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dni, password }),
  });
  if (!response.ok) throw new Error(await mensajeDeError(response));
  return response.json();
}

/**
 * La API ya distingue el motivo en `detail` (401 credenciales, 503 base no
 * disponible, 503 credencial de la base inválida). Traducir todo a "DNI o
 * clave incorrectos" ocultaba justamente los fallos de configuración.
 */
async function mensajeDeError(response: Response): Promise<string> {
  const generico =
    response.status === 401
      ? "DNI o clave incorrectos. Verifique sus credenciales."
      : `No se pudo iniciar sesión (HTTP ${response.status}).`;

  try {
    const { detail } = (await response.json()) as { detail?: unknown };
    if (typeof detail !== "string" || !detail.trim()) return generico;
    return response.status >= 500
      ? `${detail} (HTTP ${response.status})`
      : detail;
  } catch {
    return generico;
  }
}
