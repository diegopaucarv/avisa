import type { PoolClient } from "pg";

import { filtroTexto } from "../busqueda";
import { ApiError } from "../errors";
import { excluirCasosMesa } from "./casos-filtro";

/**
 * Matriz de conflictos del equipo (formato del Excel A..W).
 *
 * Dos vistas ya consolidadas son la fuente:
 *   · `analytics.vw_anexo_15_matriz_conflictividad` — una fila por caso.
 *   · `analytics.vw_anexo_14_seguimiento_compromisos` — una fila por
 *     compromiso × hito.
 *
 * El cruce es `v15 LEFT JOIN v14`, así que un caso sin compromisos sigue
 * apareciendo con N..X vacías: la celda vacía declara un hueco de dato, no un
 * caso omitido (misma regla que la migración 32).
 *
 * Dependencias de esquema que no están aplicadas en todas las bases:
 *   · migración 41 — `core.mapa_matriz_excel` y el responsable nominal del
 *     hito (`responsable_texto` / `responsable_usuario_id`).
 *   · migración 45 — `fecha_planificada` y `fecha_real` al final de la vista
 *     del Anexo 14.
 *
 * Si falta cualquiera de ellas se corta con 503 `ESQUEMA_PENDIENTE` antes de
 * consultar: nunca se devuelven filas de relleno.
 *
 * El contexto de seguridad lo fija `withSession`; el repositorio no abre
 * conexiones propias y no repite la RLS.
 */

/** Una fila del formato del equipo, con los nombres de la hoja principal. */
export type MatrizFila = {
  /** A · `N°`. La numeración del Excel no es clave: falta en 3 bloques y repite el 15. */
  numero: string | null;
  /** B · `Departamento`. */
  departamento: string | null;
  /** C · `Sectorista`. En la base se aproxima con el punto focal del caso. */
  sectorista: string | null;
  /** D · `Prioridad de Atención`. */
  prioridad: string | null;
  /** E · `Nombre de Caso`. */
  nombreCaso: string | null;
  /** F · `Narración Cronológica técnica social`. */
  narracion: string | null;
  /** G · `Análisis de Caso`. Sin columna escalar de destino. */
  analisis: string | null;
  /** H · `Timestamp de ultima actualización` (en el Excel es un estado). */
  actualizacion: string | null;
  /** I · `Descripción del Riesgo Actual`. */
  riesgoActual: string | null;
  /** J · `Actores del Estado`. */
  actoresEstado: string | null;
  /** K · `Actores Sociedad Civil`. La vista no separa Estado de sociedad civil. */
  actoresSociedadCivil: string | null;
  /** L · `Demandas`. La vista del Anexo 14 no trae demandas. */
  demandas: string | null;
  /** M · `Acciones/Compromisos/Acuerdos`. */
  accion: string | null;
  /** N · `Medios de Verificaciones`. Es una instrucción, no un adjunto. */
  mediosVerificacion: string | null;
  /** O · `Área Responsable de Monitoreo de Acción`. */
  areaResponsable: string | null;
  /** P · `Punto Focal Monitoreo`. */
  puntoFocal: string | null;
  /** Q · `Documentos / Archivos / Otros`. */
  documentos: string | null;
  /** R · `Hito`. */
  hito: string | null;
  /** S · `Descripción del Hito`. */
  descripcionHito: string | null;
  /** T · `Responsable del Hito` (texto o nombre del usuario vinculado). */
  responsableHito: string | null;
  /** U · `Fecha Planificada` (ISO si es convertible; texto crudo si no). */
  fechaPlanificada: string | null;
  /** V · `Fecha Real`. */
  fechaReal: string | null;
  /** W · `Estado Actual` (código con espacios, como en el catálogo). */
  estado: string | null;
  /** Trazabilidad AVISA (no forma parte de A..W). */
  codigoCaso: string | null;
  codigoCompromiso: string | null;
  codigoExcel: string | null;
  bloqueFila: number | null;
};

