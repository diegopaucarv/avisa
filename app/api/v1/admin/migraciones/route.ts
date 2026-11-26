import { jsonError } from "@/lib/db/errors";
import { jsonOk } from "@/lib/db/http";
import { listarMigraciones } from "@/lib/db/repos/admin";
import { withSession } from "@/lib/db/tenant";

import { sesionAdministrador } from "../_comun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/admin/migraciones`
 *
 * Bitácora de migraciones aplicadas (`core.migracion_log`), en sólo lectura.
 */
export async function GET(request: Request) {
  try {
    const ctx = sesionAdministrador(request);
    const items = await withSession(ctx, (client) => listarMigraciones(client));
    return jsonOk({ items, total: items.length });
  } catch (error) {
    return jsonError(error);
  }
}
