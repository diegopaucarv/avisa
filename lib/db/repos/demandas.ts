import type { PoolClient } from "pg";
import { auditChange } from "../audit";
import { ApiError } from "../errors";
import { anularRegistro, restaurarRegistro } from "./anulacion";

const DEMANDA_SELECT = `
  d.id,
  d.descripcion_demanda as descripcion,
  d.problema_3p as problema,
  d.propuesta_3p as propuesta,
  d.pedido_3p as pedido,
  replace(d.estado_atencion, '_', ' ') as estado,
  d.motivo_no_atencion as motivo,
  d.caso_id,
  c.codigo_caso as caso_code,
  c.nombre_caso as caso_titulo,
  d.alerta_id,
  to_char(d.fecha_registro, 'YYYY-MM-DD') as fecha_registro,
  to_char(d.fecha_vencimiento_respuesta, 'YYYY-MM-DD') as fecha_vencimiento,
  te.nombre as tematica,
  d.origen_dato as origen,
  d.confidence::float8 as confianza,
  d.es_validado_humano as validado,
  d.nivel_clasificacion as clasificacion,
  d.afecta_diferenciadamente_mujeres as afecta_mujeres,
  d.documento_origen_id,
  d.anulado_en as anulado_en,
  d.motivo_anulacion as motivo_anulacion,
  d.anulado_por as anulado_por,
  ua.nombre as anulado_por_nombre,
  d.anulacion_id as anulacion_id
`;

const DEMANDA_FROM = `
  from core.demandas d
  left join core.casos c on c.id = d.caso_id
  left join core.cat_tematicas te on te.id = d.tematica_id
  left join core.usuarios ua on ua.id = d.anulado_por
`;

