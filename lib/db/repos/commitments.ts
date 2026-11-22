import type { PoolClient } from "pg";
import { auditChange } from "../audit";
import { nextSequentialCode } from "../codes";
import { ApiError } from "../errors";
import { anularRegistro, restaurarRegistro } from "./anulacion";

/**
 * Columnas de un compromiso compartidas por list y detail.
 *
 * `fecha_vencimiento` es la fecha manual (puede ser null). El vencimiento
 * efectivo combina esa fecha con el próximo hito no terminal: ver
 * `fechaVencimientoEfectiva` / `origenVencimiento` en mapItem.
 */
const COMMITMENT_COLUMNS = `
  cmp.id,
  cmp.codigo_compromiso as codigo,
  cmp.accion_compromiso as accion,
  cmp.caso_id as caso_id,
  c.codigo_caso as caso_code,
  c.nombre_caso as caso_titulo,
  cmp.tipo_compromiso as tipo,
  replace(cmp.nivel_gobierno, '_', ' ') as nivel_gobierno,
  ec.codigo as estado,
  ec.categoria as estado_categoria,
  ec.es_terminal as terminal,
  to_char(cmp.fecha_inicio, 'YYYY-MM-DD') as fecha_inicio,
  to_char(cmp.fecha_vencimiento, 'YYYY-MM-DD') as fecha_vencimiento,
  uo.siglas as unidad,
  ag.codigo as alcance,
  te.nombre as tematica,
  cmp.atiende_brecha_genero as atiende_genero,
  cmp.evidencia_cumplimiento_uri as evidencia_uri,
  cmp.criterios_smart as criterios_smart,
  cmp.documento_origen_id as documento_origen_id,
  cmp.origen_dato as origen,
  cmp.confidence::float8 as confianza,
  cmp.es_validado_humano as validado,
  cmp.nivel_clasificacion as clasificacion,
  cmp.anulado_en as anulado_en,
  cmp.motivo_anulacion as motivo_anulacion,
  cmp.anulado_por as anulado_por,
  ua.nombre as anulado_por_nombre,
  cmp.anulacion_id as anulacion_id,
  to_char(current_date, 'YYYY-MM-DD') as today
`;

const COMMITMENT_FROM = `
  from core.compromisos cmp
  left join core.casos c on c.id = cmp.caso_id
  left join core.cat_estados_compromiso ec on ec.id = cmp.estado_id
  left join core.cat_unidades_organicas uo on uo.id = cmp.unidad_responsable_id
  left join core.cat_alcances_geograficos ag on ag.id = cmp.alcance_id
  left join core.cat_tematicas te on te.id = cmp.tematica_id
  left join core.usuarios ua on ua.id = cmp.anulado_por
`;

/**
 * Vencimiento efectivo de un compromiso: la fecha manual prevalece y, si
 * falta, se usa la del próximo hito no terminal (el más temprano con fecha).
 * Es la misma regla que `mapItem` y la que muestra la columna «Vencimiento»
 * de la tabla, de modo que el calendario y el listado no se contradicen.
 *
 * Vive en el WHERE y en el ORDER BY del rango de fechas, nunca se concatena
 * un valor: los límites van como parámetros `$n`.
 */
const VENCIMIENTO_EFECTIVO = `coalesce(
    cmp.fecha_vencimiento,
    (
      select min(h.fecha_vencimiento)
        from core.hitos_compromiso h
        left join core.cat_estados_hito eh on eh.id = h.estado_id
       where h.compromiso_id = cmp.id
         and h.fecha_vencimiento is not null
         and coalesce(eh.es_terminal, false) = false
    )
  )`;

const HITOS_LIST_JSON = `
  coalesce((
    select json_agg(json_build_object(
             'id', h.id,
             'codigo', h.codigo_hito,
             'descripcion', h.descripcion_hito,
             'fecha', to_char(h.fecha_vencimiento, 'YYYY-MM-DD'),
             'fechaReal', to_char(h.fecha_real, 'YYYY-MM-DD'),
             'estado', replace(eh.codigo, '_', ' '),
             'terminal', eh.es_terminal
           ) order by h.fecha_vencimiento nulls last, h.codigo_hito)
      from core.hitos_compromiso h
      left join core.cat_estados_hito eh on eh.id = h.estado_id
     where h.compromiso_id = cmp.id
  ), '[]'::json)
`;

