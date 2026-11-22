import type { PoolClient } from "pg";
import { auditChange } from "../audit";
import { nextSequentialCode } from "../codes";
import { ApiError } from "../errors";
import { anularRegistro, restaurarRegistro } from "./anulacion";

/**
 * El estado no existe como columna: el legado sólo guarda `paso_actual`, así que
 * se deriva en SQL para que la lista y los filtros usen exactamente el mismo
 * criterio. Cuando el paso llega a 5 la alerta ya está atendida aunque
 * `aprobada_por` / `validada_por` sigan nulos.
 */
const ALERT_STATE = `case
    when a.paso_actual >= 5 then 'Atendida'
    when a.aprobada_por is not null then 'Aprobada'
    when a.validada_por is not null then 'Validada'
    when a.paso_actual >= 3 then 'En revisión'
    else 'Pendiente de revisión'
  end`;

const ALERT_ATENDIDA = `(a.paso_actual >= 5)`;

const ALERT_SELECT = `
  a.id,
  a.codigo_alerta as codigo,
  a.titulo,
  a.caso_id as caso_id,
  c.codigo_caso as caso_code,
  c.nombre_caso as caso_titulo,
  pa.codigo as prioridad,
  pa.sla_horas::int as sla_horas,
  pa.es_grave as grave,
  na.nombre as nivel,
  na.codigo_legado as nivel_codigo,
  a.paso_actual::int as paso_actual,
  a.estado_legado as estado_legado,
  a.visibilidad,
  to_char(a.fecha_reporte, 'YYYY-MM-DD') as fecha_reporte,
  to_char(a.fecha_validacion, 'YYYY-MM-DD') as fecha_validacion,
  to_char(a.aprobada_en, 'YYYY-MM-DD') as fecha_aprobacion,
  a.aprobada_por as aprobada_por,
  a.validada_por as validada_por,
  a.descripcion_riesgo,
  a.hechos_recientes,
  a.situacion_actual,
  a.acciones_oaipcs,
  a.riesgos_json as riesgos,
  a.acciones_sugeridas_json as acciones_sugeridas,
  a.fuente_tipo,
  a.fuente_descripcion,
  a.fuente_url,
  d.nombre as distrito,
  ss.nombre as subsector,
  a.mesa_id,
  a.sectorista_usuario_id,
  a.origen_dato as origen,
  a.confidence::float8 as confianza,
  a.es_validado_humano as validado,
  a.nivel_clasificacion::int as clasificacion,
  a.anulado_en as anulado_en,
  a.motivo_anulacion as motivo_anulacion,
  a.anulado_por as anulado_por,
  ua.nombre as anulado_por_nombre,
  a.anulacion_id as anulacion_id,
  ${ALERT_STATE} as estado,
  ${ALERT_ATENDIDA} as atendida
`;

const ALERT_FROM = `
  from core.alertas_tempranas a
  left join core.casos c on c.id = a.caso_id
  left join core.cat_prioridades_alerta pa on pa.id = a.prioridad_id
  left join core.cat_niveles_alerta na on na.id = a.nivel_alerta_id
  left join core.distritos d on d.id = a.distrito_id
  left join core.cat_subsectores ss on ss.id = a.subsector_id
  left join core.usuarios ua on ua.id = a.anulado_por
`;

export type AlertListQuery = {
  q?: string;
  caso?: string;
  prioridad?: string;
  nivel?: string;
  estado?: string;
  sort?: string;
  /**
   * `true` lista la papelera: añade `anulado_en is not null`. Requiere abrir
   * la RLS con `withSession(..., { verAnulados: true })`; si no, la política
   * sigue ocultando las filas y el listado sale vacío.
   */
  incluirAnulados?: boolean;
  page?: number;
  pageSize?: number;
};