export type DemandaListQuery = {
  q?: string;
  caso?: string;
  sinCaso?: string;
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

export type DemandaListItem = {
  id: string;
  descripcion: string | null;
  problema: string | null;
  propuesta: string | null;
  pedido: string | null;
  estado: string | null;
  motivo: string | null;
  casoId: string | null;
  casoCode: string | null;
  casoTitulo: string | null;
  alertaId: string | null;
  fechaRegistro: string | null;
  fechaVencimiento: string | null;
  tematica: string | null;
  origen: string | null;
  confianza: number | null;
  validado: boolean | null;
  clasificacion: number | null;
  afectaMujeres: boolean | null;
  documentoOrigenId: string | null;
  /** Fecha de anulación en ISO 8601, o `null` si la demanda está vigente. */
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

export type DemandaListResult = {
  items: DemandaListItem[];
  total: number;
  page: number;
  pageSize: number;
  sinCasoTotal: number;
  vinculadasTotal: number;
  generatedAt: string;
};

const SORTS: Record<string, string> = {
  recent: "d.fecha_registro desc nulls last, d.created_at desc, d.id asc",
  oldest: "d.fecha_registro asc nulls last, d.created_at desc, d.id asc",
};

function mapDemanda(row: Record<string, unknown>): DemandaListItem {
  return {
    id: row.id as string,
    descripcion: row.descripcion as string | null,
    problema: row.problema as string | null,
    propuesta: row.propuesta as string | null,
    pedido: row.pedido as string | null,
    estado: row.estado as string | null,
    motivo: row.motivo as string | null,
    casoId: row.caso_id as string | null,
    casoCode: row.caso_code as string | null,
    casoTitulo: row.caso_titulo as string | null,
    alertaId: row.alerta_id as string | null,
    fechaRegistro: row.fecha_registro as string | null,
    fechaVencimiento: row.fecha_vencimiento as string | null,
    tematica: row.tematica as string | null,
    origen: row.origen as string | null,
    confianza: row.confianza as number | null,
    validado: row.validado as boolean | null,
    clasificacion: row.clasificacion as number | null,
    afectaMujeres: row.afecta_mujeres as boolean | null,
    documentoOrigenId: row.documento_origen_id as string | null,
    anuladoEn: isoOrNull(row.anulado_en),
    motivoAnulacion: row.motivo_anulacion as string | null,
    anuladoPor: row.anulado_por as string | null,
    anuladoPorNombre: row.anulado_por_nombre as string | null,
    anulacionId: row.anulacion_id as string | null,
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

/**
 * El catálogo escribe `En proceso`, con espacio (glosario §1.8; `CHECK` de la
 * migración 24). La API sigue aceptando la forma legada `En_proceso`, pero
 * normaliza siempre a la etiqueta con espacio, que es la única que la base
 * admite al escribir.
 */
function normalizeEstado(value: string): string {
  return value.trim().replace(/_/g, " ").replace(/\s+/g, " ");
}

export async function listDemandas(
  client: PoolClient,
  query: DemandaListQuery,
): Promise<DemandaListResult> {
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
      `(coalesce(d.descripcion_demanda, '') ilike ${like} or coalesce(d.problema_3p, '') ilike ${like} or coalesce(d.pedido_3p, '') ilike ${like})`,
    );
  }
  if (query.caso) where.push(`c.codigo_caso = ${bind(query.caso)}`);
  if (query.sinCaso === "true") {
    where.push("d.caso_id is null");
  } else if (query.sinCaso === "false") {
    where.push("d.caso_id is not null");
  }
  if (query.estado) {
    where.push(`d.estado_atencion = ${bind(normalizeEstado(query.estado))}`);
  }

  // Papelera: abrir la RLS es cosa de `app.ver_anulados`; aquí sólo se acota
  // el resultado a las filas anuladas. Sin `incluirAnulados` no se añade
  // `anulado_en is null`: `p_clasificacion` ya lo impone.
  if (query.incluirAnulados) {
    where.push("d.anulado_en is not null");
  }

  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 25)));
  const order = SORTS[query.sort ?? "recent"] ?? SORTS.recent;

  const sql = `
    select ${DEMANDA_SELECT},
           count(*) over()::int as total
    ${DEMANDA_FROM}
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by ${order}
    limit ${bind(pageSize)} offset ${bind((page - 1) * pageSize)}
  `;

  // Los totales de situación (huérfanas vs. vinculadas) son globales y no
  // dependen de los filtros de la petición: la interfaz los usa para ofrecer
  // "226 de 325 demandas sin caso" aunque el usuario esté filtrando.
  const [listed, counts] = await Promise.all([
    client.query(sql, params),
    client.query(
      `select count(*) filter (where caso_id is null)::int as sin_caso,
              count(*) filter (where caso_id is not null)::int as vinculadas
         from core.demandas`,
    ),
  ]);

  return {
    items: listed.rows.map(mapDemanda),
    total: listed.rows[0]?.total ?? 0,
    page,
    pageSize,
    sinCasoTotal: counts.rows[0]?.sin_caso ?? 0,
    vinculadasTotal: counts.rows[0]?.vinculadas ?? 0,
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Escrituras                                                          */
/* ------------------------------------------------------------------ */

export type DemandaWriteContext = {
  usuarioId: string;
  rolCodigo: string;
};

const ESTADOS_ATENCION = [
  "Pendiente",
  "En proceso",
  "Atendida",
  "Desestimada",
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function validateEstadoAtencion(value: string): string {
  const normalized = normalizeEstado(value);
  if (!(ESTADOS_ATENCION as readonly string[]).includes(normalized)) invalid();
  return normalized;
}

async function resolveCasoId(client: PoolClient, ref: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `select id from core.casos where codigo_caso = $1 or id::text = $1 limit 1`,
    [ref],
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

async function fetchDemandaRow(
  client: PoolClient,
  ref: string,
): Promise<Record<string, any> | undefined> {
  const result = await client.query(
    `select * from core.demandas where id::text = $1 limit 1`,
    [ref],
  );
  return result.rows[0] as Record<string, any> | undefined;
}

async function getDemandaById(
  client: PoolClient,
  id: string,
): Promise<DemandaListItem | null> {
  const result = await client.query(
    `select ${DEMANDA_SELECT}
     ${DEMANDA_FROM}
     where d.id::text = $1
     limit 1`,
    [id],
  );
  const row = result.rows[0];
  return row ? mapDemanda(row) : null;
}

export async function createDemanda(
  client: PoolClient,
  ctx: DemandaWriteContext,
  body: unknown,
): Promise<DemandaListItem> {
  const input = asObject(body);

  const descripcion = requiredText(input, "descripcion");

  const casoCode = optionalText(input, "casoCode");
  const casoId = casoCode ? await resolveCasoId(client, casoCode) : null;

  const alertaId = optionalUuid(input, "alertaId");
  const problema = optionalText(input, "problema");
  const propuesta = optionalText(input, "propuesta");
  const pedido = optionalText(input, "pedido");

  const estadoRaw = optionalText(input, "estado");
  const estado = validateEstadoAtencion(estadoRaw ?? "Pendiente");

  const motivo = optionalText(input, "motivo");
  const fechaRegistro = optionalDate(input, "fechaRegistro");
  const fechaVencimiento = optionalDate(input, "fechaVencimiento");

  const tematicaRef = optionalText(input, "tematica");
  const tematicaId = tematicaRef
    ? await resolveTematica(client, tematicaRef)
    : null;

  const afectaMujeres = optionalBoolean(input, "afectaMujeres") ?? false;

  const inserted = (
    await client.query(
      `insert into core.demandas
         (caso_id, alerta_id, descripcion_demanda, problema_3p, propuesta_3p,
          pedido_3p, estado_atencion, motivo_no_atencion, fecha_registro,
          fecha_vencimiento_respuesta, tematica_id,
          afecta_diferenciadamente_mujeres, origen_dato)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10::date, $11, $12,
               'MANUAL')
       returning *`,
      [
        casoId,
        alertaId ?? null,
        descripcion,
        problema ?? null,
        propuesta ?? null,
        pedido ?? null,
        estado,
        motivo ?? null,
        fechaRegistro ?? null,
        fechaVencimiento ?? null,
        tematicaId,
        afectaMujeres,
      ],
    )
  ).rows[0] as Record<string, any>;

  await auditChange(client, {
    tabla: "core.demandas",
    registroId: inserted.id as string,
    accion: "INSERT",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    despues: inserted,
  });

  const detail = await getDemandaById(client, inserted.id as string);
  if (!detail) throw new Error("No se pudo leer la demanda recién creada.");
  return detail;
}

export async function updateDemanda(
  client: PoolClient,
  ctx: DemandaWriteContext,
  ref: string,
  body: unknown,
): Promise<DemandaListItem> {
  const input = asObject(body);
  const current = await fetchDemandaRow(client, ref);
  if (!current) {
    throw new ApiError(404, "La demanda no existe.", "NOT_FOUND");
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (column: string, value: unknown, cast = "") => {
    params.push(value);
    sets.push(`${column} = $${params.length}${cast}`);
  };

  const descripcion = optionalText(input, "descripcion");
  if (descripcion !== undefined) add("descripcion_demanda", descripcion);

  const casoCode = optionalText(input, "casoCode");
  if (casoCode !== undefined) {
    add(
      "caso_id",
      casoCode === null ? null : await resolveCasoId(client, casoCode),
    );
  }

  const alertaId = optionalUuid(input, "alertaId");
  if (alertaId !== undefined) add("alerta_id", alertaId);

  const problema = optionalText(input, "problema");
  if (problema !== undefined) add("problema_3p", problema);

  const propuesta = optionalText(input, "propuesta");
  if (propuesta !== undefined) add("propuesta_3p", propuesta);

  const pedido = optionalText(input, "pedido");
  if (pedido !== undefined) add("pedido_3p", pedido);

  const estadoRaw = optionalText(input, "estado");
  if (estadoRaw === null) invalid();
  if (estadoRaw !== undefined) {
    add("estado_atencion", validateEstadoAtencion(estadoRaw));
  }

  const motivo = optionalText(input, "motivo");
  if (motivo !== undefined) add("motivo_no_atencion", motivo);

  const fechaRegistro = optionalDate(input, "fechaRegistro");
  if (fechaRegistro !== undefined) {
    add("fecha_registro", fechaRegistro, "::date");
  }

  const fechaVencimiento = optionalDate(input, "fechaVencimiento");
  if (fechaVencimiento !== undefined) {
    add("fecha_vencimiento_respuesta", fechaVencimiento, "::date");
  }

  const tematicaRef = optionalText(input, "tematica");
  if (tematicaRef !== undefined) {
    add(
      "tematica_id",
      tematicaRef === null ? null : await resolveTematica(client, tematicaRef),
    );
  }

  const afectaMujeres = optionalBoolean(input, "afectaMujeres");
  if (afectaMujeres !== undefined) {
    add("afecta_diferenciadamente_mujeres", afectaMujeres);
  }

  if (sets.length === 0) invalid();

  params.push(current.id);
  const updated = (
    await client.query(
      `update core.demandas
          set ${sets.join(", ")}
        where id = $${params.length}
        returning *`,
      params,
    )
  ).rows[0] as Record<string, any> | undefined;
  if (!updated) {
    throw new ApiError(404, "La demanda no existe.", "NOT_FOUND");
  }

  await auditChange(client, {
    tabla: "core.demandas",
    registroId: current.id as string,
    accion: "UPDATE",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    antes: current,
    despues: updated,
  });

  const detail = await getDemandaById(client, current.id as string);
  if (!detail) throw new Error("No se pudo leer la demanda actualizada.");
  return detail;
}

export async function deleteDemanda(
  client: PoolClient,
  ctx: DemandaWriteContext,
  ref: string,
  motivo?: string,
): Promise<void> {
  const current = await fetchDemandaRow(client, ref);
  if (!current) {
    throw new ApiError(404, "La demanda no existe.", "NOT_FOUND");
  }

  const anulacion = await anularRegistro(
    client,
    "demandas",
    String(current.id),
    motivo,
  );

  await auditChange(client, {
    tabla: "core.demandas",
    registroId: current.id as string,
    accion: "DELETE",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    antes: current,
    despues: { anuladoEn: anulacion.anuladoEn, motivo: anulacion.motivo },
  });
}

export async function restoreDemanda(
  client: PoolClient,
  ref: string,
): Promise<void> {
  const current = await fetchDemandaRow(client, ref);
  if (!current) {
    throw new ApiError(404, "La demanda no existe.", "NOT_FOUND");
  }

  await restaurarRegistro(client, "demandas", String(current.id));
}
