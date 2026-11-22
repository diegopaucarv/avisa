/**
 * Colecciones paginadas.
 *
 * La API responde hoy con claves en inglés (`items`, `page`, `pageSize`) y la UI
 * React congelada sigue leyéndolas. El destino es el contrato en español
 * (`elementos`, `pagina`, `tamanoPagina`). Este archivo es **el único punto**
 * donde ese rename se resuelve: acepta ambas formas y siempre expone español.
 */

export type Coleccion<T> = {
  elementos: T[];
  total: number;
  pagina: number;
  tamanoPagina: number;
  generadoEn: string | null;
};

export type PeticionPagina = {
  pagina: number;
  tamano: number;
};

export const TAMANO_PAGINA = 25;

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null;
}

function leer(objeto: Record<string, unknown>, claves: string[]): unknown {
  for (const clave of claves) {
    if (clave in objeto) return objeto[clave];
  }
  return undefined;
}

function numero(valor: unknown, respaldo: number): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : respaldo;
}

/** Normaliza un sobre paginado o una lista suelta. */
export function normalizarColeccion<T>(bruto: unknown): Coleccion<T> {
  if (Array.isArray(bruto)) {
    const elementos = bruto as T[];
    return {
      elementos,
      total: elementos.length,
      pagina: 1,
      tamanoPagina: elementos.length || TAMANO_PAGINA,
      generadoEn: null,
    };
  }

  if (!esRegistro(bruto)) {
    return {
      elementos: [],
      total: 0,
      pagina: 1,
      tamanoPagina: TAMANO_PAGINA,
      generadoEn: null,
    };
  }

  const crudos = leer(bruto, ['elementos', 'items', 'data']);
  const elementos = Array.isArray(crudos) ? (crudos as T[]) : [];
  const generadoEn = leer(bruto, ['generadoEn', 'generatedAt']);

  return {
    elementos,
    total: numero(leer(bruto, ['total']), elementos.length),
    pagina: numero(leer(bruto, ['pagina', 'page']), 1),
    tamanoPagina: numero(leer(bruto, ['tamanoPagina', 'pageSize']), TAMANO_PAGINA),
    generadoEn: typeof generadoEn === 'string' ? generadoEn : null,
  };
}

/**
 * Parámetros de paginación para la API.
 *
 * Se envían las dos grafías mientras convive la UI React: el servidor ya
 * entiende `page`/`pageSize` y los alias españoles son aditivos.
 */
export function paramsDePagina(peticion: PeticionPagina): Record<string, string> {
  return {
    pagina: String(peticion.pagina),
    page: String(peticion.pagina),
    tamano: String(peticion.tamano),
    pageSize: String(peticion.tamano),
  };
}

/** Construye una URL con filtros, ignorando valores vacíos. */
export function urlConParametros(
  ruta: string,
  parametros: Record<string, string | number | null | undefined>,
): string {
  const busqueda = new URLSearchParams();

  for (const [clave, valor] of Object.entries(parametros)) {
    if (valor === null || valor === undefined || valor === '') continue;
    busqueda.set(clave, String(valor));
  }

  const texto = busqueda.toString();
  if (!texto) return ruta;
  return `${ruta}${ruta.includes('?') ? '&' : '?'}${texto}`;
}

/**
 * Mapa de parámetros sin valores vacíos, para reenviar sólo los filtros que
 * están realmente activos (por ejemplo, a la exportación).
 */
export function parametrosConValor(
  parametros: Record<string, string | number | null | undefined>,
): Record<string, string> {
  const resultado: Record<string, string> = {};

  for (const [clave, valor] of Object.entries(parametros)) {
    if (valor === null || valor === undefined || valor === '') continue;
    resultado[clave] = String(valor);
  }

  return resultado;
}

/** Rango `desde–hasta` de la página actual, para el pie de tabla. */
export function rangoPagina(
  coleccion: Pick<Coleccion<unknown>, 'pagina' | 'tamanoPagina' | 'total'>,
): { desde: number; hasta: number } {
  if (coleccion.total === 0) return { desde: 0, hasta: 0 };
  const desde = (coleccion.pagina - 1) * coleccion.tamanoPagina + 1;
  const hasta = Math.min(coleccion.pagina * coleccion.tamanoPagina, coleccion.total);
  return { desde, hasta };
}

export function totalPaginas(
  coleccion: Pick<Coleccion<unknown>, 'tamanoPagina' | 'total'>,
): number {
  if (coleccion.tamanoPagina <= 0) return 1;
  return Math.max(1, Math.ceil(coleccion.total / coleccion.tamanoPagina));
}