export type AlertItem = {
  id: string;
  codigo: string;
  titulo: string | null;
  casoId: string | null;
  casoCode: string | null;
  casoTitulo: string | null;
  prioridad: string | null;
  slaHoras: number | null;
  grave: boolean | null;
  nivel: string | null;
  nivelCodigo: string | null;
  pasoActual: number | null;
  estadoLegado: string | null;
  visibilidad: string;
  fechaReporte: string | null;
  fechaValidacion: string | null;
  fechaAprobacion: string | null;
  aprobadaPor: string | null;
  validadaPor: string | null;
  descripcionRiesgo: string | null;
  hechosRecientes: string | null;
  situacionActual: string | null;
  accionesOaipcs: string | null;
  riesgos: unknown;
  accionesSugeridas: unknown;
  fuenteTipo: string | null;
  fuenteDescripcion: string | null;
  fuenteUrl: string | null;
  distrito: string | null;
  subsector: string | null;
  mesaId: string | null;
  sectoristaUsuarioId: string | null;
  origen: string;
  confianza: number | null;
  validado: boolean;
  clasificacion: number;
  estado: string;
  atendida: boolean;
  /** Fecha de anulación en ISO 8601, o `null` si la alerta está vigente. */
  anuladoEn: string | null;
  /** Motivo declarado al anular; sólo se puebla en la papelera. */
  motivoAnulacion: string | null;
  /** Usuario que anuló (id); sólo se puebla en la papelera. */
  anuladoPor: string | null;
  /** Nombre legible de quien anuló; `null` si no se puede resolver. */
  anuladoPorNombre: string | null;
  /** Lote de anulación al que pertenece la fila. */
  anulacionId: string | null;
};

export type AlertListResult = {
  items: AlertItem[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
};

export type AlertDemanda = {
  id: string;
  descripcion: string | null;
  problema: string | null;
  propuesta: string | null;
  pedido: string | null;
  estado: string | null;
  fechaRegistro: string | null;
};

export type AlertDetail = {
  alert: AlertItem;
  demandas: AlertDemanda[];
  generatedAt: string;
};

const SORTS: Record<string, string> = {
  recent: "a.fecha_reporte desc nulls last, a.codigo_alerta asc",
  prioridad:
    "pa.id asc nulls last, a.fecha_reporte desc nulls last, a.codigo_alerta asc",
};

// Sólo estos estados derivados se pueden filtrar; cualquier otro valor se ignora.
const ESTADOS = new Set([
  "Atendida",
  "Aprobada",
  "Validada",
  "Pendiente de revisión",
]);

function mapAlert(row: Record<string, any>): AlertItem {
  return {
    id: row.id,
    codigo: row.codigo,
    titulo: row.titulo,
    casoId: row.caso_id,
    casoCode: row.caso_code,
    casoTitulo: row.caso_titulo,
    prioridad: row.prioridad,
    slaHoras: row.sla_horas,
    grave: row.grave,
    nivel: row.nivel,
    nivelCodigo: row.nivel_codigo,
    pasoActual: row.paso_actual,
    estadoLegado: row.estado_legado,
    visibilidad: row.visibilidad,
    fechaReporte: row.fecha_reporte,
    fechaValidacion: row.fecha_validacion,
    fechaAprobacion: row.fecha_aprobacion,
    aprobadaPor: row.aprobada_por,
    validadaPor: row.validada_por,
    descripcionRiesgo: row.descripcion_riesgo,
    hechosRecientes: row.hechos_recientes,
    situacionActual: row.situacion_actual,
    accionesOaipcs: row.acciones_oaipcs,
    riesgos: row.riesgos,
    accionesSugeridas: row.acciones_sugeridas,
    fuenteTipo: row.fuente_tipo,
    fuenteDescripcion: row.fuente_descripcion,
    fuenteUrl: row.fuente_url,
    distrito: row.distrito,
    subsector: row.subsector,
    mesaId: row.mesa_id,
    sectoristaUsuarioId: row.sectorista_usuario_id,
    origen: row.origen,
    confianza: row.confianza,
    validado: row.validado,
    clasificacion: row.clasificacion,
    estado: row.estado,
    atendida: row.atendida,
    anuladoEn: isoOrNull(row.anulado_en),
    motivoAnulacion: row.motivo_anulacion,
    anuladoPor: row.anulado_por,
    anuladoPorNombre: row.anulado_por_nombre,
    anulacionId: row.anulacion_id,
  };
}

/**
 * `pg` devuelve `timestamptz` como `Date`; se normaliza a ISO para el payload.
 * Cualquier valor no convertible se trata como ausente.
 */
function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function listAlerts(
  client: PoolClient,
  query: AlertListQuery,
): Promise<AlertListResult> {
  const params: unknown[] = [];
  const where: string[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const search = query.q?.trim();
  if (search) {
    const like = bind(`%${search}%`);
    where.push(
      `(a.codigo_alerta ilike ${like} or a.titulo ilike ${like} or coalesce(a.descripcion_riesgo, '') ilike ${like})`,
    );
  }
  if (query.caso) where.push(`c.codigo_caso = ${bind(query.caso)}`);
  if (query.prioridad) where.push(`pa.codigo = ${bind(query.prioridad)}`);
  if (query.nivel) where.push(`na.codigo_legado = ${bind(query.nivel)}`);
  const estado = query.estado?.trim();
  if (estado && ESTADOS.has(estado)) {
    where.push(`${ALERT_STATE} = ${bind(estado)}`);
  }

  // Papelera: abrir la RLS es cosa de `app.ver_anulados`; aquí sólo se acota
  // el resultado a las filas anuladas. Sin `incluirAnulados` no se añade
  // `anulado_en is null`: `p_clasificacion` ya lo impone.
  if (query.incluirAnulados) {
    where.push("a.anulado_en is not null");
  }

  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 25)));
  const order = SORTS[query.sort ?? "recent"] ?? SORTS.recent;

  const sql = `
    select ${ALERT_SELECT},
           count(*) over()::int as total
    ${ALERT_FROM}
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by ${order}
    limit ${bind(pageSize)} offset ${bind((page - 1) * pageSize)}
  `;

  const result = await client.query(sql, params);
  const total = result.rows[0]?.total ?? 0;

  return {
    items: result.rows.map(mapAlert),
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
  };
}

