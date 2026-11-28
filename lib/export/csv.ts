/**
 * Escritor CSV mínimo, sin dependencias.
 *
 * Sigue RFC 4180: separador coma, salto CRLF y comillas dobles para los campos
 * que contienen coma, comilla o salto de línea. El BOM UTF-8 lo añade quien
 * responde, no esta función, para que el mismo texto sirva en un cuerpo HTML o
 * en una descarga.
 *
 * Es el mismo criterio que ya usan `app/api/v1/matriz/csv.ts` y la exportación
 * de sugerencias; se centraliza aquí para que las nuevas descargas no
 * reimplementen el escapado.
 */

/** BOM UTF-8: Excel abre el archivo con tildes correctas sólo si lo lleva. */
export const BOM = "\uFEFF";

/** Escapa una celda según RFC 4180. Nulo o indefinido salen vacíos. */
export function escaparCelda(valor: unknown): string {
  if (valor === null || valor === undefined) return "";

  const texto = typeof valor === "string" ? valor : String(valor);
  if (/[",\r\n]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

/** Genera un CSV con CRLF y salto final. El BOM lo añade quien responde. */
export function generarCsv(
  cabecera: readonly string[],
  filas: readonly (readonly unknown[])[],
): string {
  const lineas = [cabecera, ...filas].map((fila) =>
    fila.map(escaparCelda).join(","),
  );
  return `${lineas.join("\r\n")}\r\n`;
}