const HITOS_DETAIL_JSON = `
  coalesce((
    select json_agg(json_build_object(
             'id', h.id,
             'codigo', h.codigo_hito,
             'descripcion', h.descripcion_hito,
             'fecha', to_char(h.fecha_vencimiento, 'YYYY-MM-DD'),
             'fechaReal', to_char(h.fecha_real, 'YYYY-MM-DD'),
             'estado', replace(eh.codigo, '_', ' '),
             'terminal', eh.es_terminal,
             'validacion', h.validacion,
             'descripcionEvidencia', h.descripcion_evidencia,
             'linkEvidencia', h.link_evidencia
           ) order by h.fecha_vencimiento nulls last, h.codigo_hito)
      from core.hitos_compromiso h
      left join core.cat_estados_hito eh on eh.id = h.estado_id
     where h.compromiso_id = cmp.id
  ), '[]'::json)
`;

export type CommitmentListQuery = {
  q?: string;
  caso?: string;
  estado?: string;
  unidad?: string;
  tipo?: string;
  nivelGobierno?: string;
  atiendeGenero?: string;
  /** `YYYY-MM-DD` inclusive; filtra por el vencimiento efectivo. */
  vencimientoDesde?: string;
  /** `YYYY-MM-DD` inclusive; filtra por el vencimiento efectivo. */
  vencimientoHasta?: string;
  /**
   * `true` lista la papelera: añade `anulado_en is not null`. Requiere abrir
   * la RLS con `withSession(..., { verAnulados: true })`; si no, la política
   * sigue ocultando las filas y el listado sale vacío.
   */
  incluirAnulados?: boolean;
  /** `true` excluye los compromisos en estado terminal (cumplido, desestimado…). */
  excluirTerminales?: boolean;
  page?: number;
  pageSize?: number;
};

export type CommitmentHito = {
  id: string;
  codigo: string | null;
  descripcion: string | null;
  fecha: string | null;
  fechaReal: string | null;
  estado: string | null;
  terminal: boolean | null;
};

export type CommitmentHitoDetail = CommitmentHito & {
  validacion: string | null;
  descripcionEvidencia: string | null;
  linkEvidencia: string | null;
};

export type CommitmentProximoHito = {
  id: string;
  descripcion: string | null;
  fecha: string;
  estado: string | null;
};

export type CommitmentListItem = {
  id: string;
  codigo: string;
  accion: string;
  casoId: string | null;
  casoCode: string | null;
  casoTitulo: string | null;
  tipo: string | null;
  nivelGobierno: string | null;
  estado: string | null;
  estadoCategoria: string | null;
  terminal: boolean | null;
  fechaInicio: string | null;
  fechaVencimiento: string | null;
  fechaVencimientoEfectiva: string | null;
  origenVencimiento: "manual" | "hito" | null;
  unidad: string | null;
  alcance: string | null;
  tematica: string | null;
  atiendeGenero: boolean | null;
  evidenciaUri: string | null;
  criteriosSmart: unknown;
  documentoOrigenId: string | null;
  origen: string | null;
  confianza: number | null;
  validado: boolean | null;
  clasificacion: number | null;
  /** Fecha de anulación en ISO 8601, o `null` si el registro está vigente. */
  anuladoEn: string | null;
  /** Motivo declarado al anular; sólo se puebla en la papelera. */
  motivoAnulacion: string | null;
  /** Usuario que anuló (id); sólo se puebla en la papelera. */
  anuladoPor: string | null;
  /** Nombre legible de quien anuló; `null` si no se puede resolver. */
  anuladoPorNombre: string | null;
  /** Lote de anulación al que pertenece la fila. */
  anulacionId: string | null;
  hitos: CommitmentHito[];
  proximoHito: CommitmentProximoHito | null;
  vencido: boolean;
};