export async function getAlertById(
  client: PoolClient,
  id: string,
): Promise<AlertDetail | null> {
  // Se compara como texto para aceptar tanto el uuid como el código legible sin
  // arriesgar un 22P02 al castear cualquier entrada a uuid.
  const result = await client.query(
    `select ${ALERT_SELECT}
     ${ALERT_FROM}
     where a.id::text = $1 or a.codigo_alerta = $1
     limit 1`,
    [id],
  );

  const row = result.rows[0];
  if (!row) return null;

  const demandas = await client.query(
    `select d.id,
            d.descripcion_demanda as descripcion,
            d.problema_3p as problema,
            d.propuesta_3p as propuesta,
            d.pedido_3p as pedido,
            replace(d.estado_atencion, '_', ' ') as estado,
            to_char(d.fecha_registro, 'YYYY-MM-DD') as fecha_registro
       from core.demandas d
      where d.alerta_id = $1
      order by d.fecha_registro desc nulls last, d.created_at desc`,
    [row.id],
  );

  return {
    alert: mapAlert(row),
    demandas: demandas.rows.map((d) => ({
      id: d.id,
      descripcion: d.descripcion,
      problema: d.problema,
      propuesta: d.propuesta,
      pedido: d.pedido,
      estado: d.estado,
      fechaRegistro: d.fecha_registro,
    })),
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------------- *
 * Escrituras
 * ------------------------------------------------------------------------- */

export type WriteSession = {
  usuarioId: string;
  rolCodigo: string;
};

const MAX_TITLE_LENGTH = 500;
const MAX_TEXT_LENGTH = 20000;
const MAX_SOURCE_TYPE_LENGTH = 120;
const MAX_URL_LENGTH = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ORIGEN_VALUES = new Set([
  "MANUAL",
  "KAG",
  "WORKFLOW",
  "AVISA_HISTORICO",
  "WHATSAPP",
]);
const VISIBILIDAD_VALUES = new Set(["interna", "ejecutiva", "sectorial"]);

const ALERT_WRITE_COLUMNS = [
  "codigo_alerta",
  "caso_id",
  "prioridad_id",
  "nivel_alerta_id",
  "titulo",
  "descripcion_riesgo",
  "hechos_recientes",
  "situacion_actual",
  "acciones_oaipcs",
  "riesgos_json",
  "acciones_sugeridas_json",
  "fuente_tipo",
  "fuente_descripcion",
  "fuente_url",
  "distrito_id",
  "subsector_id",
  "fecha_reporte",
  "paso_actual",
  "visibilidad",
  "estado_legado",
] as const;

type AlertCatalogKey = "prioridad" | "nivel" | "subsector";

const ALERT_CATALOGS: Record<
  AlertCatalogKey,
  { table: string; code: string; alt?: string }
> = {
  prioridad: { table: "core.cat_prioridades_alerta", code: "codigo" },
  nivel: {
    table: "core.cat_niveles_alerta",
    code: "codigo_legado",
    alt: "nombre",
  },
  subsector: {
    table: "core.cat_subsectores",
    code: "codigo_legado",
    alt: "nombre",
  },
};

type SqlField = { column: string; value: unknown; cast?: string };

function invalid(): never {
  throw new ApiError(422, "Datos inválidos.", "INVALID_INPUT");
}

function readField(
  body: Record<string, unknown>,
  keys: readonly string[],
): { present: boolean; value: unknown } {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      return { present: true, value: body[key] };
    }
  }
  return { present: false, value: undefined };
}

