/**
 * Utilidades CSV del dashboard analítico, sin dependencias.
 *
 * Se implementa RFC 4180 a mano (comillas dobles, comillas escapadas y comas o
 * saltos de línea dentro de un campo). Es una copia local deliberada del helper
 * de `app/api/v1/conflictividad/csv.ts`: la matriz y este dashboard son
 * pantallas distintas y no se importan entre sí.
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

/** `2026-05-01` → `01/05/2026`; sin dato → celda vacía, nunca «—». */
export function fechaDdMmAaaa(valor: string | null): string {
  if (!valor) return "";
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor.trim());
  if (!partes) return "";
  return `${partes[3]}/${partes[2]}/${partes[1]}`;
}

/** Una celda suelta con el mismo escapado, para las líneas de metadatos. */
export function lineaMetadata(etiqueta: string, valor: string): string {
  return `${escaparCelda(etiqueta)},${escaparCelda(valor)}\r\n`;
}
