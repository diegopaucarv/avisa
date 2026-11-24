import type {
  AlertaFuente,
  Anexo14Resultado,
  DocumentoFuente,
  ReunionFuente,
} from "@/lib/db/repos/export-anexos";
import type { CaseDetail } from "@/lib/db/repos/cases";
import type {
  FilaConflictividad,
  ResumenConflictividad,
} from "@/lib/db/repos/conflictividad";
import type { ReporteListItem } from "@/lib/db/repos/reportes";

import {
  celda,
  fechaCelda,
  fechaDdMmAaaa,
  sinEmojis,
  textoPlano,
  type BloqueDocumento,
  type DocumentoAnexo,
  type TablaDocumento,
} from "./documento";

/**
 * Armado de los anexos oficiales a partir de las fuentes del repositorio.
 *
 * Aquí sólo se decide qué va en cada sección y qué se declara como faltante;
 * la presentación (HTML/PDF) la resuelve `documento.ts`. Ninguna sección
 * inventa contenido: si la fuente no trae el dato, la sección sale «sin dato»
 * y su nombre se agrega a `faltantes`.
 *
 * Los nombres y el orden de las columnas siguen `docs/01_requisitos/guia.md` y
 * los mockups de `docs/07_frontend/mockups/`.
 */

/* ------------------------------------------------------------------------- *
 * Catálogo de anexos
 * ------------------------------------------------------------------------- */

export type DefinicionAnexo = {
  numero: string;
  titulo: string;
  referencia: string;
  /** Fuente principal del anexo. */
  fuente: "alerta" | "documento" | "reunion" | "reporte";
  /** Tipo de `core.cat_tipos_documento` cuando la fuente es un documento. */
  tipoDocumento?: number;
  /** `true` si el documento es vertical (acta, ayuda memoria, relatoría). */
  vertical?: boolean;
};

export const CATALOGO_ANEXOS: readonly DefinicionAnexo[] = [
  {
    numero: "03",
    titulo: "Reporte de Alerta Temprana",
    referencia: "Anexo N° 03",
    fuente: "alerta",
  },
  {
    numero: "04",
    titulo: "Reporte de Clima Social General",
    referencia: "Anexo N° 04",
    fuente: "documento",
    tipoDocumento: 2,
  },
  {
    numero: "05",
    titulo: "Reporte de Clima Social Focalizado",
    referencia: "Anexo N° 05",
    fuente: "documento",
    tipoDocumento: 3,
  },
  {
    numero: "06",
    titulo: "Plan de Acción",
    referencia: "Anexo N° 06",
    fuente: "documento",
    tipoDocumento: 4,
  },
  {
    numero: "10",
    titulo: "Acta de Acuerdo",
    referencia: "Anexo N° 10",
    fuente: "documento",
    tipoDocumento: 8,
    vertical: true,
  },
  {
    numero: "12",
    titulo: "Ayuda Memoria",
    referencia: "Anexo N° 12",
    fuente: "documento",
    tipoDocumento: 10,
    vertical: true,
  },
  {
    numero: "13",
    titulo: "Relatoría",
    referencia: "Anexo N° 13",
    fuente: "documento",
    tipoDocumento: 11,
    vertical: true,
  },
  {
    numero: "16",
    titulo: "Registro de Reuniones",
    referencia: "Anexo N° 16",
    fuente: "reunion",
  },
  {
    numero: "17",
    titulo: "Registro de Reportes",
    referencia: "Anexo N° 17",
    fuente: "reporte",
  },
];

export function definicionAnexo(numero: string): DefinicionAnexo | null {
  return CATALOGO_ANEXOS.find((anexo) => anexo.numero === numero) ?? null;
}

/**
 * Normaliza `15`, `015`, `anexo-15`, `anexo n° 15` a `"15"`. Devuelve `null`
 * si no es un número de dos dígitos.
 */
export function normalizarNumero(valor: string): string | null {
  const limpio = valor
    .trim()
    .toLowerCase()
    .replace(/^anexo[\s\-_]*/, "")
    .replace(/^n[°º.]*[\s\-_]*/, "")
    .replace(/^[\s\-_]+/, "");
  const coincidencia = /^0*(\d{1,2})$/.exec(limpio);
  if (!coincidencia) return null;
  const numero = Number(coincidencia[1]);
  if (!Number.isInteger(numero) || numero < 1 || numero > 99) return null;
  return String(numero).padStart(2, "0");
}

/* ------------------------------------------------------------------------- *
 * Utilidades de secciones
 * ------------------------------------------------------------------------- */

