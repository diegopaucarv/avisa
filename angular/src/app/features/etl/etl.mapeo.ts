/**
 * Consola ETL: lectura del estado real de la ingesta.
 *
 * La pantalla no simula un motor de extracción. Lo que muestra sale de
 * `/api/v1/etl/resumen` (conteos por esquema, migraciones, catálogos y enlaces
 * de integración) y de `/api/v1/etl/ejecuciones` (historial de
 * `core.migracion_log`). Aquí viven los tipos espejo del contrato, la
 * normalización defensiva de la respuesta, los formatos de número y fecha de
 * esta vista y el inventario «Dónde aplica en AVISA» con su regla de estado.
 *
 * Nada de este archivo inventa datos: una tabla ausente se declara «no existe»
 * y una fecha nula se muestra como «—».
 */

import { normalizarColeccion, type Coleccion } from '../../core/http/coleccion';
import { esRegistro, lista, numero, texto } from '../../dominio/mapeo';
import { partesFecha } from '../../shared/formato-fecha';

/* ───────────────────────── tipos espejo del contrato ───────────────────── */

export type ConteoTabla = {
  tabla: string;
  filas: number;
};

export type ConteoEsquema = {
  esquema: string;
  totalTablas: number;
  totalFilas: number;
  tablas: ConteoTabla[];
};

export type EstadoMigraciones = {
  aplicadas: number;
  primera: string | null;
  ultima: string | null;
  ultimaClave: string | null;
};

export type TipoDocumento = {
  codigo: string;
  nombre: string;
  anexoNumero: number | null;
};

export type FormatoAdmitido = {
  extension: string;
  mime: string;
  nota: string | null;
};

export type PuntoIngesta = {
  codigo: string;
  descripcion: string;
  destino: string;
};

export type FuenteIntegracion = {
  sistema: string;
  enlaces: number;
  tipos: string[];
  protocolos: string[];
  estados: string[];
  ultimaSincronizacion: string | null;
};

export type ResumenEtl = {
  generadoEn: string | null;
  esquemas: ConteoEsquema[];
  tablasOmitidas: number;
  migraciones: EstadoMigraciones;
  catalogos: {
    tiposDocumento: TipoDocumento[];
    formatos: FormatoAdmitido[];
    puntosIngesta: PuntoIngesta[];
  };
  fuentesIntegracion: FuenteIntegracion[];
};

export type Ejecucion = {
  clave: string;
  /** Prefijo numérico de la clave (`58_…` → `58`); `null` si no lo tiene. */
  numero: string | null;
  aplicadaEn: string | null;
};

/* ─────────────────────────── normalización defensiva ───────────────────── */

function aConteoTabla(bruto: unknown): ConteoTabla | null {
  if (!esRegistro(bruto)) return null;
  const tabla = texto(bruto, ['tabla']);
  if (!tabla) return null;
  return { tabla, filas: numero(bruto, ['filas']) ?? 0 };
}

function aConteoEsquema(bruto: unknown): ConteoEsquema | null {
  if (!esRegistro(bruto)) return null;
  const esquema = texto(bruto, ['esquema']);
  if (!esquema) return null;

  const tablas = lista(bruto, ['tablas'])
    .map(aConteoTabla)
    .filter((tabla): tabla is ConteoTabla => tabla !== null);

  return {
    esquema,
    totalTablas: numero(bruto, ['totalTablas']) ?? tablas.length,
    totalFilas:
      numero(bruto, ['totalFilas']) ?? tablas.reduce((suma, tabla) => suma + tabla.filas, 0),
    tablas,
  };
}

function aEstadoMigraciones(bruto: unknown): EstadoMigraciones {
  if (!esRegistro(bruto)) {
    return { aplicadas: 0, primera: null, ultima: null, ultimaClave: null };
  }

  return {
    aplicadas: numero(bruto, ['aplicadas']) ?? 0,
    primera: texto(bruto, ['primera']),
    ultima: texto(bruto, ['ultima']),
    ultimaClave: texto(bruto, ['ultimaClave']),
  };
}

function aTipoDocumento(bruto: unknown): TipoDocumento | null {
  if (!esRegistro(bruto)) return null;
  const codigo = texto(bruto, ['codigo']);
  if (!codigo) return null;
  return {
    codigo,
    nombre: texto(bruto, ['nombre']) ?? codigo,
    anexoNumero: numero(bruto, ['anexoNumero']),
  };
}

