/**
 * Generador de PDF 1.4 mínimo, escrito a mano.
 *
 * No usa fuentes incrustadas: se apoyan las dos Helvetica estándar (`F1`
 * normal y `F2` negrita) con `WinAnsiEncoding`, suficiente para el español.
 * Se emite una cabecera con título y fecha, tablas de texto con anchos fijos y
 * salto de página automático. El xref se calcula con los desplazamientos reales
 * de cada objeto, que es lo que hace que el archivo abra sin reparaciones.
 */

export type ColumnaPdf = {
  titulo: string;
  /** Ancho relativo; si ninguna columna lo indica, se reparte por igual. */
  ancho?: number;
};

export type TablaPdf = {
  titulo?: string;
  columnas: readonly ColumnaPdf[];
  filas: readonly (readonly (string | number | null | undefined)[])[];
};

export type DocumentoPdf = {
  titulo: string;
  subtitulo?: string;
  generadoEn?: Date;
  tablas: readonly TablaPdf[];
};

const ANCHO_PAGINA = 595.28; // A4 en puntos
const ALTO_PAGINA = 841.89;
const MARGEN = 40;
const ANCHO_UTIL = ANCHO_PAGINA - MARGEN * 2;
const TAM_TITULO = 16;
const TAM_SUBTITULO = 9;
const TAM_SECCION = 10;
const TAM_CABECERA = 8.5;
const TAM_CELDA = 8;
const ALTO_LINEA = 10;
const ALTO_CABECERA = 15;
const PADDING = 3;

function limpiar(texto: string): string {
  return texto
    .replace(/\r?\n/g, " ")
    .replace(/\t/g, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
}

function aTexto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  return String(valor);
}

