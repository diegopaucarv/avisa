import { HttpErrorResponse } from "@angular/common/http";

/** Error normalizado de la API: un único punto de traducción para la UI. */
export class ErrorApi extends Error {
  readonly estado: number;
  readonly codigo: string;

  constructor(detalle: string, estado: number, codigo: string) {
    super(detalle);
    this.name = "ErrorApi";
    this.estado = estado;
    this.codigo = codigo;
  }

  /** 401 significa "sin sesión", no "fallo del sistema". */
  get esNoAutorizado(): boolean {
    return this.estado === 401;
  }

  get esProhibido(): boolean {
    return this.estado === 403;
  }
}

type CuerpoError = { detail?: unknown; code?: unknown; mensaje?: unknown };

export function aErrorApi(
  error: unknown,
  respaldo = "No se pudo completar la solicitud.",
): ErrorApi {
  if (error instanceof ErrorApi) return error;

  if (error instanceof HttpErrorResponse) {
    const cuerpo = (
      typeof error.error === "object" && error.error !== null ? error.error : {}
    ) as CuerpoError;

    const detalle =
      typeof cuerpo.detail === "string" && cuerpo.detail
        ? cuerpo.detail
        : typeof cuerpo.mensaje === "string" && cuerpo.mensaje
          ? cuerpo.mensaje
          : error.status === 0
            ? "No hay conexión con el servidor."
            : respaldo;

    const codigo =
      typeof cuerpo.code === "string" && cuerpo.code ? cuerpo.code : "HTTP_ERROR";
    return new ErrorApi(detalle, error.status, codigo);
  }

  if (error instanceof Error) return new ErrorApi(error.message, 0, "CLIENT_ERROR");
  return new ErrorApi(respaldo, 0, "CLIENT_ERROR");
}
