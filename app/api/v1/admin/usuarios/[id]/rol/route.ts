import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk } from "@/lib/db/http";
import { cambiarRolUsuario } from "@/lib/db/repos/admin";
import { withSession } from "@/lib/db/tenant";

import { leerCuerpo, sesionAdministrador, textoDe } from "../../../_comun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `PUT /api/v1/admin/usuarios/{id}/rol` con `{ rolCodigo }`.
 *
 * Reemplaza los roles vigentes por el indicado: cierra con `hasta` las demás
 * asignaciones y deja abierta la nueva. El historial se conserva.
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = sesionAdministrador(request);
    const { id } = await context.params;
    const body = await leerCuerpo(request);
    const rolCodigo = textoDe(body, "rolCodigo").trim();

    if (!rolCodigo) {
      throw new ApiError(422, "Indique el rol a asignar.", "INVALID_INPUT");
    }

    const usuario = await withSession(ctx, (client) =>
      cambiarRolUsuario(client, ctx, decodeURIComponent(id), rolCodigo),
    );

    return jsonOk({ usuario });
  } catch (error) {
    return jsonError(error);
  }
}
