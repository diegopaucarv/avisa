import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { actualizarTarjeta } from "@/lib/db/repos/bandeja";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Movimiento y edición de una tarjeta del tablero.
 *
 * `PATCH /api/v1/bandeja/{entidadTipo}/{entidadId}` acepta, total o parcialmente:
 * `columna` (`backlog` · `en_curso` · `en_espera` · `hecho`), `asignacion_texto`,
 * `responsable_usuario_id`, `responsable_texto`, `fecha_limite`,
 * `pospuesto_hasta` + `motivo_posposicion` y `orden`.
 *
 * Si la tarjeta no existe, se crea (upsert). Cada campo modificado escribe una
 * fila en `core.tablero_tarjeta_evento` con el usuario de la sesión; la
 * creación deja un evento `creacion` con la instantánea. La tabla del tablero
 * no tiene RLS: la autorización se replica en el repo (`core.puede_editar()` y
 * la entidad dueña bajo la RLS vigente).
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ entidadTipo: string; entidadId: string }> },
) {
  try {
    const session = requireSession(request);
    const { entidadTipo, entidadId } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
    }

    const ctx = { usuarioId: session.uid, rolCodigo: session.rol };
    const resultado = await withSession(ctx, (client) =>
      actualizarTarjeta(client, ctx, entidadTipo, entidadId, body),
    );

    return jsonOk(resultado);
  } catch (error) {
    return jsonError(error);
  }
}
