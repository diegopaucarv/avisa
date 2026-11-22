import { NextResponse } from "next/server";
import { ConfigError } from "./config-error";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

type PgLikeError = { code?: string };

/**
 * Traduce errores de PostgreSQL y de la propia API a respuestas estables.
 * Nunca se devuelve SQL ni el mensaje crudo de la base.
 */
export function jsonError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { detail: error.message, code: error.code },
      { status: error.status },
    );
  }

  if (error instanceof ConfigError) {
    return NextResponse.json(
      { detail: error.message, code: "CONFIG" },
      { status: 503 },
    );
  }

  const code = (error as PgLikeError)?.code;
  if (code === "42501") {
    return NextResponse.json(
      { detail: "Sin permiso para esta operación." },
      { status: 403 },
    );
  }
  // 22023: descifrado de PII sin motivo (principio de finalidad).
  if (code === "22023") {
    return NextResponse.json(
      { detail: "El motivo del descifrado es obligatorio." },
      { status: 422 },
    );
  }
  // P0002: el registro no existe o supera el nivel de clasificación.
  if (code === "P0002") {
    return NextResponse.json(
      { detail: "El registro no existe o excede el nivel de acceso." },
      { status: 404 },
    );
  }
  if (code === "22P02" || code === "23514") {
    return NextResponse.json({ detail: "Datos inválidos." }, { status: 422 });
  }
  if (code === "23505") {
    return NextResponse.json(
      { detail: "El registro ya existe." },
      { status: 409 },
    );
  }
  if (code === "23503") {
    return NextResponse.json(
      { detail: "La referencia no existe o está en uso." },
      { status: 409 },
    );
  }
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "57P01") {
    return NextResponse.json(
      { detail: "La base de datos no está disponible." },
      { status: 503 },
    );
  }
  // 42883: la función de acceso no existe (falta aplicar la migración D3).
  // 42P01: falta una tabla/esquema del contrato.
  if (code === "42883" || code === "42P01") {
    return NextResponse.json(
      { detail: "La capa de datos no está inicializada." },
      { status: 503 },
    );
  }
  // 28P01 / 28000: credenciales o permisos del rol de aplicación.
  if (code === "28P01" || code === "28000") {
    return NextResponse.json(
      { detail: "La credencial de la base de datos es inválida." },
      { status: 503 },
    );
  }

  console.error("[avisa-api]", error);
  return NextResponse.json({ detail: "Error interno." }, { status: 500 });
}
