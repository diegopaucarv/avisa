import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { deleteAlert } from "@/lib/db/repos/alerts";
import { deleteCase } from "@/lib/db/repos/cases";
import { deleteCommitment } from "@/lib/db/repos/commitments";
import { deleteDemanda } from "@/lib/db/repos/demandas";
import { deleteDocument } from "@/lib/db/repos/documents";
import { puedeAnularRegistros, withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Anulación en lote (borrado lógico) de la selección de una tabla.
 *
 * Una sola transacción para todo el lote: si un id no existe o el motivo no
 * pasa la validación de la base, no se anula ninguno. La RLS ya limita por
 * rol; aquí se corta antes con 403 para que el cliente reciba un error claro.
 */

const MAX_LOTE = 200;

type EntidadAnulable =
  | "alertas"
  | "casos"
  | "compromisos"
  | "documentos"
  | "demandas";

const ENTIDADES: readonly EntidadAnulable[] = [
  "alertas",
  "casos",
  "compromisos",
  "documentos",
  "demandas",
];

function leerCuerpo(valor: unknown): {
  entidad: EntidadAnulable;
  ids: string[];
  motivo: string;
} {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
  }

  const cuerpo = valor as {
    entidad?: unknown;
    ids?: unknown;
    motivo?: unknown;
  };

  const entidad =
    typeof cuerpo.entidad === "string"
      ? cuerpo.entidad.trim().toLowerCase()
      : "";

  if (!ENTIDADES.includes(entidad as EntidadAnulable)) {
    throw new ApiError(
      400,
      "Entidad no anulable en lote.",
      "ENTIDAD_INVALIDA",
    );
  }

  const ids = Array.isArray(cuerpo.ids)
    ? [
        ...new Set(
          cuerpo.ids
            .filter((id): id is string => typeof id === "string")
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ]
    : [];

  if (ids.length === 0) {
    throw new ApiError(
      400,
      "Indique al menos un registro a anular.",
      "IDS_REQUERIDOS",
    );
  }
  if (ids.length > MAX_LOTE) {
    throw new ApiError(
      400,
      `El lote no puede superar ${MAX_LOTE} registros.`,
      "LOTE_DEMASIADO_GRANDE",
    );
  }

  const motivo = typeof cuerpo.motivo === "string" ? cuerpo.motivo.trim() : "";
  if (!motivo) {
    throw new ApiError(
      400,
      "El motivo de la anulación es obligatorio.",
      "MOTIVO_REQUERIDO",
    );
  }

  return { entidad: entidad as EntidadAnulable, ids, motivo };
}

export async function POST(request: Request) {
  try {
    const sesion = requireSession(request);

    if (!puedeAnularRegistros(sesion.roles)) {
      throw new ApiError(
        403,
        "Su rol no permite anular registros.",
        "FORBIDDEN",
      );
    }

    let bruto: unknown;
    try {
      bruto = await request.json();
    } catch {
      throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
    }

    const { entidad, ids, motivo } = leerCuerpo(bruto);
    const scope = { usuarioId: sesion.uid, rolCodigo: sesion.rol };

    const anulados = await withSession(scope, async (client) => {
      let total = 0;
      for (const id of ids) {
        if (entidad === "alertas") {
          await deleteAlert(client, scope, id, motivo);
        } else if (entidad === "casos") {
          // `deleteCase` recibe el **código** del caso, no el uuid.
          await deleteCase(client, scope, id, motivo);
        } else if (entidad === "compromisos") {
          await deleteCommitment(client, scope, id, motivo);
        } else if (entidad === "documentos") {
          await deleteDocument(client, scope, id, motivo);
        } else {
          await deleteDemanda(client, scope, id, motivo);
        }
        total += 1;
      }
      return total;
    });

    return jsonOk({ anulados });
  } catch (error) {
    return jsonError(error);
  }
}