function llano(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Título propio de un bloque: primera línea, sin emojis ni numeración. */
function tituloDeBloque(texto: string): string {
  const primera = texto.split("\n")[0] ?? "";
  return llano(
    primera
      .replace(/^[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/u, "")
      .replace(/^\d+\s*[.)\-]?\s*/, "")
      .replace(/:$/, ""),
  );
}

type DefinicionSeccion = { titulo: string; claves: readonly string[] };

type SeccionArmada = { titulo: string; texto: string | null };

/**
 * Reparte los bloques del documento entre las secciones del formato oficial
 * según el título que cada bloque declara en su primera línea. Los bloques que
 * no se reconocen no se fuerzan dentro de una sección: se listan aparte.
 */
function seccionesDesdeDocumento(
  textos: readonly string[],
  definiciones: readonly DefinicionSeccion[],
): { secciones: SeccionArmada[]; otros: string[]; reconocidos: number } {
  const usados = new Set<number>();
  const secciones: SeccionArmada[] = [];

  for (const definicion of definiciones) {
    const encontrados: string[] = [];
    textos.forEach((texto, indice) => {
      if (usados.has(indice)) return;
      const titulo = tituloDeBloque(texto);
      if (definicion.claves.some((clave) => titulo.includes(clave))) {
        usados.add(indice);
        encontrados.push(texto);
      }
    });
    secciones.push({
      titulo: definicion.titulo,
      texto: encontrados.length > 0 ? encontrados.join("\n\n") : null,
    });
  }

  const otros = textos.filter((_, indice) => !usados.has(indice));
  return { secciones, otros, reconocidos: usados.size };
}

function deduplicar(textos: readonly (string | null)[]): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const texto of textos) {
    const limpio = textoPlano(texto);
    if (!limpio) continue;
    const clave = limpio.replace(/\s+/g, " ").trim();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(limpio);
  }
  return salida;
}

function faltantesDeSecciones(secciones: readonly SeccionArmada[]): string[] {
  return secciones
    .filter((seccion) => !seccion.texto)
    .map((seccion) => `${seccion.titulo}: la fuente no trae esta sección.`);
}

function tablaVacia(mensaje: string): string[] {
  return [mensaje];
}

/* ------------------------------------------------------------------------- *
 * Anexo 03 — Reporte de Alerta Temprana
 * ------------------------------------------------------------------------- */

export function construirAnexo03(alerta: AlertaFuente): DocumentoAnexo {
  const ambito = [
    textoPlano(alerta.region),
    textoPlano(alerta.provincia),
    textoPlano(alerta.distrito),
  ]
    .filter(Boolean)
    .join(" / ");

  const secciones: SeccionArmada[] = [
    { titulo: "1. SITUACIÓN ACTUAL", texto: alerta.situacionActual },
    { titulo: "2. HECHOS RECIENTES", texto: alerta.hechosRecientes },
    { titulo: "3. DESCRIPCIÓN DEL RIESGO", texto: alerta.descripcionRiesgo },
    { titulo: "4. ACTORES CLAVE", texto: alerta.actoresClave },
    { titulo: "5. DEMANDAS INMEDIATAS", texto: alerta.demandasInmediatas },
    { titulo: "6. ACCIONES OAIPCS", texto: alerta.accionesOaipcs },
    { titulo: "7. ACCIONES SUGERIDAS", texto: alerta.accionesSugeridas },
  ];

  return {
    titulo: "Reporte de Alerta Temprana",
    subtitulo: alerta.titulo,
    referencia: "Anexo N° 03",
    orientacion: "portrait",
    meta: [
      { etiqueta: "Código", valor: alerta.codigo },
      { etiqueta: "Fecha", valor: fechaDdMmAaaa(alerta.fecha) || "—" },
      { etiqueta: "Ámbito", valor: ambito || alerta.alcance },
      { etiqueta: "Nivel de riesgo", valor: alerta.nivel },
      { etiqueta: "Prioridad", valor: alerta.prioridad },
      { etiqueta: "Caso vinculado", valor: alerta.casoCodigo },
    ],
    bloques: secciones.map((seccion) => ({
      tipo: "parrafos" as const,
      titulo: seccion.titulo,
      texto: seccion.texto,
    })),
    faltantes: faltantesDeSecciones(secciones),
    notas: alerta.casoTitulo ? [`Caso: ${alerta.casoTitulo}`] : [],
  };
}

/* ------------------------------------------------------------------------- *
 * Anexos 04, 05, 06, 10, 12 y 13 — documentos oficiales
 * ------------------------------------------------------------------------- */

const SECCIONES_POR_ANEXO: Readonly<
  Record<string, readonly DefinicionSeccion[]>