function aFormato(bruto: unknown): FormatoAdmitido | null {
  if (!esRegistro(bruto)) return null;
  const extension = texto(bruto, ['extension']);
  if (!extension) return null;
  return {
    extension,
    mime: texto(bruto, ['mime']) ?? '',
    nota: texto(bruto, ['nota']),
  };
}

function aPuntoIngesta(bruto: unknown): PuntoIngesta | null {
  if (!esRegistro(bruto)) return null;
  const codigo = texto(bruto, ['codigo']);
  if (!codigo) return null;
  return {
    codigo,
    descripcion: texto(bruto, ['descripcion']) ?? '',
    destino: texto(bruto, ['destino']) ?? '',
  };
}

function aFuente(bruto: unknown): FuenteIntegracion | null {
  if (!esRegistro(bruto)) return null;
  const sistema = texto(bruto, ['sistema']);
  if (!sistema) return null;

  const textos = (clave: string): string[] =>
    lista(bruto, [clave]).filter((valor): valor is string => typeof valor === 'string' && !!valor);

  return {
    sistema,
    enlaces: numero(bruto, ['enlaces']) ?? 0,
    tipos: textos('tipos'),
    protocolos: textos('protocolos'),
    estados: textos('estados'),
    ultimaSincronizacion: texto(bruto, ['ultimaSincronizacion']),
  };
}

function filtrar<T>(elementos: (T | null)[]): T[] {
  return elementos.filter((elemento): elemento is T => elemento !== null);
}

/** Sobre de `GET /api/v1/etl/resumen`. Un cuerpo inválido deja la vista vacía. */
export function aResumen(bruto: unknown): ResumenEtl {
  const catalogo = esRegistro(bruto) && esRegistro(bruto['catalogos']) ? bruto['catalogos'] : null;

  return {
    generadoEn: esRegistro(bruto) ? texto(bruto, ['generadoEn', 'generatedAt']) : null,
    esquemas: esRegistro(bruto) ? filtrar(lista(bruto, ['esquemas']).map(aConteoEsquema)) : [],
    tablasOmitidas: esRegistro(bruto) ? (numero(bruto, ['tablasOmitidas']) ?? 0) : 0,
    migraciones: aEstadoMigraciones(esRegistro(bruto) ? bruto['migraciones'] : null),
    catalogos: {
      tiposDocumento: catalogo
        ? filtrar(lista(catalogo, ['tiposDocumento']).map(aTipoDocumento))
        : [],
      formatos: catalogo ? filtrar(lista(catalogo, ['formatos']).map(aFormato)) : [],
      puntosIngesta: catalogo ? filtrar(lista(catalogo, ['puntosIngesta']).map(aPuntoIngesta)) : [],
    },
    fuentesIntegracion: esRegistro(bruto)
      ? filtrar(lista(bruto, ['fuentesIntegracion']).map(aFuente))
      : [],
  };
}

function aEjecucion(bruto: unknown): Ejecucion {
  if (!esRegistro(bruto)) return { clave: '', numero: null, aplicadaEn: null };

  const clave = texto(bruto, ['clave']) ?? '';
  const prefijo = /^(\d+)_/.exec(clave);

  return {
    clave,
    numero: prefijo?.[1] ?? null,
    aplicadaEn: texto(bruto, ['aplicadaEn', 'aplicada_en']),
  };
}

/** Sobre paginado de `GET /api/v1/etl/ejecuciones`, ya en claves españolas. */
export function aEjecucionColeccion(bruto: unknown): Coleccion<Ejecucion> {
  const base = normalizarColeccion<unknown>(bruto);
  return { ...base, elementos: base.elementos.map(aEjecucion) };
}

/* ────────────────────────────── formatos ───────────────────────────────── */

const AGRUPACION_MILES = /\B(?=(\d{3})+(?!\d))/g;

function dosDigitos(valor: number): string {
  return String(valor).padStart(2, '0');
}

/**
 * Entero con espacio fino como separador de miles (`1160` → `1 160`), el uso
 * de la documentación del proyecto. Sin dato → `—`.
 */
export function formatearNumero(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return '—';
  const signo = valor < 0 ? '-' : '';
  const entero = Math.abs(Math.trunc(valor)).toString().replace(AGRUPACION_MILES, '\u2009');
  return `${signo}${entero}`;
}

