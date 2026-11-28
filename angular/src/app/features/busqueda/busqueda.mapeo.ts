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
 *
 * Territorio (cambio 30): `GET /api/v1/search` también publica `provincia`,
 * `distrito` y `ubigeo`, derivados del distrito propio del registro (alerta,
 * actor) o del distrito principal del caso. La ficha que se abre desde la
 * búsqueda los muestra cuando existen; los listados por entidad no los traen,
 * así que el índice es su única fuente.
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
  | 'casos'
  | 'alertas'
  | 'compromisos'
  | 'documentos'
  | 'actores'
  | 'demandas';

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
  /** Provincia derivada del distrito; `null` si no hay distrito conocido. */
  provincia: string | null;
  /** Distrito propio del registro o el principal de su caso; `null` si falta. */
  distrito: string | null;
  /** Ubigeo INEI de 6 dígitos del distrito; `null` si no hay distrito. */
  ubigeo: string | null;
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
  provincia: string | null;
  distrito: string | null;
  ubigeo: string | null;
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
  /** Ficha por ruta propia (path param). Sólo el caso la tiene hoy. */
  ficha?: (codigo: string) => string[];
  /**
   * Ficha propia abierta por query param (`?<parametro>=<identificador>`).
   * `campo` elige, del resultado ya normalizado, el identificador correcto para
   * el contrato de cada entidad: código para alertas, `id` para compromisos,
   * documentos y actores. Si falta, la fila cae al listado filtrado.
   */
  fichaIdentificador?: {
    ruta: readonly string[];
    parametro: string;
    campo: 'codigo' | 'id';
  };
  claves: Claves;
  /**
   * Valor de `q` con el que el listado vuelve a mostrar la fila. `null` cuando
   * el listado no busca por ese dato y conviene reenviar el término.
   */
  filtroLista: (fila: { codigo: string | null; titulo: string }) => string | null;
};

/**
 * Orden fijo de los grupos.
 *
 * El caso abre su detalle por ruta (`/casos/:codigo`). Alerta, compromiso,
 * documento y actor abren el panel lateral de su propia pantalla mediante el
 * contrato `?abrir=<identificador>` —ver `fichaIdentificador`—. Las demandas sin
 * caso no tienen ficha propia: enlazan a su listado filtrado por `q`.
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
    // La pantalla de alertas abre el panel por código (`AT-2026-37`), no por id.
    fichaIdentificador: { ruta: ['/alertas'], parametro: 'abrir', campo: 'codigo' },
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
    fichaIdentificador: { ruta: ['/compromisos'], parametro: 'abrir', campo: 'id' },
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
    fichaIdentificador: { ruta: ['/documentos'], parametro: 'abrir', campo: 'id' },
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
    // `id` es el `actor_uid` que la ficha del directorio usa como clave.
    fichaIdentificador: { ruta: ['/directorio', 'actores'], parametro: 'abrir', campo: 'id' },
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
    provincia: texto(fila, ['provincia']),
    distrito: texto(fila, ['distrito']),
    ubigeo: texto(fila, ['ubigeo', 'distritoUbigeo', 'distrito_ubigeo']),
    icono: definicion.icono,
  };
}

/** Sobre paginado de un listado de entidad (`items`/`total`/`page`/`pageSize`). */
export function aColeccionGrupo(bruto: unknown, definicion: DefinicionGrupo): Coleccion<Resultado> {
  const base = normalizarColeccion<unknown>(bruto);
  return { ...base, elementos: base.elementos.map((fila) => aResultado(definicion, fila)) };
}

/**
 * índice `tipo:id → {codigo, region, provincia, distrito, ubigeo}` a partir de
 * `GET /api/v1/search`.
 *
 * Es la única fuente de región y territorio de alertas, compromisos,
 * documentos y demandas (los heredan del caso) y del código de las demandas. La
 * respuesta se limita a 100 filas ordenadas por tipo: un término muy amplio
 * puede dejar fuera filas de los últimos grupos, que se quedan sin región ni
 * territorio.
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
      provincia: texto(crudo, ['provincia']),
      distrito: texto(crudo, ['distrito']),
      ubigeo: texto(crudo, ['ubigeo']),
    });
  }

  return indice;
}

/** Completa código, región y territorio con el índice; lo que falte sigue en `null`. */
export function enriquecer(resultado: Resultado, indice: IndiceBusqueda): Resultado {
  const referencia = indice.get(`${resultado.tipo}:${resultado.id}`);
  if (!referencia) return resultado;

  const codigo = resultado.codigo ?? referencia.codigo;
  const region = resultado.region ?? referencia.region;
  const provincia = resultado.provincia ?? referencia.provincia;
  const distrito = resultado.distrito ?? referencia.distrito;
  const ubigeo = resultado.ubigeo ?? referencia.ubigeo;

  const sinCambios =
    codigo === resultado.codigo &&
    region === resultado.region &&
    provincia === resultado.provincia &&
    distrito === resultado.distrito &&
    ubigeo === resultado.ubigeo;
  if (sinCambios) return resultado;

  return { ...resultado, codigo, region, provincia, distrito, ubigeo };
}

/**
 * Destino del resultado: la ficha propia si hay identificador con el que
 * abrirla; si no, el listado del tipo prefiltrado con `q` para reencontrar la
 * fila. Para las fichas por query param nunca se inventa el identificador: si
 * el resultado no lo trae, la fila se queda en el listado.
 */
export function aEnlace(
  definicion: DefinicionGrupo,
  resultado: Resultado,
  termino: string,
): ResultadoEnlazado {
  // Caso: la ficha es una ruta con el código en el path.
  if (definicion.ficha && resultado.codigo) {
    return {
      ...resultado,
      ruta: definicion.ficha(resultado.codigo),
      parametros: {},
      abreFicha: true,
    };
  }

  // Alerta, compromiso, documento y actor: ficha propia por `?abrir=`.
  const apertura = definicion.fichaIdentificador;
  if (apertura) {
    const identificador =
      apertura.campo === 'codigo' ? (resultado.codigo ?? null) : resultado.id || null;
    if (identificador) {
      return {
        ...resultado,
        ruta: [...apertura.ruta],
        parametros: { [apertura.parametro]: identificador },
        abreFicha: true,
      };
    }
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
