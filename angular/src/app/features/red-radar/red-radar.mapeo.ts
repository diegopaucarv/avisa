import { esRegistro, lista, numero, texto, type Registro } from '../../dominio/mapeo';
import { partesFecha } from '../../shared/formato-fecha';

/**
 * Contrato de lectura de la bandeja RED-RADAR.
 *
 * La cola trabaja sobre `core.alertas_tempranas`: no existe tabla de señales ni
 * conector. Todo lo que la base no declara se marca «sin dato» en la vista; aquí
 * sólo se normaliza lo que llega, sin rellenar huecos.
 */

export type EstadoTriaje = 'pendiente' | 'en_triage' | 'confirmada' | 'descartada' | 'duplicada';

export const ORDEN_ESTADOS: readonly EstadoTriaje[] = [
  'pendiente',
  'en_triage',
  'confirmada',
  'descartada',
  'duplicada',
];

export const ETIQUETAS_ESTADO: Record<EstadoTriaje, string> = {
  pendiente: 'Pendiente',
  en_triage: 'En triaje',
  confirmada: 'Confirmada',
  descartada: 'Descartada',
  duplicada: 'Duplicada',
};

/** Clases de etiqueta del mockup (`t-pend`, `t-triage`, `t-conv`, `t-desc`, `t-dup`). */
export const CLASE_ESTADO: Record<EstadoTriaje, string> = {
  pendiente: 't-pend',
  en_triage: 't-triage',
  confirmada: 't-conv',
  descartada: 't-desc',
  duplicada: 't-dup',
};

export type OpcionFiltroEstado = {
  valor: EstadoTriaje | 'todas';
  etiqueta: string;
};

export const OPCIONES_FILTRO: readonly OpcionFiltroEstado[] = [
  { valor: 'todas', etiqueta: 'Todas' },
  { valor: 'pendiente', etiqueta: 'Pendientes' },
  { valor: 'en_triage', etiqueta: 'En triaje' },
  { valor: 'confirmada', etiqueta: 'Confirmadas' },
  { valor: 'descartada', etiqueta: 'Descartadas' },
  { valor: 'duplicada', etiqueta: 'Duplicadas' },
];

export function esEstadoTriaje(valor: string | null): valor is EstadoTriaje {
  return (ORDEN_ESTADOS as readonly string[]).includes(valor ?? '');
}

/**
 * «Señal» de la cola. La fila ya es una alerta temprana: el tipo de señal no
 * existe como catálogo y el código es el de la alerta, no el de una señal.
 */
export type SenalVista = {
  id: string;
  codigo: string;
  extracto: string | null;
  /** `YYYY-MM-DD` tal como lo emite la API. */
  fecha: string | null;
  /** `dd/mm/aaaa`; `—` si no hay fecha. */
  fechaTexto: string;
  distrito: string | null;
  distritoId: number | null;
  ubigeo: string | null;
  distritoRuta: string | null;
  provincia: string | null;
  region: string | null;
  prioridad: string | null;
  nivel: string | null;
  casoCodigo: string | null;
  situacion: string | null;
  descripcionRiesgo: string | null;
  riesgos: string[];
  accionesSugeridas: string[];
  fuenteTipo: string | null;
  fuenteDescripcion: string | null;
  fuenteUrl: string | null;
  clasificacion: number;
  estado: EstadoTriaje;
  motivo: string | null;
  duplicadaDe: string | null;
  triadoPor: string | null;
  triadoEn: string | null;
};

export type ConteosCola = {
  total: number;
  pendiente: number;
  en_triage: number;
  confirmada: number;
  descartada: number;
  duplicada: number;
};

export type FuenteCola = {
  /** `null` mientras no exista conector ni tabla de señales. */
  senalesRecibidas: number | null;
  conFuenteRadar: number;
};

export type ColaRedRadar = {
  elementos: SenalVista[];
  total: number;
  pagina: number;
  tamanoPagina: number;
  conteos: ConteosCola;
  fuente: FuenteCola;
  hoy: string | null;
};

