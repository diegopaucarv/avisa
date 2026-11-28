import { esRegistro, leer, numero, texto, type Registro } from '../../dominio/mapeo';
import { formatearFecha, formatearFechaHora, partesFecha } from '../../shared/formato-fecha';

/**
 * Contrato local del dashboard analítico (item 57).
 *
 * Todo lo que la pantalla necesita de `GET /api/v1/analitica` se declara aquí y
 * se normaliza de forma defensiva: si el servidor cambia una clave o llega un
 * `null`, la vista degrada a «sin dato» en vez de romper. El formato de fecha y
 * hora es el único del proyecto (`shared/formato-fecha.ts`, `02NOV2025`); aquí
 * solo quedan los rótulos de periodo («ene 2026», «semana del …»).
 */

export type Granularidad = 'mes' | 'semana';

export type FiltrosDashboard = {
  desde: string;
  hasta: string;
  granularidad: Granularidad;
  region: string;
  subsector: string;
};

export const FILTROS_INICIALES: FiltrosDashboard = {
  desde: '',
  hasta: '',
  granularidad: 'mes',
  region: '',
  subsector: '',
};

export type PeriodoAnalitica = {
  inicio: string;
  fin: string;
  casos: number;
  demandas: number;
  alertas: number;
  compromisos: number;
  documentos: number;
  reuniones: number;
  manifiesto: number;
  latente: number;
  sinNivel: number;
};

export type TotalesAnalitica = {
  casos: number;
  demandas: number;
  alertas: number;
  compromisos: number;
  documentos: number;
  reuniones: number;
  manifiesto: number;
  latente: number;
  sinNivel: number;
};

export type ActividadDia = {
  fecha: string;
  registros: number;
  usuarios: number;
  legado: number;
  sinUsuario: number;
};

export type ActividadUsuario = {
  usuarioId: string | null;
  usuario: string | null;
  registros: number;
  legado: number;
  primera: string | null;
  ultima: string | null;
};

export type FilaResumen = {
  clave: string;
  etiqueta: string;
  conFecha: number;
  sinFecha: number;
  primera: string | null;
  ultima: string | null;
  usuarios: number;
};

export type OpcionAnalitica = {
  valor: string;
  etiqueta: string;
};

export type CorteAnalitica = {
  datosDesde: string | null;
  datosHasta: string | null;
  ventanaDesde: string | null;
  ventanaHasta: string | null;
  solicitadoDesde: string | null;
  solicitadoHasta: string | null;
};

export type ActividadAnalitica = {
  confiable: boolean;
  motivo: string | null;
  dias: number;
  rango: { primera: string | null; ultima: string | null };
  totalRegistros: number;
  totalLegado: number;
  totalSinUsuario: number;
  porDia: readonly ActividadDia[];
  porUsuario: readonly ActividadUsuario[];
};

export type ResolucionAnalitica = {
  total: number;
  terminales: number;
  conVencimiento: number;
  muestra: number;
  mediaDias: number | null;
  hitosCumplidos: number;
  mediaHitosDias: number | null;
  hitosMinDias: number | null;
  hitosMaxDias: number | null;
  motivo: string | null;
};

export type Analitica = {
  generadoEn: string;
  zonaHoraria: string;
  corte: CorteAnalitica;
  filtros: { granularidad: Granularidad; region: string | null; subsector: string | null };
  volumen: {
    granularidad: Granularidad;
    series: readonly string[];
    periodos: readonly PeriodoAnalitica[];
    totales: TotalesAnalitica;
  };
  actividad: ActividadAnalitica;
  resolucionCompromisos: ResolucionAnalitica;
  resumen: {
    filas: readonly FilaResumen[];
    totalRegistros: number;
    totalSinFecha: number;
  };
  catalogos: {
    regiones: readonly OpcionAnalitica[];
    subsectores: readonly OpcionAnalitica[];
  };
};

/** Entidades del volumen, en el orden fijo que ya usa el servidor y el CSV. */
export const SERIES_ENTIDAD = [
  'casos',
  'demandas',
  'alertas',
  'compromisos',
  'documentos',
  'reuniones',
] as const;

export const ETIQUETAS_SERIE: Record<string, string> = {
  casos: 'Casos',
  demandas: 'Demandas',
  alertas: 'Alertas',
  compromisos: 'Compromisos',
  documentos: 'Documentos',
  reuniones: 'Reuniones',
  manifiesto: 'Manifiesto',
  latente: 'Latente',
  sinNivel: 'Sin nivel',
  registros: 'Registros',
};

