import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, queryParams } from "@/lib/db/http";
import {
  LIMITE_SERVIDOR_BYTES,
  actualizarListaBlanca,
  crearListaBlanca,
  eliminarListaBlanca,
  listarListaBlanca,
  type CambiosListaBlanca,
} from "@/lib/db/repos/admin";
import { withSession } from "@/lib/db/tenant";

import { leerCuerpo, sesionAdministrador, textoDe } from "../_comun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/admin/lista-blanca`
 *
 * Tipos de archivo permitidos con el uso real de cada uno. `maximoServidorBytes`
 * publica el límite absoluto del servidor (20 MB), que no vive en la tabla.
 */
export async function GET(request: Request) {
  try {
    const ctx = sesionAdministrador(request);
    const items = await withSession(ctx, (client) => listarListaBlanca(client));
    return jsonOk({ items, maximoServidorBytes: LIMITE_SERVIDOR_BYTES });
  } catch (error) {
    return jsonError(error);
  }
}

/** `POST /api/v1/admin/lista-blanca` con `{ mime, extension?, activo?, nota? }`. */
export async function POST(request: Request) {
  try {
    const ctx = sesionAdministrador(request);
    const body = await leerCuerpo(request);

    const item = await withSession(ctx, (client) =>
      crearListaBlanca(client, ctx, {
        mime: textoDe(body, "mime"),
        extension: textoDe(body, "extension") || null,
        activo: typeof body["activo"] === "boolean" ? body["activo"] : undefined,
        nota: textoDe(body, "nota") || null,
      }),
    );

    return jsonOk({ item }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * `PATCH /api/v1/admin/lista-blanca` con `{ mime, extension?, activo?, nota? }`.
 *
 * El MIME es la clave primaria y viaja en el cuerpo porque contiene «/», que no
 * puede ser un segmento de ruta.
 */
export async function PATCH(request: Request) {
  try {
    const ctx = sesionAdministrador(request);
    const body = await leerCuerpo(request);
    const mime = textoDe(body, "mime").trim().toLowerCase();
    if (!mime) {
      throw new ApiError(422, "Indique el MIME a modificar.", "INVALID_INPUT");
    }

    const cambios: CambiosListaBlanca = {};
    if ("extension" in body) {
      cambios.extension =
        body["extension"] === null ? null : textoDe(body, "extension");
    }
    if (typeof body["activo"] === "boolean") cambios.activo = body["activo"];
    if ("nota" in body) {
      cambios.nota = body["nota"] === null ? null : textoDe(body, "nota");
    }

    const item = await withSession(ctx, (client) =>
      actualizarListaBlanca(client, ctx, mime, cambios),
    );

    return jsonOk({ item });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * `DELETE /api/v1/admin/lista-blanca?mime=application/pdf`
 *
 * Falla con 409 `LISTA_BLANCA_EN_USO` si hay documentos o adjuntos con ese MIME.
 */
export async function DELETE(request: Request) {
  try {
    const ctx = sesionAdministrador(request);
    const mime = queryParams(request).get("mime")?.trim().toLowerCase() ?? "";
    if (!mime) {
      throw new ApiError(422, "Indique el MIME a eliminar.", "INVALID_INPUT");
    }

    const item = await withSession(ctx, (client) =>
      eliminarListaBlanca(client, ctx, mime),
    );

    return jsonOk({ mime: item.mime, eliminado: true });
  } catch (error) {
    return jsonError(error);
  }
}
