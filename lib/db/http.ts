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
