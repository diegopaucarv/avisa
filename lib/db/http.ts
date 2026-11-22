import { NextResponse } from "next/server";
import { readSession, type SessionPayload } from "./auth";
import { ApiError } from "./errors";

/**
 * Respuestas de la capa de datos: nunca se cachean en el navegador ni en el CDN.
 */
export function jsonOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

/**
 * La sesión va firmada en una cookie; el cliente nunca envía el rol.
 * Si no hay cookie válida se corta antes de tocar la base.
 */
export function requireSession(request: Request): SessionPayload {
  const session = readSession(request);
  if (!session) {
    throw new ApiError(401, "Sesión no válida o expirada.", "NO_SESSION");
  }
  return session;
}

export function queryParams(request: Request): URLSearchParams {
  return new URL(request.url).searchParams;
}

/**
 * Motivo obligatorio de una anulación: se acepta `?motivo=` o `{ motivo }`
 * en el cuerpo JSON. La base también lo exige; aquí se corta antes con 400.
 */
export async function leerMotivo(request: Request): Promise<string> {
  const fromQuery = queryParams(request).get("motivo")?.trim();
  if (fromQuery) return fromQuery;

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    parsed = undefined;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const value = (parsed as Record<string, unknown>).motivo;
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  throw new ApiError(
    400,
    "El motivo de la anulación es obligatorio.",
    "MOTIVO_REQUERIDO",
  );
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function asPageInt(value: string | null): number | undefined {
  if (!value || !/^\d{1,6}$/.test(value)) return undefined;
  return Number(value);
}

/**
 * Lee la paginación aceptando los alias en español (`pagina`, `tamano`).
 * Cuando llegan ambas grafías gana la española. Los valores se acotan a los
 * mismos límites que usan las consultas: mínimo 1, tamaño máximo 100.
 */
export function leerPagina(params: URLSearchParams): {
  page: number;
  pageSize: number;
} {
  const rawPage =
    asPageInt(params.get("pagina")) ?? asPageInt(params.get("page")) ?? 1;
  const rawSize =
    asPageInt(params.get("tamano")) ??
    asPageInt(params.get("pageSize")) ??
    DEFAULT_PAGE_SIZE;

  return {
    page: Math.max(1, Math.trunc(rawPage)),
    pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(rawSize))),
  };
}

/**
 * Añade al sobre `pagina`/`tamanoPagina` sin quitar `page`/`pageSize` ni
 * duplicar el array de datos (se conserva la misma referencia).
 */
export function conAliasDePagina<T extends { page: number; pageSize: number }>(
  result: T,
): T & { pagina: number; tamanoPagina: number } {
  return { ...result, pagina: result.page, tamanoPagina: result.pageSize };
}