export type CommitmentListResult = {
  items: CommitmentListItem[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
};

export type CommitmentCaso = {
  id: string;
  code: string;
  title: string;
  estado: string | null;
};

export type CommitmentDocumento = {
  id: string;
  codigo: string | null;
  titulo: string | null;
  fecha: string | null;
};

export type CommitmentDetail = {
  commitment: CommitmentListItem & { hitos: CommitmentHitoDetail[] };
  caso: CommitmentCaso | null;
  documentoOrigen: CommitmentDocumento | null;
  generatedAt: string;
};

/** `estado` viaja como "En proceso" o "En_proceso"; el catálogo usa guiones bajos. */
function normalizeEnum(value: string): string {
  return value.trim().replace(/\s+/g, "_");
}

function parseBool(value: string): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
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

/**
 * El primer hito con fecha y no terminal. Los hitos vienen ordenados por
 * fecha_vencimiento ascendente (nulls last), así que el primero que cumple
 * es el más próximo de forma determinista.
 */
function pickProximoHito(
  hitos: CommitmentHito[],
): CommitmentProximoHito | null {
  for (const hito of hitos) {
    if (hito.fecha && !hito.terminal) {
      return {
        id: hito.id,
        descripcion: hito.descripcion,
        fecha: hito.fecha,
        estado: hito.estado,
      };
    }
  }
  return null;
}

type CommitmentRow = Record<string, any>;

function mapItem(row: CommitmentRow): CommitmentListItem {
  const hitos = (row.hitos ?? []) as CommitmentHito[];
  const proximoHito = pickProximoHito(hitos);
  const today = row.today as string;
  const fechaVencimiento = (row.fecha_vencimiento as string | null) ?? null;
  // coalesce(fecha_vencimiento, fecha del próximo hito no terminal)
  const fechaVencimientoEfectiva =
    fechaVencimiento ?? proximoHito?.fecha ?? null;

  return {
    id: row.id,
    codigo: row.codigo,
    accion: row.accion,
    casoId: row.caso_id,
    casoCode: row.caso_code,
    casoTitulo: row.caso_titulo,
    tipo: row.tipo,
    nivelGobierno: row.nivel_gobierno,
    estado: row.estado,
    estadoCategoria: row.estado_categoria,
    terminal: row.terminal,
    fechaInicio: row.fecha_inicio,
    fechaVencimiento,
    fechaVencimientoEfectiva,
    origenVencimiento: fechaVencimiento
      ? "manual"
      : proximoHito
        ? "hito"
        : null,
    unidad: row.unidad,
    alcance: row.alcance,
    tematica: row.tematica,
    atiendeGenero: row.atiende_genero,
    evidenciaUri: row.evidencia_uri,
    criteriosSmart: row.criterios_smart,
    documentoOrigenId: row.documento_origen_id,
    origen: row.origen,
    confianza: row.confianza,
    validado: row.validado,
    clasificacion: row.clasificacion,
    anuladoEn: isoOrNull(row.anulado_en),
    motivoAnulacion: row.motivo_anulacion,
    anuladoPor: row.anulado_por,
    anuladoPorNombre: row.anulado_por_nombre,
    anulacionId: row.anulacion_id,
    hitos,
    proximoHito,
    // Comparación lexicográfica de YYYY-MM-DD es equivalente a comparar fechas.
    vencido: fechaVencimientoEfectiva
      ? fechaVencimientoEfectiva < today
      : false,
  };
}

export async function listCommitments(
  client: PoolClient,
  query: CommitmentListQuery,
): Promise<CommitmentListResult> {
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
      `(cmp.codigo_compromiso ilike ${like} or cmp.accion_compromiso ilike ${like})`,
    );
  }
  if (query.caso) where.push(`c.codigo_caso = ${bind(query.caso)}`);
  if (query.estado) {
    where.push(
      `core.normalizar_ref(ec.codigo) = core.normalizar_ref(${bind(query.estado)})`,
    );
  }
  if (query.unidad) where.push(`uo.siglas = ${bind(query.unidad)}`);
  if (query.tipo) where.push(`cmp.tipo_compromiso = ${bind(query.tipo)}`);
  if (query.nivelGobierno) {
    where.push(
      `cmp.nivel_gobierno = ${bind(normalizeEnum(query.nivelGobierno))}`,
    );
  }
  if (query.atiendeGenero) {
    const atiende = parseBool(query.atiendeGenero);
    if (atiende !== undefined) {
      where.push(`cmp.atiende_brecha_genero = ${bind(atiende)}`);
    }
  }

  // Papelera: abrir la RLS es cosa de `app.ver_anulados`; aquí sólo se acota
  // el resultado a las filas anuladas. Sin `incluirAnulados` no se añade
  // `anulado_en is null`: `p_clasificacion` ya lo impone.
  if (query.incluirAnulados) {
    where.push("cmp.anulado_en is not null");
  }
  // Cola de vencidos: un compromiso terminal no se cuenta como pendiente.
  if (query.excluirTerminales) {
    where.push("coalesce(ec.es_terminal, false) = false");
  }

  // Rango de vencimiento para la vista de calendario. Las fechas ya llegan
  // validadas desde la ruta; aquí se comprueba otra vez para que el repo no
  // dependa de ese contrato y para no castear texto libre a `date` (un valor
  // mal formado provocaría un 500).
  const desde = query.vencimientoDesde?.trim();
  const hasta = query.vencimientoHasta?.trim();
  const desdeValido = desde && isIsoDate(desde) ? desde : null;
  const hastaValido = hasta && isIsoDate(hasta) ? hasta : null;
  if (desdeValido) {
    where.push(`${VENCIMIENTO_EFECTIVO} >= ${bind(desdeValido)}::date`);
  }
  if (hastaValido) {
    where.push(`${VENCIMIENTO_EFECTIVO} <= ${bind(hastaValido)}::date`);
  }

  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 25)));

  // Con rango de fechas interesa que el tope de filas conserve las fechas más
  // próximas; sin rango se mantiene el orden histórico del listado.
  const orden =
    desdeValido || hastaValido
      ? `${VENCIMIENTO_EFECTIVO} asc nulls last, cmp.codigo_compromiso`
      : "cmp.fecha_inicio desc nulls last, cmp.codigo_compromiso";

  const sql = `
    select ${COMMITMENT_COLUMNS},
           ${HITOS_LIST_JSON} as hitos,
           count(*) over()::int as total
    ${COMMITMENT_FROM}
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by ${orden}
    limit ${bind(pageSize)} offset ${bind((page - 1) * pageSize)}
  `;

  const result = await client.query(sql, params);
  const total = result.rows[0]?.total ?? 0;

  return {
    items: result.rows.map(mapItem),
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
  };
}