/** Definición de las 23 columnas del formato del equipo, en su orden. */
export const COLUMNAS_MATRIZ: readonly {
  letra: string;
  clave: keyof MatrizFila;
  etiqueta: string;
}[] = [
  { letra: "A", clave: "numero", etiqueta: "N°" },
  { letra: "B", clave: "departamento", etiqueta: "Departamento" },
  { letra: "C", clave: "sectorista", etiqueta: "Sectorista" },
  {
    letra: "D",
    clave: "prioridad",
    etiqueta: "Prioridad de Atención",
  },
  { letra: "E", clave: "nombreCaso", etiqueta: "Nombre de Caso" },
  {
    letra: "F",
    clave: "narracion",
    etiqueta: "Narración Cronológica técnica social",
  },
  { letra: "G", clave: "analisis", etiqueta: "Análisis de Caso" },
  {
    letra: "H",
    clave: "actualizacion",
    etiqueta: "Timestamp de ultima actualización",
  },
  {
    letra: "I",
    clave: "riesgoActual",
    etiqueta: "Descripción del Riesgo Actual",
  },
  { letra: "J", clave: "actoresEstado", etiqueta: "Actores del Estado" },
  {
    letra: "K",
    clave: "actoresSociedadCivil",
    etiqueta: "Actores Sociedad Civil",
  },
  { letra: "L", clave: "demandas", etiqueta: "Demandas" },
  {
    letra: "M",
    clave: "accion",
    etiqueta: "Acciones/Compromisos/Acuerdos",
  },
  {
    letra: "N",
    clave: "mediosVerificacion",
    etiqueta: "Medios de Verificaciones",
  },
  {
    letra: "O",
    clave: "areaResponsable",
    etiqueta: "Área Responsable de Monitoreo de Acción",
  },
  { letra: "P", clave: "puntoFocal", etiqueta: "Punto Focal Monitoreo" },
  {
    letra: "Q",
    clave: "documentos",
    etiqueta: "Documentos / Archivos / Otros",
  },
  { letra: "R", clave: "hito", etiqueta: "Hito" },
  {
    letra: "S",
    clave: "descripcionHito",
    etiqueta: "Descripción del Hito",
  },
  {
    letra: "T",
    clave: "responsableHito",
    etiqueta: "Responsable del Hito",
  },
  { letra: "U", clave: "fechaPlanificada", etiqueta: "Fecha Planificada" },
  { letra: "V", clave: "fechaReal", etiqueta: "Fecha Real" },
  { letra: "W", clave: "estado", etiqueta: "Estado Actual" },
];

export type MatrizListQuery = {
  /** Región del caso (`v15.region`), comparada sin tildes ni mayúsculas. */
  region?: string;
  /** Código de caso exacto. */
  caso?: string;
  /** Estado del hito con espacios (`En ejecucion`, `Cumplido`, …). */
  estado?: string;
  /** Búsqueda libre por código de caso, nombre de caso o código Excel. */
  q?: string;
  page?: number;
  pageSize?: number;
};

