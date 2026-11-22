/**
 * Búsqueda global: contrato de `GET /api/v1/search`.
 *
 * El sobre real es `{query, results, total, page, pageSize, generatedAt,
 * pagina, tamanoPagina}`. La clave de los elementos es `results`, que
 * `normalizarColeccion` no reconoce (`items`/`elementos`/`data`), así que el
 * sobre se normaliza aquí, a mano, conservando `total`, `pagina` y
 * `tamanoPagina`.
 *
 * `type`/`view` llegan en inglés desde `lib/db/repos/search.ts`; este archivo
 * los traduce a la etiqueta en español y a la ruta interna de la SPA.
 */

import { TAMANO_PAGINA, type Coleccion } from '../../core/http/coleccion';
import { esRegistro, texto, type Registro } from '../../dominio/mapeo';

/** El servidor no busca con menos de dos caracteres: responde 422. */
export const MINIMO_TERMINO = 2;

/** Valores de `type` que produce hoy `lib/db/repos/search.ts`. */
export type TipoResultado = 'case' | 'alert' | 'commitment' | 'document' | 'actor' | 'demanda';

export type ResultadoBusqueda = {
  /** Clave de `track`; combina tipo e id para no colisionar entre tablas. */
  clave: string;
  id: string;
  tipo: string;
  etiquetaTipo: string;
  titulo: string;
  subtitulo: string | null;
  codigo: string | null;
  icono: string;
  /** Ruta de la pantalla que muestra el recurso; `null` si el tipo no se reconoce. */
  ruta: string[] | null;
};

export type ColeccionBusqueda = Coleccion<ResultadoBusqueda>;

type Definicion = {
  etiqueta: string;
  icono: string;
  /** El caso tiene ficha propia por código; el resto abre su listado. */
  ruta: (codigo: string | null) => string[];
};

const DEFINICIONES: Record<TipoResultado, Definicion> = {
  case: {
    etiqueta: 'Caso',
    icono: 'casos',
    ruta: (codigo) => (codigo ? ['/casos', codigo] : ['/casos']),
  },
  alert: {
    etiqueta: 'Alerta temprana',
    icono: 'alertas',
    ruta: () => ['/alertas'],
  },
  commitment: {
    etiqueta: 'Compromiso',
    icono: 'compromisos',
    ruta: () => ['/compromisos'],
  },
  document: {
    etiqueta: 'Documento',
    icono: 'documentos',
    ruta: () => ['/documentos'],
  },
  actor: {
    etiqueta: 'Actor',
    icono: 'actores',
    ruta: () => ['/directorio', 'actores'],
  },
  demanda: {
    etiqueta: 'Demanda sin caso',
    icono: 'bandeja',
    ruta: () => ['/casos', 'sin-caso'],
  },
};

function esTipo(valor: string): valor is TipoResultado {
  return Object.prototype.hasOwnProperty.call(DEFINICIONES, valor);
}

/** Un elemento de `results[]`. */
export function aResultadoBusqueda(bruto: unknown): ResultadoBusqueda {
  const registro: Registro = esRegistro(bruto) ? bruto : {};
  const tipo = (texto(registro, ['type']) ?? '').toLowerCase();
  const definicion = esTipo(tipo) ? DEFINICIONES[tipo] : null;
  const codigo = texto(registro, ['code']);
  const id = texto(registro, ['id']) ?? codigo ?? '';

  return {
    clave: `${tipo}:${id}`,
    id,
    tipo,
    etiquetaTipo: definicion?.etiqueta ?? 'Resultado',
    titulo: texto(registro, ['title']) ?? 'Sin título',
    subtitulo: texto(registro, ['subtitle']),
    codigo,
    icono: definicion?.icono ?? 'buscar',
    ruta: definicion ? definicion.ruta(codigo) : null,
  };
}

function numero(valor: unknown, respaldo: number): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : respaldo;
}

/**
 * Sobre de `GET /api/v1/search`.
 *
 * `results` es la lista; `total` es el total real del servidor (no el de la
 * página). Se aceptan las dos grafías de página porque el backend publica
 * `pagina`/`tamanoPagina` junto a `page`/`pageSize`.
 */
export function aColeccionBusqueda(bruto: unknown): ColeccionBusqueda {
  const registro: Registro = esRegistro(bruto) ? bruto : {};
  const crudos = registro['results'];
  const elementos = Array.isArray(crudos) ? crudos.map(aResultadoBusqueda) : [];
  const generadoEn = registro['generatedAt'];

  return {
    elementos,
    total: numero(registro['total'], elementos.length),
    pagina: numero(registro['pagina'] ?? registro['page'], 1),
    tamanoPagina: numero(registro['tamanoPagina'] ?? registro['pageSize'], TAMANO_PAGINA),
    generadoEn: typeof generadoEn === 'string' ? generadoEn : null,
  };
}