export async function getCommitmentById(
  client: PoolClient,
  id: string,
): Promise<CommitmentDetail | null> {
  const result = await client.query(
    `select ${COMMITMENT_COLUMNS},
            ${HITOS_DETAIL_JSON} as hitos,
            replace(eca.codigo, '_', ' ') as caso_estado,
            d.id as doc_id,
            d.codigo as doc_codigo,
            d.titulo as doc_titulo,
            to_char(d.fecha, 'YYYY-MM-DD') as doc_fecha
     ${COMMITMENT_FROM}
     left join core.cat_estados_caso eca on eca.id = c.estado_id
     left join core.documentos d on d.id = cmp.documento_origen_id
     where cmp.id::text = $1 or cmp.codigo_compromiso = $1`,
    [id],
  );

  const row = result.rows[0];
  if (!row) return null;

  const base = mapItem(row);

  return {
    commitment: {
      ...base,
      hitos: (row.hitos ?? []) as CommitmentHitoDetail[],
    },
    caso: row.caso_id
      ? {
          id: row.caso_id,
          code: row.caso_code,
          title: row.caso_titulo,
          estado: row.caso_estado,
        }
      : null,
    documentoOrigen: row.doc_id
      ? {
          id: row.doc_id,
          codigo: row.doc_codigo,
          titulo: row.doc_titulo,
          fecha: row.doc_fecha,
        }
      : null,
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Escrituras                                                          */
/* ------------------------------------------------------------------ */

export type CommitmentWriteContext = {
  usuarioId: string;
  rolCodigo: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NIVELES_GOBIERNO = [
  "Nacional",
  "Regional",
  "Local",
  "Empresa",
  "Sociedad_Civil",
] as const;

function invalid(): never {
  throw new ApiError(422, "Datos inválidos.", "INVALID_INPUT");
}

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid();
  return body as Record<string, unknown>;
}

function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function requiredText(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string") invalid();
  const trimmed = value.trim();
  if (!trimmed) invalid();
  return trimmed;
}

function optionalText(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!has(body, key)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "string") invalid();
  const trimmed = value.trim();
  if (!trimmed) invalid();
  return trimmed;
}

function optionalBoolean(
  body: Record<string, unknown>,
  key: string,
): boolean | undefined {
  if (!has(body, key)) return undefined;
  const value = body[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "boolean") invalid();
  return value;
}

function optionalDate(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!has(body, key)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "string" || !isIsoDate(value)) invalid();
  return value;
}

function optionalUuid(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!has(body, key)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "string" || !UUID.test(value)) invalid();
  return value;
}

function optionalJson(body: Record<string, unknown>, key: string): unknown {
  if (!has(body, key)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "object") invalid();
  return value;
}

function jsonParam(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/**
 * Repite el INSERT una vez si choca con el UNIQUE del código correlativo.
 * El savepoint es imprescindible: en PostgreSQL un error aborta la transacción
 * completa y sin él no se podría reintentar dentro de `withSession`.
 */
async function retryUnique<T>(
  client: PoolClient,
  run: () => Promise<T>,
): Promise<T> {
  await client.query("savepoint code_retry");
  try {
    const result = await run();
    await client.query("release savepoint code_retry");
    return result;
  } catch (error) {
    if ((error as { code?: string }).code !== "23505") throw error;
    await client.query("rollback to savepoint code_retry");
    const result = await run();
    await client.query("release savepoint code_retry");
    return result;
  }
}

async function resolveCaso(
  client: PoolClient,
  ref: string,
): Promise<{ id: string; codigo: string; unidadId: number }> {
  const result = await client.query<{
    id: string;
    codigo_caso: string;
    unidad_responsable_id: number;
  }>(
    `select id, codigo_caso, unidad_responsable_id
       from core.casos
      where id::text = $1 or codigo_caso = $1
      limit 1`,
    [ref],
  );
  const row = result.rows[0];
  if (!row) invalid();
  return {
    id: row.id,
    codigo: row.codigo_caso,
    unidadId: row.unidad_responsable_id,
  };
}

async function resolveUnidad(
  client: PoolClient,
  siglas: string,
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `select id from core.cat_unidades_organicas where siglas = $1 limit 1`,
    [siglas],
  );
  const row = result.rows[0];
  if (!row) invalid();
  return row.id;
}