/** `2026-11-24` → `24/11/2026`; sin fecha → `—`. */
export function formatearFechaDdMmAaaa(valor: string | null | undefined): string {
  const partes = partesFecha(valor);
  if (!partes) return '—';
  const [anio, mes, dia] = partes;
  return `${dosDigitos(dia)}/${dosDigitos(mes)}/${anio}`;
}

/**
 * `2026-11-24T20:32:46.804Z` → `24/11/2026 15:32` en hora local del navegador.
 * Si el valor no es un instante válido, cae al formato de sola fecha.
 */
export function formatearFechaHoraDdMmAaaa(valor: string | null | undefined): string {
  if (!valor) return '—';

  const fecha = new Date(valor);
  if (!Number.isNaN(fecha.getTime())) {
    const partes = `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}-${dosDigitos(
      fecha.getDate(),
    )}`;
    return `${formatearFechaDdMmAaaa(partes)} ${dosDigitos(fecha.getHours())}:${dosDigitos(
      fecha.getMinutes(),
    )}`;
  }

  return formatearFechaDdMmAaaa(valor);
}

/* ───────────────────────── etiquetas de integración ────────────────────── */

export function etiquetaSentido(valor: string): string {
  switch (valor.trim().toLowerCase()) {
    case 'pull':
      return 'Entrada (pull)';
    case 'push':
      return 'Salida (push)';
    default:
      return valor;
  }
}

export function etiquetaProtocolo(valor: string): string {
  switch (valor.trim().toLowerCase()) {
    case 'api_rest_pide':
      return 'API REST (PIDE)';
    case 'batch_sftp':
      return 'Lote por SFTP';
    case 'oficio_manual':
      return 'Oficio manual';
    default:
      return valor;
  }
}

export function etiquetaEstadoIntegracion(valor: string): string {
  switch (valor.trim().toLowerCase()) {
    case 'activa':
      return 'Activa';
    case 'pendiente_auth':
      return 'Pendiente de autorización';
    default:
      return valor;
  }
}

export type TonoDato = 'ok' | 'warn' | 'bad' | 'nodata';

export function tonoEstadoIntegracion(valor: string): TonoDato {
  switch (valor.trim().toLowerCase()) {
    case 'activa':
      return 'ok';
    case 'pendiente_auth':
      return 'warn';
    default:
      return 'nodata';
  }
}

export function etiquetaDestinoIngesta(valor: string): string {
  switch (valor.trim().toLowerCase()) {
    case 'core':
      return 'Core';
    case 'qda':
      return 'QDA';
    case 'lex':
      return 'LEX';
    case 'kag':
      return 'KAG';
    case 'ind':
      return 'IND';
    default:
      return valor;
  }
}

/* ─────────────────── inventario «Dónde aplica en AVISA» ────────────────── */

export type OrigenMaterial = 'texto' | 'archivo' | 'planilla';
export type DestinoPrincipal = 'caso' | 'alerta' | 'reunion' | 'actor';

export type OpcionOrigen = { clave: OrigenMaterial; etiqueta: string };
export type OpcionDestino = { clave: DestinoPrincipal; etiqueta: string };

export const ORIGENES_MATERIAL: readonly OpcionOrigen[] = [
  { clave: 'texto', etiqueta: 'Texto pegado' },
  { clave: 'archivo', etiqueta: 'Archivo' },
  { clave: 'planilla', etiqueta: 'Planilla' },
];

export const DESTINOS_PRINCIPALES: readonly OpcionDestino[] = [
  { clave: 'caso', etiqueta: 'Caso' },
  { clave: 'alerta', etiqueta: 'Alerta' },
  { clave: 'reunion', etiqueta: 'Reunión' },
  { clave: 'actor', etiqueta: 'Actor' },
];

/** Tablas donde caería cada destino principal, con su esquema. */
export const TABLAS_POR_DESTINO: Record<DestinoPrincipal, readonly string[]> = {
  caso: ['core.casos', 'core.caso_cronologia'],
  alerta: ['core.alertas_tempranas'],
  reunion: ['core.reuniones_dialogo', 'core.reunion_participantes'],
  actor: ['core.actores'],
};

export type TokenDestino = { tipo: 'texto' | 'codigo'; valor: string };

export type FilaDestino = {
  clave: string;
  entrada: string;
  produce: string;
  destino: readonly TokenDestino[];
  /** Tablas que deciden el estado del dato. */
  claves: readonly string[];
  /** La fila no es un destino directo: se consulta en otra pantalla. */
  parcial?: boolean;
};