/**
 * Colores de las series. Son variables del tema: el mismo `stroke` se resuelve
 * en claro y en oscuro sin duplicar la hoja de estilos.
 */
export const COLORES_SERIE: Record<string, string> = {
  casos: 'var(--blue)',
  demandas: 'var(--teal)',
  alertas: 'var(--amber)',
  compromisos: 'var(--red)',
  documentos: 'var(--green)',
  reuniones: 'var(--muted)',
  manifiesto: 'var(--red)',
  latente: 'var(--blue)',
  sinNivel: 'var(--muted)',
  registros: 'var(--blue)',
};

export const ANALITICA_VACIA: Analitica = {
  generadoEn: '',
  zonaHoraria: 'America/Lima',
  corte: {
    datosDesde: null,
    datosHasta: null,
    ventanaDesde: null,
    ventanaHasta: null,
    solicitadoDesde: null,
    solicitadoHasta: null,
  },
  filtros: { granularidad: 'mes', region: null, subsector: null },
  volumen: {
    granularidad: 'mes',
    series: SERIES_ENTIDAD,
    periodos: [],
    totales: {
      casos: 0,
      demandas: 0,
      alertas: 0,
      compromisos: 0,
      documentos: 0,
      reuniones: 0,
      manifiesto: 0,
      latente: 0,
      sinNivel: 0,
    },
  },
  actividad: {
    confiable: false,
    motivo: null,
    dias: 0,
    rango: { primera: null, ultima: null },
    totalRegistros: 0,
    totalLegado: 0,
    totalSinUsuario: 0,
    porDia: [],
    porUsuario: [],
  },
  resolucionCompromisos: {
    total: 0,
    terminales: 0,
    conVencimiento: 0,
    muestra: 0,
    mediaDias: null,
    hitosCumplidos: 0,
    mediaHitosDias: null,
    hitosMinDias: null,
    hitosMaxDias: null,
    motivo: null,
  },
  resumen: { filas: [], totalRegistros: 0, totalSinFecha: 0 },
  catalogos: { regiones: [], subsectores: [] },
};

// ─────────────────────────── normalización defensiva ───────────────────────────

function subregistro(objeto: Registro, clave: string): Registro {
  const valor = leer(objeto, [clave]);
  return esRegistro(valor) ? valor : {};
}

function listaRegistros(objeto: Registro, clave: string): Registro[] {
  const valor = leer(objeto, [clave]);
  return Array.isArray(valor) ? valor.filter((item): item is Registro => esRegistro(item)) : [];
}

function listaTextos(objeto: Registro, clave: string): string[] {
  const valor = leer(objeto, [clave]);
  return Array.isArray(valor)
    ? valor.filter((item): item is string => typeof item === 'string')
    : [];
}

function n(objeto: Registro, clave: string): number {
  return numero(objeto, [clave]) ?? 0;
}

function nNulo(objeto: Registro, clave: string): number | null {
  return numero(objeto, [clave]);
}

function t(objeto: Registro, clave: string): string | null {
  return texto(objeto, [clave]);
}

function aPeriodo(registro: Registro): PeriodoAnalitica {
  return {
    inicio: t(registro, 'inicio') ?? '',
    fin: t(registro, 'fin') ?? '',
    casos: n(registro, 'casos'),
    demandas: n(registro, 'demandas'),
    alertas: n(registro, 'alertas'),
    compromisos: n(registro, 'compromisos'),
    documentos: n(registro, 'documentos'),
    reuniones: n(registro, 'reuniones'),
    manifiesto: n(registro, 'manifiesto'),
    latente: n(registro, 'latente'),
    sinNivel: n(registro, 'sinNivel'),
  };
}

function aTotales(registro: Registro): TotalesAnalitica {
  return {
    casos: n(registro, 'casos'),
    demandas: n(registro, 'demandas'),
    alertas: n(registro, 'alertas'),
    compromisos: n(registro, 'compromisos'),
    documentos: n(registro, 'documentos'),
    reuniones: n(registro, 'reuniones'),
    manifiesto: n(registro, 'manifiesto'),
    latente: n(registro, 'latente'),
    sinNivel: n(registro, 'sinNivel'),
  };
}

function aDia(registro: Registro): ActividadDia {
  return {
    fecha: t(registro, 'fecha') ?? '',
    registros: n(registro, 'registros'),
    usuarios: n(registro, 'usuarios'),
    legado: n(registro, 'legado'),
    sinUsuario: n(registro, 'sinUsuario'),
  };
}