> = {
  "04": [
    {
      titulo: "1. RESUMEN EJECUTIVO",
      claves: ["resumen ejecutivo", "resumen"],
    },
    { titulo: "2. ACTORES", claves: ["actores"] },
    {
      titulo: "3. CLIMA SOCIAL Y HECHOS RECIENTES",
      claves: ["hechos recientes", "clima social", "hechos"],
    },
    { titulo: "4. DEMANDAS LOCALES", claves: ["demandas"] },
    {
      titulo: "5. EVALUACIÓN DE RIESGO",
      claves: ["evaluacion de riesgo", "analisis de riesgo", "riesgo"],
    },
    {
      titulo: "6. OPORTUNIDADES ESTRATÉGICAS Y ACCIONES PREVISTAS",
      claves: ["oportunidad", "acciones previstas"],
    },
  ],
  "05": [
    { titulo: "ALERTA CLAVE", claves: ["alerta clave", "alerta"] },
    { titulo: "CONTEXTO RÁPIDO", claves: ["contexto"] },
    { titulo: "2. ACTORES", claves: ["actores"] },
    {
      titulo: "3. FOCOS DE TENSIÓN",
      claves: ["focos de tension", "focos", "tension"],
    },
    { titulo: "DEMANDAS PRINCIPALES", claves: ["demandas"] },
    { titulo: "RIESGOS INMEDIATOS", claves: ["riesgos inmediatos", "riesgo"] },
    { titulo: "OPORTUNIDADES DE INTERVENCIÓN", claves: ["oportunidad"] },
    { titulo: "RECOMENDACIONES", claves: ["recomendacion"] },
  ],
  "06": [
    { titulo: "SITUACIÓN ACTUAL", claves: ["situacion"] },
    { titulo: "ACTORES", claves: ["actores"] },
    { titulo: "HECHOS RECIENTES", claves: ["hechos"] },
    { titulo: "DEMANDAS Y NARRATIVAS", claves: ["demandas", "narrativas"] },
    { titulo: "ACCIONES INMEDIATAS", claves: ["acciones"] },
    { titulo: "RECOMENDACIONES", claves: ["recomendacion"] },
  ],
  "10": [
    { titulo: "ASISTENTES", claves: ["asistentes", "participantes"] },
    { titulo: "DESARROLLO", claves: ["desarrollo"] },
    { titulo: "ACUERDOS", claves: ["acuerdos", "acuerdo"] },
    { titulo: "PEDIDOS", claves: ["pedidos", "pedido"] },
    { titulo: "OBSERVACIONES", claves: ["observaciones", "observacion"] },
  ],
  "12": [
    { titulo: "I. OBJETIVO", claves: ["objetivo"] },
    { titulo: "II. PARTICIPANTES", claves: ["participantes"] },
    { titulo: "III. TEMAS TRATADOS", claves: ["temas", "agenda"] },
    { titulo: "IV. CONCLUSIONES", claves: ["conclusiones", "conclusion"] },
    { titulo: "COMPROMISOS", claves: ["compromisos", "compromiso"] },
  ],
  "13": [
    { titulo: "I. DATOS GENERALES", claves: ["datos generales"] },
    { titulo: "II. OBJETIVO", claves: ["objetivo"] },
    { titulo: "III. PARTICIPANTES", claves: ["participantes"] },
    {
      titulo: "IV. CONCLUSIONES Y COMPROMISOS",
      claves: ["conclusiones", "compromisos"],
    },
    { titulo: "V. DESARROLLO", claves: ["desarrollo"] },
    {
      titulo: "VI. SECCIÓN ANALÍTICA",
      claves: ["seccion analitica", "analitica", "analisis"],
    },
    {
      titulo: "VII. NOTA METODOLÓGICA",
      claves: ["nota metodologica", "metodolog"],
    },
  ],
};

const TITULO_DOCUMENTO: Readonly<Record<string, string>> = {
  "04": "Reporte de Clima Social General",
  "05": "Reporte de Clima Social Focalizado",
  "06": "Plan de Acción",
  "10": "Acta de Acuerdo",
  "12": "Ayuda Memoria",
  "13": "Relatoría",
};

export function construirAnexoDocumento(
  numero: string,
  documento: DocumentoFuente,
): DocumentoAnexo {
  const definiciones = SECCIONES_POR_ANEXO[numero] ?? [];
  const textos = deduplicar([
    documento.resumen,
    ...documento.bloques.map((bloque) => bloque.texto),
  ]);
  const { secciones, otros, reconocidos } = seccionesDesdeDocumento(
    textos,
    definiciones,
  );

  // Si el documento no declara títulos de sección, su resumen se usa como
  // primera sección en lugar de perderse entre «otros contenidos».
  if (reconocidos === 0 && documento.resumen && secciones.length > 0) {
    const primera = secciones[0];
    if (primera && !primera.texto) {
      primera.texto = documento.resumen;
      const indice = textos.indexOf(documento.resumen);
      if (indice >= 0) textos.splice(indice, 1);
    }
  }

  const bloques: BloqueDocumento[] = secciones.map((seccion) => ({
    tipo: "parrafos" as const,
    titulo: seccion.titulo,
    texto: seccion.texto,
  }));

  const faltantes = faltantesDeSecciones(secciones);
  if (otros.length > 0) {
    bloques.push({
      tipo: "parrafos",
      titulo: "OTROS CONTENIDOS REGISTRADOS",
      texto: otros.join("\n\n"),
    });
  }

  if (!documento.fecha) faltantes.push("Fecha: el documento no la registra.");
  if (!documento.responsable && !documento.autorTexto)
    faltantes.push("Responsable: el documento no tiene responsable resoluble.");
  if (!documento.region && !documento.distrito)
    faltantes.push(
      "Ámbito geográfico: el documento no tiene distrito ni región.",
    );

  const notas: string[] = [];
  if (documento.tipoNombre)
    notas.push(`Tipo de documento: ${documento.tipoNombre}.`);
  if (documento.urlPdf) notas.push(`Archivo original: ${documento.urlPdf}`);
  if (otros.length > 0)
    notas.push(
      "Los bloques que no declaran un título de sección se conservan íntegros al final; no se reasignan a una sección del formato.",
    );

  return {
    titulo: TITULO_DOCUMENTO[numero] ?? "Documento oficial",
    subtitulo: documento.titulo,
    referencia: `Anexo N° ${numero}`,
    orientacion: ["10", "12", "13"].includes(numero) ? "portrait" : "portrait",
    meta: [
      { etiqueta: "Código", valor: documento.codigo },
      { etiqueta: "Fecha", valor: fechaDdMmAaaa(documento.fecha) || "—" },
      {
        etiqueta: "Responsable",
        valor: documento.responsable ?? documento.autorTexto,
      },
      {
        etiqueta: "Ámbito",
        valor:
          [documento.region, documento.provincia, documento.distrito]
            .filter(Boolean)
            .join(" / ") || null,
      },
      { etiqueta: "Caso", valor: documento.casoCodigo },
      { etiqueta: "Documento", valor: documento.tipoNombre },
    ],
    bloques,
    faltantes,
    notas,
  };
}