async function resolveEstadoCompromiso(
  client: PoolClient,
  codigo: string,
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `select id from core.cat_estados_compromiso
      where core.normalizar_ref(codigo) = core.normalizar_ref($1) limit 1`,
    [codigo],
  );
  const row = result.rows[0];
  if (!row) invalid();
  return row.id;
}

async function resolveEstadoHito(
  client: PoolClient,
  codigo: string,
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `select id from core.cat_estados_hito
      where core.normalizar_ref(codigo) = core.normalizar_ref($1) limit 1`,
    [codigo],
  );
  const row = result.rows[0];
  if (!row) invalid();
  return row.id;
}

async function resolveAlcance(
  client: PoolClient,
  codigo: string,
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `select id from core.cat_alcances_geograficos where codigo = $1 limit 1`,
    [codigo],
  );
  const row = result.rows[0];
  if (!row) invalid();
  return row.id;
}

async function resolveTematica(
  client: PoolClient,
  ref: string,
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `select id from core.cat_tematicas
      where id::text = $1 or lower(nombre) = lower($1)
      limit 1`,
    [ref],
  );
  const row = result.rows[0];
  if (!row) invalid();
  return row.id;
}

function mapCommitmentTipo(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "actividad") return "Actividad";
  if (normalized === "pip") return "PIP";
  return invalid();
}

async function fetchCommitmentRow(
  client: PoolClient,
  ref: string,
): Promise<Record<string, any> | undefined> {
  const result = await client.query(
    `select * from core.compromisos
      where id::text = $1 or codigo_compromiso = $1
      limit 1`,
    [ref],
  );
  return result.rows[0] as Record<string, any> | undefined;
}

export async function createCommitment(
  client: PoolClient,
  ctx: CommitmentWriteContext,
  body: unknown,
): Promise<CommitmentDetail> {
  const input = asObject(body);

  const accion = requiredText(input, "accion");
  const casoRef =
    optionalText(input, "casoCode") ?? optionalText(input, "casoId");
  if (!casoRef) invalid();
  const caso = await resolveCaso(client, casoRef);

  const unidadSiglas = optionalText(input, "unidad");
  const unidadId = unidadSiglas
    ? await resolveUnidad(client, unidadSiglas)
    : caso.unidadId;

  const estadoCodigo = optionalText(input, "estado");
  const estadoId = await resolveEstadoCompromiso(
    client,
    estadoCodigo ?? "Por_iniciar",
  );

  const tipo = mapCommitmentTipo(optionalText(input, "tipo") ?? "Actividad");

  const nivelRef = optionalText(input, "nivelGobierno");
  const nivelGobierno = nivelRef ? normalizeEnum(nivelRef) : null;
  if (
    nivelGobierno &&
    !(NIVELES_GOBIERNO as readonly string[]).includes(nivelGobierno)
  ) {
    invalid();
  }

  const alcanceCodigo = optionalText(input, "alcance");
  const alcanceId = alcanceCodigo
    ? await resolveAlcance(client, alcanceCodigo)
    : null;

  const tematicaRef = optionalText(input, "tematica");
  const tematicaId = tematicaRef
    ? await resolveTematica(client, tematicaRef)
    : null;

  const atiendeGenero = optionalBoolean(input, "atiendeGenero") ?? false;
  const criteriosSmart = optionalJson(input, "criteriosSmart");
  const evidenciaUri = optionalText(input, "evidenciaUri");
  const documentoOrigenId = optionalUuid(input, "documentoOrigenId");

  const fechaInicio = optionalDate(input, "fechaInicio");
  if (fechaInicio === null) invalid();
  const fechaVencimiento = optionalDate(input, "fechaVencimiento");

  const sql = `
    insert into core.compromisos
      (codigo_compromiso, caso_id, documento_origen_id, unidad_responsable_id,
       alcance_id, tematica_id, fecha_inicio, fecha_vencimiento,
       accion_compromiso, tipo_compromiso, nivel_gobierno, estado_id,
       evidencia_cumplimiento_uri, atiende_brecha_genero, criterios_smart,
       origen_dato)
    values ($1, $2, $3, $4, $5, $6, coalesce($7::date, current_date), $8::date,
            $9, $10, $11, $12, $13, $14, $15::jsonb, 'MANUAL')
    returning *
  `;

  const inserted = await retryUnique(client, async () => {
    const codigo = await nextSequentialCode(
      client,
      "core.compromisos",
      "codigo_compromiso",
      `${caso.codigo}_COMP`,
      3,
    );
    const result = await client.query(sql, [
      codigo,
      caso.id,
      documentoOrigenId ?? null,
      unidadId,
      alcanceId,
      tematicaId,
      fechaInicio ?? null,
      fechaVencimiento ?? null,
      accion,
      tipo,
      nivelGobierno,
      estadoId,
      evidenciaUri ?? null,
      atiendeGenero,
      jsonParam(criteriosSmart),
    ]);
    return result.rows[0] as Record<string, any>;
  });

  await auditChange(client, {
    tabla: "core.compromisos",
    registroId: inserted.id as string,
    accion: "INSERT",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    despues: inserted,
  });

  const detail = await getCommitmentById(client, inserted.id as string);
  if (!detail) throw new Error("No se pudo leer el compromiso recién creado.");
  return detail;
}