function text(value: unknown, max: number, required: boolean): string | null {
  if (value === null || value === undefined) {
    if (required) invalid();
    return null;
  }
  if (typeof value !== "string") invalid();
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) invalid();
    return null;
  }
  if (trimmed.length > max) invalid();
  return trimmed;
}

function requiredText(value: unknown, max: number): string {
  const out = text(value, max, true);
  if (out === null) invalid();
  return out;
}

function intIn(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) invalid();
  if (value < min || value > max) invalid();
  return value;
}

function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !DATE_RE.test(value)) invalid();
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) invalid();
  if (parsed.toISOString().slice(0, 10) !== value) invalid();
  return value;
}

function origenValue(value: unknown): string {
  if (typeof value !== "string") invalid();
  const normalized = value.trim().toUpperCase();
  if (!ORIGEN_VALUES.has(normalized)) invalid();
  return normalized;
}

function visibilidadValue(value: unknown): string {
  if (typeof value !== "string") invalid();
  const normalized = value.trim().toLowerCase();
  if (!VISIBILIDAD_VALUES.has(normalized)) invalid();
  return normalized;
}

function jsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") invalid();
  return value;
}

function pick(
  row: Record<string, unknown>,
  columns: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const column of columns) {
    if (column in row) out[column] = row[column];
  }
  return out;
}

async function resolveCatalog(
  client: PoolClient,
  key: AlertCatalogKey,
  raw: unknown,
): Promise<number> {
  if (typeof raw !== "string") invalid();
  const value = raw.trim();
  if (!value) invalid();
  // Las etiquetas de catálogo llevan espacio y tilde (`Crítica inmediata`), pero
  // la API sigue aceptando `Critica_Inmediata`. `core.normalizar_ref` iguala ambas.
  const spec = ALERT_CATALOGS[key];
  const matches = [
    `core.normalizar_ref(${spec.code}) = core.normalizar_ref($1)`,
  ];
  if (spec.alt)
    matches.push(`core.normalizar_ref(${spec.alt}) = core.normalizar_ref($1)`);
  const result = await client.query(
    `select id from ${spec.table} where ${matches.join(" or ")} order by id limit 1`,
    [value],
  );
  const id = result.rows[0]?.id;
  if (id === undefined || id === null) invalid();
  return Number(id);
}

async function resolveCaseId(
  client: PoolClient,
  raw: unknown,
): Promise<string> {
  if (typeof raw !== "string") invalid();
  const code = raw.trim();
  if (!code) invalid();
  const result = await client.query(
    `select id from core.casos where codigo_caso = $1`,
    [code],
  );
  const id = result.rows[0]?.id;
  if (!id) invalid();
  return String(id);
}

async function resolveDistritoId(
  client: PoolClient,
  raw: unknown,
): Promise<number> {
  if (typeof raw !== "number" || !Number.isInteger(raw)) invalid();
  const result = await client.query(
    `select id from core.distritos where id = $1`,
    [raw],
  );
  if (!result.rows[0]) invalid();
  return raw;
}

