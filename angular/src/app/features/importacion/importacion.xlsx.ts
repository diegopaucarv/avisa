/**
 * Lectura de libros de Excel (.xlsx/.xlsm) para el importador.
 *
 * `exceljs` se carga con `import()` dinámico: es una dependencia grande y el
 * panel de importación es una pantalla secundaria; así no engorda el bundle
 * inicial. La primera hoja se normaliza a la misma matriz de celdas que produce
 * `leerTabla()` para CSV/TSV, de modo que la validación (`importacion.validar.ts`)
 * y el panel no conocen dos formatos ni duplican reglas.
 *
 * Normalizaciones:
 * - Toda celda se vuelve texto. Las fechas reales de Excel pasan a `AAAA-MM-DD`,
 *   que es lo que entiende `normalizarFecha()`.
 * - Se descartan las filas totalmente vacías (Excel deja restos al final).
 * - La primera fila no vacía es la cabecera; si no hay ninguna, se informa.
 *
 * Los tipos de `exceljs` se evitan a propósito: el paquete es CommonJS y su
 * `import()` puede exponer las clases como nombradas o bajo `default`. Se usa
 * una forma estructural mínima y se aceptan las dos variantes.
 */

import type { TablaLeida } from './importacion.csv';

export type LecturaXlsx =
  | { readonly ok: true; readonly tabla: TablaLeida }
  | { readonly ok: false; readonly mensaje: string };

type FilaExcel = { readonly values?: unknown };

type HojaExcel = {
  readonly name?: string;
  /** Última fila con contenido; `actualRowCount` es el respaldo de exceljs. */
  readonly rowCount?: number;
  readonly actualRowCount?: number;
  getRow?(indice: number): FilaExcel | undefined;
};

type LibroExcel = {
  readonly xlsx?: { load(datos: ArrayBuffer): Promise<unknown> };
  readonly worksheets?: HojaExcel[];
};

type ConstructorLibro = new () => LibroExcel;

type ModuloExcel = {
  readonly Workbook?: ConstructorLibro;
  readonly default?: { readonly Workbook?: ConstructorLibro };
};

/** Lee el primer libro de Excel y devuelve la tabla normalizada o el motivo. */
export async function leerLibroExcel(archivo: File): Promise<LecturaXlsx> {
  if (archivo.size === 0) {
    return { ok: false, mensaje: 'El archivo de Excel está vacío.' };
  }

  let modulo: ModuloExcel;
  try {
    modulo = (await import('exceljs')) as unknown as ModuloExcel;
  } catch {
    return {
      ok: false,
      mensaje:
        'No se pudo cargar el lector de Excel. Guarde la hoja como CSV UTF-8 e inténtelo de nuevo.',
    };
  }

  const Constructor = modulo.Workbook ?? modulo.default?.Workbook;
  if (!Constructor) {
    return { ok: false, mensaje: 'No se pudo cargar el lector de Excel.' };
  }

  let datos: ArrayBuffer;
  try {
    datos = await archivo.arrayBuffer();
  } catch {
    return { ok: false, mensaje: 'No se pudo leer el archivo seleccionado.' };
  }
  if (datos.byteLength === 0) {
    return { ok: false, mensaje: 'El archivo de Excel está vacío.' };
  }

  const libro = new Constructor();
  try {
    await libro.xlsx?.load(datos);
  } catch {
    return {
      ok: false,
      mensaje:
        'El archivo no es un libro de Excel válido o está dañado. Verifique el .xlsx o expórtelo de nuevo.',
    };
  }

  const hojas = libro.worksheets ?? [];
  const hoja = hojas[0];
  if (!hoja) {
    return { ok: false, mensaje: 'El libro de Excel no tiene hojas.' };
  }

  const filas = leerFilas(hoja);
  if (filas.length === 0) {
    return {
      ok: false,
      mensaje: `La hoja «${hoja.name ?? '1'}» no tiene filas: ni siquiera encabezados.`,
    };
  }

  const [cabecera, ...resto] = filas;
  return {
    ok: true,
    tabla: {
      // El delimitador no se usa al validar; se declara tabulador porque es la
      // representación natural de una hoja en matriz.
      cabecera: recortarCeldasVaciasFinales(cabecera),
      filas: resto.filter((fila) => fila.some((celda) => celda.trim() !== '')),
      delimitador: '\t',
    },
  };
}

/** Convierte todas las filas con contenido de la hoja en celdas de texto. */
function leerFilas(hoja: HojaExcel): string[][] {
  const total = Math.max(0, hoja.rowCount ?? hoja.actualRowCount ?? 0);
  const filas: string[][] = [];

  for (let indice = 1; indice <= total; indice += 1) {
    const fila = hoja.getRow?.(indice);
    if (!fila) continue;

    const celdas = valoresDeFila(fila).map(textoCelda);
    if (celdas.some((celda) => celda.trim() !== '')) filas.push(celdas);
  }

  return filas;
}

/**
 * `row.values` es un arreglo disperso con un hueco en el índice 0. También
 * puede llegar como objeto `{ 1: …, 3: … }`; ambos se aplanan a un arreglo
 * contiguo desde la columna A.
 */
function valoresDeFila(fila: FilaExcel): unknown[] {
  const valores = fila.values;

  if (Array.isArray(valores)) return valores.slice(1);

  if (valores && typeof valores === 'object') {
    const registro = valores as Record<string, unknown>;
    const indices = Object.keys(registro)
      .map((clave) => Number(clave))
      .filter((numero) => Number.isInteger(numero) && numero > 0);
    if (indices.length === 0) return [];

    const maximo = Math.max(...indices);
    return Array.from({ length: maximo }, (_, posicion) => registro[String(posicion + 1)]);
  }

  return [];
}

/**
 * Texto visible de una celda de Excel: cadena, número, booleano, fecha (en
 * ISO), texto enriquecido, hipervínculo, resultado de fórmula o error.
 */
function textoCelda(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (valor instanceof Date) return fechaIso(valor);

  if (typeof valor === 'object') {
    const objeto = valor as Record<string, unknown>;

    if (Array.isArray(objeto['richText'])) {
      return objeto['richText']
        .map((parte) => textoCelda((parte as Record<string, unknown>)?.['text']))
        .join('');
    }
    if (typeof objeto['text'] === 'string') return objeto['text'];
    if ('result' in objeto) return textoCelda(objeto['result']);
    if (typeof objeto['error'] === 'string') return objeto['error'];
  }

  return '';
}

/**
 * Fecha de Excel → `AAAA-MM-DD`. `exceljs` entrega las fechas como instantes
 * UTC; se leen con los accesores UTC para que el día no cambie según la zona
 * horaria del navegador.
 */
function fechaIso(valor: Date): string {
  if (Number.isNaN(valor.getTime())) return '';
  const anio = String(valor.getUTCFullYear()).padStart(4, '0');
  const mes = String(valor.getUTCMonth() + 1).padStart(2, '0');
  const dia = String(valor.getUTCDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

/** Quita las columnas vacías del final para no inflar la cabecera. */
function recortarCeldasVaciasFinales(celdas: readonly string[]): string[] {
  let fin = celdas.length;
  while (fin > 0 && (celdas[fin - 1] ?? '').trim() === '') fin -= 1;
  return celdas.slice(0, fin);
}