export async function updateCommitment(
  client: PoolClient,
  ctx: CommitmentWriteContext,
  ref: string,
  body: unknown,
): Promise<CommitmentDetail> {
  const input = asObject(body);
  const current = await fetchCommitmentRow(client, ref);
  if (!current) {
    throw new ApiError(404, "El compromiso no existe.", "NOT_FOUND");
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (column: string, value: unknown, cast = "") => {
    params.push(value);
    sets.push(`${column} = $${params.length}${cast}`);
  };

  const accion = optionalText(input, "accion");
  if (accion === null) invalid();
  if (accion !== undefined) add("accion_compromiso", accion);

  const fechaInicio = optionalDate(input, "fechaInicio");
  if (fechaInicio === null) invalid();
  if (fechaInicio !== undefined) add("fecha_inicio", fechaInicio, "::date");

  const fechaVencimiento = optionalDate(input, "fechaVencimiento");
  if (fechaVencimiento !== undefined) {
    add("fecha_vencimiento", fechaVencimiento, "::date");
  }

  const tipo = optionalText(input, "tipo");
  if (tipo === null) invalid();
  if (tipo !== undefined) add("tipo_compromiso", mapCommitmentTipo(tipo));

  if (has(input, "nivelGobierno")) {
    const raw = optionalText(input, "nivelGobierno");
    if (raw === null) {
      add("nivel_gobierno", null);
    } else if (raw !== undefined) {
      const nivel = normalizeEnum(raw);
      if (!(NIVELES_GOBIERNO as readonly string[]).includes(nivel)) invalid();
      add("nivel_gobierno", nivel);
    }
  }

  const estadoCodigo = optionalText(input, "estado");
  if (estadoCodigo === null) invalid();
  if (estadoCodigo !== undefined) {
    add("estado_id", await resolveEstadoCompromiso(client, estadoCodigo));
  }

  const unidadSiglas = optionalText(input, "unidad");
  if (unidadSiglas === null) invalid();
  if (unidadSiglas !== undefined) {
    add("unidad_responsable_id", await resolveUnidad(client, unidadSiglas));
  }

  const alcanceCodigo = optionalText(input, "alcance");
  if (alcanceCodigo !== undefined) {
    add(
      "alcance_id",
      alcanceCodigo === null
        ? null
        : await resolveAlcance(client, alcanceCodigo),
    );
  }

  const tematicaRef = optionalText(input, "tematica");
  if (tematicaRef !== undefined) {
    add(
      "tematica_id",
      tematicaRef === null ? null : await resolveTematica(client, tematicaRef),
    );
  }

  const atiendeGenero = optionalBoolean(input, "atiendeGenero");
  if (atiendeGenero !== undefined) {
    add("atiende_brecha_genero", atiendeGenero);
  }

  const criteriosSmart = optionalJson(input, "criteriosSmart");
  if (criteriosSmart !== undefined) {
    add("criterios_smart", jsonParam(criteriosSmart), "::jsonb");
  }

  const evidenciaUri = optionalText(input, "evidenciaUri");
  if (evidenciaUri !== undefined) {
    add("evidencia_cumplimiento_uri", evidenciaUri);
  }

  if (sets.length === 0) invalid();

  params.push(current.id);
  const updated = (
    await client.query(
      `update core.compromisos
          set ${sets.join(", ")}
        where id = $${params.length}
        returning *`,
      params,
    )
  ).rows[0] as Record<string, any> | undefined;
  if (!updated) {
    throw new ApiError(404, "El compromiso no existe.", "NOT_FOUND");
  }

  await auditChange(client, {
    tabla: "core.compromisos",
    registroId: current.id as string,
    accion: "UPDATE",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    antes: current,
    despues: updated,
  });

  const detail = await getCommitmentById(client, current.id as string);
  if (!detail) throw new Error("No se pudo leer el compromiso actualizado.");
  return detail;
}

export async function deleteCommitment(
  client: PoolClient,
  ctx: CommitmentWriteContext,
  ref: string,
  motivo?: string,
): Promise<void> {
  const current = await fetchCommitmentRow(client, ref);
  if (!current) {
    throw new ApiError(404, "El compromiso no existe.", "NOT_FOUND");
  }

  const anulacion = await anularRegistro(
    client,
    "compromisos",
    String(current.id),
    motivo,
  );

  await auditChange(client, {
    tabla: "core.compromisos",
    registroId: current.id as string,
    accion: "DELETE",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    antes: current,
    despues: { anuladoEn: anulacion.anuladoEn, motivo: anulacion.motivo },
  });
}

export async function restoreCommitment(
  client: PoolClient,
  ref: string,
): Promise<void> {
  const current = await fetchCommitmentRow(client, ref);
  if (!current) {
    throw new ApiError(404, "El compromiso no existe.", "NOT_FOUND");
  }

  await restaurarRegistro(client, "compromisos", String(current.id));
}

/* ------------------------------------------------------------------ */
/* Hitos                                                               */
/* ------------------------------------------------------------------ */

const HITO_DETAIL_SELECT = `
  select h.id,
         h.codigo_hito as codigo,
         h.descripcion_hito as descripcion,
         to_char(h.fecha_vencimiento, 'YYYY-MM-DD') as fecha,
         to_char(h.fecha_real, 'YYYY-MM-DD') as fecha_real,
         replace(eh.codigo, '_', ' ') as estado,
         eh.es_terminal as terminal,
         h.validacion,
         h.descripcion_evidencia as descripcion_evidencia,
         h.link_evidencia as link_evidencia
    from core.hitos_compromiso h
    left join core.cat_estados_hito eh on eh.id = h.estado_id
`;

function mapHitoRow(row: Record<string, any>): CommitmentHitoDetail {
  return {
    id: row.id,
    codigo: row.codigo ?? null,
    descripcion: row.descripcion ?? null,
    fecha: row.fecha ?? null,
    fechaReal: row.fecha_real ?? null,
    estado: row.estado ?? null,
    terminal: row.terminal ?? null,
    validacion: row.validacion ?? null,
    descripcionEvidencia: row.descripcion_evidencia ?? null,
    linkEvidencia: row.link_evidencia ?? null,
  };
}

async function resolveCommitmentId(
  client: PoolClient,
  ref: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `select id from core.compromisos
      where id::text = $1 or codigo_compromiso = $1
      limit 1`,
    [ref],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "El compromiso no existe.", "NOT_FOUND");
  }
  return row.id;
}