const t = (valor: string): TokenDestino => ({ tipo: 'texto', valor });
const c = (valor: string): TokenDestino => ({ tipo: 'codigo', valor });

/**
 * Las diez entradas largas que hoy existen en AVISA, en el orden del mockup.
 * `claves` son las tablas cuyo conteo real decide el estado; para «Reunión» se
 * miran las reuniones y sus participantes, no los compromisos, que ya tienen su
 * propia fila.
 */
export const DESTINOS: readonly FilaDestino[] = [
  {
    clave: 'cronologia',
    entrada: 'Narración cronológica del caso (texto de párrafos)',
    produce: 'Hechos fechados, uno por fila',
    destino: [
      c('core.caso_cronologia'),
      t(': '),
      c('fecha_evento'),
      t(', '),
      c('descripcion_hecho'),
      t(', '),
      c('tipo_hecho_id'),
    ],
    claves: ['core.caso_cronologia'],
  },
  {
    clave: 'riesgo',
    entrada: 'Descripción del riesgo y resumen del caso',
    produce: 'Riesgo, factores y nivel declarado',
    destino: [
      c('core.casos.descripcion_riesgo'),
      t(', '),
      c('resumen_ejecutivo'),
      t(', '),
      c('caso_factores'),
    ],
    claves: ['core.casos', 'core.caso_factores'],
  },
  {
    clave: 'documento',
    entrada: 'Informe u oficio en PDF',
    produce: 'Documento y, de ahí, caso, demandas e hitos',
    destino: [
      c('core.documentos'),
      t(': '),
      c('tipo_id'),
      t(', '),
      c('url_pdf'),
      t(', '),
      c('resumen_ejecutivo'),
    ],
    claves: ['core.documentos'],
  },
  {
    clave: 'alerta',
    entrada: 'Reporte rápido o insumo de alerta',
    produce: 'Alerta con situación, riesgos y acciones',
    destino: [
      c('core.alertas_tempranas'),
      t(': '),
      c('situacion_actual'),
      t(', '),
      c('riesgos_json'),
      t(', '),
      c('acciones_sugeridas_json'),
    ],
    claves: ['core.alertas_tempranas'],
  },
  {
    clave: 'acta',
    entrada: 'Acta, ayuda memoria o relatoría',
    produce: 'Reunión, participantes y compromisos',
    destino: [
      c('core.reuniones_dialogo'),
      t(', '),
      c('reunion_participantes'),
      t(', '),
      c('core.compromisos'),
    ],
    claves: ['core.reuniones_dialogo', 'core.reunion_participantes'],
  },
  {
    clave: 'compromiso',
    entrada: 'Compromiso redactado en prosa',
    produce: 'Compromiso con criterios y sus hitos',
    destino: [
      c('core.compromisos.accion_compromiso'),
      t(', '),
      c('criterios_smart'),
      t(', '),
      c('core.hitos_compromiso'),
    ],
    claves: ['core.compromisos', 'core.hitos_compromiso'],
  },
  {
    clave: 'actor',
    entrada: 'Lista de asistencia o padrón de un oficio',
    produce: 'Actores con cargo, organización y contacto',
    destino: [
      c('core.actores'),
      t(': '),
      c('nombre_actual'),
      t(', '),
      c('cargo_actual'),
      t(', '),
      c('organizacion_ancla_uid'),
    ],
    claves: ['core.actores'],
  },
  {
    clave: 'matriz',
    entrada: 'Matriz del equipo en Excel',
    produce: 'Acciones e hitos por caso',
    destino: [c('core.compromisos'), t(' + '), c('core.hitos_compromiso')],
    claves: ['core.compromisos', 'core.hitos_compromiso'],
    parcial: true,
  },
  {
    clave: 'fragmento',
    entrada: 'Documento largo que hay que trocear',
    produce: 'Fragmentos con página y offset',
    destino: [c('core.documento_fragmento')],
    claves: ['core.documento_fragmento'],
  },
  {
    clave: 'plantilla',
    entrada: 'Plantillas de redacción institucional',
    produce: 'Texto base para ayuda memoria y relatoría',
    destino: [c('legacy.dim_redaccion')],
    claves: ['legacy.dim_redaccion'],
  },
];

export type ConteoIndexado = {
  esquema: string;
  tabla: string;
  filas: number;
};

export type EstadoDato = {
  tono: TonoDato;
  etiqueta: string;
  detalle: string | null;
};