async function findAlert(
  client: PoolClient,
  idOrCode: string,
): Promise<Record<string, any>> {
  // Sin castear la entrada a uuid: un código legible también es válido.
  const result = await client.query(
    `select * from core.alertas_tempranas
      where id::text = $1 or codigo_alerta = $1
      limit 1`,
    [idOrCode],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "La alerta no existe.", "NOT_FOUND");
  return row;
}

function insertSql(
  table: string,
  fields: SqlField[],
): { sql: string; params: unknown[] } {
  const params = fields.map((field) => field.value);
  const columns = fields.map((field) => field.column).join(", ");
  const values = fields
    .map(
      (field, index) => `$${index + 1}${field.cast ? `::${field.cast}` : ""}`,
    )
    .join(", ");
  return {
    sql: `insert into ${table} (${columns}) values (${values}) returning *`,
    params,
  };
}

async function insertAlertRow(
  client: PoolClient,
  build: (codigo: string) => SqlField[],
): Promise<Record<string, any>> {
  const year = new Date().getFullYear();
  let retried = false;
  for (;;) {
    await client.query("savepoint alerta_insert");
    try {
      const codigo = await nextSequentialCode(
        client,
        "core.alertas_tempranas",
        "codigo_alerta",
        `AT-${year}-`,
        2,
      );
      const { sql, params } = insertSql(
        "core.alertas_tempranas",
        build(codigo),
      );
      const result = await client.query(sql, params);
      await client.query("release savepoint alerta_insert");
      return result.rows[0];
    } catch (error) {
      if (!retried && (error as { code?: string }).code === "23505") {
        retried = true;
        await client.query("rollback to savepoint alerta_insert");
        continue;
      }
      throw error;
    }
  }
}