async function resolveCommitmentTarget(
  client: PoolClient,
  ref: string,
): Promise<{ id: string; codigo: string }> {
  const result = await client.query<{ id: string; codigo: string }>(
    `select id, codigo_compromiso as codigo from core.compromisos
      where id::text = $1 or codigo_compromiso = $1
      limit 1`,
    [ref],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "El compromiso no existe.", "NOT_FOUND");
  }
  return row;
}

async function fetchHitoFormatted(
  client: PoolClient,
  id: string,
): Promise<CommitmentHitoDetail | null> {
  const result = await client.query(`${HITO_DETAIL_SELECT} where h.id = $1`, [
    id,
  ]);
  const row = result.rows[0];
  return row ? mapHitoRow(row) : null;
}

export async function createHito(
  client: PoolClient,
  ctx: CommitmentWriteContext,
  commitmentRef: string,
  body: unknown,
): Promise<CommitmentHitoDetail> {
  // El código del hito se deriva del compromiso (Anexo 12/14):
  // <codigo_compromiso>_H001.
  const compromiso = await resolveCommitmentTarget(client, commitmentRef);
  const compromisoId = compromiso.id;
  const input = asObject(body);

  const descripcion = requiredText(input, "descripcion");
  const fecha = optionalDate(input, "fecha");
  const estadoCodigo = optionalText(input, "estado");
  const estadoId = await resolveEstadoHito(
    client,
    estadoCodigo ?? "Registrado",
  );
  const evidencia = optionalText(input, "evidencia");

  const inserted = await retryUnique(client, async () => {
    const codigo = await nextSequentialCode(
      client,
      "core.hitos_compromiso",
      "codigo_hito",
      `${compromiso.codigo}_H`,
      3,
    );
    const result = await client.query(
      `insert into core.hitos_compromiso
         (compromiso_id, codigo_hito, descripcion_hito, fecha_vencimiento,
          estado_id, descripcion_evidencia, origen_dato)
       values ($1, $2, $3, $4::date, $5, $6, 'MANUAL')
       returning *`,
      [
        compromisoId,
        codigo,
        descripcion,
        fecha ?? null,
        estadoId,
        evidencia ?? null,
      ],
    );
    return result.rows[0] as Record<string, any>;
  });

  await auditChange(client, {
    tabla: "core.hitos_compromiso",
    registroId: inserted.id as string,
    accion: "INSERT",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    despues: inserted,
  });

  const hito = await fetchHitoFormatted(client, inserted.id as string);
  if (!hito) throw new Error("No se pudo leer el hito recién creado.");
  return hito;
}

