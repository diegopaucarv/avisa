import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import {
  fusionarActor,
  type ActorScope,
} from "@/lib/db/repos/actors";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CuerpoFusion = {
  destinoId: string;
  motivo: string;
};

async function leerCuerpo(request: Request): Promise<CuerpoFusion> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
  }

  const cuerpo = parsed as Record<string, unknown>;
  const destinoId =
    typeof cuerpo.destinoId === "string" ? cuerpo.destinoId.trim() : "";
  if (!destinoId) {
    throw new ApiError(
      422,
      "Debe indicar el actor de destino de la fusión.",
      "DESTINO_REQUERIDO",
    );
  }

  const motivo = typeof cuerpo.motivo === "string" ? cuerpo.motivo.trim() : "";
  if (motivo.length < 10) {
    throw new ApiError(
      422,
      "El motivo de la fusión debe tener al menos 10 caracteres.",
      "MOTIVO_REQUERIDO",
    );
  }

  return { destinoId, motivo };
}

/**
 * Fusión de actores duplicados.
 *
 * El actor de la ruta es el origen: sus vínculos (`casos_actores`,
 * `demandas_actores`, `documento_actores`, `alertas_actores`, `actor_membresia`)
 * se reasignan al destino y el origen queda inactivo, nunca se borra.
 *
 * La RLS de los puentes exige crear y eliminar (más nivel 3): sólo `sectorista`
 * y `administrador` pueden ejecutar esta operación. El repositorio comprueba la
 * autoridad antes de escribir.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ uid: string }> },
) {
  try {
    const session = requireSession(request);
    const { uid } = await context.params;
    const origenRef = decodeURIComponent(uid);
    const { destinoId, motivo } = await leerCuerpo(request);

    const scope: ActorScope = {
      usuarioId: session.uid,
      rolCodigo: session.rol,
      roles: session.roles,
    };

    const resumen = await withSession(scope, (client) =>
      fusionarActor(client, scope, origenRef, destinoId, motivo),
    );

    return jsonOk(resumen);
  } catch (error) {
    return jsonError(error);
  }
}