export type DetalleRedRadar = {
  senal: SenalVista;
};

export type OpcionRegion = { id: number; nombre: string };

export type TriajeCambios = {
  estado: EstadoTriaje;
  motivo?: string;
  duplicadaDeCodigo?: string;
};

/* ------------------------------------------------------------------------- *
 * Fechas
 * ------------------------------------------------------------------------- */

function dosDigitos(valor: number): string {
  return String(valor).padStart(2, '0');
}

/**
 * `2026-11-04` → `04/11/2026`. Es el formato que exige esta pantalla; el resto
 * de la SPA usa `04NOV2026` (`formatearFecha`), por eso no se reutiliza.
 */
export function fechaDdMmAaaa(valor: string | null | undefined): string {
  const partes = partesFecha(valor);
  if (!partes) return '—';
  const [anio, mes, dia] = partes;
  return `${dosDigitos(dia)}/${dosDigitos(mes)}/${anio}`;
}

/* ------------------------------------------------------------------------- *
 * Extracto y sugerencias
 * ------------------------------------------------------------------------- */

/**
 * El título de la alerta puede traer el membrete del reporte de campo
 * («REPORTE DE ALERTA TEMPRANA | …»). Se quita para que la columna muestre el
 * hecho, no el membrete. Si no hay prefijo se conserva el texto íntegro.
 */
export function limpiarExtracto(titulo: string | null, respaldo: string | null): string | null {
  const base = titulo ?? respaldo;
  if (!base) return null;
  const limpio = base.replace(/^\s*\W*REPORTE DE ALERTA TEMPRANA\s*[|:]\s*/i, '').trim();
  return limpio || base.trim();
}

/**
 * `riesgos_json` / `acciones_sugeridas_json` son objetos semiestructurados
 * (`{ texto }`, `{ codigo_legado }`) o listas. Se aplanan a líneas legibles; lo
 * que no se puede leer no se inventa.
 */
const CLAVES_TEXTO = [
  'texto',
  'detalle',
  'descripcion',
  'accion',
  'riesgo',
  'titulo',
  'nombre',
  'codigo_legado',
] as const;

export function lineasDe(valor: unknown): string[] {
  if (typeof valor === 'string') {
    return valor
      .split('\n')
      .map((linea) => linea.replace(/^[\s\-–—•*]+/, '').trim())
      .filter((linea) => linea.length > 0);
  }
  if (Array.isArray(valor)) {
    return valor.flatMap((item) => lineasDe(item));
  }
  if (esRegistro(valor)) {
    for (const clave of CLAVES_TEXTO) {
      const candidato = valor[clave];
      if (typeof candidato === 'string' && candidato.trim()) {
        return [candidato.trim()];
      }
    }
  }
  return [];
}

/* ------------------------------------------------------------------------- *
 * Etiquetas de prioridad
 * ------------------------------------------------------------------------- */

/**
 * Mapeo sólo visual a las clases del mockup. El catálogo real no es
 * Alta/Media/Baja sino Crítica inmediata · Urgente · Temprana · Seguimiento.
 */
export function clasePrioridad(prioridad: string | null): string {
  const clave = (prioridad ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!clave) return 't-baja';
  if (clave.includes('critic')) return 't-crit';
  if (clave.includes('urgent')) return 't-alta';
  if (clave.includes('tempran')) return 't-media';
  if (clave.includes('seguim')) return 't-baja';
  return 't-baja';
}

