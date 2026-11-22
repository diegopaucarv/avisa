/**
 * Búsqueda global: grupos, contrato de cada listado y enlaces.
 *
 * La pantalla consulta **un endpoint por entidad** en vez de
 * `GET /api/v1/search`: es la única forma de conocer el total de cada grupo y
 * de topear filas sin que un grupo grande sepulte a los demás. Los seis
 * listados aceptan `q` —comprobado en `app/api/v1/` para `cases`, `alerts`,
 * `commitments`, `documents`, `actors` y `demandas`—, así que ningún grupo se
 * omite por falta de parámetro.
 *
 * Región: sólo los listados de casos y actores la seleccionan. Alerta,
 * compromiso, documento y demanda la heredan del caso y únicamente
 * `GET /api/v1/search` la publica. Esa respuesta se usa como índice de región
 * —y de código para las demandas, cuyo listado no trae `codigo_legado`—. Si el
 * registro no aparece en el índice, el valor queda en `null` y la tarjeta
 * pinta «—»: nunca se inventa.
 */

import { normalizarColeccion, type Coleccion } from '../../core/http/coleccion';
import { esRegistro, texto, type Registro } from '../../dominio/mapeo';

/** El servidor no busca con menos de dos caracteres: responde 422. */
export const MINIMO_TERMINO = 2;

/** Tope de filas por grupo; el total del grupo sigue siendo el real. */
export const TOPE_POR_GRUPO = 5;

/** `MAX_PAGE_SIZE` de `lib/db/repos/search.ts`; el índice no admite más. */
export const TOPE_INDICE = 100;

/** Valores de `type` que produce hoy `lib/db/repos/search.ts`. */
export type TipoBusqueda = 'case' | 'alert' | 'commitment' | 'document' | 'actor' | 'demanda';

export type ClaveGrupo =
  'casos' | 'alertas' | 'compromisos' | 'documentos' | 'actores' | 'demandas';

/** Fila ya normalizada; todavía sin ruta, que depende del término vigente. */
export type Resultado = {
  /** Clave de `track`; combina tipo e id para no colisionar entre tablas. */
  clave: string;
  id: string;
  tipo: TipoBusqueda;
  etiquetaTipo: string;
  titulo: string;
  subtitulo: string | null;
  codigo: string | null;
  /** Región del registro; `null` cuando el listado no la trae y el índice no la cubre. */
  region: string | null;
  icono: string;
};

export type Enlace = {
  ruta: string[];
  parametros: Record<string, string>;
};

export type ResultadoEnlazado = Resultado &
  Enlace & {
    /** `true` si `ruta` abre la ficha del registro; `false` si abre su listado. */
    abreFicha: boolean;
  };

export type FilaIndice = {
  codigo: string | null;
  region: string | null;
};

export type IndiceBusqueda = ReadonlyMap<string, FilaIndice>;

type Claves = {
  codigo: readonly string[];
  titulo: readonly string[];
  subtitulo: readonly string[];
};

export type DefinicionGrupo = {
  clave: ClaveGrupo;
  tipo: TipoBusqueda;
  /** Etiqueta del registro, la que lleva cada fila. */
  etiqueta: string;
  /** Título del grupo. */
  tituloGrupo: string;
  icono: string;
  /** Ruta de la API sin la base (`urlApi` la compone). */
  recurso: string;
  /** Listado del tipo; destino de las filas que no tienen ficha. */
  listado: string[];
  /** Ficha del registro. Sólo si `app.routes.ts` la declara. */
  ficha?: (codigo: string) => string[];
  claves: Claves;
  /**
   * Valor de `q` con el que el listado vuelve a mostrar la fila. `null` cuando
   * el listado no busca por ese dato y conviene reenviar el término.
   */
  filtroLista: (fila: { codigo: string | null; titulo: string }) => string | null;
};

/**
 * Orden fijo de los grupos. Sólo el caso tiene pantalla de detalle
 * (`/casos/:codigo`); alertas, compromisos, documentos, actores y demandas no
 * la tienen, así que enlazan a su listado ya filtrado por `q` en vez de a una
 * ruta muerta.
 */
