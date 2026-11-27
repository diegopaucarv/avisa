import type { ActorDirectorio } from './directorio.mapeo';

/** Una línea del padrón; es lo que se imprime para que cada asistente firme. */
export type FilaPadron = {
  nombre: string;
  cargo: string;
  organizacion: string;
  region: string;
};

type DatosPadronFilas = {
  titulo: string;
  lugar: string;
  fecha: string;
  filas: readonly FilaPadron[];
};

/** Una fila del Excel de firmas, ya con los datos que van a la hoja. */
export type FilaPadronAsistencia = {
  nombre: string;
  cargo: string;
  dni: string;
  celular: string;
  provincia: string;
  distrito: string;
  ospa: string;
};

export type DatosPadronExcel = {
  titulo: string;
  lugar: string;
  /** ISO `YYYY-MM-DD` (lo que emite `<input type="date">`). */
  fecha: string;
  filas: readonly FilaPadronAsistencia[];
};

/** MIME del libro; el nombre del archivo lo decide la pantalla que descarga. */
export const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Columnas de la hoja, en el orden del formato de firmas. El ancho está en
 * caracteres de Excel; los valores salen de convertir los px del formato
 * impreso con `(px − 5) / 7`.
 */
const COLUMNAS = [
  { ancho: 7, rotulo: 'N°' },
  { ancho: 26.86, rotulo: 'APELLIDOS Y NOMBRES' },
  { ancho: 18.57, rotulo: 'CARGO' },
  { ancho: 12.43, rotulo: 'DNI' },
  { ancho: 14.14, rotulo: 'CELULAR' },
  { ancho: 15.43, rotulo: 'PROVINCIA' },
  { ancho: 15.43, rotulo: 'DISTRITO' },
  { ancho: 27, rotulo: 'PUERTO/CALETA / COMUNIDAD' },
  { ancho: 24.29, rotulo: 'NOMBRE DE LA OSPA' },
  { ancho: 24.29, rotulo: 'FIRMA' },
] as const;

const TOTAL_COLUMNAS = COLUMNAS.length;

/** DNI y celular se escriben como texto: un DNI con ceros a la izquierda no es un número. */
const COLUMNAS_TEXTO = new Set([4, 5]);
const ALTO_FILA_DATOS = 30;

const MESES_ABREVIADOS = [
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

const BORDE_FINO = {
  top: { style: 'thin', color: { argb: 'FF808080' } },
  left: { style: 'thin', color: { argb: 'FF808080' } },
  bottom: { style: 'thin', color: { argb: 'FF808080' } },
  right: { style: 'thin', color: { argb: 'FF808080' } },
} as const;

const RELLENO_CABECERA = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFEFF3F8' },
} as const;

/** El módulo CJS llega como `default` en Node; en el bundle, el nombre directo. */
type ModuloExcel = typeof import('exceljs') & { default?: typeof import('exceljs') };

function celdaCsv(valor: string): string {
  const seguro = /^[\s]*[=+@\-]/.test(valor) ? `'${valor}` : valor;
  return `"${seguro.replace(/"/g, '""')}"`;
}

/**
 * ISO `YYYY-MM-DD` → `dd mmm aaaa` (`05 nov 2026`), el formato del registro de
 * firmas. Se parsea a mano en vez de con `Date` para no correr la fecha un día
 * por la zona horaria.
 */
export function formatearFechaPadron(valor: string): string {
  const limpio = (valor ?? '').trim();
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(limpio);
  if (!partes) return limpio;

  const [, anio, mes, dia] = partes;
  const indice = Number(mes) - 1;
  if (indice < 0 || indice >= MESES_ABREVIADOS.length) return limpio;

  return `${dia} ${MESES_ABREVIADOS[indice]} ${anio}`;
}

/**
 * Padrón a partir de filas ya armadas. Es la forma que usa la importación de
 * listas de asistencia, que no conoce fichas del directorio.
 */
export function crearCsvPadronFilas({ titulo, lugar, fecha, filas }: DatosPadronFilas): string {
  const lineas = [
    ['Lista de asistencia'],
    ['Sesión', titulo],
    ['Lugar', lugar],
    ['Fecha', fecha],
    [],
    ['N.º', 'Nombre del actor', 'Cargo / función', 'Organización', 'Región', 'Firma'],
    ...filas.map((fila, indice) => [
      String(indice + 1),
      fila.nombre,
      fila.cargo,
      fila.organizacion,
      fila.region,
      '',
    ]),
  ];

  return `\uFEFF${lineas.map((fila) => fila.map(celdaCsv).join(',')).join('\r\n')}`;
}