export async function updateHito(
  client: PoolClient,
  ctx: CommitmentWriteContext,
  commitmentRef: string,
  hitoRef: string,
  body: unknown,
): Promise<CommitmentHitoDetail> {
  const compromisoId = await resolveCommitmentId(client, commitmentRef);
  const input = asObject(body);

  const currentResult = await client.query(
    `select * from core.hitos_compromiso
      where compromiso_id = $1
        and (id::text = $2 or codigo_hito = $2)
      limit 1`,
    [compromisoId, hitoRef],
  );
  const current = currentResult.rows[0] as Record<string, any> | undefined;
  if (!current) {
    throw new ApiError(404, "El hito no existe.", "NOT_FOUND");
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (column: string, value: unknown, cast = "") => {
    params.push(value);
    sets.push(`${column} = $${params.length}${cast}`);
  };

  const descripcion = optionalText(input, "descripcion");
  if (descripcion === null) invalid();
  if (descripcion !== undefined) add("descripcion_hito", descripcion);

  const fecha = optionalDate(input, "fecha");
  if (fecha !== undefined) add("fecha_vencimiento", fecha, "::date");

  const estadoCodigo = optionalText(input, "estado");
  if (estadoCodigo === null) invalid();
  if (estadoCodigo !== undefined) {
    add("estado_id", await resolveEstadoHito(client, estadoCodigo));
  }

  const fechaReal = optionalDate(input, "fechaReal");
  if (fechaReal !== undefined) add("fecha_real", fechaReal, "::date");

  const evidencia = optionalText(input, "evidencia");
  if (evidencia !== undefined) add("descripcion_evidencia", evidencia);

  if (sets.length === 0) invalid();

  params.push(current.id);
  const updated = (
    await client.query(
      `update core.hitos_compromiso
          set ${sets.join(", ")}
        where id = $${params.length}
        returning *`,
      params,
    )
  ).rows[0] as Record<string, any> | undefined;
  if (!updated) {
    throw new ApiError(404, "El hito no existe.", "NOT_FOUND");
  }

  await auditChange(client, {
    tabla: "core.hitos_compromiso",
    registroId: current.id as string,
    accion: "UPDATE",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    antes: current,
    despues: updated,
  });

  const hito = await fetchHitoFormatted(client, current.id as string);
  if (!hito) throw new Error("No se pudo leer el hito actualizado.");
  return hito;
}

export async function deleteHito(
  client: PoolClient,
  ctx: CommitmentWriteContext,
  commitmentRef: string,
  hitoRef: string,
  motivo?: string,
): Promise<void> {
  const compromisoId = await resolveCommitmentId(client, commitmentRef);
  const currentResult = await client.query(
    `select * from core.hitos_compromiso
      where compromiso_id = $1
        and (id::text = $2 or codigo_hito = $2)
      limit 1`,
    [compromisoId, hitoRef],
  );
  const current = currentResult.rows[0] as Record<string, any> | undefined;
  if (!current) {
    throw new ApiError(404, "El hito no existe.", "NOT_FOUND");
  }

  const anulacion = await anularRegistro(
    client,
    "hitos_compromiso",
    String(current.id),
    motivo,
  );

  await auditChange(client, {
    tabla: "core.hitos_compromiso",
    registroId: current.id as string,
    accion: "DELETE",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    antes: current,
    despues: { anuladoEn: anulacion.anuladoEn, motivo: anulacion.motivo },
  });
}
