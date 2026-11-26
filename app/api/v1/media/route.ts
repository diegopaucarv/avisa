import { ApiError, jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerBooleano,
  leerPagina,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import {
  anularMedia,
  createMedia,
  listMedia,
  MEDIA_ENTITY_TYPES,
  type MediaListQuery,
} from "@/lib/db/repos/media";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENTIDADES = new Set<string>(MEDIA_ENTITY_TYPES);

/**
 * Medios y galería fotográfica.
 *
 * `GET` lista los medios de una entidad (`entidadTipo` + `entidadId`) o de un
 * lote de entidades (`entidadIds`, separados por coma), que es lo que usan las
 * tablas del directorio para pintar la foto principal sin una petición por
 * fila.
 *
 * `POST` registra un medio. `DELETE` anula lógicamente (nunca borra el archivo).
 *
 * La galería nace vacía: si no hay fotos, la interfaz debe decir «Sin
 * fotografías», no inventar una imagen.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const { page, pageSize } = leerPagina(params);

    const entidadTipo =
      params.get("entidadTipo") ?? params.get("entidad_tipo") ?? undefined;
    if (entidadTipo && !ENTIDADES.has(entidadTipo)) {
      throw new ApiError(
        422,
        "El tipo de entidad no está en el catálogo.",
        "CATALOG_VALUE_INVALID",
      );
    }

    const entidadId =
      params.get("entidadId") ?? params.get("entidad_id") ?? undefined;
    const entidadIds = (
      params.get("entidadIds") ??
      params.get("entidad_ids") ??
      ""
    )
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    const query: MediaListQuery = {
      page,
      pageSize,
      entidadTipo,
      entidadId,
      entidadIds: entidadIds.length ? entidadIds : undefined,
      rol: params.get("rol") ?? undefined,
      incluirAnulados: leerBooleano(params.get("anulados")),
    };

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listMedia(client, query),
      { verAnulados: query.incluirAnulados },
    );

    return jsonOk(conAliasDePagina(result));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireSession(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
    }

    const ctx = { usuarioId: session.uid, rolCodigo: session.rol };
    const medio = await withSession(ctx, (client) =>
      createMedia(client, ctx, body),
    );

    return jsonOk(medio, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);

    const id = params.get("id")?.trim();
    if (!id) {
      throw new ApiError(
        400,
        "Indique el identificador del medio.",
        "ID_REQUERIDO",
      );
    }
    const motivo = params.get("motivo")?.trim();

    const ctx = { usuarioId: session.uid, rolCodigo: session.rol };
    const medio = await withSession(ctx, (client) =>
      anularMedia(client, ctx, id, motivo),
    );

    return jsonOk(medio);
  } catch (error) {
    return jsonError(error);
  }
}