function aUsuario(registro: Registro): ActividadUsuario {
  return {
    usuarioId: t(registro, 'usuarioId'),
    usuario: t(registro, 'usuario'),
    registros: n(registro, 'registros'),
    legado: n(registro, 'legado'),
    primera: t(registro, 'primera'),
    ultima: t(registro, 'ultima'),
  };
}

function aFilaResumen(registro: Registro): FilaResumen {
  return {
    clave: t(registro, 'clave') ?? '',
    etiqueta: t(registro, 'etiqueta') ?? '',
    conFecha: n(registro, 'conFecha'),
    sinFecha: n(registro, 'sinFecha'),
    primera: t(registro, 'primera'),
    ultima: t(registro, 'ultima'),
    usuarios: n(registro, 'usuarios'),
  };
}

function aOpcion(registro: Registro): OpcionAnalitica {
  return {
    valor: t(registro, 'valor') ?? '',
    etiqueta: t(registro, 'etiqueta') ?? '',
  };
}

function granularidadDe(objeto: Registro): Granularidad {
  return t(objeto, 'granularidad') === 'semana' ? 'semana' : 'mes';
}

/** Normaliza la respuesta del endpoint. Cualquier forma inesperada cae a vacío. */
export function aAnalitica(bruto: unknown): Analitica {
  if (!esRegistro(bruto)) return ANALITICA_VACIA;

  const corte = subregistro(bruto, 'corte');
  const filtros = subregistro(bruto, 'filtros');
  const volumen = subregistro(bruto, 'volumen');
  const actividad = subregistro(bruto, 'actividad');
  const rango = subregistro(actividad, 'rango');
  const resolucion = subregistro(bruto, 'resolucionCompromisos');
  const resumen = subregistro(bruto, 'resumen');
  const catalogos = subregistro(bruto, 'catalogos');

  return {
    generadoEn: t(bruto, 'generadoEn') ?? '',
    zonaHoraria: t(bruto, 'zonaHoraria') ?? 'America/Lima',
    corte: {
      datosDesde: t(corte, 'datosDesde'),
      datosHasta: t(corte, 'datosHasta'),
      ventanaDesde: t(corte, 'ventanaDesde'),
      ventanaHasta: t(corte, 'ventanaHasta'),
      solicitadoDesde: t(corte, 'solicitadoDesde'),
      solicitadoHasta: t(corte, 'solicitadoHasta'),
    },
    filtros: {
      granularidad: granularidadDe(filtros),
      region: t(filtros, 'region'),
      subsector: t(filtros, 'subsector'),
    },
    volumen: {
      granularidad: granularidadDe(volumen),
      series: listaTextos(volumen, 'series'),
      periodos: listaRegistros(volumen, 'periodos').map(aPeriodo),
      totales: aTotales(subregistro(volumen, 'totales')),
    },
    actividad: {
      confiable: leer(actividad, ['confiable']) === true,
      motivo: t(actividad, 'motivo'),
      dias: n(actividad, 'dias'),
      rango: { primera: t(rango, 'primera'), ultima: t(rango, 'ultima') },
      totalRegistros: n(actividad, 'totalRegistros'),
      totalLegado: n(actividad, 'totalLegado'),
      totalSinUsuario: n(actividad, 'totalSinUsuario'),
      porDia: listaRegistros(actividad, 'porDia').map(aDia),
      porUsuario: listaRegistros(actividad, 'porUsuario').map(aUsuario),
    },
    resolucionCompromisos: {
      total: n(resolucion, 'total'),
      terminales: n(resolucion, 'terminales'),
      conVencimiento: n(resolucion, 'conVencimiento'),
      muestra: n(resolucion, 'muestra'),
      mediaDias: nNulo(resolucion, 'mediaDias'),
      hitosCumplidos: n(resolucion, 'hitosCumplidos'),
      mediaHitosDias: nNulo(resolucion, 'mediaHitosDias'),
      hitosMinDias: nNulo(resolucion, 'hitosMinDias'),
      hitosMaxDias: nNulo(resolucion, 'hitosMaxDias'),
      motivo: t(resolucion, 'motivo'),
    },
    resumen: {
      filas: listaRegistros(resumen, 'filas').map(aFilaResumen),
      totalRegistros: n(resumen, 'totalRegistros'),
      totalSinFecha: n(resumen, 'totalSinFecha'),
    },
    catalogos: {
      regiones: listaRegistros(catalogos, 'regiones')
        .map(aOpcion)
        .filter((opcion) => opcion.valor !== ''),
      subsectores: listaRegistros(catalogos, 'subsectores')
        .map(aOpcion)
        .filter((opcion) => opcion.valor !== ''),
    },
  };
}