/* ------------------------------------------------------------------------- *
 * Anexo 16 — Registro de Reuniones
 * ------------------------------------------------------------------------- */

export function construirAnexo16(reunion: ReunionFuente): DocumentoAnexo {
  const faltantes: string[] = [];
  if (reunion.asistentes === 0)
    faltantes.push(
      "Asistencia: la reunión no tiene participantes marcados como asistentes.",
    );
  if (!reunion.lugar) faltantes.push("Lugar: la reunión no lo registra.");
  if (!reunion.tieneAyudaMemoria)
    faltantes.push("Ayuda memoria: la reunión no la tiene registrada.");
  if (!reunion.tieneRelatoria)
    faltantes.push("Relatoría: la reunión no la tiene registrada.");
  if (!reunion.publicacion)
    faltantes.push(
      "Publicación / nota: la reunión no tiene URL de publicación.",
    );

  const tabla: TablaDocumento = {
    columnas: [
      { titulo: "Tipo", ancho: 1.4 },
      { titulo: "Código", ancho: 1.6, tipo: "codigo" },
      { titulo: "Sector", ancho: 1.4 },
      { titulo: "Responsable", ancho: 2 },
      { titulo: "Fecha", ancho: 1.2, tipo: "fecha" },
      { titulo: "Departamento", ancho: 1.4 },
      { titulo: "Lugar", ancho: 2 },
      { titulo: "Título", ancho: 3 },
      { titulo: "Asistencia", ancho: 1, alineacion: "centro" },
      { titulo: "AM", ancho: 0.8, alineacion: "centro" },
      { titulo: "Relatoría", ancho: 1, alineacion: "centro" },
      { titulo: "Publicación / Nota", ancho: 2 },
    ],
    filas: [
      [
        reunion.tipo ?? "—",
        reunion.codigo || "—",
        reunion.region ?? "—",
        reunion.responsable ?? "—",
        fechaCelda(reunion.fecha),
        reunion.region ?? "—",
        reunion.lugar ?? "—",
        reunion.titulo ?? "—",
        reunion.asistentes > 0 ? String(reunion.asistentes) : "—",
        reunion.tieneAyudaMemoria ? "Sí" : "No",
        reunion.tieneRelatoria ? "Sí" : "No",
        reunion.publicacion ?? "—",
      ],
    ],
  };

  return {
    titulo: "Registro de Reuniones",
    subtitulo: reunion.titulo ?? reunion.codigo,
    referencia: "Anexo N° 16",
    orientacion: "landscape",
    meta: [
      { etiqueta: "Código", valor: reunion.codigo },
      { etiqueta: "Fecha", valor: fechaDdMmAaaa(reunion.fecha) || "—" },
      { etiqueta: "Tipo", valor: reunion.tipo },
      { etiqueta: "Lugar", valor: reunion.lugar },
      { etiqueta: "Región", valor: reunion.region },
      { etiqueta: "Responsable", valor: reunion.responsable },
    ],
    bloques: [{ tipo: "tabla", titulo: "Registro", tabla }],
    faltantes,
  };
}

/* ------------------------------------------------------------------------- *
 * Anexo 17 — Registro de Reportes
 * ------------------------------------------------------------------------- */

export function construirAnexo17(reporte: ReporteListItem): DocumentoAnexo {
  const secciones: SeccionArmada[] = [
    { titulo: "RESUMEN EJECUTIVO", texto: reporte.resumenEjecutivo },
    { titulo: "CONTENIDO", texto: reporte.contenido },
    {
      titulo: "CONCLUSIONES Y RECOMENDACIONES",
      texto: reporte.conclusionesRecomendaciones,
    },
  ];

  return {
    titulo: "Registro de Reportes",
    subtitulo: reporte.titulo,
    referencia: "Anexo N° 17",
    orientacion: "portrait",
    meta: [
      { etiqueta: "Tipo", valor: reporte.tipo },
      { etiqueta: "Código", valor: reporte.codigoReporte },
      { etiqueta: "Caso", valor: reporte.codigoCaso },
      { etiqueta: "Responsable", valor: reporte.responsable },
      { etiqueta: "Fecha", valor: fechaDdMmAaaa(reporte.fecha) || "—" },
      {
        etiqueta: "Región / ubicación",
        valor: reporte.region ?? reporte.ubicacion,
      },
    ],
    bloques: secciones.map((seccion) => ({
      tipo: "parrafos" as const,
      titulo: seccion.titulo,
      texto: seccion.texto,
    })),
    faltantes: faltantesDeSecciones(secciones),
  };
}

