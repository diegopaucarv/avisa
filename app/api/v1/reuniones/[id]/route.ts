import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { iniciarReunion } from "@/lib/db/repos/resultados";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `PATCH /api/v1/reuniones/{id}` — «Iniciar la reunión ahora».
 *
 * `core.reuniones_dialogo` no tiene una columna de estado: mover la reunión al
 * instante actual y marcarla como `programada = false` es la forma en que la
 * tabla representa que ya empezó. No se inventa un estado que el esquema no
 * guarda.
 *
 * El handler valida la sesión y delega en el repositorio, que comprueba el rol
 * de escritura y el UUID antes de tocar la base. Devuelve la reunión ya
 * actualizada para que la vista recargue el listado con datos frescos.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const decoded = decodeURIComponent(id);

    const ctx = { usuarioId: session.uid, rolCodigo: session.rol };
    const reunion = await withSession(ctx, (client) =>
      iniciarReunion(client, ctx, decoded),
    );

    return jsonOk(reunion);
  } catch (error) {
    return jsonError(error);
  }
}
