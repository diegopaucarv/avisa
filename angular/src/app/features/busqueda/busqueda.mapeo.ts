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
 * los traduce a la etiqueta en español y a la ruta interna de la SPA. El
 * servidor añade `region` a cada resultado (heredada del caso cuando el
 * registro no tiene región propia).
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
  /** Región del registro; `null` cuando el modelo no la tiene. La tarjeta pone «—». */
  region: string | null;
  icono: string;
  /** Ruta de la pantalla que muestra el recurso; `null` si el tipo no se reconoce. */
  ruta: string[] | null;
  /** `true` si `ruta` abre la ficha del registro; `false` si abre su listado. */
  abreFicha: boolean;
};

export type ColeccionBusqueda = Coleccion<ResultadoBusqueda>;

type Definicion = {
  etiqueta: string;
  icono: string;
  /** Listado del tipo; destino cuando no hay ficha del registro. */
  listado: () => string[];
  /** Ficha del registro. Hoy sólo los casos la tienen (`/casos/:codigo`). */
  ficha?: (codigo: string | null) => string[] | null;
};

/**
 * Sólo el caso tiene pantalla de detalle. Alertas, compromisos, documentos,
 * actores y demandas no la tienen todavía: se declaran sin `ficha` para que la
 * tarjeta enlace a su listado y lo anuncie («Ver listado») en vez de fingir que
 * abre el registro. Añadir esas fichas es trabajo pendiente, no de este cambio.
 */
const DEFINICIONES: Record<TipoResultado, Definicion> = {
  case: {
    etiqueta: 'Caso',
    icono: 'casos',
    listado: () => ['/casos'],
    ficha: (codigo) => (codigo ? ['/casos', codigo] : null),
  },
  alert: {
    etiqueta: 'Alerta temprana',
    icono: 'alertas',
    listado: () => ['/alertas'],
  },
  commitment: {
    etiqueta: 'Compromiso',
    icono: 'compromisos',
    listado: () => ['/compromisos'],
  },
  document: {
    etiqueta: 'Documento',
    icono: 'documentos',
    listado: () => ['/documentos'],
  },
  actor: {
    etiqueta: 'Actor',
    icono: 'actores',
    listado: () => ['/directorio', 'actores'],
  },
  demanda: {
    etiqueta: 'Demanda sin caso',
    icono: 'bandeja',
    listado: () => ['/casos', 'sin-caso'],
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
  const ficha = definicion?.ficha?.(codigo) ?? null;

  return {
    clave: `${tipo}:${id}`,
    id,
    tipo,
    etiquetaTipo: definicion?.etiqueta ?? 'Resultado',
    titulo: texto(registro, ['title']) ?? 'Sin título',
    subtitulo: texto(registro, ['subtitle']),
    codigo,
    region: texto(registro, ['region']),
    icono: definicion?.icono ?? 'buscar',
    ruta: ficha ?? definicion?.listado() ?? null,
    abreFicha: ficha !== null,
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