export type MatrizListResult = {
  items: MatrizFila[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
};

export type MapaMatrizItem = {
  codigoExcel: string | null;
  codigoCaso: string | null;
  nombreCaso: string | null;
  confianza: string | null;
  nota: string | null;
  bloqueFila: number;
  fuente: string;
};

/** Caso existente, reducido a lo que necesita la previsualización. */
export type CasoMatriz = {
  id: string;
  codigo: string;
  nombre: string | null;
};

export type CompromisoMatriz = {
  id: string;
  /** Caso al que pertenece; lo necesita el plan para conciliar por caso. */
  casoId: string;
  codigo: string;
  accion: string;
  hitos: { codigo: string; descripcion: string }[];
};

type PresenciaEsquema = {
  v15: boolean;
  v14: boolean;
  mapa: boolean;
  casos: boolean;
  compromisos: boolean;
  hitos: boolean;
  fechaPlanificada: boolean;
  fechaReal: boolean;
  responsableTexto: boolean;
  responsableUsuario: boolean;
};

const MENSAJE_ESQUEMA =
  "La matriz del equipo todavía no está disponible: falta aplicar migraciones en la base de datos.";

async function presencia(client: PoolClient): Promise<PresenciaEsquema> {
  const result = await client.query<{
    v15: boolean;
    v14: boolean;
    mapa: boolean;
    casos: boolean;
    compromisos: boolean;
    hitos: boolean;
    fecha_planificada: boolean;
    fecha_real: boolean;
    responsable_texto: boolean;
    responsable_usuario: boolean;
  }>(`
    select to_regclass('analytics.vw_anexo_15_matriz_conflictividad') is not null as v15,
           to_regclass('analytics.vw_anexo_14_seguimiento_compromisos') is not null as v14,
           to_regclass('core.mapa_matriz_excel') is not null as mapa,
           to_regclass('core.casos') is not null as casos,
           to_regclass('core.compromisos') is not null as compromisos,
           to_regclass('core.hitos_compromiso') is not null as hitos,
           exists (
             select 1 from information_schema.columns
              where table_schema = 'analytics'
                and table_name = 'vw_anexo_14_seguimiento_compromisos'
                and column_name = 'fecha_planificada'
           ) as fecha_planificada,
           exists (
             select 1 from information_schema.columns
              where table_schema = 'analytics'
                and table_name = 'vw_anexo_14_seguimiento_compromisos'
                and column_name = 'fecha_real'
           ) as fecha_real,
           exists (
             select 1 from information_schema.columns
              where table_schema = 'core'
                and table_name = 'hitos_compromiso'
                and column_name = 'responsable_texto'
           ) as responsable_texto,
           exists (
             select 1 from information_schema.columns
              where table_schema = 'core'
                and table_name = 'hitos_compromiso'
                and column_name = 'responsable_usuario_id'
           ) as responsable_usuario
  `);

  const row = result.rows[0];
  return {
    v15: row?.v15 === true,
    v14: row?.v14 === true,
    mapa: row?.mapa === true,
    casos: row?.casos === true,
    compromisos: row?.compromisos === true,
    hitos: row?.hitos === true,
    fechaPlanificada: row?.fecha_planificada === true,
    fechaReal: row?.fecha_real === true,
    responsableTexto: row?.responsable_texto === true,
    responsableUsuario: row?.responsable_usuario === true,
  };
}

function errorEsquema(faltantes: readonly string[]): ApiError {
  return new ApiError(
    503,
    `${MENSAJE_ESQUEMA} Falta: ${faltantes.join(", ")}.`,
    "ESQUEMA_PENDIENTE",
  );
}

/**
 * Corta con 503 si falta cualquiera de las piezas de la matriz. Se comprueba
 * antes de consultar para no devolver una tabla a medias.
 */
export async function verificarEsquemaMatriz(
  client: PoolClient,
): Promise<void> {
  const p = await presencia(client);
  const faltantes: string[] = [];

  if (!p.v15) {
    faltantes.push("analytics.vw_anexo_15_matriz_conflictividad");
  }
  if (!p.v14) {
    faltantes.push("analytics.vw_anexo_14_seguimiento_compromisos");
  }
  if (!p.mapa) {
    faltantes.push("core.mapa_matriz_excel (migración 41)");
  }
  if (p.v14 && !p.fechaPlanificada) {
    faltantes.push(
      "vw_anexo_14_seguimiento_compromisos.fecha_planificada (migración 45)",
    );
  }
  if (p.v14 && !p.fechaReal) {
    faltantes.push(
      "vw_anexo_14_seguimiento_compromisos.fecha_real (migración 45)",
    );
  }
  if (!p.responsableTexto || !p.responsableUsuario) {
    faltantes.push(
      "core.hitos_compromiso.responsable_texto / responsable_usuario_id (migración 41)",
    );
  }

  if (faltantes.length > 0) throw errorEsquema(faltantes);
}

/** La tabla de equivalencias debe existir para leerla o usarla en el plan. */
export async function verificarEsquemaMapeo(client: PoolClient): Promise<void> {
  const p = await presencia(client);
  if (!p.mapa) {
    throw errorEsquema(["core.mapa_matriz_excel (migración 41)"]);
  }
}

/**
 * Comprueba lo mínimo para previsualizar. El mapa puede sustituirse por los
 * `mapeos` que envíe el cliente, así que se exige sólo cuando no se aportan.
 */
export async function verificarEsquemaPrevisualizacion(
  client: PoolClient,
  requiereMapa: boolean,
): Promise<void> {
  const p = await presencia(client);
  const faltantes: string[] = [];

  if (!p.casos) faltantes.push("core.casos");
  if (!p.compromisos) faltantes.push("core.compromisos");
  if (!p.hitos) faltantes.push("core.hitos_compromiso");
  if (requiereMapa && !p.mapa) {
    faltantes.push("core.mapa_matriz_excel (migración 41)");
  }

  if (faltantes.length > 0) throw errorEsquema(faltantes);
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

/** Normaliza una fecha tipada a `YYYY-MM-DD`; si es texto sucio, lo conserva. */
function fecha(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(valor);
  if (iso?.[1]) return iso[1];
  return texto(valor);
}

function mapFila(row: Record<string, unknown>): MatrizFila {
  return {
    numero: null,
    departamento: texto(row.departamento),
    sectorista: texto(row.sectorista),
    prioridad: texto(row.prioridad),
    nombreCaso: texto(row.nombre_caso),
    narracion: texto(row.narracion),
    analisis: null,
    actualizacion: null,
    riesgoActual: texto(row.riesgo_actual),
    actoresEstado: texto(row.actores_estado),
    actoresSociedadCivil: null,
    demandas: null,
    accion: texto(row.accion),
    mediosVerificacion: null,
    areaResponsable: texto(row.area_responsable),
    puntoFocal: texto(row.punto_focal),
    documentos: texto(row.documentos),
    hito: texto(row.hito),
    descripcionHito: texto(row.descripcion_hito),
    responsableHito: texto(row.responsable_hito),
    fechaPlanificada: fecha(row.fecha_planificada),
    fechaReal: fecha(row.fecha_real),
    estado: texto(row.estado),
    codigoCaso: texto(row.codigo_caso),
    codigoCompromiso: texto(row.codigo_compromiso),
    codigoExcel: texto(row.codigo_excel),
    bloqueFila: typeof row.bloque_fila === "number" ? row.bloque_fila : null,
  };
}

/**
 * Filtros compartidos por el listado y la exportación. Se usa
 * `core.normalizar_ref` en las dos orillas para que una tilde o una mayúscula
 * no cambien el resultado. Los valores vacíos no se aplican.
 */
function construirWhere(
  query: MatrizListQuery,
  bind: (valor: unknown) => string,
): string[] {
  // Los casos espejo de mesas (`MD-...`) quedan fuera de la matriz: la vista los
  // devolvería como una fila sin región, prioridad ni compromisos.
  const where: string[] = [excluirCasosMesa("v15")];

  const region = query.region?.trim();
  if (region) {
    where.push(
      `core.normalizar_ref(v15.region) = core.normalizar_ref(${bind(region)})`,
    );
  }

  const caso = query.caso?.trim();
  if (caso) {
    where.push(
      `core.normalizar_ref(v15.codigo_caso) = core.normalizar_ref(${bind(caso)})`,
    );
  }

  const estado = query.estado?.trim();
  if (estado) {
    where.push(
      `core.normalizar_ref(replace(v14.estado_hito, '_', ' ')) = core.normalizar_ref(${bind(
        estado,
      )})`,
    );
  }

  const porTexto = filtroTexto(
    ["v15.codigo_caso", "v15.nombre_caso", "mapa.codigo_excel"],
    query.q,
    bind,
  );
  if (porTexto) where.push(porTexto);

  return where;
}

/**
 * Una fila por compromiso × hito, con las columnas A..W del formato del equipo.
 *
 * El responsable del hito (U) sale del enlace por `codigo_hito` —único en
 * `core.hitos_compromiso`— prefiriendo el texto libre y cayendo al nombre del
 * usuario vinculado. `fecha_planificada` / `fecha_real` (V/W) se leen de la
 * vista del Anexo 14 que la migración 45 completa.
 */
export async function listarMatriz(
  client: PoolClient,
  query: MatrizListQuery,
): Promise<MatrizListResult> {
  const params: unknown[] = [];
  const bind = (valor: unknown): string => {
    params.push(valor);
    return `$${params.length}`;
  };

  const where = construirWhere(query, bind);
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 25)));

  const sql = `
    select v15.codigo_caso,
           v15.region                  as departamento,
           v15.punto_focal             as sectorista,
           v15.prioridad_atencion      as prioridad,
           v15.nombre_caso,
           v15.narracion_cronologica   as narracion,
           v15.descripcion_riesgo      as riesgo_actual,
           v15.actores_involucrados    as actores_estado,
           v14.accion_compromiso        as accion,
           v14.area_responsable,
           v15.punto_focal,
           v14.documento_origen         as documentos,
           v14.codigo_hito              as hito,
           v14.hito                     as descripcion_hito,
           coalesce(h.responsable_texto, u.nombre) as responsable_hito,
           v14.fecha_planificada::text  as fecha_planificada,
           v14.fecha_real::text         as fecha_real,
           replace(v14.estado_hito, '_', ' ') as estado,
           v14.codigo_compromiso,
           mapa.codigo_excel,
           mapa.bloque_fila,
           count(*) over()::int         as total
      from analytics.vw_anexo_15_matriz_conflictividad v15
      left join analytics.vw_anexo_14_seguimiento_compromisos v14
             on v14.codigo_caso = v15.codigo_caso
      left join core.casos c
             on c.codigo_caso = v15.codigo_caso
      left join core.hitos_compromiso h
             on h.codigo_hito = v14.codigo_hito
      left join core.usuarios u
             on u.id = h.responsable_usuario_id
      left join lateral (
        select m.codigo_excel, m.bloque_fila
          from core.mapa_matriz_excel m
         where m.caso_id = c.id
         order by (m.confianza = 'alta') desc, m.bloque_fila
         limit 1
      ) mapa on true
      ${where.length ? `where ${where.join(" and ")}` : ""}
     order by v15.codigo_caso, v14.codigo_compromiso, v14.codigo_hito
     limit ${bind(pageSize)} offset ${bind((page - 1) * pageSize)}
  `;

  const result = await client.query(sql, params);
  const total = (result.rows[0]?.total as number | undefined) ?? 0;

  return {
    items: result.rows.map((row) => mapFila(row as Record<string, unknown>)),
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
  };
}

