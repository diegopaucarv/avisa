import { normalizarColeccion } from '../../core/http/coleccion';
import { esRegistro, leer, numero, texto } from '../../dominio/mapeo';
import { partesFecha } from '../../shared/formato-fecha';

/**
 * Contrato de lectura y presentación de la matriz de conflictividad (Anexo 15).
 *
 * La API entrega las filas en camelCase (`codigoCaso`, `nivelConflictividad`, …)
 * y un sobre paginado con `items`/`total`/`resumen`. Este archivo es el único
 * punto donde ese sobre se traduce: la página nunca lee claves crudas.
 *
 * Regla de producto: el nivel **manifiesto** es `Conflicto social` o
 * `Crisis social`; todo lo demás —incluido el caso sin nivel declarado— es
 * **latente**. La regla se replica aquí para la interfaz, pero los conteos
 * oficiales llegan calculados del servidor (`resumen`).
 */

export type FilaConflictividad = {
  codigoCaso: string;
  nombreCaso: string | null;
  region: string | null;
  alcance: string | null;
  subsector: string | null;
  nivelConflictividad: string | null;
  nivelRiesgo: string | null;
  prioridadAtencion: string | null;
  estado: string | null;
  unidadResponsable: string | null;
  /** `YYYY-MM-DD` o `null` si el caso no tiene `fecha_inicio`. */
  fechaInicio: string | null;
  /** `YYYY-MM-DD` del último hecho no anulado, o `null`. */
  ultimoHecho: string | null;
  /** Compromisos no anulados. `0` es un conteo real, no un hueco. */
  compromisos: number;
  /** Tipos distintos de compromiso, o `null` cuando no hay compromisos. */
  tipoCompromiso: string | null;
  /** Documentos no anulados vinculados al caso. `0` es un conteo real. */
  documentos: number;
};

/** Fila del Anexo 15 más las cinco columnas que sólo se muestran en el detalle. */
export type DetalleConflictividad = FilaConflictividad & {
  descripcionRiesgo: string | null;
  narracionCronologica: string | null;
  alertasVinculadas: string | null;
  actoresInvolucrados: string | null;
  puntoFocal: string | null;
};

export type ResumenConflictividad = {
  total: number;
  /** Nivel `Conflicto social` o `Crisis social`. */
  manifiestos: number;
  /** Todo lo demás, incluido el caso sin nivel declarado. */
  latentes: number;
  /** Filas sin `nivel_conflicto` (quedan dentro de `latentes`). */
  sinNivel: number;
};

export type ListaConflictividad = {
  elementos: FilaConflictividad[];
  total: number;
  pagina: number;
  tamanoPagina: number;
  resumen: ResumenConflictividad;
  generadoEn: string | null;
};

export type Opcion = { valor: string; etiqueta: string };

export type CatalogosConflictividad = {
  regiones: Opcion[];
  alcances: Opcion[];
  subsectores: Opcion[];
  prioridades: Opcion[];
  niveles: Opcion[];
  estados: Opcion[];
};

/** Filtros de la pantalla. Los vacíos no viajan a la API. */
export type FiltrosMatriz = {
  q: string;
  region: string;
  alcance: string;
  subsector: string;
  estado: string;
  /** `manifiesto`, `latente` o un nivel exacto del catálogo. */
  nivel: string;
  prioridad: string;
  /** `YYYY-MM-DD`, inclusive. */
  desde: string;
  /** `YYYY-MM-DD`, inclusive. */
  hasta: string;
  /** `inicio` (defecto), `codigo`, `riesgo` o `prioridad`. */
  orden: string;
};

/**
 * Órdenes canónicos para los desplegables. El catálogo ya trae su propio
 * `orden`, pero se fija aquí el orden de lectura de la Guía para que dos
 * catálogos con la misma etiqueta nunca se muestren en orden distinto.
 */
export const ORDEN_ESTADOS: readonly string[] = ['Abierto', 'Resuelto', 'Archivado'];
export const ORDEN_NIVELES: readonly string[] = [
  'Diferencia',
  'Controversia',
  'Conflicto social',
  'Crisis social',
];
export const ORDEN_ALCANCES: readonly string[] = ['Norte', 'Centro', 'Sur', 'Oriente', 'Nacional'];
/** «Medio» desde la migración 53; «Moderado» se acepta como legado. */
export const ORDEN_PRIORIDADES: readonly string[] = ['Urgente', 'Medio', 'Moderado', 'Bajo'];