/** Código del catálogo → etiqueta legible («critica_inmediata» → «Critica inmediata»). */
export function etiquetaPrioridad(prioridad: string | null): string {
  if (!prioridad) return '—';
  const limpio = prioridad.replace(/_/g, ' ').trim();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

/* ------------------------------------------------------------------------- *
 * Normalización de la cola
 * ------------------------------------------------------------------------- */

function estadoDe(valor: string | null): EstadoTriaje {
  return esEstadoTriaje(valor) ? valor : 'pendiente';
}

function aSenalDesdeCola(bruto: Registro): SenalVista {
  const titulo = texto(bruto, ['titulo']);
  const hechos = texto(bruto, ['hechosRecientes', 'hechos_recientes']);
  const distrito = texto(bruto, ['distrito']);
  const provincia = texto(bruto, ['provincia']);
  const region = texto(bruto, ['region']);
  const ruta =
    texto(bruto, ['distritoRuta', 'distrito_ruta']) ??
    [distrito, provincia, region].filter((parte): parte is string => Boolean(parte)).join(' · ');

  return {
    id: texto(bruto, ['id']) ?? '',
    codigo: texto(bruto, ['codigo']) ?? '—',
    extracto: limpiarExtracto(titulo, hechos),
    fecha: texto(bruto, ['fecha']),
    fechaTexto: fechaDdMmAaaa(texto(bruto, ['fecha'])),
    distrito,
    distritoId: numero(bruto, ['distritoId', 'distrito_id']),
    ubigeo: texto(bruto, ['ubigeo']),
    distritoRuta: ruta || null,
    provincia,
    region,
    prioridad: texto(bruto, ['prioridad']),
    nivel: texto(bruto, ['nivel']),
    casoCodigo: texto(bruto, ['casoCodigo', 'caso_codigo']),
    situacion: texto(bruto, ['situacionActual', 'situacion_actual']),
    descripcionRiesgo: texto(bruto, ['descripcionRiesgo', 'descripcion_riesgo']),
    riesgos: lineasDe(bruto['riesgos']),
    accionesSugeridas: lineasDe(bruto['accionesSugeridas'] ?? bruto['acciones_sugeridas']),
    fuenteTipo: texto(bruto, ['fuenteTipo', 'fuente_tipo']),
    fuenteDescripcion: texto(bruto, ['fuenteDescripcion', 'fuente_descripcion']),
    fuenteUrl: texto(bruto, ['fuenteUrl', 'fuente_url']),
    clasificacion: numero(bruto, ['clasificacion']) ?? 1,
    estado: estadoDe(texto(bruto, ['estado'])),
    motivo: texto(bruto, ['motivo']),
    duplicadaDe: texto(bruto, ['duplicadaDe', 'duplicada_de']),
    triadoPor: texto(bruto, ['triadoPor', 'triado_por']),
    triadoEn: texto(bruto, ['triadoEn', 'triado_en']),
  };
}

function conteosDe(bruto: Registro): ConteosCola {
  const crudos = esRegistro(bruto['conteos']) ? bruto['conteos'] : {};
  const leer = (clave: string): number => numero(crudos, [clave]) ?? 0;
  return {
    total: leer('total'),
    pendiente: leer('pendiente'),
    en_triage: leer('en_triage'),
    confirmada: leer('confirmada'),
    descartada: leer('descartada'),
    duplicada: leer('duplicada'),
  };
}

function fuenteDe(bruto: Registro): FuenteCola {
  const crudos = esRegistro(bruto['fuente']) ? bruto['fuente'] : {};
  return {
    senalesRecibidas: numero(crudos, ['senalesRecibidas']),
    conFuenteRadar: numero(crudos, ['conFuenteRadar']) ?? 0,
  };
}

export function normalizarCola(bruto: unknown): ColaRedRadar {
  if (!esRegistro(bruto)) {
    return {
      elementos: [],
      total: 0,
      pagina: 1,
      tamanoPagina: 25,
      conteos: conteosDe({}),
      fuente: fuenteDe({}),
      hoy: null,
    };
  }

  const elementos = lista(bruto, ['elementos'])
    .filter((item): item is Registro => esRegistro(item))
    .map(aSenalDesdeCola);

  return {
    elementos,
    total: numero(bruto, ['total']) ?? elementos.length,
    pagina: Math.max(1, numero(bruto, ['pagina']) ?? 1),
    tamanoPagina: Math.max(1, numero(bruto, ['tamanoPagina']) ?? 25),
    conteos: conteosDe(bruto),
    fuente: fuenteDe(bruto),
    hoy: texto(bruto, ['hoy']),
  };
}

/* ------------------------------------------------------------------------- *
 * Normalización del detalle
 * ------------------------------------------------------------------------- */

/**
 * El detalle reutiliza el contrato de la ficha de alertas (`alerta`, camelCase)
 * más el triaje. Se convierte a la misma `SenalVista` de la cola para que el
 * panel no tenga dos formas de leer la misma fila.
 */
export function normalizarDetalle(bruto: unknown): DetalleRedRadar | null {
  if (!esRegistro(bruto)) return null;
  const alerta = esRegistro(bruto['alerta']) ? bruto['alerta'] : null;
  if (!alerta) return null;

  const triaje = esRegistro(bruto['triaje']) ? bruto['triaje'] : null;
  const estado = estadoDe(triaje ? texto(triaje, ['estado']) : null);
  const titulo = texto(alerta, ['titulo']);
  const hechos = texto(alerta, ['hechosRecientes', 'hechos_recientes']);
  const distrito = texto(alerta, ['distrito']);
  const provincia = texto(alerta, ['provincia']);
  const region = texto(alerta, ['region']);
  const ruta =
    texto(alerta, ['distritoRuta', 'distrito_ruta']) ??
    [distrito, provincia, region].filter((parte): parte is string => Boolean(parte)).join(' · ');
  const fecha = texto(alerta, ['fechaReporte', 'fecha_reporte', 'fecha']);

  const senal: SenalVista = {
    id: texto(alerta, ['id']) ?? '',
    codigo: texto(alerta, ['codigo']) ?? '—',
    extracto: limpiarExtracto(titulo, hechos),
    fecha,
    fechaTexto: fechaDdMmAaaa(fecha),
    distrito,
    distritoId: numero(alerta, ['distritoId', 'distrito_id']),
    ubigeo: texto(bruto, ['ubigeo']),
    distritoRuta: ruta || null,
    provincia,
    region,
    prioridad: texto(alerta, ['prioridad']),
    nivel: texto(alerta, ['nivel']),
    casoCodigo: texto(alerta, ['casoCodigo', 'caso_codigo', 'casoCode', 'caso_code']),
    situacion: texto(alerta, ['situacionActual', 'situacion_actual']),
    descripcionRiesgo: texto(alerta, ['descripcionRiesgo', 'descripcion_riesgo']),
    riesgos: lineasDe(alerta['riesgos']),
    accionesSugeridas: lineasDe(alerta['accionesSugeridas'] ?? alerta['acciones_sugeridas']),
    fuenteTipo: texto(alerta, ['fuenteTipo', 'fuente_tipo']),
    fuenteDescripcion: texto(alerta, ['fuenteDescripcion', 'fuente_descripcion']),
    fuenteUrl: texto(alerta, ['fuenteUrl', 'fuente_url']),
    clasificacion: numero(alerta, ['clasificacion']) ?? 1,
    estado,
    motivo: triaje ? texto(triaje, ['motivo']) : null,
    duplicadaDe: triaje ? texto(triaje, ['duplicadaDeCodigo', 'duplicada_de_codigo']) : null,
    triadoPor: triaje ? texto(triaje, ['triadoPor', 'triado_por']) : null,
    triadoEn: triaje ? texto(triaje, ['triadoEn', 'triado_en']) : null,
  };

  return {
    senal,
  };
}

/* ------------------------------------------------------------------------- *
 * Catálogos
 * ------------------------------------------------------------------------- */

export function regionesDeCatalogo(bruto: unknown): OpcionRegion[] {
  if (!esRegistro(bruto)) return [];
  const catalogs = esRegistro(bruto['catalogs']) ? bruto['catalogs'] : {};
  const regiones: OpcionRegion[] = [];
  for (const item of lista(catalogs, ['regiones'])) {
    if (!esRegistro(item)) continue;
    const id = numero(item, ['id']);
    const nombre = texto(item, ['etiqueta', 'nombre', 'codigo']);
    if (id !== null && id > 0 && nombre) regiones.push({ id, nombre });
  }
  return regiones.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}
