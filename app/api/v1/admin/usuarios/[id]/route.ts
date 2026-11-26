import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk } from "@/lib/db/http";
import { cambiarEstadoUsuario } from "@/lib/db/repos/admin";
import { withSession } from "@/lib/db/tenant";

import { leerCuerpo, sesionAdministrador } from "../../_comun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `PATCH /api/v1/admin/usuarios/{id}` con `{ activo: boolean }`.
 *
 * Activa o desactiva la cuenta. Desactivar la propia cuenta responde 422
 * `AUTO_DESACTIVACION`.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = sesionAdministrador(request);
    const { id } = await context.params;
    const body = await leerCuerpo(request);
    const activo = body["activo"];

    if (typeof activo !== "boolean") {
      throw new ApiError(
        422,
        "El estado debe ser un booleano.",
        "INVALID_INPUT",
      );
    }

    const usuario = await withSession(ctx, (client) =>
      cambiarEstadoUsuario(client, ctx, decodeURIComponent(id), activo),
    );

    return jsonOk({ usuario });
  } catch (error) {
    return jsonError(error);
  }
}
