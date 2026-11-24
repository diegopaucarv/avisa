import { ApiError } from "@/lib/db/errors";
import { requireSession } from "@/lib/db/http";
import type { DbSession } from "@/lib/db/tenant";
import { contextoAdministrador } from "@/lib/db/repos/admin";

/**
 * Utilidades compartidas por las rutas de administración.
 *
 * El prefijo `_` mantiene el archivo fuera del enrutado de Next: aquí no hay
 * `route.ts`, sólo funciones importadas por los handlers.
 */

/**
 * La sesión firmada convertida al contexto elevado a `administrador`.
 * Sin ese rol se responde 403 antes de abrir la transacción.
 */
export function sesionAdministrador(request: Request): DbSession {
  const session = requireSession(request);
  return contextoAdministrador(session);
}

export async function leerCuerpo(
  request: Request,
): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
  }
  return parsed as Record<string, unknown>;
}

export function textoDe(
  body: Record<string, unknown>,
  clave: string,
  respaldo = "",
): string {
  const valor = body[clave];
  return typeof valor === "string" ? valor : respaldo;
}

export function idNumerico(valor: string): number {
  if (!/^\d{1,9}$/.test(valor) || Number(valor) <= 0) {
    throw new ApiError(404, "El valor no existe.", "NOT_FOUND");
  }
  return Number(valor);
}
