/**
 * Escritor XLSX mínimo, sin dependencias.
 *
 * Un `.xlsx` es un ZIP con partes OOXML. Aquí el ZIP se construye con el método
 * 0 (sin compresión), que es válido y no necesita `zlib`: basta con CRC-32,
 * cabeceras locales, directorio central y EOCD. De OOXML se emiten sólo las
 * partes que Excel y LibreOffice necesitan para abrir el libro:
 *
 *   [Content_Types].xml
 *   _rels/.rels
 *   xl/workbook.xml
 *   xl/_rels/workbook.xml.rels
 *   xl/worksheets/sheetN.xml
 *
 * Cada celda usa `inlineStr` (sin `sharedStrings`) y distingue números de
 * texto: un `number` va como `<v>` numérico y todo lo demás como cadena.
 */

import { normalizar } from "./json";

export type HojaXlsx = {
  nombre: string;
  filas: readonly Record<string, unknown>[];
  /** Orden y subconjunto de columnas; si falta, se deduce de las filas. */
  columnas?: readonly string[];
};

type EntradaZip = { nombre: string; datos: Uint8Array };

type Celda = { tipo: "n" | "b"; texto: string } | { tipo: "t"; texto: string };

const codificador = new TextEncoder();

const TIPO_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const TIPO_REL_PAQUETE =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const TIPO_CT_TRABAJO =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const TIPO_CT_HOJA =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";

function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function letraColumna(indice: number): string {
  let numero = indice + 1;
  let salida = "";
  while (numero > 0) {
    const resto = (numero - 1) % 26;
    salida = String.fromCharCode(65 + resto) + salida;
    numero = Math.floor((numero - 1) / 26);
  }
  return salida;
}

function columnasDe(
  filas: readonly Record<string, unknown>[],
  columnas: readonly string[] | undefined,
): string[] {
  if (columnas && columnas.length > 0) return [...columnas];

  const vistas = new Set<string>();
  for (const fila of filas) {
    for (const clave of Object.keys(fila)) vistas.add(clave);
  }
  return [...vistas];
}

function celdaDe(valor: unknown): Celda | null {
  const normalizado = normalizar(valor);
  if (normalizado === null) return null;

  if (typeof normalizado === "number") {
    return { tipo: "n", texto: String(normalizado) };
  }
  if (typeof normalizado === "boolean") {
    return { tipo: "b", texto: normalizado ? "1" : "0" };
  }
  if (typeof normalizado === "string") {
    return { tipo: "t", texto: normalizado };
  }
  return { tipo: "t", texto: JSON.stringify(normalizado) };
}

function celdaXml(
  numeroFila: number,
  indice: number,
  celda: Celda | null,
): string {
  if (!celda) return "";
  const referencia = `${letraColumna(indice)}${numeroFila}`;

  if (celda.tipo === "t") {
    return `<c r="${referencia}" t="inlineStr"><is><t xml:space="preserve">${escaparXml(
      celda.texto,
    )}</t></is></c>`;
  }
  return `<c r="${referencia}" t="${celda.tipo}"><v>${celda.texto}</v></c>`;
}

function filaXml(
  numeroFila: number,
  celdas: readonly (Celda | null)[],
): string {
  const partes = celdas
    .map((celda, indice) => celdaXml(numeroFila, indice, celda))
    .join("");
  return `<row r="${numeroFila}">${partes}</row>`;
}