export const RESUMEN_VACIO: ResumenConflictividad = {
  total: 0,
  manifiestos: 0,
  latentes: 0,
  sinNivel: 0,
};

export const CATALOGOS_VACIOS: CatalogosConflictividad = {
  regiones: [],
  alcances: [],
  subsectores: [],
  prioridades: [],
  niveles: [],
  estados: [],
};

function aFila(bruto: unknown): FilaConflictividad {
  const fila = esRegistro(bruto) ? bruto : {};

  return {
    codigoCaso: texto(fila, ['codigoCaso', 'codigo_caso']) ?? '',
    nombreCaso: texto(fila, ['nombreCaso', 'nombre_caso']),
    region: texto(fila, ['region']),
    alcance: texto(fila, ['alcance']),
    subsector: texto(fila, ['subsector']),
    nivelConflictividad: texto(fila, ['nivelConflictividad', 'nivel_conflicto']),
    nivelRiesgo: texto(fila, ['nivelRiesgo', 'nivel_riesgo']),
    prioridadAtencion: texto(fila, ['prioridadAtencion', 'prioridad_atencion']),
    estado: texto(fila, ['estado']),
    unidadResponsable: texto(fila, ['unidadResponsable', 'unidad_responsable']),
    fechaInicio: texto(fila, ['fechaInicio', 'fecha_inicio']),
    ultimoHecho: texto(fila, ['ultimoHecho', 'ultimo_hecho']),
    compromisos: numero(fila, ['compromisos']) ?? 0,
    tipoCompromiso: texto(fila, ['tipoCompromiso', 'tipo_compromiso']),
    documentos: numero(fila, ['documentos']) ?? 0,
  };
}

function aResumen(entrada: unknown, filas: readonly FilaConflictividad[]): ResumenConflictividad {
  const registro = esRegistro(entrada) ? entrada : {};
  const total = numero(registro, ['total']);

  // Si la API no manda el resumen, se deriva de las filas recibidas. Nunca se
  // inventa una cifra: con `filas` vacías el resultado queda en cero.
  if (total === null) {
    let manifiestos = 0;
    let sinNivel = 0;
    for (const fila of filas) {
      if (!fila.nivelConflictividad) sinNivel += 1;
      if (agrupacionNivel(fila.nivelConflictividad) === 'manifiesto') manifiestos += 1;
    }
    return {
      total: filas.length,
      manifiestos,
      latentes: filas.length - manifiestos,
      sinNivel,
    };
  }

  return {
    total,
    manifiestos: numero(registro, ['manifiestos']) ?? 0,
    latentes: numero(registro, ['latentes']) ?? 0,
    sinNivel: numero(registro, ['sinNivel', 'sin_nivel']) ?? 0,
  };
}

/** Sobre del listado paginado (o de la vista imprimible, sin paginar). */
export function aLista(bruto: unknown): ListaConflictividad {
  const coleccion = normalizarColeccion<unknown>(bruto);
  const elementos = coleccion.elementos.map(aFila);
  const registro = esRegistro(bruto) ? bruto : {};

  return {
    elementos,
    total: coleccion.total,
    pagina: coleccion.pagina,
    tamanoPagina: coleccion.tamanoPagina,
    resumen: aResumen(leer(registro, ['resumen']), elementos),
    generadoEn: coleccion.generadoEn,
  };
}

/** Ficha de una fila; `null` cuando la respuesta no trae el caso. */
export function aDetalle(bruto: unknown): DetalleConflictividad | null {
  if (!esRegistro(bruto)) return null;

  const fila = aFila(bruto);
  if (!fila.codigoCaso) return null;

  return {
    ...fila,
    descripcionRiesgo: texto(bruto, ['descripcionRiesgo', 'descripcion_riesgo']),
    narracionCronologica: texto(bruto, ['narracionCronologica', 'narracion_cronologica']),
    alertasVinculadas: texto(bruto, ['alertasVinculadas', 'alertas_vinculadas']),
    actoresInvolucrados: texto(bruto, ['actoresInvolucrados', 'actores_involucrados']),
    puntoFocal: texto(bruto, ['puntoFocal', 'punto_focal']),
  };
}

function opcionesDe(catalogo: Record<string, unknown>, clave: string): Opcion[] {
  const crudo = leer(catalogo, [clave]);
  if (!Array.isArray(crudo)) return [];

  const opciones: Opcion[] = [];
  for (const item of crudo) {
    const fila = esRegistro(item) ? item : {};
    const valor = texto(fila, ['codigo', 'valor', 'nombre']);
    const etiqueta = texto(fila, ['etiqueta', 'nombre']) ?? valor;
    if (valor && etiqueta) opciones.push({ valor, etiqueta });
  }
  return opciones;
}

