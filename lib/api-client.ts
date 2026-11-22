/**
 * Cliente HTTP mínimo para la capa de datos de AVISA.
 *
 * Todas las llamadas van same-origin para que la cookie httpOnly de sesión
 * viaje sola; los errores del backend se traducen a `ApiClientError` con el
 * `detail` y el `code` que devuelve la API.
 */

type ErrorBody = {
  detail?: unknown;
  code?: unknown;
};

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(detail: string, status: number, code: string) {
    super(detail);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

function readErrorBody(value: unknown): ErrorBody {
  return typeof value === "object" && value !== null
    ? (value as ErrorBody)
    : {};
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    let detail = `La solicitud a ${path} falló (${response.status}).`;
    let code = "HTTP_ERROR";
    try {
      const body = readErrorBody(await response.json());
      if (typeof body.detail === "string" && body.detail) detail = body.detail;
      if (typeof body.code === "string" && body.code) code = body.code;
    } catch {
      // Respuesta sin JSON válido: se conserva el mensaje genérico.
    }
    throw new ApiClientError(detail, response.status, code);
  }

  const data: unknown = await response.json();
  return data as T;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (!isRecord(acc) || !(key in acc)) return undefined;
    return acc[key];
  }, value);
}

function withPageParams(path: string, page: number): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}page=${page}&pageSize=${PAGE_SIZE}`;
}

/**
 * Recorre una colección paginada (`{ items, total, ... }`) y devuelve todos los
 * elementos. `itemPath` permite apuntar a listas anidadas (p. ej. `data.items`);
 * el `total` se lee del objeto contenedor de esa lista.
 *
 * Topes de seguridad: `pageSize=100` y 50 páginas como máximo, para no entrar en
 * un bucle infinito si el backend ignorara la paginación.
 */
export async function apiGetAllPages<T>(
  path: string,
  itemPath = "items",
): Promise<T[]> {
  const collected: T[] = [];
  let total: number | null = null;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = withPageParams(path, page);
    const body = await apiGet<unknown>(url);
    const rawItems = readPath(body, itemPath);

    if (!Array.isArray(rawItems)) {
      throw new ApiClientError(
        `La respuesta de ${url} no contiene la lista "${itemPath}".`,
        0,
        "INVALID_RESPONSE",
      );
    }

    // `Array.isArray` ya validó la forma; el dominio de `T` lo garantiza la API.
    const pageItems = rawItems as T[];

    const containerPath = itemPath.includes(".")
      ? itemPath.slice(0, itemPath.lastIndexOf("."))
      : "";
    const container = containerPath ? readPath(body, containerPath) : body;
    const rawTotal = isRecord(container) ? container.total : undefined;
    if (typeof rawTotal === "number") total = rawTotal;

    collected.push(...pageItems);

    if (pageItems.length < PAGE_SIZE) break;
    if (total !== null && collected.length >= total) break;
  }

  return collected;
}