export const GRUPOS: readonly DefinicionGrupo[] = [
  {
    clave: 'casos',
    tipo: 'case',
    etiqueta: 'Caso',
    tituloGrupo: 'Casos',
    icono: 'casos',
    recurso: '/v1/cases',
    listado: ['/casos'],
    ficha: (codigo) => ['/casos', codigo],
    claves: { codigo: ['code'], titulo: ['title'], subtitulo: ['estado'] },
    filtroLista: ({ codigo }) => codigo,
  },
  {
    clave: 'alertas',
    tipo: 'alert',
    etiqueta: 'Alerta temprana',
    tituloGrupo: 'Alertas tempranas',
    icono: 'alertas',
    recurso: '/v1/alerts',
    listado: ['/alertas'],
    claves: { codigo: ['codigo'], titulo: ['titulo'], subtitulo: ['prioridad'] },
    filtroLista: ({ codigo }) => codigo,
  },
  {
    clave: 'compromisos',
    tipo: 'commitment',
    etiqueta: 'Compromiso',
    tituloGrupo: 'Compromisos',
    icono: 'compromisos',
    recurso: '/v1/commitments',
    listado: ['/compromisos'],
    claves: { codigo: ['codigo'], titulo: ['accion'], subtitulo: ['estado'] },
    filtroLista: ({ codigo }) => codigo,
  },
  {
    clave: 'documentos',
    tipo: 'document',
    etiqueta: 'Documento',
    tituloGrupo: 'Documentos',
    icono: 'documentos',
    recurso: '/v1/documents',
    listado: ['/documentos'],
    claves: { codigo: ['codigo'], titulo: ['titulo'], subtitulo: ['tipoNombre', 'tipo'] },
    filtroLista: ({ codigo }) => codigo,
  },
  {
    clave: 'actores',
    tipo: 'actor',
    etiqueta: 'Actor',
    tituloGrupo: 'Actores',
    icono: 'actores',
    recurso: '/v1/actors',
    listado: ['/directorio', 'actores'],
    claves: { codigo: ['codigo'], titulo: ['nombre'], subtitulo: ['tipo', 'cargo'] },
    // El `q` del directorio busca nombre, abreviatura y cargo; no `codigo_legado`.
    filtroLista: ({ titulo }) => titulo,
  },
  {
    clave: 'demandas',
    tipo: 'demanda',
    etiqueta: 'Demanda sin caso',
    tituloGrupo: 'Demandas sin caso',
    icono: 'bandeja',
    recurso: '/v1/demandas',
    listado: ['/casos', 'sin-caso'],
    claves: { codigo: [], titulo: ['descripcion', 'problema'], subtitulo: ['estado'] },
    // El listado busca en la descripción y el 3P, nunca en `codigo_legado`.
    filtroLista: () => null,
  },
];

/** Fila de `items[]` de un listado → resultado normalizado. */
export function aResultado(definicion: DefinicionGrupo, bruto: unknown): Resultado {
  const fila: Registro = esRegistro(bruto) ? bruto : {};
  const id = texto(fila, ['id']) ?? '';
  const codigo = texto(fila, definicion.claves.codigo);
  const titulo = texto(fila, definicion.claves.titulo) ?? 'Sin título';

  return {
    clave: `${definicion.tipo}:${id || codigo || titulo}`,
    id,
    tipo: definicion.tipo,
    etiquetaTipo: definicion.etiqueta,
    titulo,
    subtitulo: texto(fila, definicion.claves.subtitulo),
    codigo,
    region: texto(fila, ['region']),
    icono: definicion.icono,
  };
}

/** Sobre paginado de un listado de entidad (`items`/`total`/`page`/`pageSize`). */
export function aColeccionGrupo(bruto: unknown, definicion: DefinicionGrupo): Coleccion<Resultado> {
  const base = normalizarColeccion<unknown>(bruto);
  return { ...base, elementos: base.elementos.map((fila) => aResultado(definicion, fila)) };
}

/**
 * índice `tipo:id → {codigo, region}` a partir de `GET /api/v1/search`.
 *
 * Es la única fuente de región de alertas, compromisos, documentos y demandas
 * (la heredan del caso) y del código de las demandas. La respuesta se limita a
 * 100 filas ordenadas por tipo: un término muy amplio puede dejar fuera filas
 * de los últimos grupos, que se quedan sin región.
 */
export function aIndiceBusqueda(bruto: unknown): IndiceBusqueda {
  const registro: Registro = esRegistro(bruto) ? bruto : {};
  const crudos = registro['results'];
  const indice = new Map<string, FilaIndice>();
  if (!Array.isArray(crudos)) return indice;

  for (const crudo of crudos) {
    if (!esRegistro(crudo)) continue;
    const tipo = (texto(crudo, ['type']) ?? '').toLowerCase();
    const id = texto(crudo, ['id']);
    if (!tipo || !id) continue;
    indice.set(`${tipo}:${id}`, {
      codigo: texto(crudo, ['code']),
      region: texto(crudo, ['region']),
    });
  }

  return indice;
}

/** Completa código y región con el índice; lo que no esté sigue en `null`. */
export function enriquecer(resultado: Resultado, indice: IndiceBusqueda): Resultado {
  const referencia = indice.get(`${resultado.tipo}:${resultado.id}`);
  if (!referencia) return resultado;

  const codigo = resultado.codigo ?? referencia.codigo;
  const region = resultado.region ?? referencia.region;
  if (codigo === resultado.codigo && region === resultado.region) return resultado;

  return { ...resultado, codigo, region };
}

/**
 * Destino del resultado: la ficha si existe y hay código; si no, el listado
 * del tipo prefiltrado con `q` para reencontrar la fila.
 */
export function aEnlace(
  definicion: DefinicionGrupo,
  resultado: Resultado,
  termino: string,
): ResultadoEnlazado {
  const ficha = definicion.ficha && resultado.codigo ? definicion.ficha(resultado.codigo) : null;

  if (ficha) {
    return { ...resultado, ruta: ficha, parametros: {}, abreFicha: true };
  }

  const filtro =
    definicion.filtroLista({ codigo: resultado.codigo, titulo: resultado.titulo }) ?? termino;

  return {
    ...resultado,
    ruta: definicion.listado,
    parametros: { q: filtro },
    abreFicha: false,
  };
}
