/**
 * Exportaciones JSON sin dependencias.
 *
 * El objetivo no es sólo volcar datos, sino que dos corridas sobre el mismo
 * estado produzcan exactamente el mismo texto: las fechas se serializan en ISO
 * (UTC), los números no finitos pasan a `null`, los `bigint` a cadena y las
 * claves de cada objeto se ordenan. Así el archivo sirve para comparar,
 * versionar o auditar sin ruido de orden.
 */

export type FilaExportada = Record<string, unknown>;

/** Volcado de una entidad lógica (`entidad` es su nombre canónico). */
export type DumpEntidad = {
  entidad: string;
  generadoEn: string;
  filas: unknown[];
};

/** Volcado de la base completa: cada clave de `tablas` es una entidad. */
export type DumpBase = {
  generadoEn: string;
  tablas: Record<string, unknown[]>;
};

export function esFila(valor: unknown): valor is FilaExportada {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/**
 * Deja un valor en una forma estable y serializable.
 *
 * - `Date` → cadena ISO 8601 (`toISOString`, siempre UTC).
 * - `undefined` → `null` (una columna ausente y una nula se exportan igual).
 * - `NaN` e `Infinity` → `null` (JSON no los representa).
 * - `bigint` → cadena decimal (JSON no los representa sin perder precisión).
 * - Objetos → mismas claves ordenadas alfabéticamente.
 */
export function normalizar(valor: unknown): unknown {
  if (valor === null || valor === undefined) return null;

  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor.toISOString();
  }

  if (typeof valor === "bigint") return valor.toString();

  if (typeof valor === "number") {
    return Number.isFinite(valor) ? valor : null;
  }

  if (typeof valor === "string" || typeof valor === "boolean") {
    return valor;
  }

  if (Array.isArray(valor)) return valor.map(normalizar);

  if (esFila(valor)) {
    const salida: Record<string, unknown> = {};
    for (const clave of Object.keys(valor).sort()) {
      salida[clave] = normalizar(valor[clave]);
    }
    return salida;
  }

  return null;
}

/** Serializa a UTF-8 con la forma normalizada y una indentación previsible. */
export function serializarJson(valor: unknown, espacio = 2): Uint8Array {
  const texto = JSON.stringify(normalizar(valor), null, espacio);
  return new TextEncoder().encode(texto);
}

export function dumpEntidad(
  entidad: string,
  filas: readonly unknown[],
  generadoEn: Date = new Date(),
): DumpEntidad {
  return {
    entidad,
    generadoEn: generadoEn.toISOString(),
    filas: filas.map((fila) => normalizar(fila)),
  };
}

export function dumpBase(
  tablas: Record<string, readonly unknown[]>,
  generadoEn: Date = new Date(),
): DumpBase {
  const salida: Record<string, unknown[]> = {};
  for (const [nombre, filas] of Object.entries(tablas)) {
    salida[nombre] = filas.map((fila) => normalizar(fila));
  }
  return {
    generadoEn: generadoEn.toISOString(),
    tablas: salida,
  };
}
