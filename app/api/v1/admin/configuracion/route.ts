import { jsonError } from "@/lib/db/errors";
import { jsonOk } from "@/lib/db/http";
import { listarConfiguracion } from "@/lib/db/repos/admin";
import { withSession } from "@/lib/db/tenant";

import { sesionAdministrador } from "../_comun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/admin/configuracion`
 *
 * Parámetros globales (`clave`, `valor` jsonb, `descripcion` y última edición).
 */
export async function GET(request: Request) {
  try {
    const ctx = sesionAdministrador(request);
    const items = await withSession(ctx, (client) => listarConfiguracion(client));
    return jsonOk({ items });
  } catch (error) {
    return jsonError(error);
  }
}
