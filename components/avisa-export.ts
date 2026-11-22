/**
 * Descarga de CSV para la demostración.
 *
 * El archivo se genera en el navegador (no hay servidor ni persistencia): se
 * agrega BOM para que Excel reconozca UTF-8, se usan saltos CRLF y se escapan
 * las celdas con comillas dobles. Cada exportación debe recibir una nota de
 * encabezado que aclare que los datos son demostrativos y su fecha.
 */

export type CsvCell = string | number;

const CRLF = "\r\n";
const BOM = "\uFEFF";

const pad = (value: number) => String(value).padStart(2, "0");

const escapeCell = (value: CsvCell) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const formatStamp = (date: Date) =>
  `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;

/**
 * Nota estándar de encabezado para exportaciones demostrativas.
 * Incluye la fecha y hora local de la descarga.
 */
export function demoExportNote(scope: string, exportedAt: Date = new Date()) {
  return `Datos demostrativos · ${scope} · Exportado el ${formatStamp(
    exportedAt,
  )} (hora local). No usar para decisiones institucionales ni asociar a personas reales.`;
}

/**
 * Construye y descarga un CSV en el cliente.
 * `rows` debe incluir la fila de encabezados como primer elemento.
 */
export function downloadCsv(
  filename: string,
  rows: CsvCell[][],
  meta?: string,
) {
  if (typeof window === "undefined") return;

  const lines: string[] = [];
  if (meta) lines.push(escapeCell(meta));
  rows.forEach((row) => lines.push(row.map(escapeCell).join(",")));

  const content = `${BOM}${lines.join(CRLF)}${CRLF}`;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.toLowerCase().endsWith(".csv")
    ? filename
    : `${filename}.csv`;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Se libera el objeto URL en el siguiente ciclo para permitir la descarga.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