/* ------------------------------------------------------------------------- *
 * Anexo 14 — Matriz de Seguimiento de Compromisos
 * ------------------------------------------------------------------------- */

const COLUMNAS_ANEXO_14 = [
  { titulo: "Código de Compromiso", ancho: 2.2, tipo: "codigo" },
  { titulo: "Código de Caso", ancho: 1.7, tipo: "codigo" },
  { titulo: "Región", ancho: 1.2 },
  { titulo: "Provincia", ancho: 1.2 },
  { titulo: "Distrito", ancho: 1.2 },
  { titulo: "Alcance Geográfico", ancho: 1.2 },
  { titulo: "Documento de Origen", ancho: 1.7 },
  { titulo: "Fecha inicio", ancho: 1, tipo: "fecha" },
  { titulo: "Temática", ancho: 1.5 },
  { titulo: "Acciones / Compromisos / Acuerdos", ancho: 3.4 },
  { titulo: "Área Responsable / Punto Focal", ancho: 1.5 },
  { titulo: "Código de Hito", ancho: 2.2, tipo: "codigo" },
  { titulo: "Hitos", ancho: 3.2 },
  { titulo: "Estado de Hitos", ancho: 1.2 },
] as const;

export function construirAnexo14(
  datos: Anexo14Resultado,
  filtros: readonly string[],
): DocumentoAnexo {
  const filas = datos.filas.map((fila) => [
    fila.codigoCompromiso || "—",
    fila.codigoCaso ?? "—",
    fila.region ?? "—",
    fila.provincia ?? "—",
    fila.distrito ?? "—",
    fila.alcanceGeografico ?? "—",
    fila.documentoOrigen ?? "—",
    fechaCelda(fila.fechaInicio),
    fila.tematica ?? "—",
    fila.accionCompromiso ?? "—",
    fila.areaResponsable ?? "—",
    fila.codigoHito ?? "—",
    fila.hito ?? "—",
    fila.estadoHito ?? "—",
  ]);

  const compromisos = new Set(datos.filas.map((fila) => fila.codigoCompromiso))
    .size;
  const casos = new Set(
    datos.filas
      .map((fila) => fila.codigoCaso)
      .filter((codigo): codigo is string => Boolean(codigo)),
  ).size;

  return {
    titulo: "Matriz de Seguimiento de Compromisos",
    subtitulo: "Anexo N° 14 · catorce columnas del formato oficial",
    referencia: "Anexo N° 14",
    orientacion: "landscape",
    meta: [
      { etiqueta: "Registros", valor: String(datos.filas.length) },
      { etiqueta: "Compromisos", valor: String(compromisos) },
      { etiqueta: "Casos", valor: String(casos) },
      {
        etiqueta: "Filtros",
        valor: filtros.length > 0 ? filtros.join(" · ") : "sin filtros",
      },
      {
        etiqueta: "Fuente",
        valor: datos.desdeVista ? "Vista del Anexo 14" : "Compromisos",
      },
    ],
    bloques: [
      {
        tipo: "tabla",
        tabla: {
          vacia: "sin compromisos para los filtros aplicados",
          columnas: COLUMNAS_ANEXO_14,
          filas,
        },
      },
    ],
    faltantes: datos.faltantes,
  };
}

/* ------------------------------------------------------------------------- *
 * Anexo 15 — Matriz de Conflictividad
 * ------------------------------------------------------------------------- */

const COLUMNAS_ANEXO_15 = [
  { titulo: "N°", ancho: 0.5, alineacion: "derecha" },
  { titulo: "Código de caso", ancho: 1.5, tipo: "codigo" },
  { titulo: "Nombre del caso", ancho: 3 },
  { titulo: "Región", ancho: 1.1 },
  { titulo: "Alcance", ancho: 1 },
  { titulo: "Subsector", ancho: 1.3 },
  { titulo: "Nivel de conflictividad", ancho: 1.3 },
  { titulo: "Nivel de riesgo", ancho: 1 },
  { titulo: "Prioridad de atención", ancho: 1.2 },
  { titulo: "Estado", ancho: 1.1 },
  { titulo: "Unidad responsable", ancho: 1.3 },
  { titulo: "Inicio", ancho: 0.9, tipo: "fecha" },
  { titulo: "Último hecho", ancho: 0.9, tipo: "fecha" },
  { titulo: "Compromisos", ancho: 0.9, alineacion: "derecha" },
  { titulo: "Tipo de compromiso", ancho: 1.5 },
  { titulo: "Documentos", ancho: 0.9, alineacion: "derecha" },
] as const;