// ─────────────────────────────── formato y fechas ───────────────────────────────

const MESES_CORTOS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'set',
  'oct',
  'nov',
  'dic',
] as const;

const ZONA_HORARIA = 'America/Lima';

function dosDigitos(valor: number): string {
  return String(valor).padStart(2, '0');
}

/** `2026-05-01` → `01MAY2026`; vacío o ilegible → `—`. Nombre legado. */
export function formatearFechaDdMmAaaa(valor: string | null | undefined): string {
  return formatearFecha(valor);
}

/** Enteros con espacio fino (U+2009) como separador de miles. */
export function formatearNumero(valor: number): string {
  if (!Number.isFinite(valor)) return 'sin dato';
  const entero = Math.round(valor);
  const signo = entero < 0 ? '-' : '';
  const digitos = String(Math.abs(entero));
  return signo + digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
}

/** `99.7` → `99,7 %`. */
export function formatearPorcentaje(valor: number): string {
  if (!Number.isFinite(valor)) return 'sin dato';
  return `${valor.toFixed(1).replace('.', ',')} %`;
}

/** Días con una decimal; sin valor → «sin dato». */
export function formatearDias(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return 'sin dato';
  return `${valor.toFixed(1).replace('.', ',')} días`;
}

/** Instante ISO → `02NOV2026 16:00` en zona de Lima. Sin valor → «sin dato». */
export function formatearFechaHoraLima(valor: string | null | undefined): string {
  if (!valor) return 'sin dato';
  return formatearFechaHora(valor);
}

/** `ene 2026` para meses y `semana del 05/01/2026` para semanas. */
export function etiquetaPeriodo(periodo: PeriodoAnalitica, granularidad: Granularidad): string {
  const partes = partesFecha(periodo.inicio);
  if (!partes) return 'periodo sin fecha';
  const [anio, mes, dia] = partes;

  if (granularidad === 'semana') {
    return `semana del ${dosDigitos(dia)}/${dosDigitos(mes)}/${anio}`;
  }

  return `${MESES_CORTOS[mes - 1] ?? ''} ${anio}`.trim();
}

/** Etiqueta corta del eje X: `ene 26` o `05/01`. */
export function etiquetaEjePeriodo(periodo: PeriodoAnalitica, granularidad: Granularidad): string {
  const partes = partesFecha(periodo.inicio);
  if (!partes) return '—';
  const [anio, mes, dia] = partes;

  if (granularidad === 'semana') return `${dosDigitos(dia)}/${dosDigitos(mes)}`;
  return `${MESES_CORTOS[mes - 1] ?? ''} ${String(anio).slice(2)}`.trim();
}

/** `2026-01-05` → `05/01`. */
export function etiquetaDiaCorta(valor: string | null | undefined): string {
  const partes = partesFecha(valor);
  if (!partes) return '—';
  const [, mes, dia] = partes;
  return `${dosDigitos(dia)}/${dosDigitos(mes)}`;
}

