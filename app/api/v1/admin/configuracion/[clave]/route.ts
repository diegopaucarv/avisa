import { jsonError } from "@/lib/db/errors";
import { jsonOk } from "@/lib/db/http";
import { guardarConfiguracion } from "@/lib/db/repos/admin";
import { withSession } from "@/lib/db/tenant";

import { leerCuerpo, sesionAdministrador } from "../../_comun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `PUT /api/v1/admin/configuracion/{clave}` con `{ valor, descripcion? }`.
 *
 * `valor` llega como texto JSON y se guarda como `jsonb`; se valida aquí antes
 * de escribir. Hace upsert. La auditoría registra clave y descripción, nunca el
 * valor (puede contener un secreto).
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ clave: string }> },
) {
  try {
    const ctx = sesionAdministrador(request);
    const { clave } = await context.params;
    const body = await leerCuerpo(request);

    const item = await withSession(ctx, (client) =>
      guardarConfiguracion(client, ctx, decodeURIComponent(clave), {
        valor: body["valor"],
        descripcion:
          body["descripcion"] === null || body["descripcion"] === undefined
            ? null
            : String(body["descripcion"]),
      }),
    );

    return jsonOk({ item });
  } catch (error) {
    return jsonError(error);
  }
}
