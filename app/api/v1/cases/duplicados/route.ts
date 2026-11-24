import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, queryParams, requireSession } from "@/lib/db/http";
import { buscarDuplicados, descartarDuplicado } from "@/lib/db/repos/cases";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Aviso de duplicados antes de registrar un caso.
 *
 * `GET ?titulo=&distritoId=&organizacion=&demanda=&caso=`
 * devuelve los casos parecidos y el criterio que coincidió (título, distrito,
 * organización o demanda). `caso` es el código del caso en edición: se excluye
 * y se usan sus descartes previos.
 *
 * `POST { casoA, casoB, motivo }` registra que dos casos NO son duplicados.
 * No borra ni fusiona nada: deja la constancia para que el aviso no repita.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);

    const distritoRaw = params.get("distritoId") ?? params.get("distrito");
    const distritoId =
      distritoRaw !== null && /^\d+$/.test(distritoRaw.trim())
        ? Number(distritoRaw.trim())
        : undefined;

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) =>
        buscarDuplicados(client, {
          titulo: params.get("titulo") ?? "",
          distritoId,
          organizacion: params.get("organizacion") ?? undefined,
          demanda: params.get("demanda") ?? undefined,
          caso: params.get("caso") ?? undefined,
        }),
    );

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
  }
  return parsed as Record<string, unknown>;
}

export async function POST(request: Request) {
  try {
    const session = requireSession(request);
    const body = await readBody(request);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };

    const casoA = typeof body.casoA === "string" ? body.casoA : "";
    const casoB = typeof body.casoB === "string" ? body.casoB : "";
    const motivo = typeof body.motivo === "string" ? body.motivo : "";

    const result = await withSession(scope, (client) =>
      descartarDuplicado(client, scope, { casoA, casoB, motivo }),
    );

    return jsonOk(result, 201);
  } catch (error) {
    return jsonError(error);
  }
}
