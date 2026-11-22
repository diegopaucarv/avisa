import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { resolveDataScope } from "@/lib/db/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sesión hidratable: el cliente puede restaurar el perfil tras recargar sin
 * volver a pedir credenciales (la cookie es httpOnly y va firmada).
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    return jsonOk({
      user: {
        dni: session.dn,
        nombre: session.nom,
        rol: session.rol,
        roles: session.roles,
        id: session.cod,
        area: session.area,
        cargo: session.cargo,
        regiones: session.regs,
      },
      scope: resolveDataScope(session),
      expiresAt: new Date(session.exp).toISOString(),
    });
  } catch (error) {
    return jsonError(error);
  }
}
