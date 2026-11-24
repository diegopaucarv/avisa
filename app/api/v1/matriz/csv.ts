import { COLUMNAS_MATRIZ, type MatrizFila } from "@/lib/db/repos/matriz";

/**
 * Utilidades CSV de la matriz, sin dependencias externas.
 *
 * Se implementa RFC 4180 a mano (comillas dobles, comillas escapadas, comas y
 * saltos de línea dentro de un campo) porque el proyecto no incorpora —ni debe
 * incorporar— un parser XLSX. El mismo criterio se replica en la SPA para la
 * plantilla vacía y las pruebas puras.
 */

/** BOM UTF-8: Excel abre el archivo con tildes correctas sólo si lo lleva. */
export const BOM = "\uFEFF";

export type CampoImportado = Exclude<
  keyof MatrizFila,
  "codigoCompromiso" | "bloqueFila"
>;

type DefinicionCampo = {
  campo: CampoImportado;
  /** Cabeceras aceptadas, ya normalizadas con `normalizarCabecera`. */
  alias: readonly string[];
};

/**
 * Cabeceras de la hoja principal del equipo. Los alias cubren las variantes del
 * Excel («Prioridad de Atención», «Área Responsable de Monitoreo de Acción») y
 * los nombres cortos que usa la exportación propia.
 */
const CAMPOS: readonly DefinicionCampo[] = [
  {
    campo: "codigoCaso",
    alias: [
      "codigo_caso",
      "codigo_caso_avisa",
      "codigo_avisa",
      // «Código de caso» es el código oficial del Anexo 15; el identificador
      // propio del archivo del equipo lleva el sufijo «excel».
      "codigo_de_caso",
    ],
  },
  {
    campo: "codigoExcel",
    alias: ["codigo_excel", "codigo_de_caso_excel"],
  },
  { campo: "numero", alias: ["n", "nro", "numero", "num"] },
  { campo: "departamento", alias: ["departamento"] },
  { campo: "sectorista", alias: ["sectorista"] },
  {
    campo: "prioridad",
    alias: ["prioridad", "prioridad_de_atencion"],
  },
  {
    campo: "nombreCaso",
    alias: ["nombre_de_caso", "nombre_caso", "caso"],
  },
  {
    campo: "narracion",
    alias: [
      "narracion_cronologica_tecnica_social",
      "narracion_cronologica",
      "narracion",
    ],
  },
  {
    campo: "analisis",
    alias: ["analisis_de_caso", "analisis_de_caso_canva", "analisis"],
  },
  {
    campo: "actualizacion",
    alias: [
      "timestamp_de_ultima_actualizacion",
      "timestamp_ultima_actualizacion",
      "ultima_actualizacion",
      "actualizacion",
    ],
  },
  {
    campo: "riesgoActual",
    alias: ["descripcion_del_riesgo_actual", "riesgo_actual"],
  },
  { campo: "actoresEstado", alias: ["actores_del_estado"] },
  { campo: "actoresSociedadCivil", alias: ["actores_sociedad_civil"] },
  { campo: "demandas", alias: ["demandas"] },
  {
    campo: "accion",
    alias: [
      "acciones_compromisos_acuerdos",
      "accion_compromiso",
      "compromisos",
      "acciones",
      "accion",
    ],
  },
  {
    campo: "mediosVerificacion",
    alias: [
      "medios_de_verificaciones",
      "medios_de_verificacion",
      "medios_verificaciones",
    ],
  },
  {
    campo: "areaResponsable",
    alias: [
      "area_responsable_de_monitoreo_de_accion",
      "area_responsable",
      "unidad_responsable",
    ],
  },
  {
    campo: "puntoFocal",
    alias: ["punto_focal_monitoreo", "punto_focal"],
  },
  {
    campo: "documentos",
    alias: ["documentos_archivos_otros", "documentos_archivos", "documentos"],
  },
  { campo: "hito", alias: ["hito"] },
  {
    campo: "descripcionHito",
    alias: ["descripcion_del_hito", "descripcion_hito"],
  },
  {
    campo: "responsableHito",
    alias: ["responsable_del_hito", "responsable_hito"],
  },
  { campo: "fechaPlanificada", alias: ["fecha_planificada"] },
  { campo: "fechaReal", alias: ["fecha_real"] },
  { campo: "estado", alias: ["estado_actual", "estado"] },
];

/**
 * Columnas que el Excel fusiona a lo largo de un bloque: al exportar a CSV
 * quedan vacías en las filas siguientes. Se arrastra el último valor visto.
 *
 * No se arrastran S..X a propósito: un blanco en el hito, su descripción, el
 * responsable, las fechas o el estado significa «sin dato», y estimarlo
 * incumpliría la regla de no inventar.
 */
const ARRASTRA: readonly CampoImportado[] = [
  "codigoCaso",
  "codigoExcel",
  "numero",
  "departamento",
  "sectorista",
  "prioridad",
  "nombreCaso",
  "narracion",
  "analisis",
  "actualizacion",
  "riesgoActual",
  "actoresEstado",
  "actoresSociedadCivil",
  "demandas",
  "accion",
  "mediosVerificacion",
  "areaResponsable",
  "puntoFocal",
  "documentos",
];

