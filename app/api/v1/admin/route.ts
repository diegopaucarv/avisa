import { jsonError } from "@/lib/db/errors";
import { jsonOk } from "@/lib/db/http";
import { ROL_ADMINISTRADOR, resumenAdmin } from "@/lib/db/repos/admin";
import { withSession } from "@/lib/db/tenant";

import { sesionAdministrador } from "./_comun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/admin`
 *
 * Resumen de las cinco secciones: usuarios (total y activos), roles, lista
 * blanca (total y activos), parámetros y migraciones (total y última fecha).
 * Declara `rolRequerido` para que la interfaz no repita el código a mano.
 */
export async function GET(request: Request) {
  try {
    const ctx = sesionAdministrador(request);
    const resumen = await withSession(ctx, (client) => resumenAdmin(client));
    return jsonOk({ ...resumen, rolRequerido: ROL_ADMINISTRADOR });
  } catch (error) {
    return jsonError(error);
  }
}
