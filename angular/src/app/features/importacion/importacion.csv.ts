/**
 * Lectura de hojas para importar.
 *
 * Acepta lo que la gente tiene a mano: un CSV exportado de Excel (separado por
 * coma o por punto y coma, con o sin BOM), un TSV y, sobre todo, el texto que
 * resulta de seleccionar celdas en Excel y pegarlas aquí (separado por tabulador
 * y con celdas entrecomilladas si contienen saltos de línea).
 *
 * Un `.xlsx` es un ZIP con XML dentro. Se detecta por extensión o por la firma
 * del archivo y se entrega a `importacion.xlsx.ts`, que lo lee con `exceljs`
 * cargado bajo demanda. El `.xls` binario antiguo no se puede leer: se reconoce
 * aquí para responder con una instrucción concreta en vez de un error genérico.
 */

export type Delimitador = '\t' | ';' | ',';

export type TablaLeida = {
  readonly cabecera: readonly string[];
  readonly filas: readonly (readonly string[])[];
  readonly delimitador: Delimitador;
};

/** Cabecera normalizada para comparar alias: sin tildes, signos ni mayúsculas. */
export function normalizarEncabezado(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Elige el separador con más presencia en la primera línea con contenido. */
export function detectarDelimitador(texto: string): Delimitador {
  const linea = texto.split(/\r?\n/).find((posible) => posible.trim() !== '') ?? '';
  const cuenta = (separador: string): number => {
    let total = 0;
    let entrecomillado = false;
    for (const caracter of linea) {
      if (caracter === '"') entrecomillado = !entrecomillado;
      else if (caracter === separador && !entrecomillado) total += 1;
    }
    return total;
  };

  const tabuladores = cuenta('\t');
  const puntosYComa = cuenta(';');
  const comas = cuenta(',');

  if (tabuladores > 0 && tabuladores >= puntosYComa && tabuladores >= comas) return '\t';
  if (puntosYComa > comas) return ';';
  return ',';
}

/**
 * Parser de campos entrecomillados (RFC 4180 en lo que importa): respeta las
 * comillas dobles escapadas (`""`), los saltos de línea dentro de una celda y
 * el CRLF de las exportaciones de Windows.
 */
export function parsearTexto(texto: string, delimitador: Delimitador): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let entrecomillado = false;

  const cerrarCelda = (): void => {
    fila.push(celda);
    celda = '';
  };
  const cerrarFila = (): void => {
    cerrarCelda();
    filas.push(fila);
    fila = [];
  };

  for (let indice = 0; indice < texto.length; indice += 1) {
    const caracter = texto[indice];

    if (entrecomillado) {
      if (caracter === '"') {
        if (texto[indice + 1] === '"') {
          celda += '"';
          indice += 1;
        } else {
          entrecomillado = false;
        }
      } else {
        celda += caracter;
      }
      continue;
    }

    if (caracter === '"' && celda.trim() === '') {
      // Comillas de apertura: lo escrito antes (espacios) se descarta.
      entrecomillado = true;
      celda = '';
      continue;
    }

    if (caracter === delimitador) {
      cerrarCelda();
      continue;
    }

    if (caracter === '\n') {
      cerrarFila();
      continue;
    }

    if (caracter === '\r') continue;

    celda += caracter;
  }

  if (celda !== '' || fila.length > 0) cerrarFila();

  // Se descartan las filas totalmente vacías (Excel deja rastros al final).
  return filas.filter((posible) => posible.some((valor) => valor.trim() !== ''));
}

/** BOM de UTF-8: Excel lo escribe al exportar y rompería el primer encabezado. */
export function quitarBom(texto: string): string {
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

/**
 * Nombre del archivo con extensión de Excel binario. Se comprueba por extensión
 * y por la firma `PK\u0003\u0004` (lo que devuelve `File` al leer los bytes).
 * Un `.xls` también entra aquí, pero el llamador debe descartarlo antes con
 * `esExcelAntiguo()`: no es un ZIP y `exceljs` no lo lee.
 */
export function esExcelBinario(nombre: string, firma?: string): boolean {
  const extension = nombre.toLowerCase().split('.').pop() ?? '';
  if (extension === 'xlsx' || extension === 'xls' || extension === 'xlsm') return true;
  return firma === 'PK\u0003\u0004';
}

/** `.xls` binario antiguo (BIFF): `exceljs` no lo soporta y no se adivina. */
export function esExcelAntiguo(nombre: string): boolean {
  return (nombre.toLowerCase().split('.').pop() ?? '') === 'xls';
}

/** Texto listo para `parsearTexto`, con BOM fuera y delimitador detectado. */
export function leerTabla(texto: string): TablaLeida {
  const limpio = quitarBom(texto).replace(/^\s+/, '');
  const delimitador = detectarDelimitador(limpio);
  const filas = parsearTexto(limpio, delimitador);
  const [cabecera = [], ...resto] = filas;

  return {
    cabecera,
    filas: resto.filter((fila) => fila.some((celda) => celda.trim() !== '')),
    delimitador,
  };
}

/** `""` → celda vacía; recorta espacios pero conserva los saltos internos. */
export function limpiarCelda(valor: string | undefined): string {
  if (valor === undefined) return '';
  return valor.trim();
}
