import { createTransport } from "nodemailer";

/**
 * Envío desde la cuenta institucional de Gmail (SMTP).
 *
 * Sólo servidor: las credenciales viven en variables de entorno y nunca se
 * envían a la SPA. El remitente y el cuerpo se arman aquí; la ruta valida el
 * mensaje antes de llegar a este módulo.
 */

const HOST_SMTP = "smtp.gmail.com";
const PUERTO_SMTP = 465;
/** Conexión, saludo y socket: un corte a los 10 s en vez de colgar la ruta. */
const TIEMPO_LIMITE_MS = 10_000;

/** La cuenta institucional no está configurada en el servidor. */
export class CorreoNoConfiguradoError extends Error {
  constructor(readonly variablesFaltantes: readonly string[]) {
    super(
      "Falta configurar el correo institucional en el servidor (" +
        `${variablesFaltantes.join(", ")}).`,
    );
    this.name = "CorreoNoConfiguradoError";
  }
}

/**
 * El envío falló en el servidor SMTP. El mensaje es siempre genérico: el
 * detalle crudo de SMTP puede incluir la cuenta y no sale de aquí.
 */
export class CorreoEnvioError extends Error {
  constructor(readonly codigo: string) {
    super("No se pudo enviar el correo institucional.");
    this.name = "CorreoEnvioError";
  }
}

export type ConfiguracionCorreo = {
  usuario: string;
  contrasenaAplicacion: string;
  nombreRemitente: string | null;
};

export type MensajeInstitucional = {
  destinatario: string;
  asunto: string;
  cuerpo: string;
};

export type ResultadoEnvio = { messageId: string | null };

/**
 * Lee las variables del servidor. Si falta alguna no se crea transporte ni se
 * intenta conectar: se lanza el error tipado para que la ruta responda 503.
 */
export function leerConfiguracionCorreo(): ConfiguracionCorreo {
  const usuario = (process.env.GMAIL_USER ?? "").replace(/\s+/g, "");
  // Google muestra la contraseña de aplicación en bloques de 4; se acepta
  // copiada con espacios porque no forman parte de la credencial.
  const contrasenaAplicacion = (process.env.GMAIL_APP_PASSWORD ?? "").replace(
    /\s+/g,
    "",
  );

  const variablesFaltantes: string[] = [];
  if (!usuario) variablesFaltantes.push("GMAIL_USER");
  if (!contrasenaAplicacion) {
    variablesFaltantes.push("GMAIL_APP_PASSWORD");
  }
  if (variablesFaltantes.length > 0) {
    throw new CorreoNoConfiguradoError(variablesFaltantes);
  }

  return {
    usuario,
    contrasenaAplicacion,
    nombreRemitente:
      (process.env.GMAIL_FROM_NAME ?? "").trim() || null,
  };
}

/** ¿Hay credenciales completas? No dice nada del resultado del envío. */
export function correoConfigurado(): boolean {
  try {
    leerConfiguracionCorreo();
    return true;
  } catch {
    return false;
  }
}

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * `"Nombre" <cuenta>` cuando hay nombre visible; si no, sólo la dirección.
 * El nombre se limpia de saltos de línea y comillas para no inyectar cabeceras.
 */
function componerRemitente(config: ConfiguracionCorreo): string {
  const nombre = (config.nombreRemitente ?? "")
    .replace(/[\r\n"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return nombre ? `"${nombre}" <${config.usuario}>` : config.usuario;
}

/** Versión HTML mínima: el cuerpo va escapado y con los saltos preservados. */
function construirCuerpoHtml(cuerpo: string): string {
  return [
    '<!doctype html><html lang="es"><head><meta charset="utf-8"></head>',
    '<body style="margin:0;padding:16px;background:#ffffff;color:#1f2d3a;">',
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;',
    'line-height:1.55;white-space:pre-wrap;">',
    escaparHtml(cuerpo),
    "</div></body></html>",
  ].join("");
}

function codigoDeError(fallo: unknown): string {
  if (fallo && typeof fallo === "object" && "code" in fallo) {
    const codigo = (fallo as { code?: unknown }).code;
    if (typeof codigo === "string" && codigo.trim()) {
      return codigo.trim().slice(0, 40);
    }
  }
  return "DESCONOCIDO";
}

/**
 * Envía un mensaje de texto desde la cuenta institucional.
 *
 * No se registra el destinatario ni el cuerpo: sólo el resultado del envío y,
 * si falla, el código acotado del error SMTP. Un fallo de autenticación se
 * convierte en `CorreoEnvioError` genérico.
 */
export async function enviarCorreoInstitucional(
  mensaje: MensajeInstitucional,
): Promise<ResultadoEnvio> {
  const config = leerConfiguracionCorreo();

  const transporte = createTransport({
    host: HOST_SMTP,
    port: PUERTO_SMTP,
    secure: true,
    auth: {
      user: config.usuario,
      pass: config.contrasenaAplicacion,
    },
    connectionTimeout: TIEMPO_LIMITE_MS,
    greetingTimeout: TIEMPO_LIMITE_MS,
    socketTimeout: TIEMPO_LIMITE_MS,
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  try {
    const informacion = await transporte.sendMail({
      from: componerRemitente(config),
      to: mensaje.destinatario,
      subject: mensaje.asunto.replace(/[\r\n]+/g, " ").trim(),
      text: mensaje.cuerpo,
      html: construirCuerpoHtml(mensaje.cuerpo),
    });

    console.info("[avisa-correo] envío completado");

    return {
      messageId:
        typeof informacion?.messageId === "string" && informacion.messageId
          ? informacion.messageId
          : null,
    };
  } catch (fallo) {
    const codigo = codigoDeError(fallo);
    console.warn("[avisa-correo] envío fallido", { codigo });
    throw new CorreoEnvioError(codigo);
  } finally {
    transporte.close?.();
  }
}
