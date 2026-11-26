import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import {
  createCommitmentEvento,
  getCommitmentHistorial,
} from "@/lib/db/repos/commitments";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Historia de un compromiso (Guía §8.3.2 y Anexo 14).
 *
 * `GET` devuelve en una sola respuesta los eventos de `core.compromiso_evento`
 * (con el autor resuelto), los hitos con su estado y el conteo de adjuntos, y
 * los adjuntos vigentes del compromiso y de sus hitos. Todo viaja ordenado
 * cronológicamente en `linea`; si la tabla de eventos está vacía, `eventos` es
 * `[]` y la línea sigue mostrando hitos y adjuntos.
 *
 * `POST` registra un evento manual (`{ tipo, detalle? }`). El tipo es un slug
 * corto y el detalle, un objeto libre. La autorización se replica en el repo
 * porque `core.compromiso_evento` no tiene RLS propia.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const decoded = decodeURIComponent(id);

    const historial = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => getCommitmentHistorial(client, decoded),
    );

    if (!historial) {
      throw new ApiError(404, "El compromiso no existe.", "NOT_FOUND");
    }

    return jsonOk(historial);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const decoded = decodeURIComponent(id);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
    }

    const ctx = { usuarioId: session.uid, rolCodigo: session.rol };
    const evento = await withSession(ctx, (client) =>
      createCommitmentEvento(client, ctx, decoded, body),
    );

    return jsonOk(evento, 201);
  } catch (error) {
    return jsonError(error);
  }
}
