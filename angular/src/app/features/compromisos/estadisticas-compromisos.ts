/**
 * Compromisos · estadísticas: contrato de
 * `GET /api/v1/commitments/estadisticas` y transformaciones puras.
 *
 * La API devuelve un sobre ya agregado (no filas). Aquí se hace el mapeo
 * tolerante (camelCase o snake_case, sobre envuelto o directo), el orden del
 * ranking y el cálculo del porcentaje, de modo que la plantilla no conozca
 * variantes ni haga aritmética. El CSV se genera en el cliente porque el botón
 * «Exportar» descarga lo que la pantalla ya tiene sin una segunda petición.
 */

import { esRegistro, leer, lista, numero, texto } from '../../dominio/mapeo';

export type EstadisticaEstado = {
  estado: string;
  categoria: string;
  total: number;
};

/** Fila del ranking por área responsable (unidad orgánica). */
export type EstadisticaArea = {
  area: string;
  nombre: string;
  total: number;
  cumplidos: number;
  noCumplidos: number;
  porcentajeCumplimiento: number;
};

export type EstadisticaEstadoHito = {
  estado: string;
  total: number;
};

export type EstadisticasCompromisos = {
  total: number;
  vigentes: number;
  cumplidos: number;
  noCumplidos: number;
  enProceso: number;
  pendientes: number;
  porEstado: EstadisticaEstado[];
  porArea: EstadisticaArea[];
  porPlazo: {
    vencidos: number;
    alDia: number;
    sinPlazo: number;
  };
  porEstadoHito: EstadisticaEstadoHito[];
  generatedAt: string;
};

/**
 * Cabecera del CSV. El bloque va primero para poder apilar indicadores,
 * ranking y plazos en una sola tabla plana que Excel ordena y filtra sin
 * perder el contexto de cada fila.
 */
export const CABECERA_ESTADISTICAS = [
  'bloque',
  'clave',
  'detalle',
  'total',
  'cumplidos',
  'no_cumplidos',
  'porcentaje_cumplimiento',
] as const;

/** BOM UTF-8: sin él Excel abre el archivo con tildes rotas. */
export const BOM = '\uFEFF';

function entero(valor: unknown): number {
  const valorNumerico = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(valorNumerico) ? Math.trunc(valorNumerico) : 0;
}

function redondear(valor: number): number {
  return Math.round(valor * 10) / 10;
}

/**
 * Porcentaje de cumplimiento de un área, redondeado a un decimal.
 * Un total de cero no produce `NaN`: se declara 0.
 */
export function porcentajeCumplimiento(cumplidos: number, total: number): number {
  if (!total) return 0;
  return redondear((cumplidos / total) * 100);
}

/**
 * Orden del ranking: más compromisos primero y, a igual total, el nombre del
 * área como desempate estable para que dos cargas iguales se lean igual.
 */
export function ordenarPorArea(filas: readonly EstadisticaArea[]): EstadisticaArea[] {
  return [...filas].sort(
    (izquierda, derecha) =>
      derecha.total - izquierda.total || izquierda.area.localeCompare(derecha.area, 'es'),
  );
}

/** Desenvuelve un `{ data: {...} }` si lo hubiera; si no, devuelve el objeto. */
function raiz(bruto: unknown): Record<string, unknown> {
  if (!esRegistro(bruto)) return {};
  const envuelto = leer(bruto, ['data']);
  return esRegistro(envuelto) ? envuelto : bruto;
}

/**
 * Mapea el sobre de la API al contrato de la pantalla. Tolera `null`, arreglos
 * sueltos y números enviados como texto; nunca inventa filas.
 */