/** Tabla de equivalencias Excel → caso, con el código AVISA ya resuelto. */
export async function listarMapaMatriz(
  client: PoolClient,
): Promise<MapaMatrizItem[]> {
  const result = await client.query<{
    codigo_excel: string | null;
    codigo_caso: string | null;
    nombre_caso: string | null;
    confianza: string | null;
    nota: string | null;
    bloque_fila: number;
    fuente: string;
  }>(`
    select m.codigo_excel,
           c.codigo_caso,
           c.nombre_caso,
           m.confianza,
           m.nota,
           m.bloque_fila,
           m.fuente
      from core.mapa_matriz_excel m
      join core.casos c on c.id = m.caso_id
     order by m.bloque_fila
  `);

  return result.rows.map((row) => ({
    codigoExcel: texto(row.codigo_excel),
    codigoCaso: texto(row.codigo_caso),
    nombreCaso: texto(row.nombre_caso),
    confianza: texto(row.confianza),
    nota: texto(row.nota),
    bloqueFila: row.bloque_fila,
    fuente: row.fuente,
  }));
}

/** Casos cuya `codigo_caso` normalizada esté en la lista. */
export async function cargarCasosPorCodigo(
  client: PoolClient,
  codigos: readonly string[],
): Promise<CasoMatriz[]> {
  const normalizados = Array.from(
    new Set(
      codigos
        .map((codigo) => codigo.trim().toLowerCase())
        .filter((codigo) => codigo !== ""),
    ),
  );
  if (normalizados.length === 0) return [];

  const result = await client.query<{
    id: string;
    codigo_caso: string;
    nombre_caso: string | null;
  }>(
    `select c.id, c.codigo_caso, c.nombre_caso
       from core.casos c
      where core.normalizar_ref(c.codigo_caso) = any($1::text[])`,
    [normalizados],
  );

  return result.rows.map((row) => ({
    id: row.id,
    codigo: row.codigo_caso,
    nombre: texto(row.nombre_caso),
  }));
}