export async function createAlert(
  client: PoolClient,
  session: WriteSession,
  body: Record<string, unknown>,
): Promise<AlertDetail> {
  const titulo = requiredText(
    readField(body, ["titulo", "title"]).value,
    MAX_TITLE_LENGTH,
  );
  const prioridad = readField(body, ["prioridad", "priority"]);
  if (!prioridad.present || prioridad.value === null) invalid();
  const prioridadId = await resolveCatalog(
    client,
    "prioridad",
    prioridad.value,
  );

  const paso = readField(body, ["pasoActual", "paso_actual"]);
  const visibilidad = readField(body, ["visibilidad"]);

  const fields: SqlField[] = [
    { column: "titulo", value: titulo },
    { column: "prioridad_id", value: prioridadId },
    {
      column: "paso_actual",
      value: paso.present ? intIn(paso.value, 1, 99) : 1,
    },
    {
      column: "visibilidad",
      value: visibilidad.present
        ? visibilidadValue(visibilidad.value)
        : "interna",
    },
  ];

  const caso = readField(body, ["casoCode", "caso", "caso_codigo"]);
  if (caso.present && caso.value !== null) {
    fields.push({
      column: "caso_id",
      value: await resolveCaseId(client, caso.value),
    });
  }

  const nivel = readField(body, ["nivel", "nivelAlerta"]);
  if (nivel.present && nivel.value !== null) {
    fields.push({
      column: "nivel_alerta_id",
      value: await resolveCatalog(client, "nivel", nivel.value),
    });
  }

  const descripcion = readField(body, [
    "descripcionRiesgo",
    "descripcion_riesgo",
  ]);
  if (descripcion.present) {
    fields.push({
      column: "descripcion_riesgo",
      value: text(descripcion.value, MAX_TEXT_LENGTH, false),
    });
  }

  const hechos = readField(body, ["hechosRecientes", "hechos_recientes"]);
  if (hechos.present) {
    fields.push({
      column: "hechos_recientes",
      value: text(hechos.value, MAX_TEXT_LENGTH, false),
    });
  }

  const situacion = readField(body, ["situacionActual", "situacion_actual"]);
  if (situacion.present) {
    fields.push({
      column: "situacion_actual",
      value: text(situacion.value, MAX_TEXT_LENGTH, false),
    });
  }

  const acciones = readField(body, ["accionesOaipcs", "acciones_oaipcs"]);
  if (acciones.present) {
    fields.push({
      column: "acciones_oaipcs",
      value: text(acciones.value, MAX_TEXT_LENGTH, false),
    });
  }

  const riesgos = readField(body, ["riesgos"]);
  if (riesgos.present) {
    fields.push({
      column: "riesgos_json",
      value: jsonValue(riesgos.value),
      cast: "jsonb",
    });
  }

  const sugeridas = readField(body, [
    "accionesSugeridas",
    "acciones_sugeridas",
  ]);
  if (sugeridas.present) {
    fields.push({
      column: "acciones_sugeridas_json",
      value: jsonValue(sugeridas.value),
      cast: "jsonb",
    });
  }

  const fuenteTipo = readField(body, ["fuenteTipo", "fuente_tipo"]);
  if (fuenteTipo.present) {
    fields.push({
      column: "fuente_tipo",
      value: text(fuenteTipo.value, MAX_SOURCE_TYPE_LENGTH, false),
    });
  }

  const fuenteDescripcion = readField(body, [
    "fuenteDescripcion",
    "fuente_descripcion",
  ]);
  if (fuenteDescripcion.present) {
    fields.push({
      column: "fuente_descripcion",
      value: text(fuenteDescripcion.value, MAX_TEXT_LENGTH, false),
    });
  }

  const fuenteUrl = readField(body, ["fuenteUrl", "fuente_url"]);
  if (fuenteUrl.present) {
    fields.push({
      column: "fuente_url",
      value: text(fuenteUrl.value, MAX_URL_LENGTH, false),
    });
  }

  const distrito = readField(body, ["distritoId", "distrito_id"]);
  if (distrito.present && distrito.value !== null) {
    fields.push({
      column: "distrito_id",
      value: await resolveDistritoId(client, distrito.value),
    });
  }

  const subsector = readField(body, ["subsector"]);
  if (subsector.present && subsector.value !== null) {
    fields.push({
      column: "subsector_id",
      value: await resolveCatalog(client, "subsector", subsector.value),
    });
  }

  const fechaReporte = readField(body, ["fechaReporte", "fecha_reporte"]);
  if (fechaReporte.present && fechaReporte.value !== null) {
    fields.push({
      column: "fecha_reporte",
      value: dateOnly(fechaReporte.value),
    });
  }

  const origen = readField(body, ["origenDato", "origen_dato"]);
  if (origen.present && origen.value !== null) {
    fields.push({ column: "origen_dato", value: origenValue(origen.value) });
  }

  let row: Record<string, any>;
  try {
    row = await insertAlertRow(client, (codigo) => [
      { column: "codigo_alerta", value: codigo },
      ...fields,
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === "P0001") {
      throw new ApiError(
        409,
        "La alerta no cumple las condiciones de visibilidad.",
        "ALERT_VISIBILITY",
      );
    }
    throw error;
  }

  await auditChange(client, {
    tabla: "core.alertas_tempranas",
    registroId: String(row.id),
    accion: "INSERT",
    usuarioId: session.usuarioId,
    rolCodigo: session.rolCodigo,
    antes: null,
    despues: pick(row, ALERT_WRITE_COLUMNS),
  });

  const detail = await getAlertById(client, String(row.id));
  if (!detail) {
    throw new ApiError(
      500,
      "No se pudo leer la alerta creada.",
      "READ_BACK_FAILED",
    );
  }
  return detail;
}

export async function updateAlert(
  client: PoolClient,
  session: WriteSession,
  idOrCode: string,
  body: Record<string, unknown>,
): Promise<AlertDetail> {
  const row = await findAlert(client, idOrCode);

  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (column: string, value: unknown, cast?: string) => {
    params.push(value);
    sets.push(`${column} = $${params.length}${cast ? `::${cast}` : ""}`);
  };

  const titulo = readField(body, ["titulo", "title"]);
  if (titulo.present)
    add("titulo", requiredText(titulo.value, MAX_TITLE_LENGTH));

  const paso = readField(body, ["pasoActual", "paso_actual"]);
  if (paso.present) add("paso_actual", intIn(paso.value, 1, 99));

  const descripcion = readField(body, [
    "descripcionRiesgo",
    "descripcion_riesgo",
  ]);
  if (descripcion.present) {
    add("descripcion_riesgo", text(descripcion.value, MAX_TEXT_LENGTH, false));
  }

  const hechos = readField(body, ["hechosRecientes", "hechos_recientes"]);
  if (hechos.present)
    add("hechos_recientes", text(hechos.value, MAX_TEXT_LENGTH, false));

  const situacion = readField(body, ["situacionActual", "situacion_actual"]);
  if (situacion.present) {
    add("situacion_actual", text(situacion.value, MAX_TEXT_LENGTH, false));
  }

  const acciones = readField(body, ["accionesOaipcs", "acciones_oaipcs"]);
  if (acciones.present) {
    add("acciones_oaipcs", text(acciones.value, MAX_TEXT_LENGTH, false));
  }

  const prioridad = readField(body, ["prioridad", "priority"]);
  if (prioridad.present) {
    add(
      "prioridad_id",
      prioridad.value === null
        ? null
        : await resolveCatalog(client, "prioridad", prioridad.value),
    );
  }

  const nivel = readField(body, ["nivel", "nivelAlerta"]);
  if (nivel.present) {
    add(
      "nivel_alerta_id",
      nivel.value === null
        ? null
        : await resolveCatalog(client, "nivel", nivel.value),
    );
  }

  const riesgos = readField(body, ["riesgos"]);
  if (riesgos.present) {
    add("riesgos_json", jsonValue(riesgos.value), "jsonb");
  }

  const sugeridas = readField(body, [
    "accionesSugeridas",
    "acciones_sugeridas",
  ]);
  if (sugeridas.present) {
    add("acciones_sugeridas_json", jsonValue(sugeridas.value), "jsonb");
  }

  const caso = readField(body, ["casoCode", "caso", "caso_codigo"]);
  if (caso.present) {
    add(
      "caso_id",
      caso.value === null ? null : await resolveCaseId(client, caso.value),
    );
  }

  if (sets.length === 0) invalid();
  sets.push("updated_at = now()");
  params.push(row.id);

  let updated: { rows: Record<string, any>[] };
  try {
    updated = await client.query(
      `update core.alertas_tempranas set ${sets.join(", ")}
        where id = $${params.length}
        returning *`,
      params,
    );
  } catch (error) {
    // G21: al tocar una alerta ya publicada el trigger revalida las firmas.
    if ((error as { code?: string }).code === "P0001") {
      throw new ApiError(
        409,
        "La alerta no cumple las condiciones de visibilidad.",
        "ALERT_VISIBILITY",
      );
    }
    throw error;
  }

  const updatedRow = updated.rows[0];
  if (!updatedRow) throw new ApiError(404, "La alerta no existe.", "NOT_FOUND");

  await auditChange(client, {
    tabla: "core.alertas_tempranas",
    registroId: String(row.id),
    accion: "UPDATE",
    usuarioId: session.usuarioId,
    rolCodigo: session.rolCodigo,
    antes: pick(row, ALERT_WRITE_COLUMNS),
    despues: pick(updatedRow, ALERT_WRITE_COLUMNS),
  });

  const detail = await getAlertById(client, String(updatedRow.id));
  if (!detail) {
    throw new ApiError(
      500,
      "No se pudo leer la alerta actualizada.",
      "READ_BACK_FAILED",
    );
  }
  return detail;
}

export async function deleteAlert(
  client: PoolClient,
  session: WriteSession,
  idOrCode: string,
  motivo?: string,
): Promise<void> {
  const row = await findAlert(client, idOrCode);

  const anulacion = await anularRegistro(
    client,
    "alertas_tempranas",
    String(row.id),
    motivo,
  );

  await auditChange(client, {
    tabla: "core.alertas_tempranas",
    registroId: String(row.id),
    accion: "DELETE",
    usuarioId: session.usuarioId,
    rolCodigo: session.rolCodigo,
    antes: pick(row, ALERT_WRITE_COLUMNS),
    despues: { anuladoEn: anulacion.anuladoEn, motivo: anulacion.motivo },
  });
}

export async function restoreAlert(
  client: PoolClient,
  idOrCode: string,
): Promise<void> {
  const row = await findAlert(client, idOrCode);
  await restaurarRegistro(client, "alertas_tempranas", String(row.id));
}
