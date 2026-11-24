import { jsonError } from "@/lib/db/errors";
import { jsonOk } from "@/lib/db/http";
import {
  actualizarValorCatalogo,
  eliminarValorCatalogo,
} from "@/lib/db/repos/admin";
import { withSession } from "@/lib/db/tenant";

import { idNumerico, leerCuerpo, sesionAdministrador } from "../../../_comun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `PATCH /api/v1/admin/catalogos/{catalogo}/{id}`
 *
 * Cambia los campos editables del valor. Cuerpo por catálogo:
 * · niveles_riesgo → `{ orden }`
 * · estados_caso   → `{ activo }`
 * · tipos_actor / roles_actor → `{ etiqueta }`
 * · roles          → `{ maxClasificacion, puedeCrear, puedeEditar, puedeEliminar }`
 *
 * `niveles_conflicto` responde 409 `CATALOGO_NORMATIVO`: su trigger rechaza
 * cualquier escritura directa.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ catalogo: string; id: string }> },
) {
  try {
    const ctx = sesionAdministrador(request);
    const { catalogo, id } = await context.params;
    const cambios = await leerCuerpo(request);

    const resultado = await withSession(ctx, (client) =>
      actualizarValorCatalogo(
        client,
        ctx,
        decodeURIComponent(catalogo),
        idNumerico(id),
        cambios,
      ),
    );

    return jsonOk({ catalogo: resultado });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * `DELETE /api/v1/admin/catalogos/{catalogo}/{id}`
 *
 * Bloquea el borrado si algún registro usa el valor (409 `CATALOGO_EN_USO`) o
 * si el catálogo está protegido (409 `CATALOGO_PROTEGIDO`).
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ catalogo: string; id: string }> },
) {
  try {
    const ctx = sesionAdministrador(request);
    const { catalogo, id } = await context.params;

    const resultado = await withSession(ctx, (client) =>
      eliminarValorCatalogo(
        client,
        ctx,
        decodeURIComponent(catalogo),
        idNumerico(id),
      ),
    );

    return jsonOk({ catalogo: resultado });
  } catch (error) {
    return jsonError(error);
  }
}
