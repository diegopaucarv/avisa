import type { FilaConflictividad } from "@/lib/db/repos/conflictividad";

/**
 * Utilidades CSV de la matriz de conflictividad (Anexo 15), sin dependencias.
 *
 * Se implementa RFC 4180 a mano (comillas dobles, comillas escapadas y comas o
 * saltos de línea dentro de un campo). Es una copia local deliberada del helper
 * de `app/api/v1/matriz/csv.ts`: la matriz del equipo está fuera del alcance de
 * esta pantalla y no se importa para no acoplar las dos features.
 */

/** BOM UTF-8: Excel abre el archivo con tildes correctas sólo si lo lleva. */
export const BOM = "\uFEFF";

/**
 * Cabecera del Anexo 15, en el orden del mockup. «Ver ficha» es una acción de
 * la interfaz y no viaja en el archivo; «N°» se numera al generar cada fila.
 */
export const CABECERA_ANEXO_15: readonly string[] = [
  "N°",
  "Código de caso",
  "Nombre del caso",
  "Región",
  "Alcance",
  "Subsector",
  "Nivel de conflictividad",
  "Nivel de riesgo",
  "Prioridad de atención",
  "Estado",
  "Unidad responsable",
  "Inicio",
  "Último hecho",
  "Compromisos",
  "Tipo de compromiso",
  "Documentos",
];

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

/** Fila del Anexo 15 → celdas en el orden de `CABECERA_ANEXO_15`. */
export function filaACsv(fila: FilaConflictividad, indice: number): string[] {
  return [
    String(indice),
    fila.codigoCaso,
    fila.nombreCaso ?? "",
    fila.region ?? "",
    fila.alcance ?? "",
    fila.subsector ?? "",
    fila.nivelConflictividad ?? "",
    fila.nivelRiesgo ?? "",
    fila.prioridadAtencion ?? "",
    fila.estado ?? "",
    fila.unidadResponsable ?? "",
    fechaDdMmAaaa(fila.fechaInicio),
    fechaDdMmAaaa(fila.ultimoHecho),
    String(fila.compromisos),
    fila.tipoCompromiso ?? "",
    String(fila.documentos),
  ];
}