function escapar(texto: string): string {
  return texto
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/** Ancho aproximado; no se cargan métricas reales de la fuente. */
function anchoTexto(texto: string, tamano: number, negrita = false): number {
  return texto.length * tamano * (negrita ? 0.54 : 0.5);
}

function partirTexto(texto: string, ancho: number, tamano: number): string[] {
  const limite = Math.max(8, ancho);
  const palabras = texto.split(/\s+/).filter((palabra) => palabra.length > 0);
  if (palabras.length === 0) return [""];

  const lineas: string[] = [];
  let actual = "";

  for (const palabra of palabras) {
    const candidata = actual ? `${actual} ${palabra}` : palabra;
    if (anchoTexto(candidata, tamano) <= limite) {
      actual = candidata;
      continue;
    }

    if (actual) lineas.push(actual);

    if (anchoTexto(palabra, tamano) <= limite) {
      actual = palabra;
      continue;
    }

    let trozo = "";
    for (const caracter of palabra) {
      if (trozo && anchoTexto(trozo + caracter, tamano) > limite) {
        lineas.push(trozo);
        trozo = caracter;
      } else {
        trozo += caracter;
      }
    }
    actual = trozo;
  }

  if (actual) lineas.push(actual);
  return lineas.length > 0 ? lineas : [""];
}

function fechaLegible(fecha: Date): string {
  const iso = Number.isNaN(fecha.getTime())
    ? new Date().toISOString()
    : fecha.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function codificarLatin1(texto: string): Uint8Array {
  const bytes = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i += 1) {
    const codigo = texto.charCodeAt(i);
    bytes[i] = codigo <= 0xff ? codigo : 0x3f;
  }
  return bytes;
}

export function generarPdf(doc: DocumentoPdf): Uint8Array {
  const fecha = fechaLegible(doc.generadoEn ?? new Date());

  const paginas: string[] = [];
  let actual: string[] = [];
  let y = ALTO_PAGINA - MARGEN;

  const escribir = (
    x: number,
    altura: number,
    texto: string,
    tamano: number,
    negrita: boolean,
  ): void => {
    const limpio = limpiar(texto);
    actual.push(
      `BT /${negrita ? "F2" : "F1"} ${tamano.toFixed(2)} Tf ${x.toFixed(
        2,
      )} ${altura.toFixed(2)} Td (${escapar(limpio)}) Tj ET\n`,
    );
  };

  const linea = (x1: number, y1: number, x2: number, y2: number): void => {
    actual.push(
      `0.6 w 0.7 0.7 0.7 RG ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(
        2,
      )} ${y2.toFixed(2)} l S\n`,
    );
  };

  const cerrarPagina = (): void => {
    if (actual.length > 0) paginas.push(actual.join(""));
    actual = [];
  };

  const abrirPrimera = (): void => {
    cerrarPagina();
    y = ALTO_PAGINA - MARGEN;
    escribir(MARGEN, y, doc.titulo, TAM_TITULO, true);
    y -= 18;
    escribir(MARGEN, y, `Generado el ${fecha}`, TAM_SUBTITULO, false);
    y -= 14;
    if (doc.subtitulo) {
      escribir(MARGEN, y, doc.subtitulo, TAM_SUBTITULO, false);
      y -= 14;
    }
    y -= 4;
  };

  const nuevaPagina = (): void => {
    cerrarPagina();
    y = ALTO_PAGINA - MARGEN;
    escribir(MARGEN, y, doc.titulo, 11, true);
    escribir(
      ANCHO_PAGINA - MARGEN - anchoTexto(fecha, 8),
      y,
      fecha,
      8,
      false,
    );
    y -= 10;
    linea(MARGEN, y, ANCHO_PAGINA - MARGEN, y);
    y -= 16;
  };

  const asegurar = (altura: number): void => {
    if (y - altura < MARGEN) nuevaPagina();
  };

  const anchosDe = (columnas: readonly ColumnaPdf[]): number[] => {
    const conAncho = columnas.every(
      (columna) => typeof columna.ancho === "number" && columna.ancho > 0,
    );

    if (conAncho) {
      const suma = columnas.reduce(
        (total, columna) => total + (columna.ancho ?? 0),
        0,
      );
      if (suma > 0) {
        return columnas.map(
          (columna) => ((columna.ancho ?? 0) / suma) * ANCHO_UTIL,
        );
      }
    }

    return columnas.map(() => ANCHO_UTIL / Math.max(1, columnas.length));
  };

  const dibujarCabeceraTabla = (
    columnas: readonly ColumnaPdf[],
    anchos: readonly number[],
  ): void => {
    asegurar(ALTO_CABECERA + ALTO_LINEA);
    let x = MARGEN;
    columnas.forEach((columna, indice) => {
      escribir(
        x + PADDING,
        y - TAM_CABECERA,
        columna.titulo,
        TAM_CABECERA,
        true,
      );
      x += anchos[indice] ?? 0;
    });
    y -= ALTO_CABECERA;
    linea(MARGEN, y, MARGEN + ANCHO_UTIL, y);
  };

  const dibujarTabla = (tabla: TablaPdf): void => {
    if (tabla.titulo) {
      asegurar(ALTO_CABECERA + 12);
      escribir(MARGEN, y, tabla.titulo, TAM_SECCION, true);
      y -= 13;
    }

    if (tabla.columnas.length === 0) {
      asegurar(ALTO_LINEA);
      escribir(MARGEN, y, "Sin registros", TAM_CELDA, false);
      y -= ALTO_LINEA + 8;
      return;
    }

    const anchos = anchosDe(tabla.columnas);
    dibujarCabeceraTabla(tabla.columnas, anchos);

    for (const fila of tabla.filas) {
      const lineasPorCelda = tabla.columnas.map((_, indice) =>
        partirTexto(
          limpiar(aTexto(fila[indice])),
          (anchos[indice] ?? 0) - PADDING * 2,
          TAM_CELDA,
        ),
      );

      let maximo = 1;
      for (const lineas of lineasPorCelda) {
        if (lineas.length > maximo) maximo = lineas.length;
      }
      const altoFila = maximo * ALTO_LINEA + 4;

      if (y - altoFila < MARGEN) {
        nuevaPagina();
        dibujarCabeceraTabla(tabla.columnas, anchos);
      }

      let x = MARGEN;
      lineasPorCelda.forEach((lineas, indice) => {
        lineas.forEach((textoLinea, numeroLinea) => {
          escribir(
            x + PADDING,
            y - TAM_CELDA - numeroLinea * ALTO_LINEA,
            textoLinea,
            TAM_CELDA,
            false,
          );
        });
        x += anchos[indice] ?? 0;
      });

      y -= altoFila;
      linea(MARGEN, y, MARGEN + ANCHO_UTIL, y);
    }

    y -= 12;
  };

  abrirPrimera();
  for (const tabla of doc.tablas) dibujarTabla(tabla);
  cerrarPagina();

  if (paginas.length === 0) paginas.push("");

  const objetos: string[] = [];
  const kids: string[] = [];

  objetos[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objetos[3] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objetos[4] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

  paginas.forEach((contenido, indice) => {
    const numeroContenido = 5 + indice * 2;
    const numeroPagina = 6 + indice * 2;
    objetos[numeroContenido] = `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`;
    objetos[numeroPagina] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO_PAGINA} ${ALTO_PAGINA}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${numeroContenido} 0 R >>`;
    kids.push(`${numeroPagina} 0 R`);
  });

  objetos[2] = `<< /Type /Pages /Kids [${kids.join(
    " ",
  )}] /Count ${paginas.length} >>`;

  const maximo = 4 + paginas.length * 2;
  const desplazamientos: number[] = new Array(maximo + 1).fill(0);

  let pdf = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  for (let numero = 1; numero <= maximo; numero += 1) {
    desplazamientos[numero] = pdf.length;
    pdf += `${numero} 0 obj\n${objetos[numero] ?? ""}\nendobj\n`;
  }

  const inicioXref = pdf.length;
  pdf += `xref\n0 ${maximo + 1}\n0000000000 65535 f \n`;
  for (let numero = 1; numero <= maximo; numero += 1) {
    pdf += `${String(desplazamientos[numero] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maximo + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF`;

  return codificarLatin1(pdf);
}