export function construirAnexo15(
  filasConflictividad: readonly FilaConflictividad[],
  resumen: ResumenConflictividad,
  filtros: readonly string[],
  generadoEnTexto: string,
): DocumentoAnexo {
  const filas = filasConflictividad.map((fila, indice) => [
    String(indice + 1),
    fila.codigoCaso || "—",
    fila.nombreCaso ?? "—",
    fila.region ?? "—",
    fila.alcance ?? "—",
    fila.subsector ?? "—",
    fila.nivelConflictividad ?? "—",
    fila.nivelRiesgo ?? "—",
    fila.prioridadAtencion ?? "—",
    fila.estado ?? "—",
    fila.unidadResponsable ?? "—",
    fechaCelda(fila.fechaInicio),
    fechaCelda(fila.ultimoHecho),
    String(fila.compromisos),
    fila.tipoCompromiso ?? "—",
    String(fila.documentos),
  ]);

  const vacios = {
    sinNivel: resumen.sinNivel,
  };

  const faltantes: string[] = [];
  if (vacios.sinNivel > 0) {
    faltantes.push(
      `${vacios.sinNivel} caso(s) no declaran nivel de conflictividad: la celda queda como «—».`,
    );
  }

  return {
    titulo: "Matriz de Conflictividad",
    subtitulo: "Anexo N° 15 · una fila por caso abierto",
    referencia: "Anexo N° 15",
    orientacion: "landscape",
    meta: [
      { etiqueta: "Total de casos", valor: String(resumen.total) },
      { etiqueta: "Manifiestos", valor: String(resumen.manifiestos) },
      { etiqueta: "Latentes", valor: String(resumen.latentes) },
      { etiqueta: "Sin nivel declarado", valor: String(resumen.sinNivel) },
      {
        etiqueta: "Filtros",
        valor: filtros.length > 0 ? filtros.join(" · ") : "sin filtros",
      },
      { etiqueta: "Generado", valor: generadoEnTexto },
    ],
    bloques: [
      {
        tipo: "tabla",
        tabla: {
          vacia: "sin casos para los filtros aplicados",
          columnas: COLUMNAS_ANEXO_15,
          filas,
        },
      },
    ],
    faltantes,
  };
}

/* ------------------------------------------------------------------------- *
 * Clima social para mensajería (Anexo 04 / 05)
 * ------------------------------------------------------------------------- */

const SECCIONES_MENSAJERIA: readonly DefinicionSeccion[] = [
  { titulo: "1. RESUMEN EJECUTIVO", claves: ["resumen ejecutivo", "resumen"] },
  { titulo: "2. ACTORES", claves: ["actores"] },
  {
    titulo: "3. CLIMA SOCIAL Y HECHOS RECIENTES",
    claves: ["hechos recientes", "clima social", "hechos"],
  },
  { titulo: "4. DEMANDAS LOCALES", claves: ["demandas", "focos", "tension"] },
  {
    titulo: "5. EVALUACIÓN DE RIESGO",
    claves: ["evaluacion de riesgo", "analisis de riesgo", "riesgo"],
  },
  {
    titulo: "6. OPORTUNIDADES Y ACCIONES PREVISTAS",
    claves: ["oportunidad", "recomendacion", "acciones previstas"],
  },
];

/**
 * Deja el texto en la forma que WhatsApp acepta: sin caracteres de control, sin
 * espacios de ancho cero, saltos de línea acotados y viñetas con guion (WhatsApp
 * usa `*` para negrita, así que no se deja un asterisco suelto al inicio).
 */