export function aEstadisticasCompromisos(bruto: unknown): EstadisticasCompromisos {
  const datos = raiz(bruto);

  const porEstado: EstadisticaEstado[] = lista(datos, ['porEstado', 'por_estado']).map((fila) => {
    const registro = esRegistro(fila) ? fila : {};
    return {
      estado: texto(registro, ['estado']) ?? '—',
      categoria: texto(registro, ['categoria']) ?? '',
      total: entero(numero(registro, ['total'])),
    };
  });

  const porArea: EstadisticaArea[] = ordenarPorArea(
    lista(datos, ['porArea', 'por_area']).map((fila) => {
      const registro = esRegistro(fila) ? fila : {};
      const total = entero(numero(registro, ['total']));
      const cumplidos = entero(numero(registro, ['cumplidos']));
      const declarado = numero(registro, ['porcentajeCumplimiento', 'porcentaje_cumplimiento']);

      return {
        area: texto(registro, ['area']) ?? '—',
        nombre: texto(registro, ['nombre']) ?? '',
        total,
        cumplidos,
        noCumplidos: entero(numero(registro, ['noCumplidos', 'no_cumplidos'])),
        // Si la API no manda el porcentaje se deriva aquí; si lo manda, se
        // respeta pero se redondea al mismo decimal que la pantalla.
        porcentajeCumplimiento:
          declarado === null ? porcentajeCumplimiento(cumplidos, total) : redondear(declarado),
      };
    }),
  );

  const porEstadoHito: EstadisticaEstadoHito[] = lista(datos, [
    'porEstadoHito',
    'por_estado_hito',
  ]).map((fila) => {
    const registro = esRegistro(fila) ? fila : {};
    return {
      estado: texto(registro, ['estado']) ?? '—',
      total: entero(numero(registro, ['total'])),
    };
  });

  const plazoCrudo = leer(datos, ['porPlazo', 'por_plazo']);
  const plazo = esRegistro(plazoCrudo) ? plazoCrudo : {};

  return {
    total: entero(numero(datos, ['total'])),
    vigentes: entero(numero(datos, ['vigentes'])),
    cumplidos: entero(numero(datos, ['cumplidos'])),
    noCumplidos: entero(numero(datos, ['noCumplidos', 'no_cumplidos'])),
    enProceso: entero(numero(datos, ['enProceso', 'en_proceso'])),
    pendientes: entero(numero(datos, ['pendientes'])),
    porEstado,
    porArea,
    porPlazo: {
      vencidos: entero(numero(plazo, ['vencidos'])),
      alDia: entero(numero(plazo, ['alDia', 'al_dia'])),
      sinPlazo: entero(numero(plazo, ['sinPlazo', 'sin_plazo'])),
    },
    porEstadoHito,
    generatedAt: texto(datos, ['generatedAt', 'generated_at']) ?? '',
  };
}

/** Escapa una celda según RFC 4180. */
function escaparCelda(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  const cadena = typeof valor === 'string' ? valor : String(valor);
  return /[",\r\n]/.test(cadena) ? `"${cadena.replace(/"/g, '""')}"` : cadena;
}

/**
 * CSV con BOM UTF-8, separador coma y CRLF, el mismo dialecto que las demás
 * exportaciones del proyecto (`analitica`, `conflictividad`, matriz de casos).
 * El BOM va incluido: este helper existe para descargar, no para servir.
 */
export function generarCsvEstadisticas(datos: EstadisticasCompromisos): string {
  const filas: (string | number)[][] = [
    ['indicador', 'total', 'Compromisos', datos.total, '', '', ''],
    ['indicador', 'vigentes', 'Vigentes (abiertos)', datos.vigentes, '', '', ''],
    ['indicador', 'cumplidos', 'Cumplidos', datos.cumplidos, '', '', ''],
    ['indicador', 'no_cumplidos', 'No cumplidos', datos.noCumplidos, '', '', ''],
    ['indicador', 'en_proceso', 'En proceso', datos.enProceso, '', '', ''],
    ['indicador', 'pendientes', 'Por iniciar', datos.pendientes, '', '', ''],
    ['plazo', 'vencidos', 'Hito vencido sin cumplir', datos.porPlazo.vencidos, '', '', ''],
    ['plazo', 'al_dia', 'Al día', datos.porPlazo.alDia, '', '', ''],
    ['plazo', 'sin_plazo', 'Sin plazo registrado', datos.porPlazo.sinPlazo, '', '', ''],
  ];

  for (const fila of datos.porArea) {
    filas.push([
      'area',
      fila.area,
      fila.nombre,
      fila.total,
      fila.cumplidos,
      fila.noCumplidos,
      fila.porcentajeCumplimiento,
    ]);
  }

  for (const fila of datos.porEstado) {
    filas.push(['estado', fila.estado, fila.categoria, fila.total, '', '', '']);
  }

  for (const fila of datos.porEstadoHito) {
    filas.push(['estado_hito', fila.estado, '', fila.total, '', '', '']);
  }

  const lineas = [CABECERA_ESTADISTICAS, ...filas].map((fila) => fila.map(escaparCelda).join(','));
  return `${BOM}${lineas.join('\r\n')}\r\n`;
}

/** Nombre del archivo descargado, con la fecha del día. */
export function nombreArchivoEstadisticas(fecha: Date = new Date()): string {
  return `avisa_estadisticas_compromisos_${fecha.toISOString().slice(0, 10)}.csv`;
}