const POR_ALIAS = new Map<string, CampoImportado>();
for (const definicion of CAMPOS) {
  for (const alias of definicion.alias) {
    if (!POR_ALIAS.has(alias)) POR_ALIAS.set(alias, definicion.campo);
  }
}

/** Cabecera exacta del CSV de exportación (A..W, en el orden del Excel). */
export const CABECERA_MATRIZ: readonly string[] = COLUMNAS_MATRIZ.map(
  (columna) => columna.etiqueta,
);

/** Cabecera del CSV de equivalencias. */
export const CABECERA_MAPEO: readonly string[] = [
  "codigo_excel",
  "codigo_caso",
  "confianza",
  "nota",
  "bloque_fila",
  "fuente",
];

/**
 * Normaliza una cabecera: sin BOM, sin tildes, minúsculas y separadores
 * colapsados a `_`. `N°` se convierte en `n`.
 */
export function normalizarCabecera(valor: string): string {
  return valor
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[°º]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

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

/**
 * Parser CSV sin dependencias. Acepta CRLF, LF y CR; comillas dobles escapadas
 * como `""`; y comas o saltos dentro de un campo entrecomillado.
 *
 * Devuelve todas las filas, incluidas las de cabecera. Las filas en las que
 * todas las celdas están vacías se descartan para que una línea en blanco al
 * final no genere un registro fantasma.
 */
export function parsearCsv(texto: string): string[][] {
  const limpio = texto.startsWith(BOM) ? texto.slice(BOM.length) : texto;
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let entreComillas = false;
  let i = 0;

  while (i < limpio.length) {
    const caracter = limpio[i];

    if (entreComillas) {
      if (caracter === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"';
          i += 2;
          continue;
        }
        entreComillas = false;
        i += 1;
        continue;
      }
      campo += caracter;
      i += 1;
      continue;
    }

    if (caracter === '"') {
      entreComillas = true;
      i += 1;
      continue;
    }

    if (caracter === ",") {
      fila.push(campo);
      campo = "";
      i += 1;
      continue;
    }

    if (caracter === "\r" || caracter === "\n") {
      fila.push(campo);
      campo = "";
      filas.push(fila);
      fila = [];
      i += caracter === "\r" && limpio[i + 1] === "\n" ? 2 : 1;
      continue;
    }

    campo += caracter;
    i += 1;
  }

  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }

  return filas.filter((registro) =>
    registro.some((celda) => celda.trim() !== ""),
  );
}

export type CabeceraLeida = {
  indices: Partial<Record<CampoImportado, number>>;
  /** Campo canónico → rótulo tal como venía en el archivo. */
  reconocidas: Record<string, string>;
  ignoradas: string[];
};

/**
 * Empareja la cabecera del archivo con los campos conocidos. La primera
 * aparición de un campo gana; los rótulos extra se declaran ignorados en lugar
 * de descartarse en silencio.
 */
export function leerCabecera(cabecera: readonly string[]): CabeceraLeida {
  const indices: Partial<Record<CampoImportado, number>> = {};
  const reconocidas: Record<string, string> = {};
  const ignoradas: string[] = [];

  cabecera.forEach((rotulo, indice) => {
    const normalizado = normalizarCabecera(rotulo);
    const campo = POR_ALIAS.get(normalizado);
    if (!campo) {
      if (rotulo.trim() !== "") ignoradas.push(rotulo.trim());
      return;
    }
    if (indices[campo] === undefined) {
      indices[campo] = indice;
      reconocidas[campo] = rotulo.trim();
    } else {
      ignoradas.push(rotulo.trim());
    }
  });

  return { indices, reconocidas, ignoradas };
}

export type FilaFuente = {
  fila: number;
} & Record<CampoImportado, string | null>;

function celda(celdas: readonly string[], indice: number | undefined): string {
  if (indice === undefined) return "";
  return (celdas[indice] ?? "").trim();
}

/**
 * Convierte la matriz parseada en filas con los campos canónicos, aplicando el
 * arrastre de las celdas que el Excel fusiona. `fila` es la posición del
 * registro en el archivo (la cabecera es la 1).
 */
export function construirFilas(
  registros: readonly (readonly string[])[],
  leida: CabeceraLeida,
): FilaFuente[] {
  const acumulado = new Map<CampoImportado, string>();
  const filas: FilaFuente[] = [];

  for (let indice = 0; indice < registros.length; indice += 1) {
    const celdas = registros[indice] ?? [];
    const valores = {} as Record<CampoImportado, string | null>;

    for (const definicion of CAMPOS) {
      const valor = celda(celdas, leida.indices[definicion.campo]);
      if (ARRASTRA.includes(definicion.campo)) {
        if (valor !== "") {
          acumulado.set(definicion.campo, valor);
        }
        valores[definicion.campo] = acumulado.get(definicion.campo) ?? null;
      } else {
        valores[definicion.campo] = valor === "" ? null : valor;
      }
    }

    filas.push({ fila: indice + 2, ...valores });
  }

  return filas;
}

/**
 * Fila del repositorio → celdas en el orden A..W. Las columnas sin dato salen
 * vacías: nunca se rellenan con un guion ni con un cero.
 */
export function filaAMatriz(fila: MatrizFila): string[] {
  return COLUMNAS_MATRIZ.map((columna) => {
    const valor = fila[columna.clave];
    return valor === null || valor === undefined ? "" : String(valor);
  });
}