export function limpiarWhatsapp(texto: string): string {
  return texto
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .replace(/[\u2028\u2029]/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\u2014/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/^[ \t]*(?:[*•]|\d+[.)])\s+/gm, "- ")
    .replace(/[ \t]+$/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function esUrlSegura(valor: string | null | undefined): string | null {
  const limpio = textoPlano(valor);
  if (!limpio) return null;
  try {
    const url = new URL(limpio);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function construirMensajeClimaSocial(
  documento: DocumentoFuente,
  fotoSolicitada: string | null,
): { texto: string; faltantes: string[] } {
  const textos = deduplicar([
    documento.resumen,
    ...documento.bloques.map((bloque) => bloque.texto),
  ]);
  const { secciones } = seccionesDesdeDocumento(textos, SECCIONES_MENSAJERIA);

  const ambito =
    [documento.region, documento.provincia, documento.distrito]
      .filter(Boolean)
      .join(", ") || "ÁMBITO POR PRECISAR";
  const encabezadoTitulo = `${documento.titulo} | OAIPCS`;

  const lineas: string[] = [
    `*REPORTE DE CLIMA SOCIAL SOBRE ${ambito.toUpperCase()}*`,
    `*${encabezadoTitulo}*`,
    `Fecha: ${fechaDdMmAaaa(documento.fecha) || "sin fecha"}`,
  ];

  if (documento.casoCodigo) lineas.push(`Caso: ${documento.casoCodigo}`);

  for (const seccion of secciones) {
    lineas.push("", `*${seccion.titulo}*`, seccion.texto ?? "sin dato");
  }

  const foto = esUrlSegura(fotoSolicitada) ?? esUrlSegura(documento.urlFoto);
  if (foto) lineas.push("", `Foto: ${foto}`);

  const faltantes = faltantesDeSecciones(secciones);
  if (!documento.urlFoto && !esUrlSegura(fotoSolicitada)) {
    faltantes.push("Foto representativa: el reporte no registra url_foto.");
  }

  return { texto: limpiarWhatsapp(lineas.join("\n")), faltantes };
}

/** Versión apta para PDF: sin emojis ni caracteres fuera de Latin-1. */
export function mensajeParaPdf(texto: string): string {
  return sinEmojis(texto);
}

/* ------------------------------------------------------------------------- *
 * Análisis del caso (8.2.4)
 * ------------------------------------------------------------------------- */

function listarTexto(valores: readonly (string | null)[]): string | null {
  const limpios = valores
    .map((valor) => textoPlano(valor))
    .filter((valor): valor is string => Boolean(valor));
  return limpios.length > 0 ? limpios.join("\n") : null;
}

export function construirAnalisisCaso(detalle: CaseDetail): DocumentoAnexo {
  const caso = detalle.case;

  const actores: TablaDocumento = {
    vacia: "el caso no tiene actores registrados",
    columnas: [
      { titulo: "Actor", ancho: 2.4 },
      { titulo: "Naturaleza", ancho: 1.3 },
      { titulo: "Tipo", ancho: 1.3 },
      { titulo: "Función", ancho: 2 },
      { titulo: "Posicionamiento", ancho: 3 },
    ],
    filas: detalle.actors.map((actor) => [
      actor.nombre || "—",
      actor.naturaleza ?? "—",
      actor.tipo ?? "—",
      actor.funcion ?? "—",
      actor.posicionamiento ?? "—",
    ]),
  };

  const hechos: TablaDocumento = {
    vacia: "el caso no tiene hechos en la cronología",
    columnas: [
      { titulo: "Fecha", ancho: 1, tipo: "fecha" },
      { titulo: "Tipo", ancho: 1.2 },
      { titulo: "Hecho", ancho: 4 },
      { titulo: "Actor", ancho: 1.6 },
      { titulo: "Validado", ancho: 0.9, alineacion: "centro" },
    ],
    filas: detalle.events.map((evento) => [
      fechaCelda(evento.fecha),
      evento.tipo ?? "—",
      evento.descripcion || "—",
      evento.actor ?? "—",
      evento.validado ? "Sí" : "No",
    ]),
  };

  const demandas: TablaDocumento = {
    vacia: "el caso no tiene demandas registradas",
    columnas: [
      { titulo: "Problema", ancho: 2.4 },
      { titulo: "Propuesta", ancho: 2.4 },
      { titulo: "Pedido", ancho: 2.4 },
      { titulo: "Estado", ancho: 1.2 },
    ],
    filas: detalle.demandas.map((demanda) => [
      demanda.problema ?? "—",
      demanda.propuesta ?? "—",
      demanda.pedido ?? "—",
      demanda.estado ?? "—",
    ]),
  };

  const compromisos: TablaDocumento = {
    vacia: "el caso no tiene compromisos registrados",
    columnas: [
      { titulo: "Código", ancho: 2, tipo: "codigo" },
      { titulo: "Acción / compromiso", ancho: 4 },
      { titulo: "Tipo", ancho: 1.3 },
      { titulo: "Estado", ancho: 1.2 },
      { titulo: "Unidad", ancho: 1.4 },
      { titulo: "Hitos", ancho: 2.4 },
    ],
    filas: detalle.commitments.map((compromiso) => [
      compromiso.codigo || "—",
      compromiso.accion || "—",
      compromiso.tipo ?? "—",
      compromiso.estado ?? "—",
      compromiso.unidad ?? "—",
      compromiso.hitos.length > 0
        ? compromiso.hitos
            .map(
              (hito) =>
                `${hito.codigo ? `${hito.codigo}: ` : ""}${hito.descripcion ?? "sin descripción"}${
                  hito.estado ? ` (${hito.estado})` : ""
                }`,
            )
            .join("\n")
        : "—",
    ]),
  };

  const posiciones = listarTexto([
    ...detalle.actors.map((actor) =>
      actor.posicionamiento
        ? `${actor.nombre}: ${actor.posicionamiento}`
        : null,
    ),
  ]);

  const geografia: DocumentoAnexo["bloques"][number] = {
    tipo: "definiciones",
    titulo: "7. GEOGRAFÍA",
    items: [
      { etiqueta: "Región", valor: caso.region },
      {
        etiqueta: "Regiones",
        valor: caso.regiones.length > 0 ? caso.regiones.join(", ") : null,
      },
      { etiqueta: "Distrito", valor: caso.geografia?.distrito ?? null },
      { etiqueta: "Ubigeo", valor: caso.geografia?.distritoUbigeo ?? null },
      { etiqueta: "Alcance", valor: caso.alcance },
    ],
  };

  const estado: DocumentoAnexo["bloques"][number] = {
    tipo: "definiciones",
    titulo: "8. ESTADO DEL CASO",
    items: [
      { etiqueta: "Estado", valor: caso.estado },
      { etiqueta: "Nivel de conflictividad", valor: caso.nivelConflicto },
      { etiqueta: "Prioridad", valor: caso.prioridad },
      { etiqueta: "Nivel de riesgo", valor: caso.risk },
      {
        etiqueta: "Fecha de inicio",
        valor: caso.fechaInicio ? fechaDdMmAaaa(caso.fechaInicio) : null,
      },
      {
        etiqueta: "Fecha de cierre",
        valor: caso.fechaCierre ? fechaDdMmAaaa(caso.fechaCierre) : null,
      },
    ],
  };

  const fuenteRecomendacion = detalle.alerts[0];
  const recomendaciones = fuenteRecomendacion
    ? `Alerta vinculada ${fuenteRecomendacion.codigo}${
        fuenteRecomendacion.nivel ? ` · nivel ${fuenteRecomendacion.nivel}` : ""
      }${fuenteRecomendacion.prioridad ? ` · prioridad ${fuenteRecomendacion.prioridad}` : ""}. Las acciones recomendadas no se guardan como campo de la alerta.`
    : null;

  const seccionesVacias: string[] = [];
  if (!caso.summary) seccionesVacias.push("1. RESUMEN");
  if (detalle.events.length === 0) seccionesVacias.push("2. CONTEXTO Y HECHOS");
  if (detalle.actors.length === 0) seccionesVacias.push("3. MAPA DE ACTORES");
  if (!posiciones && detalle.demandas.length === 0)
    seccionesVacias.push("4. POSICIONES, INTERESES Y NECESIDADES");
  seccionesVacias.push("5. CAPACIDADES");
  seccionesVacias.push("6. CAUSAS");
  seccionesVacias.push("9. RECOMENDACIONES");

  return {
    titulo: "Análisis de Caso",
    subtitulo: `${caso.code} · ${caso.title}`,
    referencia: "Análisis de caso (8.2.4)",
    orientacion: "portrait",
    meta: [
      { etiqueta: "Código", valor: caso.code },
      { etiqueta: "Región", valor: caso.region },
      { etiqueta: "Estado", valor: caso.estado },
      { etiqueta: "Nivel de conflictividad", valor: caso.nivelConflicto },
      { etiqueta: "Prioridad", valor: caso.prioridad },
      { etiqueta: "Unidad responsable", valor: caso.unidadResponsable },
    ],
    bloques: [
      { tipo: "parrafos", titulo: "1. RESUMEN", texto: caso.summary },
      {
        tipo: "parrafos",
        titulo: "2. CONTEXTO Y HECHOS",
        texto: listarTexto([caso.summary]),
      },
      { tipo: "tabla", titulo: "Hechos de la cronología", tabla: hechos },
      { tipo: "tabla", titulo: "3. MAPA DE ACTORES", tabla: actores },
      {
        tipo: "definiciones",
        titulo: "4. POSICIONES, INTERESES Y NECESIDADES",
        items: [{ etiqueta: "Posiciones declaradas", valor: posiciones }],
      },
      { tipo: "tabla", titulo: "Demandas del caso", tabla: demandas },
      {
        tipo: "parrafos",
        titulo: "5. CAPACIDADES",
        texto:
          "sin dato. La base no registra capacidades de organización, movilización ni recursos por actor; ese análisis debe redactarse en la ficha.",
      },
      {
        tipo: "parrafos",
        titulo:
          "6. CAUSAS (ESTRUCTURALES, IMPULSORAS, DESENCADENANTES Y MANIFESTACIONES)",
        texto:
          "sin dato. La base no clasifica las causas del caso en estructurales, impulsoras, desencadenantes ni manifestaciones.",
      },
      geografia,
      estado,
      { tipo: "tabla", titulo: "Compromisos del caso", tabla: compromisos },
      {
        tipo: "parrafos",
        titulo: "9. RECOMENDACIONES",
        texto: recomendaciones,
      },
    ],
    faltantes: seccionesVacias.map(
      (seccion) => `${seccion}: sin dato en la base.`,
    ),
    notas: [
      "Las secciones 5 y 6 no tienen campo de origen en core.casos; se generan vacías a propósito para no inventar contenido.",
    ],
  };
}

/* ------------------------------------------------------------------------- *
 * Metadatos de filtros legibles
 * ------------------------------------------------------------------------- */

export function describirFiltros(
  etiquetas: Readonly<Record<string, string>>,
  valores: Readonly<Record<string, string | null | undefined>>,
): string[] {
  const partes: string[] = [];
  for (const [clave, etiqueta] of Object.entries(etiquetas)) {
    const valor = textoPlano(valores[clave]);
    if (valor) partes.push(`${etiqueta}: ${valor}`);
  }
  return partes;
}

export { celda };