/** Compromisos con sus hitos, para clasificar crear frente a actualizar. */
export async function cargarCompromisosPorCaso(
  client: PoolClient,
  casoIds: readonly string[],
): Promise<CompromisoMatriz[]> {
  if (casoIds.length === 0) return [];

  const result = await client.query<{
    id: string;
    caso_id: string;
    codigo_compromiso: string;
    accion_compromiso: string;
    codigo_hito: string | null;
    descripcion_hito: string | null;
  }>(
    `select co.id,
            co.caso_id,
            co.codigo_compromiso,
            co.accion_compromiso,
            h.codigo_hito,
            h.descripcion_hito
       from core.compromisos co
       left join core.hitos_compromiso h on h.compromiso_id = co.id
      where co.caso_id = any($1::uuid[])
      order by co.codigo_compromiso, h.codigo_hito`,
    [casoIds],
  );

  const porId = new Map<string, CompromisoMatriz>();
  for (const row of result.rows) {
    let compromiso = porId.get(row.id);
    if (!compromiso) {
      compromiso = {
        id: row.id,
        casoId: row.caso_id,
        codigo: row.codigo_compromiso,
        accion: row.accion_compromiso,
        hitos: [],
      };
      porId.set(row.id, compromiso);
    }
    if (row.codigo_hito) {
      compromiso.hitos.push({
        codigo: row.codigo_hito,
        descripcion: row.descripcion_hito ?? "",
      });
    }
  }

  return Array.from(porId.values());
}

/** Equivalencias vigentes, en el formato mínimo que consume el plan. */
export async function cargarMapa(
  client: PoolClient,
): Promise<{ codigoExcel: string; codigoCaso: string }[]> {
  const result = await client.query<{
    codigo_excel: string;
    codigo_caso: string;
  }>(`
    select m.codigo_excel, c.codigo_caso
      from core.mapa_matriz_excel m
      join core.casos c on c.id = m.caso_id
     where m.codigo_excel is not null
  `);

  return result.rows.map((row) => ({
    codigoExcel: row.codigo_excel,
    codigoCaso: row.codigo_caso,
  }));
}