/** Ordena por la lista canónica; lo que no está en la lista queda al final. */
function porOrden(opciones: Opcion[], orden: readonly string[]): Opcion[] {
  if (orden.length === 0) return opciones;

  const indice = new Map(orden.map((valor, posicion) => [valor.toLowerCase(), posicion]));

  return [...opciones].sort((a, b) => {
    const posicionA = indice.get(a.etiqueta.toLowerCase()) ?? indice.get(a.valor.toLowerCase());
    const posicionB = indice.get(b.etiqueta.toLowerCase()) ?? indice.get(b.valor.toLowerCase());
    const pesoA = posicionA ?? orden.length;
    const pesoB = posicionB ?? orden.length;
    if (pesoA !== pesoB) return pesoA - pesoB;
    return a.etiqueta.localeCompare(b.etiqueta, 'es');
  });
}

/** `GET /api/v1/catalogs` reducido a los desplegables de la matriz. */
export function aCatalogos(bruto: unknown): CatalogosConflictividad {
  const registro = esRegistro(bruto) ? bruto : {};
  const crudo = leer(registro, ['catalogs', 'catalogos']);
  const catalogo = esRegistro(crudo) ? crudo : {};

  return {
    regiones: porOrden(opcionesDe(catalogo, 'regiones'), []),
    alcances: porOrden(opcionesDe(catalogo, 'alcances'), ORDEN_ALCANCES),
    subsectores: porOrden(opcionesDe(catalogo, 'subsectores'), []),
    prioridades: porOrden(opcionesDe(catalogo, 'prioridadesAtencion'), ORDEN_PRIORIDADES),
    niveles: porOrden(opcionesDe(catalogo, 'nivelesConflicto'), ORDEN_NIVELES),
    estados: porOrden(opcionesDe(catalogo, 'estadosCaso'), ORDEN_ESTADOS),
  };
}

/** `2026-05-01` → `01/05/2026`; sin fecha → `—`. */
export function formatearFechaDdMmAaaa(valor: string | null | undefined): string {
  const partes = partesFecha(valor);
  if (!partes) return '—';

  const [anio, mes, dia] = partes;
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${anio}`;
}

/** Texto visible de una celda; faltante = `—`, nunca un cero ni un texto estimado. */
export function textoOSinDato(valor: string | null | undefined): string {
  if (valor === null || valor === undefined) return '—';
  const limpio = valor.trim();
  return limpio ? limpio : '—';
}

/**
 * Regla de producto del nivel: `Conflicto social` y `Crisis social` son
 * manifiestos; el resto —incluido el caso sin nivel— es latente.
 */
export function agrupacionNivel(nivel: string | null | undefined): 'manifiesto' | 'latente' {
  const limpio = (nivel ?? '').trim().toLowerCase();
  return limpio === 'conflicto social' || limpio === 'crisis social' ? 'manifiesto' : 'latente';
}

export function claseNivel(nivel: string | null | undefined): string {
  switch ((nivel ?? '').trim().toLowerCase()) {
    case 'diferencia':
      return 'nivel-diferencia';
    case 'controversia':
      return 'nivel-controversia';
    case 'conflicto social':
      return 'nivel-conflicto';
    case 'crisis social':
      return 'nivel-crisis';
    default:
      return 'nivel-sin-dato';
  }
}

export function claseRiesgo(riesgo: string | null | undefined): string {
  switch ((riesgo ?? '').trim().toLowerCase()) {
    case 'alto':
      return 'riesgo-alto';
    case 'moderado':
    case 'medio':
      return 'riesgo-moderado';
    case 'bajo':
      return 'riesgo-bajo';
    default:
      return 'riesgo-sin-dato';
  }
}

export function clasePrioridad(prioridad: string | null | undefined): string {
  switch ((prioridad ?? '').trim().toLowerCase()) {
    case 'urgente':
      return 'prioridad-urgente';
    case 'moderado':
    case 'medio':
      return 'prioridad-moderado';
    case 'bajo':
      return 'prioridad-bajo';
    default:
      return 'prioridad-sin-dato';
  }
}

export function claseEstado(estado: string | null | undefined): string {
  switch ((estado ?? '').trim().toLowerCase()) {
    case 'abierto':
      return 'estado-abierto';
    case 'resuelto':
      return 'estado-resuelto';
    case 'archivado':
      return 'estado-archivado';
    default:
      return 'estado-sin-dato';
  }
}