function hojaXml(
  filas: readonly Record<string, unknown>[],
  columnas: readonly string[],
): string {
  const filasXml: string[] = [];

  if (columnas.length > 0) {
    filasXml.push(
      filaXml(
        1,
        columnas.map((columna) => ({ tipo: "t", texto: columna }) as Celda),
      ),
    );
  }

  filas.forEach((fila, indice) => {
    filasXml.push(
      filaXml(
        indice + 2,
        columnas.map((columna) => celdaDe(fila[columna])),
      ),
    );
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${filasXml.join(
    "",
  )}</sheetData></worksheet>`;
}

/** Nombre válido de hoja: sin `[]:*?/\`, máximo 31 caracteres y único. */
function nombreHoja(nombre: string, usados: Set<string>): string {
  const limpio = nombre
    .replace(/[\[\]:*?/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const base = (limpio || "Hoja").slice(0, 31);

  let candidato = base;
  let sufijo = 2;
  while (usados.has(candidato.toLowerCase())) {
    const marca = ` (${sufijo})`;
    candidato = `${base.slice(0, 31 - marca.length)}${marca}`;
    sufijo += 1;
  }
  usados.add(candidato.toLowerCase());
  return candidato;
}

/* ------------------------------------------------------------------------- *
 * ZIP (método 0, sin compresión)
 * ------------------------------------------------------------------------- */

const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tabla[n] = c >>> 0;
  }
  return tabla;
})();

function crc32(datos: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < datos.length; i += 1) {
    crc = TABLA_CRC[(crc ^ datos[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function construirZip(entradas: readonly EntradaZip[]): Uint8Array {
  const locales: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let desplazamiento = 0;

  // 1980-01-01: fecha DOS válida y fija, para que el archivo sea reproducible.
  const fechaDos = 0x0021;

  for (const entrada of entradas) {
    const nombre = codificador.encode(entrada.nombre);
    const crc = crc32(entrada.datos);

    const cabecera = new Uint8Array(30 + nombre.length);
    const hv = new DataView(cabecera.buffer);
    hv.setUint32(0, 0x04034b50, true); // firma local
    hv.setUint16(4, 20, true); // versión necesaria
    hv.setUint16(6, 0x0800, true); // nombres en UTF-8
    hv.setUint16(8, 0, true); // método 0: almacenado
    hv.setUint16(10, 0, true); // hora
    hv.setUint16(12, fechaDos, true);
    hv.setUint32(14, crc, true);
    hv.setUint32(18, entrada.datos.length, true);
    hv.setUint32(22, entrada.datos.length, true);
    hv.setUint16(26, nombre.length, true);
    hv.setUint16(28, 0, true); // extra
    cabecera.set(nombre, 30);

    locales.push(cabecera, entrada.datos);

    const registro = new Uint8Array(46 + nombre.length);
    const rv = new DataView(registro.buffer);
    rv.setUint32(0, 0x02014b50, true); // firma central
    rv.setUint16(4, 20, true); // versión que creó
    rv.setUint16(6, 20, true); // versión necesaria
    rv.setUint16(8, 0x0800, true);
    rv.setUint16(10, 0, true);
    rv.setUint16(12, 0, true);
    rv.setUint16(14, fechaDos, true);
    rv.setUint32(16, crc, true);
    rv.setUint32(20, entrada.datos.length, true);
    rv.setUint32(24, entrada.datos.length, true);
    rv.setUint16(28, nombre.length, true);
    rv.setUint16(30, 0, true); // extra
    rv.setUint16(32, 0, true); // comentario
    rv.setUint16(34, 0, true); // disco
    rv.setUint16(36, 0, true); // atributos internos
    rv.setUint32(38, 0, true); // atributos externos
    rv.setUint32(42, desplazamiento, true);
    registro.set(nombre, 46);
    central.push(registro);

    desplazamiento += cabecera.length + entrada.datos.length;
  }

  const tamanoCentral = central.reduce((suma, parte) => suma + parte.length, 0);

  const fin = new Uint8Array(22);
  const fv = new DataView(fin.buffer);
  fv.setUint32(0, 0x06054b50, true); // EOCD
  fv.setUint16(4, 0, true); // disco
  fv.setUint16(6, 0, true); // disco del directorio
  fv.setUint16(8, entradas.length, true);
  fv.setUint16(10, entradas.length, true);
  fv.setUint32(12, tamanoCentral, true);
  fv.setUint32(16, desplazamiento, true);
  fv.setUint16(20, 0, true); // comentario

  const total = desplazamiento + tamanoCentral + fin.length;
  const salida = new Uint8Array(total);
  let posicion = 0;
  for (const parte of [...locales, ...central, fin]) {
    salida.set(parte, posicion);
    posicion += parte.length;
  }
  return salida;
}

/* ------------------------------------------------------------------------- *
 * Libro
 * ------------------------------------------------------------------------- */

export function escribirXlsx(hojas: readonly HojaXlsx[]): Uint8Array {
  const lista: HojaXlsx[] =
    hojas.length > 0 ? [...hojas] : [{ nombre: "Hoja1", filas: [] }];

  const usados = new Set<string>();
  const nombres = lista.map((hoja) => nombreHoja(hoja.nombre, usados));

  const hojasComparadas = lista.map((hoja) => ({
    ...hoja,
    columnas: columnasDe(hoja.filas, hoja.columnas),
  }));

  const contentTypes: string[] = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    `<Override PartName="/xl/workbook.xml" ContentType="${TIPO_CT_TRABAJO}"/>`,
  ];

  const relacionesLibro: string[] = [];
  const hojasLibro: string[] = [];
  const partes: EntradaZip[] = [];

  hojasComparadas.forEach((hoja, indice) => {
    const numero = indice + 1;
    contentTypes.push(
      `<Override PartName="/xl/worksheets/sheet${numero}.xml" ContentType="${TIPO_CT_HOJA}"/>`,
    );
    relacionDeHoja(
      relacionesLibro,
      hojasLibro,
      nombres[indice] ?? `Hoja${numero}`,
      numero,
    );

    partes.push({
      nombre: `xl/worksheets/sheet${numero}.xml`,
      datos: codificador.encode(hojaXml(hoja.filas, hoja.columnas)),
    });
  });

  const raiz = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${TIPO_REL_PAQUETE}"><Relationship Id="rId1" Type="${TIPO_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const libro = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${TIPO_REL}"><sheets>${hojasLibro.join(
    "",
  )}</sheets></workbook>`;

  const relaciones = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${TIPO_REL_PAQUETE}">${relacionesLibro.join(
    "",
  )}</Relationships>`;

  const tipos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${contentTypes.join(
    "",
  )}</Types>`;

  return construirZip([
    { nombre: "[Content_Types].xml", datos: codificador.encode(tipos) },
    { nombre: "_rels/.rels", datos: codificador.encode(raiz) },
    { nombre: "xl/workbook.xml", datos: codificador.encode(libro) },
    {
      nombre: "xl/_rels/workbook.xml.rels",
      datos: codificador.encode(relaciones),
    },
    ...partes,
  ]);
}

function relacionDeHoja(
  relaciones: string[],
  hojas: string[],
  nombre: string,
  numero: number,
): void {
  relaciones.push(
    `<Relationship Id="rId${numero}" Type="${TIPO_REL}/worksheet" Target="worksheets/sheet${numero}.xml"/>`,
  );
  hojas.push(
    `<sheet name="${escaparXml(nombre)}" sheetId="${numero}" r:id="rId${numero}"/>`,
  );
}
