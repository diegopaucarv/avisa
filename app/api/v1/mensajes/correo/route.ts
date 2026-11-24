import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import {
  CorreoEnvioError,
  CorreoNoConfiguradoError,
  correoConfigurado,
  enviarCorreoInstitucional,
} from "@/lib/mail/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/mensajes/correo`
 *
 * Envía un mensaje de texto desde la cuenta institucional de Gmail. El
 * destinatario lo escribe la persona usuaria en la SPA: esta ruta nunca lo toma
 * de la base ni guarda el cuerpo. Sin `GMAIL_USER`/`GMAIL_APP_PASSWORD`
 * responde 503 `CONFIG_MISSING` en vez de intentar conectar.
 */

const MENSAJE_NO_CONFIGURADO = "Correo institucional no configurado.";

const MAX_DESTINATARIO = 254;
const MAX_ASUNTO = 150;
const MAX_CUERPO = 8000;

const ENVIOS_POR_MINUTO = 10;
const VENTANA_MS = 60_000;

/** Formato razonable: una arroba, dominio con punto y TLD alfabético. */
const PATRON_CORREO = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[A-Za-z]{2,}$/;

type MensajeValidado = {
  destinatario: string;
  asunto: string;
  cuerpo: string;
};

function leerMensaje(valor: unknown): MensajeValidado {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
  }

  const registro = valor as Record<string, unknown>;

  const destinatario =
    typeof registro.destinatario === "string"
      ? registro.destinatario.trim()
      : "";
  if (!destinatario) {
    throw new ApiError(
      400,
      "Indique el correo del destinatario.",
      "INVALID_BODY",
    );
  }
  if (
    destinatario.length > MAX_DESTINATARIO ||
    !PATRON_CORREO.test(destinatario)
  ) {
    throw new ApiError(
      400,
      "El correo del destinatario no es válido.",
      "INVALID_BODY",
    );
  }

  const asunto =
    typeof registro.asunto === "string" ? registro.asunto.trim() : "";
  if (!asunto) {
    throw new ApiError(400, "Indique el asunto del correo.", "INVALID_BODY");
  }
  if (asunto.length > MAX_ASUNTO || /[\r\n]/.test(asunto)) {
    throw new ApiError(
      400,
      `El asunto no puede superar ${MAX_ASUNTO} caracteres ni incluir saltos de línea.`,
      "INVALID_BODY",
    );
  }

  const cuerpo =
    typeof registro.cuerpo === "string" ? registro.cuerpo.trim() : "";
  if (!cuerpo) {
    throw new ApiError(400, "Indique el cuerpo del correo.", "INVALID_BODY");
  }
  if (cuerpo.length > MAX_CUERPO) {
    throw new ApiError(
      400,
      `El cuerpo no puede superar ${MAX_CUERPO} caracteres.`,
      "INVALID_BODY",
    );
  }

  return { destinatario, asunto, cuerpo };
}

/**
 * Límite por usuario en memoria del proceso. Alcanza para frenar un doble
 * clic o un bucle; con varias instancias cada una lleva su propia cuenta.
 */
const enviosPorUsuario = new Map<string, number[]>();

function registrarEnvio(usuarioId: string): void {
  const ahora = Date.now();
  const recientes = (enviosPorUsuario.get(usuarioId) ?? []).filter(
    (marca) => ahora - marca < VENTANA_MS,
  );

  if (recientes.length >= ENVIOS_POR_MINUTO) {
    enviosPorUsuario.set(usuarioId, recientes);
    throw new ApiError(
      429,
      `Ha alcanzado el límite de ${ENVIOS_POR_MINUTO} envíos por minuto. Intente de nuevo en un minuto.`,
      "RATE_LIMITED",
    );
  }

  recientes.push(ahora);
  enviosPorUsuario.set(usuarioId, recientes);
}

/**
 * 503 sin credenciales. Conserva el sobre `{ detail, code }` que normaliza la
 * SPA y añade el objeto `error` documentado para este canal.
 */
function respuestaNoConfigurado() {
  return jsonOk(
    {
      detail: MENSAJE_NO_CONFIGURADO,
      code: "CONFIG_MISSING",
      error: { code: "CONFIG_MISSING", message: MENSAJE_NO_CONFIGURADO },
    },
    503,
  );
}

export async function POST(request: Request) {
  try {
    const sesion = requireSession(request);

    let bruto: unknown;
    try {
      bruto = await request.json();
    } catch {
      throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
    }

    const mensaje = leerMensaje(bruto);

    if (!correoConfigurado()) return respuestaNoConfigurado();

    registrarEnvio(sesion.uid);

    await enviarCorreoInstitucional(mensaje);

    return jsonOk({
      enviado: true,
      canal: "correo-institucional",
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof CorreoNoConfiguradoError) {
      return respuestaNoConfigurado();
    }
    if (error instanceof CorreoEnvioError) {
      return jsonOk(
        {
          detail: "No se pudo enviar el correo institucional.",
          code: "CORREO_FALLO",
        },
        502,
      );
    }
    return jsonError(error);
  }
}