/** Índice `esquema.tabla` → conteo, a partir del resumen ya normalizado. */
export function conteosPorClave(resumen: ResumenEtl | undefined): Map<string, ConteoIndexado> {
  const mapa = new Map<string, ConteoIndexado>();

  for (const esquema of resumen?.esquemas ?? []) {
    for (const tabla of esquema.tablas) {
      mapa.set(`${esquema.esquema}.${tabla.tabla}`, {
        esquema: esquema.esquema,
        tabla: tabla.tabla,
        filas: tabla.filas,
      });
    }
  }

  return mapa;
}

/** Conteo real de las tablas de un destino principal; `null` si no existe. */
export function conteosDeDestino(
  destino: DestinoPrincipal,
  mapa: Map<string, ConteoIndexado>,
): { clave: string; filas: number | null }[] {
  return TABLAS_POR_DESTINO[destino].map((clave) => ({
    clave,
    filas: mapa.get(clave)?.filas ?? null,
  }));
}

function nombreCorto(clave: string): string {
  return clave.slice(clave.indexOf('.') + 1);
}

function listaFilas(filas: number[]): string {
  if (filas.length === 1) return formatearNumero(filas[0]);
  return filas.map((fila) => formatearNumero(fila)).join(' y ');
}

/**
 * Estado del dato de una fila del inventario, calculado con los conteos reales.
 *
 * Reglas, en orden:
 * 1. Si las claves son de `legacy`, se informan como filas sin cargar.
 * 2. Si ninguna tabla existe en los conteos → «no existe».
 * 3. Si falta alguna tabla de `core` → «incompleto» con el número que falta.
 * 4. Si la fila se resuelve en otra pantalla → «parcial».
 * 5. Todo en cero → «existe vacía».
 * 6. Alguna tabla vacía → «existe» y se nombra la vacía.
 * 7. En otro caso → «existe» con las filas reales.
 */
export function estadoDestino(fila: FilaDestino, mapa: Map<string, ConteoIndexado>): EstadoDato {
  const deCore = fila.claves.filter((clave) => clave.startsWith('core.'));
  const deLegacy = fila.claves.filter((clave) => clave.startsWith('legacy.'));

  if (deCore.length === 0 && deLegacy.length > 0) {
    const encontradas = deLegacy
      .map((clave) => mapa.get(clave))
      .filter((conteo): conteo is ConteoIndexado => conteo !== undefined);

    if (encontradas.length === 0) {
      return { tono: 'bad', etiqueta: 'no existe', detalle: null };
    }

    const total = encontradas.reduce((suma, conteo) => suma + conteo.filas, 0);
    if (total === 0) {
      return { tono: 'nodata', etiqueta: 'existe vacía en legacy', detalle: '0 filas' };
    }

    return {
      tono: 'warn',
      etiqueta: `${formatearNumero(total)} filas en legacy`,
      detalle: 'no cargadas en core',
    };
  }

  const encontradas = deCore
    .map((clave) => mapa.get(clave))
    .filter((conteo): conteo is ConteoIndexado => conteo !== undefined);

  if (encontradas.length === 0) {
    return { tono: 'bad', etiqueta: 'no existe', detalle: null };
  }

  if (encontradas.length < deCore.length) {
    const faltan = deCore.length - encontradas.length;
    return {
      tono: 'nodata',
      etiqueta: `incompleto`,
      detalle: `falta${faltan === 1 ? '' : 'n'} ${faltan} tabla${faltan === 1 ? '' : 's'}`,
    };
  }

  if (fila.parcial) {
    return { tono: 'warn', etiqueta: 'parcial', detalle: 'se revisa en la matriz del caso' };
  }

  const total = encontradas.reduce((suma, conteo) => suma + conteo.filas, 0);
  if (total === 0) {
    return { tono: 'warn', etiqueta: 'existe vacía', detalle: '0 filas' };
  }

  const vacias = encontradas.filter((conteo) => conteo.filas === 0);
  if (vacias.length > 0) {
    return {
      tono: 'ok',
      etiqueta: 'existe',
      detalle: `${vacias.map((conteo) => nombreCorto(conteo.tabla)).join(' y ')} vacía`,
    };
  }

  return {
    tono: 'ok',
    etiqueta: 'existe',
    detalle: `${listaFilas(encontradas.map((conteo) => conteo.filas))} filas`,
  };
}
