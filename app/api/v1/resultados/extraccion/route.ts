import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { obtenerImagenDeReunion } from "@/lib/db/repos/resultados";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AsistentePropuesto = {
  nombre: string;
  cargo: string | null;
};

export type ExtraccionResultado = {
  /** `false` cuando no hay motor configurado o no respondió. */
  disponible: boolean;
  motor: string | null;
  asistentes: AsistentePropuesto[];
  nota: string | null;
};

const TIMEOUT_MS = 15_000;

/**
 * Extracción de nombres desde la foto de la lista de asistencia.
 *
 * Este proyecto **no trae motor de OCR**. El endpoint es el punto de enganche:
 * si la instalación configura `AVISA_EXTRACCION_URL`, se envía la imagen ya
 * guardada como adjunto y se espera `{ asistentes: [{ nombre, cargo? }] }`. Si
 * la variable no está definida —o el servicio no responde— se devuelve
 * `disponible: false` y la SPA arranca con la lista vacía para escribirla a
 * mano. Nunca se inventan nombres: sin motor, la lista siempre está vacía.
 *
 * Sólo lee el adjunto; no escribe en la base.
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
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
    }

    const registro = body as Record<string, unknown>;
    const reunionId =
      typeof registro["reunionId"] === "string"
        ? registro["reunionId"].trim()
        : "";
    const adjuntoId =
      typeof registro["adjuntoId"] === "string"
        ? registro["adjuntoId"].trim()
        : "";

    if (!reunionId || !adjuntoId) {
      throw new ApiError(
        422,
        "Faltan la reunión o el adjunto a procesar.",
        "DATOS_INCOMPLETOS",
      );
    }

    const imagen = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => obtenerImagenDeReunion(client, reunionId, adjuntoId),
    );

    if (!imagen) {
      throw new ApiError(
        404,
        "El adjunto no pertenece a esta reunión o no existe.",
        "ADJUNTO_NO_ENCONTRADO",
      );
    }

    const url = process.env.AVISA_EXTRACCION_URL?.trim();
    if (!url) {
      const sinMotor: ExtraccionResultado = {
        disponible: false,
        motor: null,
        asistentes: [],
        nota:
          "No hay motor de OCR configurado. La foto quedó guardada como adjunto, " +
          "pero los nombres no se extraen: escríbelos y revísalos a mano.",
      };
      return jsonOk(sinMotor);
    }

    const extraido = await llamarMotor(
      url,
      imagen.contenido.toString("base64"),
      imagen.mime,
    );
    if (!extraido) {
      const sinRespuesta: ExtraccionResultado = {
        disponible: false,
        motor: null,
        asistentes: [],
        nota:
          "El motor de extracción no respondió. La foto quedó guardada como " +
          "adjunto; escribe y revisa la lista a mano.",
      };
      return jsonOk(sinRespuesta);
    }

    const resultado: ExtraccionResultado = {
      disponible: true,
      motor: "configurado",
      asistentes: extraido,
      nota:
        extraido.length === 0
          ? "El motor no reconoció nombres legibles. Revisa la foto y escribe la lista a mano."
          : "Revisa y corrige cada nombre: la extracción automática puede confundir apellidos.",
    };
    return jsonOk(resultado);
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Adaptador genérico. Se acepta `{ asistentes: [...] }` o un array suelto; de
 * cada fila sólo se toman `nombre` (obligatorio) y `cargo` (opcional) como
 * texto. Cualquier fila sin nombre se descarta.
 */
async function llamarMotor(
  url: string,
  imagenBase64: string,
  mime: string | null,
): Promise<AsistentePropuesto[] | null> {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    const respuesta = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imagenBase64, mime }),
      signal: control.signal,
    });
    if (!respuesta.ok) return null;

    const bruto: unknown = await respuesta.json();
    const lista = Array.isArray(bruto)
      ? bruto
      : bruto && typeof bruto === "object"
        ? (bruto as Record<string, unknown>)["asistentes"]
        : undefined;
    if (!Array.isArray(lista)) return [];

    const asistentes: AsistentePropuesto[] = [];
    for (const fila of lista) {
      if (!fila || typeof fila !== "object") continue;
      const item = fila as Record<string, unknown>;
      const nombre =
        typeof item["nombre"] === "string" ? item["nombre"].trim() : "";
      if (!nombre) continue;
      const cargo =
        typeof item["cargo"] === "string" && item["cargo"].trim()
          ? item["cargo"].trim()
          : null;
      asistentes.push({ nombre: nombre.slice(0, 255), cargo });
      if (asistentes.length >= 300) break;
    }
    return asistentes;
  } catch {
    return null;
  } finally {
    clearTimeout(temporizador);
  }
}