/**
 * Padrón de firmas en Excel. `exceljs` se carga con `import()` dentro de la
 * función para que el lector de hojas viaje en su propio chunk: el directorio
 * no lo necesita hasta que alguien descarga la lista.
 */
export async function crearXlsxPadron({
  titulo,
  lugar,
  fecha,
  filas,
}: DatosPadronExcel): Promise<Blob> {
  const modulo = (await import('exceljs')) as ModuloExcel;
  const ExcelJS = modulo.default ?? modulo;

  const libro = new ExcelJS.Workbook();
  libro.creator = 'AVISA';

  const hoja = libro.addWorksheet('Lista de asistencia', {
    views: [{ state: 'frozen', ySplit: 4 }],
  });
  hoja.columns = COLUMNAS.map((columna) => ({ width: columna.ancho }));

  // Fila 1: el título ocupa todo el ancho de la tabla.
  const tituloLimpio = titulo.trim();
  const filaTitulo = hoja.addRow([
    tituloLimpio ? `LISTA DE ASISTENCIA — ${tituloLimpio}` : 'LISTA DE ASISTENCIA',
  ]);
  filaTitulo.height = 24;
  hoja.mergeCells(1, 1, 1, TOTAL_COLUMNAS);
  filaTitulo.getCell(1).font = { bold: true, size: 14 };
  filaTitulo.getCell(1).alignment = { vertical: 'middle' };
  for (let columna = 1; columna <= TOTAL_COLUMNAS; columna++) {
    filaTitulo.getCell(columna).border = BORDE_FINO;
  }

  // Filas 2 y 3: lugar y fecha. Van en una sola celda para que el texto no se
  // parta con el ancho angosto de la primera columna.
  const filaLugar = hoja.addRow([`Lugar: ${lugar.trim()}`]);
  filaLugar.getCell(1).border = BORDE_FINO;
  const filaFecha = hoja.addRow([`Fecha: ${formatearFechaPadron(fecha)}`]);
  filaFecha.getCell(1).border = BORDE_FINO;

  // Fila 4: encabezados exactos del formato de firmas.
  const filaEncabezados = hoja.addRow(COLUMNAS.map((columna) => columna.rotulo));
  filaEncabezados.height = ALTO_FILA_DATOS;
  for (let columna = 1; columna <= TOTAL_COLUMNAS; columna++) {
    const celda = filaEncabezados.getCell(columna);
    celda.font = { bold: true };
    celda.fill = RELLENO_CABECERA;
    celda.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    celda.border = BORDE_FINO;
  }

  // Filas 5 en adelante: una por asistente, con alto para firmar a mano.
  filas.forEach((fila, indice) => {
    const filaHoja = hoja.addRow([
      indice + 1,
      fila.nombre,
      fila.cargo,
      fila.dni,
      fila.celular,
      fila.provincia,
      fila.distrito,
      '',
      fila.ospa,
      '',
    ]);
    filaHoja.height = ALTO_FILA_DATOS;
    for (let columna = 1; columna <= TOTAL_COLUMNAS; columna++) {
      const celda = filaHoja.getCell(columna);
      celda.border = BORDE_FINO;
      celda.alignment = {
        vertical: 'middle',
        horizontal: columna === 1 ? 'center' : 'left',
      };
      if (COLUMNAS_TEXTO.has(columna)) celda.numFmt = '@';
    }
  });

  const contenido = await libro.xlsx.writeBuffer();
  return new Blob([contenido], { type: MIME_XLSX });
}

/**
 * Padrón a partir de fichas del directorio.
 *
 * El DNI y el celular viajan resueltos en `filas`: la pantalla los pide por
 * `/pii` con motivo auditado y aquí sólo se vuelcan. La provincia es derivable
 * del distrito en el listado (`distrito_id → provincia_id → nombre`), así que
 * se toma de `actor.provincia` y no se inventa cuando falta.
 */
export function filaPadronDeActor(
  actor: ActorDirectorio,
  ospaDeMembresia?: string | null,
  pii?: { dni: string | null; telefono: string | null } | null,
): FilaPadronAsistencia {
  return {
    nombre: actor.nombre,
    cargo: actor.cargo || actor.funcion || '',
    dni: pii?.dni ?? '',
    celular: pii?.telefono ?? '',
    provincia: actor.provincia ?? '',
    distrito: actor.distrito ?? '',
    ospa: ospaDeMembresia || actor.organizacionAncla || actor.abreviatura || '',
  };
}
