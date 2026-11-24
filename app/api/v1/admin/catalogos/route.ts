import { jsonError } from "@/lib/db/errors";
import { jsonOk } from "@/lib/db/http";
import { listarCatalogos } from "@/lib/db/repos/admin";
import { withSession } from "@/lib/db/tenant";

import { sesionAdministrador } from "../_comun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/admin/catalogos`
 *
 * Devuelve los seis catálogos que consume la interfaz con sus valores, el uso
 * de cada valor y los campos editables. `niveles_conflicto` llega como sólo
 * lectura con su motivo normativo.
 */
export async function GET(request: Request) {
  try {
    const ctx = sesionAdministrador(request);
    const catalogos = await withSession(ctx, (client) => listarCatalogos(client));
    return jsonOk({ catalogos });
  } catch (error) {
    return jsonError(error);
  }
}
