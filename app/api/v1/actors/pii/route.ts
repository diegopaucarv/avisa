import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import {
  asegurarClaveCifrado,
  getActorPii,
  resolverAutoridad,
} from "@/lib/db/repos/pii";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tope duro de ids por lote: acota el coste del descifrado y la auditoría. */
const MAX_IDS = 500;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CuerpoLote = {
  ids: string[];
  motivo: string;
};

/**
 * Valida el cuerpo `{ ids, motivo }` antes de abrir la transacción.
 *
 * Los ids se exigen como UUID: el endpoint individual también acepta el código
 * legado, pero en lote conviene un contrato cerrado para que la respuesta y la
 * auditoría queden ancladas al identificador canónico.
 */
function leerCuerpo(body: unknown): CuerpoLote {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
  }

  const registro = body as Record<string, unknown>;
  const crudos = registro.ids;
  if (!Array.isArray(crudos) || crudos.length === 0) {
    throw new ApiError(422, "Indique al menos un actor.", "IDS_REQUERIDOS");
  }
  if (crudos.length > MAX_IDS) {
    throw new ApiError(
      422,
      `No se pueden consultar más de ${MAX_IDS} actores a la vez.`,
      "IDS_EXCEDEN_LIMITE",
    );
  }

  const ids: string[] = [];
  for (const bruto of crudos) {
    const id = typeof bruto === "string" ? bruto.trim() : "";
    if (!UUID_RE.test(id)) {
      throw new ApiError(
        422,
        "Cada identificador debe ser un UUID válido.",
        "ID_INVALIDO",
      );
    }
    ids.push(id);
  }

  // Finalidad explícita: un acceso masivo a PII exige motivo auditable, igual
  // que el descifrado individual (Ley 29733). No se rellena con un valor por
  // defecto para no perder de vista quién pidió qué.
  const motivo =
    typeof registro.motivo === "string" ? registro.motivo.trim() : "";
  if (!motivo) {
    throw new ApiError(
      422,
      "El motivo del descifrado es obligatorio.",
      "MOTIVO_REQUERIDO",
    );
  }

  // Se deduplica sin perder el orden: evita descifrar y auditar dos veces el
  // mismo actor y claves repetidas en la respuesta.
  return { ids: [...new Set(ids)], motivo };
}

/** Mensaje por id. Nunca propaga SQL ni el detalle crudo de la base. */
function mensajeDeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "No se pudieron descifrar los datos de este actor.";
}

/**
 * `POST /api/v1/actors/pii` — descifrado de DNI y teléfono en lote.
 *
 * Cuerpo: `{ ids: string[], motivo: string }`. Reutiliza `getActorPii`, que fija
 * la autoridad de PII, comprueba la clave y audita el motivo: una sola
 * transacción (`withSession`) cubre todo el lote.
 *
 * Respuesta:
 *   `{ datos: { "<id>": { dni, telefono } }, errores: { "<id>": "<motivo>" },
 *      noDescifrados: number }`
 *   · `datos` omite los ids sin dato (sin ficha o con ambos campos vacíos).
 *   · `errores` recoge el fallo de contrato/permiso de un id sin abortar el
 *     lote.
 *   · `noDescifrados` cuenta las filas cuyo dato estaba corrupto o ilegible:
 *     salen en `datos` con ambos campos en `null` para no romper la descarga.
 *
 * Un dato corrupto en una fila no puede tumbar el lote entero: el fallo de
 * descifrado se captura por actor y esa fila sale sin PII. Sólo los errores de
 * contrato o permiso (`ApiError`) se reportan como error individual.
 *
 * El gate de permisos se resuelve **una vez** antes del bucle: si la sesión no
 * puede ver PII o falta la clave, el lote entero responde 403/503 en vez de
 * devolver cada id como error individual.
 */
export async function POST(request: Request) {
  try {
    const session = requireSession(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
    }

    const { ids, motivo } = leerCuerpo(body);

    const resultado = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      async (client) => {
        // Mismo gate que el endpoint individual, aplicado al lote completo.
        await resolverAutoridad(client, session.roles, ["pii"]);
        await asegurarClaveCifrado(client);

        const datos: Record<
          string,
          { dni: string | null; telefono: string | null }
        > = {};
        const errores: Record<string, string> = {};
        /** Filas cuyo dato estaba corrupto: se devuelven sin PII, sin abortar. */
        let noDescifrados = 0;

        for (const id of ids) {
          try {
            const pii = await getActorPii(client, id, motivo, session.roles);
            if (!pii) {
              errores[id] = "El actor no existe.";
              continue;
            }
            // Un actor sin ficha o sin ambos campos no aporta dato: se omite.
            if (pii.dni === null && pii.telefono === null) continue;

            datos[id] = { dni: pii.dni, telefono: pii.telefono };
          } catch (error) {
            // Un fallo de contrato/permiso se reporta por id sin abortar el lote.
            if (error instanceof ApiError) {
              errores[id] = mensajeDeError(error);
              continue;
            }
            // Dato corrupto o ilegible de una fila: no tumba la descarga, sale
            // sin PII y se cuenta aparte para que la pantalla pueda avisar.
            datos[id] = { dni: null, telefono: null };
            noDescifrados += 1;
          }
        }

        return {
          datos,
          errores,
          noDescifrados,
          generatedAt: new Date().toISOString(),
        };
      },
    );

    return jsonOk(resultado);
  } catch (error) {
    return jsonError(error);
  }
}