/** Fecha de hoy en Lima como `YYYY-MM-DD` (formato del filtro y de la API). */
export function fechaHoyLima(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Resta meses a una fecha `YYYY-MM-DD`, recortando el día al fin de mes. */
export function restarMeses(fecha: string, meses: number): string {
  const partes = partesFecha(fecha);
  if (!partes) return fecha;
  const [anio, mes, dia] = partes;

  const totalMeses = anio * 12 + (mes - 1) - meses;
  const anioNuevo = Math.floor(totalMeses / 12);
  const mesNuevo = totalMeses - anioNuevo * 12;
  const ultimoDia = new Date(Date.UTC(anioNuevo, mesNuevo + 1, 0)).getUTCDate();
  const diaNuevo = Math.min(dia, ultimoDia);

  return `${anioNuevo}-${dosDigitos(mesNuevo + 1)}-${dosDigitos(diaNuevo)}`;
}

/** Suma de las seis entidades de un periodo. */
export function totalPeriodo(periodo: PeriodoAnalitica): number {
  return (
    periodo.casos +
    periodo.demandas +
    periodo.alertas +
    periodo.compromisos +
    periodo.documentos +
    periodo.reuniones
  );
}

// ───────────────────────────── gráficos SVG propios ─────────────────────────────

export type SerieGrafico = {
  clave: string;
  etiqueta: string;
  color: string;
  valores: readonly number[];
};

export type SerieDibujada = {
  clave: string;
  etiqueta: string;
  color: string;
  /** Puntos listos para `<polyline points>`. */
  puntos: string;
  circulos: readonly { x: number; y: number }[];
  total: number;
};

export type Grafico = {
  ancho: number;
  alto: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  techo: number;
  lineas: readonly { y: number; valor: number }[];
  marcasX: readonly { x: number; etiqueta: string }[];
  series: readonly SerieDibujada[];
};

const MARGEN = { izquierda: 44, derecha: 12, arriba: 12, abajo: 28 } as const;

/**
 * Escala «bonita»: el techo es un múltiplo de 1, 2 o 5 × 10^k y se divide en
 * cuatro pasos, de modo que el eje Y siempre tenga cinco líneas legibles.
 */
export function escalaBonita(maximo: number): { techo: number; paso: number } {
  if (!Number.isFinite(maximo) || maximo <= 0) return { techo: 4, paso: 1 };

  const bruto = maximo / 4;
  const exponente = Math.floor(Math.log10(bruto));
  const base = 10 ** exponente;
  const normalizado = bruto / base;
  const factor = normalizado <= 1 ? 1 : normalizado <= 2 ? 2 : normalizado <= 5 ? 5 : 10;
  const paso = factor * base;

  return { techo: paso * 4, paso };
}

function posicionX(indice: number, total: number, x0: number, x1: number): number {
  if (total <= 1) return (x0 + x1) / 2;
  return x0 + (indice * (x1 - x0)) / (total - 1);
}

function redondear(valor: number): number {
  return Math.round(valor * 10) / 10;
}

/**
 * Construye la geometría de un gráfico de líneas sin librerías. Devuelve también
 * las líneas de rejilla y las marcas del eje X para que la plantilla sólo pinte.
 */
export function construirGrafico(
  series: readonly SerieGrafico[],
  etiquetas: readonly string[],
  opciones: { ancho?: number; alto?: number } = {},
): Grafico {
  const ancho = opciones.ancho ?? 760;
  const alto = opciones.alto ?? 230;
  const x0 = MARGEN.izquierda;
  const x1 = ancho - MARGEN.derecha;
  const y0 = alto - MARGEN.abajo;
  const y1 = MARGEN.arriba;
  const total = etiquetas.length;

  let maximo = 0;
  for (const serie of series) {
    for (const valor of serie.valores) {
      if (Number.isFinite(valor) && valor > maximo) maximo = valor;
    }
  }

  const { techo, paso } = escalaBonita(maximo);

  const lineas: { y: number; valor: number }[] = [];
  for (let i = 0; i <= 4; i += 1) {
    const valor = paso * i;
    lineas.push({ y: redondear(y0 - (valor / techo) * (y0 - y1)), valor });
  }

  const marcasX: { x: number; etiqueta: string }[] = [];
  if (total > 0) {
    const cantidad = Math.min(6, total);
    const indices = new Set<number>();

    if (cantidad === 1) {
      indices.add(0);
    } else {
      for (let k = 0; k < cantidad; k += 1) {
        indices.add(Math.round((k * (total - 1)) / (cantidad - 1)));
      }
    }

    for (const indice of [...indices].sort((a, b) => a - b)) {
      marcasX.push({
        x: redondear(posicionX(indice, total, x0, x1)),
        etiqueta: etiquetas[indice] ?? '',
      });
    }
  }

  const dibujadas: SerieDibujada[] = series.map((serie) => {
    const puntos: string[] = [];
    const circulos: { x: number; y: number }[] = [];

    for (let i = 0; i < total; i += 1) {
      const valor = serie.valores[i] ?? 0;
      const x = posicionX(i, total, x0, x1);
      const y = y0 - (Math.min(valor, techo) / techo) * (y0 - y1);
      puntos.push(`${redondear(x)},${redondear(y)}`);
      if (total <= 24) circulos.push({ x: redondear(x), y: redondear(y) });
    }

    return {
      clave: serie.clave,
      etiqueta: serie.etiqueta,
      color: serie.color,
      puntos: puntos.join(' '),
      circulos,
      total: serie.valores.reduce((suma, valor) => suma + (Number.isFinite(valor) ? valor : 0), 0),
    };
  });

  return { ancho, alto, x0, x1, y0, y1, techo, lineas, marcasX, series: dibujadas };
}
