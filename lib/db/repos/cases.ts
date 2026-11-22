import type { PoolClient } from "pg";
import { auditChange } from "../audit";
import { ApiError } from "../errors";
import { normalizarMotivo } from "./anulacion";

const CASE_SELECT = `
  c.id,
  c.codigo_caso as code,
  c.nombre_caso as title,
  c.resumen_ejecutivo as summary,
  c.descripcion_riesgo,
  c.pct_avance::float8 as progress,
  to_char(c.fecha_ultima_actualizacion at time zone 'America/Lima', 'YYYY-MM-DD') as updated,
  c.fecha_ultima_actualizacion as updated_at,
  to_char(c.fecha_inicio, 'YYYY-MM-DD') as fecha_inicio,
  to_char(c.fecha_cierre, 'YYYY-MM-DD') as fecha_cierre,
  coalesce(reg.nombre, rp.nombre) as region,
  replace(ec.codigo, '_', ' ') as estado,
  nr.codigo as risk,
  pa.codigo as prioridad,
  ag.codigo as alcance,
  nc.nombre as nivel_conflicto,
  ci.nombre as stage,
  te.nombre as tematica,
  su.nombre as subsector,
  uo.siglas as unidad_responsable,
  c.origen_dato as origen,
  c.nivel_clasificacion as clasificacion
`;

const CASE_FROM = `
  from core.casos c
  left join core.cat_estados_caso ec on ec.id = c.estado_id
  left join core.cat_niveles_riesgo nr on nr.id = c.nivel_riesgo_id
  left join core.cat_prioridades_atencion pa on pa.id = c.prioridad_id
  left join core.cat_alcances_geograficos ag on ag.id = c.alcance_id
  left join core.cat_niveles_conflicto nc on nc.id = c.nivel_conflicto_id
  left join core.cat_ciclos_intervencion ci on ci.id = c.ciclo_intervencion_id
  left join core.cat_tematicas te on te.id = c.tematica_id
  left join core.cat_subsectores su on su.id = c.subsector_id
  left join core.cat_unidades_organicas uo on uo.id = c.unidad_responsable_id
  left join core.regiones rp on rp.id = c.region_principal_id
  left join lateral (
    select rg.nombre
      from core.caso_regiones cr
      join core.regiones rg on rg.id = cr.region_id
     where cr.caso_id = c.id
     order by cr.es_principal desc, rg.nombre
     limit 1
  ) reg on true
`;

export type CaseListQuery = {
  q?: string;
  estado?: string;
  riesgo?: string;
  prioridad?: string;
  alcance?: string;
  tematica?: string;
  unidad?: string;
  region?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
};

export type CaseListItem = {
  id: string;
  code: string;
  title: string;
  summary: string | null;
  progress: number | null;
  updated: string | null;
  updatedAt: string | Date | null;
  region: string | null;
  estado: string | null;
  risk: string | null;
  riskSource: "casos.nivel_riesgo_id";
  riskDerived: false;
  prioridad: string | null;
  alcance: string | null;
  nivelConflicto: string | null;
  stage: string | null;
  tematica: string | null;
  subsector: string | null;
  unidadResponsable: string | null;
  origen: string | null;
  clasificacion: number;
};

export type CaseListResult = {
  items: CaseListItem[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
};

const SORTS: Record<string, string> = {
  recent: "c.fecha_ultima_actualizacion desc, c.codigo_caso asc",
  risk: "nr.orden desc nulls last, c.codigo_caso asc",
  priority: "pa.orden asc nulls last, c.codigo_caso asc",
  code: "c.codigo_caso asc",
};

function normalizeState(value: string): string {
  return value.trim().replace(/\s+/g, "_");
}

export async function listCases(
  client: PoolClient,
  query: CaseListQuery,
): Promise<CaseListResult> {
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
      `(c.codigo_caso ilike ${like} or c.nombre_caso ilike ${like} or coalesce(c.resumen_ejecutivo, '') ilike ${like})`,
    );
  }
  if (query.estado)
    where.push(`ec.codigo = ${bind(normalizeState(query.estado))}`);
  if (query.riesgo) where.push(`nr.codigo = ${bind(query.riesgo)}`);
  if (query.prioridad) where.push(`pa.codigo = ${bind(query.prioridad)}`);
  if (query.alcance) where.push(`ag.codigo = ${bind(query.alcance)}`);
  if (query.tematica) where.push(`te.nombre = ${bind(query.tematica)}`);
  if (query.unidad) where.push(`uo.siglas = ${bind(query.unidad)}`);
  if (query.region) {
    where.push(`coalesce(reg.nombre, rp.nombre) = ${bind(query.region)}`);
  }

  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 25)));
  const order = SORTS[query.sort ?? "recent"] ?? SORTS.recent;

  const sql = `
    select ${CASE_SELECT},
           count(*) over()::int as total
    ${CASE_FROM}
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by ${order}
    limit ${bind(pageSize)} offset ${bind((page - 1) * pageSize)}
  `;

  const result = await client.query(sql, params);
  const total = result.rows[0]?.total ?? 0;

  const items: CaseListItem[] = result.rows.map((row) => ({
    id: row.id,
    code: row.code,
    title: row.title,
    summary: row.summary,
    progress: row.progress,
    updated: row.updated,
    updatedAt: row.updated_at,
    region: row.region,
    estado: row.estado,
    risk: row.risk,
    riskSource: "casos.nivel_riesgo_id",
    riskDerived: false,
    prioridad: row.prioridad,
    alcance: row.alcance,
    nivelConflicto: row.nivel_conflicto,
    stage: row.stage,
    tematica: row.tematica,
    subsector: row.subsector,
    unidadResponsable: row.unidad_responsable,
    origen: row.origen,
    clasificacion: row.clasificacion,
  }));

  return {
    items,
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
  };
}

export type CaseActor = {
  id: string;
  nombre: string;
  naturaleza: string;
  tipo: string | null;
  funcion: string | null;
  posicionamiento: string | null;
  correo: string | null;
};

export type CaseEvent = {
  id: string;
  fecha: string;
  tipo: string | null;
  descripcion: string;
  validado: boolean;
  critico: boolean;
  evidencia: string | null;
};

export type CaseDemanda = {
  id: string;
  problema: string | null;
  propuesta: string | null;
  pedido: string | null;
  descripcion: string | null;
  estado: string;
  motivo: string | null;
};

export type CaseHito = {
  id: string;
  descripcion: string;
  fecha: string | null;
  estado: string | null;
};

export type CaseCommitment = {
  id: string;
  codigo: string;
  accion: string;
  tipo: string;
  nivelGobierno: string | null;
  fechaInicio: string | null;
  estado: string | null;
  unidad: string | null;
  evidenciaUri: string | null;
  atiendeGenero: boolean;
  hitos: CaseHito[];
};

export type CaseDocument = {
  id: string;
  codigo: string | null;
  titulo: string;
  fecha: string | null;
  tipo: string | null;
  tipoNombre: string | null;
  estado: string | null;
  resumen: string | null;
  archivo: string | null;
  origen: string | null;
  confianza: number | null;
};

export type CaseDetail = {
  case: CaseListItem & {
    regiones: string[];
    fechaInicio: string | null;
    fechaCierre: string | null;
    descripcionRiesgo: string | null;
  };
  actors: CaseActor[];
  events: CaseEvent[];
  demandas: CaseDemanda[];
  commitments: CaseCommitment[];
  documents: CaseDocument[];
  generatedAt: string;
};

export async function getCaseByCode(
  client: PoolClient,
  code: string,
): Promise<CaseDetail | null> {
  const result = await client.query(
    `select ${CASE_SELECT},
            (select array_agg(rg.nombre order by rg.nombre)
               from core.caso_regiones cr
               join core.regiones rg on rg.id = cr.region_id
              where cr.caso_id = c.id) as regiones
     ${CASE_FROM}
     where c.codigo_caso = $1`,
    [code],
  );

  const row = result.rows[0];
  if (!row) return null;

  const [actors, events, demandas, commitments, documents] = await Promise.all([
    client.query(
      `select a.actor_uid as id,
              a.nombre_actual as nombre,
              a.naturaleza,
              ta.nombre as tipo,
              ra.nombre as funcion,
              pf.nombre as posicionamiento,
              a.email_contacto as correo
         from core.casos_actores ca
         join core.actores a on a.actor_uid = ca.actor_id
         left join core.cat_tipos_actor ta on ta.id = a.tipo_actor_id
         left join core.cat_roles_actor ra on ra.id = a.rol_actor_id
         left join core.cat_perfiles_actor pf on pf.id = a.perfil_id
        where ca.caso_id = $1
        order by a.nombre_actual`,
      [row.id],
    ),
    client.query(
      `select ev.id,
              to_char(ev.fecha_evento, 'YYYY-MM-DD') as fecha,
              th.nombre as tipo,
              ev.descripcion_hecho as descripcion,
              ev.es_validado_humano as validado,
              ev.es_hecho_critico as critico,
              ev.link_evidencia as evidencia
         from core.caso_cronologia ev
         left join core.cat_tipos_hecho th on th.id = ev.tipo_hecho_id
        where ev.caso_id = $1
        order by ev.fecha_evento desc, ev.created_at desc`,
      [row.id],
    ),
    client.query(
      `select d.id,
              d.problema_3p as problema,
              d.propuesta_3p as propuesta,
              d.pedido_3p as pedido,
              d.descripcion_demanda as descripcion,
              replace(d.estado_atencion, '_', ' ') as estado,
              d.motivo_no_atencion as motivo
         from core.demandas d
        where d.caso_id = $1
        order by d.fecha_registro desc nulls last`,
      [row.id],
    ),
    client.query(
      `select cmp.id,
              cmp.codigo_compromiso as codigo,
              cmp.accion_compromiso as accion,
              cmp.tipo_compromiso as tipo,
              replace(cmp.nivel_gobierno, '_', ' ') as nivel_gobierno,
              to_char(cmp.fecha_inicio, 'YYYY-MM-DD') as fecha_inicio,
              ec.codigo as estado,
              uo.siglas as unidad,
              cmp.evidencia_cumplimiento_uri as evidencia_uri,
              cmp.atiende_brecha_genero as atiende_genero,
              coalesce((
                select json_agg(json_build_object(
                         'id', h.id,
                         'descripcion', h.descripcion_hito,
                         'fecha', to_char(h.fecha_vencimiento, 'YYYY-MM-DD'),
                         'estado', replace(eh.codigo, '_', ' ')
                       ) order by h.fecha_vencimiento nulls last)
                  from core.hitos_compromiso h
                  left join core.cat_estados_hito eh on eh.id = h.estado_id
                 where h.compromiso_id = cmp.id
              ), '[]'::json) as hitos
         from core.compromisos cmp
         left join core.cat_estados_compromiso ec on ec.id = cmp.estado_id
         left join core.cat_unidades_organicas uo on uo.id = cmp.unidad_responsable_id
        where cmp.caso_id = $1
        order by cmp.fecha_inicio desc, cmp.codigo_compromiso`,
      [row.id],
    ),
    client.query(
      `select d.id,
              d.codigo,
              d.titulo,
              to_char(d.fecha, 'YYYY-MM-DD') as fecha,
              td.codigo as tipo,
              td.nombre as tipo_nombre,
              d.estado,
              d.resumen_ejecutivo as resumen,
              d.url_pdf as archivo,
              d.origen_dato as origen,
              d.confidence::float8 as confianza
         from core.documentos d
         left join core.cat_tipos_documento td on td.id = d.tipo_id
        where d.caso_id = $1
        order by d.fecha desc, d.codigo`,
      [row.id],
    ),
  ]);

  const item: CaseListItem = {
    id: row.id,
    code: row.code,
    title: row.title,
    summary: row.summary,
    progress: row.progress,
    updated: row.updated,
    updatedAt: row.updated_at,
    region: row.region,
    estado: row.estado,
    risk: row.risk,
    riskSource: "casos.nivel_riesgo_id",
    riskDerived: false,
    prioridad: row.prioridad,
    alcance: row.alcance,
    nivelConflicto: row.nivel_conflicto,
    stage: row.stage,
    tematica: row.tematica,
    subsector: row.subsector,
    unidadResponsable: row.unidad_responsable,
    origen: row.origen,
    clasificacion: row.clasificacion,
  };

  return {
    case: {
      ...item,
      regiones: (row.regiones ?? []) as string[],
      fechaInicio: row.fecha_inicio,
      fechaCierre: row.fecha_cierre,
      descripcionRiesgo: row.descripcion_riesgo,
    },
    actors: actors.rows as CaseActor[],
    events: events.rows as CaseEvent[],
    demandas: demandas.rows as CaseDemanda[],
    commitments: commitments.rows as CaseCommitment[],
    documents: documents.rows as CaseDocument[],
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

const MAX_TITLE_LENGTH = 255;
const MAX_TEXT_LENGTH = 20000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ORIGEN_VALUES = new Set([
  "MANUAL",
  "KAG",
  "WORKFLOW",
  "AVISA_HISTORICO",
  "WHATSAPP",
]);

const CASE_WRITE_COLUMNS = [
  "codigo_caso",
  "nombre_caso",
  "resumen_ejecutivo",
  "descripcion_riesgo",
  "pct_avance",
  "fecha_inicio",
  "fecha_cierre",
  "estado_id",
  "nivel_riesgo_id",
  "prioridad_id",
  "alcance_id",
  "nivel_conflicto_id",
  "ciclo_intervencion_id",
  "tematica_id",
  "subsector_id",
  "unidad_responsable_id",
  "region_principal_id",
  "origen_dato",
] as const;

type CatalogKey =
  | "estado"
  | "riesgo"
  | "prioridad"
  | "alcance"
  | "nivelConflicto"
  | "ciclo"
  | "tematica"
  | "subsector"
  | "unidadResponsable";

/**
 * Tabla y columnas de código literales: el body nunca elige identificadores.
 * `alt` permite aceptar la etiqueta visible (nombre/siglas) además del código.
 */
const CASE_CATALOGS: Record<
  CatalogKey,
  { table: string; code: string; alt?: string }
> = {
  estado: { table: "core.cat_estados_caso", code: "codigo" },
  riesgo: { table: "core.cat_niveles_riesgo", code: "codigo" },
  prioridad: { table: "core.cat_prioridades_atencion", code: "codigo" },
  alcance: { table: "core.cat_alcances_geograficos", code: "codigo" },
  nivelConflicto: { table: "core.cat_niveles_conflicto", code: "codigo" },
  ciclo: {
    table: "core.cat_ciclos_intervencion",
    code: "codigo_legado",
    alt: "nombre",
  },
  tematica: {
    table: "core.cat_tematicas",
    code: "codigo_legado",
    alt: "nombre",
  },
  subsector: {
    table: "core.cat_subsectores",
    code: "codigo_legado",
    alt: "nombre",
  },
  unidadResponsable: {
    table: "core.cat_unidades_organicas",
    code: "siglas",
    alt: "nombre_completo",
  },
};

type SqlField = { column: string; value: unknown; cast?: string };
type RegionRow = { id: number; nombre: string };

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

function numericIn(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid();
  if (value < min || value > max) invalid();
  return value;
}

function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !DATE_RE.test(value)) invalid();
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) invalid();
  // Rechaza fechas imposibles como 2026-02-30 (que Date normaliza).
  if (parsed.toISOString().slice(0, 10) !== value) invalid();
  return value;
}

function origenValue(value: unknown): string {
  if (typeof value !== "string") invalid();
  const normalized = value.trim().toUpperCase();
  if (!ORIGEN_VALUES.has(normalized)) invalid();
  return normalized;
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
  key: CatalogKey,
  raw: unknown,
): Promise<number> {
  if (typeof raw !== "string") invalid();
  const value = raw.trim();
  if (!value) invalid();
  // Las etiquetas de catálogo llevan espacio y tilde (`En ejecución`), pero la
  // API sigue aceptando `En_ejecucion`. `core.normalizar_ref` iguala ambas.
  const spec = CASE_CATALOGS[key];
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

async function catalogValue(
  client: PoolClient,
  key: CatalogKey,
  raw: unknown,
): Promise<number> {
  if (raw === null || raw === undefined) invalid();
  return resolveCatalog(client, key, raw);
}

async function resolveCatalogOrDefault(
  client: PoolClient,
  key: CatalogKey,
  raw: unknown,
  fallback: string,
): Promise<number> {
  return resolveCatalog(
    client,
    key,
    raw === null || raw === undefined ? fallback : raw,
  );
}

/**
 * Para catálogos donde «no informado» es un valor legítimo: la Guía pide una
 * única temática principal, pero admite registrar un caso antes de
 * clasificarlo. Devuelve `null` en vez de inventar una categoría.
 */
async function resolveOptionalCatalog(
  client: PoolClient,
  key: CatalogKey,
  raw: unknown,
): Promise<number | null> {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && !raw.trim()) return null;
  return resolveCatalog(client, key, raw);
}

function readRegionNames(
  body: Record<string, unknown>,
  required: boolean,
): string[] | null {
  const single = readField(body, ["region"]);
  const multi = readField(body, ["regiones"]);
  if (!single.present && !multi.present) {
    if (required) invalid();
    return null;
  }

  const names: string[] = [];
  if (multi.present) {
    if (!Array.isArray(multi.value)) invalid();
    for (const item of multi.value) {
      if (typeof item !== "string") invalid();
      const trimmed = item.trim();
      if (!trimmed) invalid();
      names.push(trimmed);
    }
  }
  if (single.present) {
    if (typeof single.value !== "string") invalid();
    const trimmed = single.value.trim();
    if (!trimmed) invalid();
    names.unshift(trimmed);
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(name);
    }
  }

  if (unique.length === 0) {
    if (required) invalid();
    return [];
  }
  return unique;
}

async function resolveRegions(
  client: PoolClient,
  names: string[],
): Promise<RegionRow[]> {
  if (names.length === 0) return [];
  const result = await client.query(
    `select id, nombre from core.regiones where lower(nombre) = any($1::text[])`,
    [names.map((name) => name.toLowerCase())],
  );
  const byName = new Map<string, RegionRow>();
  for (const row of result.rows) {
    byName.set(String(row.nombre).toLowerCase(), {
      id: Number(row.id),
      nombre: String(row.nombre),
    });
  }
  return names.map((name) => {
    const found = byName.get(name.toLowerCase());
    if (!found) invalid();
    return found;
  });
}

async function replaceCaseRegions(
  client: PoolClient,
  casoId: string,
  regions: RegionRow[],
): Promise<void> {
  await client.query(`delete from core.caso_regiones where caso_id = $1`, [
    casoId,
  ]);
  for (let index = 0; index < regions.length; index += 1) {
    await client.query(
      `insert into core.caso_regiones (caso_id, region_id, es_principal)
       values ($1, $2, $3)`,
      [casoId, regions[index].id, index === 0],
    );
  }
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

/**
 * El código lo emite el contador persistente de la base (`core.secuencia_codigo`
 * a través de `core.siguiente_codigo_caso`), que es atómico: dos altas
 * simultáneas reciben números distintos. Se conserva el savepoint para que un
 * 23505 inesperado no aborte toda la transacción.
 */
async function insertCaseRow(
  client: PoolClient,
  subsectorId: number | null,
  tematicaId: number | null,
  build: (codigo: string) => SqlField[],
): Promise<Record<string, any>> {
  let retried = false;
  for (;;) {
    await client.query("savepoint caso_insert");
    try {
      const coded = await client.query<{ codigo: string }>(
        `select core.siguiente_codigo_caso($1::int, $2::int) as codigo`,
        [subsectorId, tematicaId],
      );
      const codigo = coded.rows[0].codigo;
      const { sql, params } = insertSql("core.casos", build(codigo));
      const result = await client.query(sql, params);
      await client.query("release savepoint caso_insert");
      return result.rows[0];
    } catch (error) {
      if (!retried && (error as { code?: string }).code === "23505") {
        retried = true;
        await client.query("rollback to savepoint caso_insert");
        continue;
      }
      throw error;
    }
  }
}

export async function createCase(
  client: PoolClient,
  session: WriteSession,
  body: Record<string, unknown>,
): Promise<CaseDetail> {
  const title = requiredText(
    readField(body, ["titulo", "nombreCaso", "nombre_caso"]).value,
    MAX_TITLE_LENGTH,
  );
  const regionNames = readRegionNames(body, true);
  if (!regionNames) invalid();
  const regions = await resolveRegions(client, regionNames);

  // El código del caso se compone con estos dos catálogos, así que se resuelven
  // antes de construir las columnas. La temática puede faltar: la Guía pide una
  // temática principal, pero un caso se puede registrar antes de clasificarlo.
  const tematicaId = await resolveOptionalCatalog(
    client,
    "tematica",
    readField(body, ["tematica"]).value,
  );
  const subsectorId = await resolveCatalogOrDefault(
    client,
    "subsector",
    readField(body, ["subsector"]).value,
    "Sector-01",
  );

  const fields: SqlField[] = [
    { column: "nombre_caso", value: title },
    { column: "region_principal_id", value: regions[0]?.id ?? null },
    {
      column: "nivel_riesgo_id",
      value: await resolveCatalogOrDefault(
        client,
        "riesgo",
        readField(body, ["riesgo"]).value,
        "Bajo",
      ),
    },
    { column: "tematica_id", value: tematicaId },
    { column: "subsector_id", value: subsectorId },
    {
      column: "unidad_responsable_id",
      value: await resolveCatalogOrDefault(
        client,
        "unidadResponsable",
        readField(body, ["unidadResponsable", "unidad"]).value,
        "OAIPCS",
      ),
    },
  ];

  const resumen = readField(body, [
    "resumenEjecutivo",
    "resumen_ejecutivo",
    "resumen",
  ]);
  if (resumen.present) {
    fields.push({
      column: "resumen_ejecutivo",
      value: text(resumen.value, MAX_TEXT_LENGTH, false),
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

  const avance = readField(body, ["pctAvance", "pct_avance", "avance"]);
  if (avance.present) {
    fields.push({
      column: "pct_avance",
      value: avance.value === null ? null : numericIn(avance.value, 0, 100),
    });
  }

  const inicio = readField(body, ["fechaInicio", "fecha_inicio"]);
  if (inicio.present)
    fields.push({ column: "fecha_inicio", value: dateOnly(inicio.value) });

  const cierre = readField(body, ["fechaCierre", "fecha_cierre"]);
  if (cierre.present)
    fields.push({ column: "fecha_cierre", value: dateOnly(cierre.value) });

  const estado = readField(body, ["estado"]);
  if (estado.present && estado.value !== null) {
    fields.push({
      column: "estado_id",
      value: await resolveCatalog(client, "estado", estado.value),
    });
  }

  const prioridad = readField(body, ["prioridad"]);
  if (prioridad.present && prioridad.value !== null) {
    fields.push({
      column: "prioridad_id",
      value: await resolveCatalog(client, "prioridad", prioridad.value),
    });
  }

  const alcance = readField(body, ["alcance"]);
  if (alcance.present && alcance.value !== null) {
    fields.push({
      column: "alcance_id",
      value: await resolveCatalog(client, "alcance", alcance.value),
    });
  }

  const conflicto = readField(body, ["nivelConflicto", "nivel_conflicto"]);
  if (conflicto.present && conflicto.value !== null) {
    fields.push({
      column: "nivel_conflicto_id",
      value: await resolveCatalog(client, "nivelConflicto", conflicto.value),
    });
  }

  const ciclo = readField(body, ["ciclo"]);
  if (ciclo.present && ciclo.value !== null) {
    fields.push({
      column: "ciclo_intervencion_id",
      value: await resolveCatalog(client, "ciclo", ciclo.value),
    });
  }

  const origen = readField(body, ["origenDato", "origen_dato"]);
  if (origen.present && origen.value !== null) {
    fields.push({ column: "origen_dato", value: origenValue(origen.value) });
  }

  const row = await insertCaseRow(client, subsectorId, tematicaId, (codigo) => [
    { column: "codigo_caso", value: codigo },
    ...fields,
  ]);

  await replaceCaseRegions(client, String(row.id), regions);

  await auditChange(client, {
    tabla: "core.casos",
    registroId: String(row.id),
    accion: "INSERT",
    usuarioId: session.usuarioId,
    rolCodigo: session.rolCodigo,
    antes: null,
    despues: {
      ...pick(row, CASE_WRITE_COLUMNS),
      regiones: regions.map((region) => region.nombre),
    },
  });

  const detail = await getCaseByCode(client, String(row.codigo_caso));
  if (!detail) {
    throw new ApiError(
      500,
      "No se pudo leer el caso creado.",
      "READ_BACK_FAILED",
    );
  }
  return detail;
}

export async function updateCase(
  client: PoolClient,
  session: WriteSession,
  code: string,
  body: Record<string, unknown>,
): Promise<CaseDetail> {
  const current = await client.query(
    `select * from core.casos where codigo_caso = $1`,
    [code],
  );
  const row = current.rows[0];
  if (!row) throw new ApiError(404, "El caso no existe.", "NOT_FOUND");

  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (column: string, value: unknown, cast?: string) => {
    params.push(value);
    sets.push(`${column} = $${params.length}${cast ? `::${cast}` : ""}`);
  };

  const title = readField(body, ["titulo", "nombreCaso", "nombre_caso"]);
  if (title.present)
    add("nombre_caso", requiredText(title.value, MAX_TITLE_LENGTH));

  const resumen = readField(body, [
    "resumenEjecutivo",
    "resumen_ejecutivo",
    "resumen",
  ]);
  if (resumen.present)
    add("resumen_ejecutivo", text(resumen.value, MAX_TEXT_LENGTH, false));

  const descripcion = readField(body, [
    "descripcionRiesgo",
    "descripcion_riesgo",
  ]);
  if (descripcion.present)
    add("descripcion_riesgo", text(descripcion.value, MAX_TEXT_LENGTH, false));

  const avance = readField(body, ["pctAvance", "pct_avance", "avance"]);
  if (avance.present) {
    add(
      "pct_avance",
      avance.value === null ? null : numericIn(avance.value, 0, 100),
    );
  }

  const inicio = readField(body, ["fechaInicio", "fecha_inicio"]);
  if (inicio.present) add("fecha_inicio", dateOnly(inicio.value));

  const cierre = readField(body, ["fechaCierre", "fecha_cierre"]);
  if (cierre.present) add("fecha_cierre", dateOnly(cierre.value));

  // Columnas NOT NULL: un null explícito es un dato inválido, no un borrado.
  const estado = readField(body, ["estado"]);
  if (estado.present) {
    add("estado_id", await catalogValue(client, "estado", estado.value));
  }

  const riesgo = readField(body, ["riesgo"]);
  if (riesgo.present) {
    add("nivel_riesgo_id", await catalogValue(client, "riesgo", riesgo.value));
  }

  const tematica = readField(body, ["tematica"]);
  if (tematica.present) {
    add("tematica_id", await catalogValue(client, "tematica", tematica.value));
  }

  const subsector = readField(body, ["subsector"]);
  if (subsector.present) {
    add(
      "subsector_id",
      await catalogValue(client, "subsector", subsector.value),
    );
  }

  const unidad = readField(body, ["unidadResponsable", "unidad"]);
  if (unidad.present) {
    add(
      "unidad_responsable_id",
      await catalogValue(client, "unidadResponsable", unidad.value),
    );
  }

  // Columnas anulables: null limpia la relación.
  const prioridad = readField(body, ["prioridad"]);
  if (prioridad.present) {
    add(
      "prioridad_id",
      prioridad.value === null
        ? null
        : await resolveCatalog(client, "prioridad", prioridad.value),
    );
  }

  const alcance = readField(body, ["alcance"]);
  if (alcance.present) {
    add(
      "alcance_id",
      alcance.value === null
        ? null
        : await resolveCatalog(client, "alcance", alcance.value),
    );
  }

  const conflicto = readField(body, ["nivelConflicto", "nivel_conflicto"]);
  if (conflicto.present) {
    add(
      "nivel_conflicto_id",
      conflicto.value === null
        ? null
        : await resolveCatalog(client, "nivelConflicto", conflicto.value),
    );
  }

  const ciclo = readField(body, ["ciclo"]);
  if (ciclo.present) {
    add(
      "ciclo_intervencion_id",
      ciclo.value === null
        ? null
        : await resolveCatalog(client, "ciclo", ciclo.value),
    );
  }

  const origen = readField(body, ["origenDato", "origen_dato"]);
  if (origen.present) add("origen_dato", origenValue(origen.value));

  const regionNames = readRegionNames(body, false);
  let regions: RegionRow[] | null = null;
  let previousRegions: string[] = [];
  if (regionNames) {
    const previous = await client.query(
      `select rg.nombre
         from core.caso_regiones cr
         join core.regiones rg on rg.id = cr.region_id
        where cr.caso_id = $1
        order by cr.es_principal desc, rg.nombre`,
      [row.id],
    );
    previousRegions = previous.rows.map((item) => String(item.nombre));
    regions = await resolveRegions(client, regionNames);
    add("region_principal_id", regions[0]?.id ?? null);
  }

  if (sets.length === 0) invalid();
  sets.push("fecha_ultima_actualizacion = now()");
  params.push(row.id);

  const updated = await client.query(
    `update core.casos set ${sets.join(", ")} where id = $${params.length} returning *`,
    params,
  );
  const updatedRow = updated.rows[0];
  if (!updatedRow) throw new ApiError(404, "El caso no existe.", "NOT_FOUND");

  if (regions) await replaceCaseRegions(client, String(row.id), regions);

  const antes: Record<string, unknown> = pick(row, CASE_WRITE_COLUMNS);
  const despues: Record<string, unknown> = pick(updatedRow, CASE_WRITE_COLUMNS);
  if (regions) {
    antes.regiones = previousRegions;
    despues.regiones = regions.map((region) => region.nombre);
  }

  await auditChange(client, {
    tabla: "core.casos",
    registroId: String(row.id),
    accion: "UPDATE",
    usuarioId: session.usuarioId,
    rolCodigo: session.rolCodigo,
    antes,
    despues,
  });

  const detail = await getCaseByCode(client, String(updatedRow.codigo_caso));
  if (!detail) {
    throw new ApiError(
      500,
      "No se pudo leer el caso actualizado.",
      "READ_BACK_FAILED",
    );
  }
  return detail;
}

export async function anularCase(
  client: PoolClient,
  session: WriteSession,
  code: string,
  motivo?: string,
): Promise<{ anulacionId: string }> {
  const razon = normalizarMotivo(motivo);

  const current = await client.query(
    `select * from core.casos where codigo_caso = $1`,
    [code],
  );
  const row = current.rows[0];
  if (!row) throw new ApiError(404, "El caso no existe.", "NOT_FOUND");

  const result = await client.query<{ data: { anulacionId?: string } }>(
    `select core.anular_caso($1::uuid, $2) as data`,
    [String(row.id), razon],
  );
  const anulacionId = result.rows[0]?.data?.anulacionId;
  if (!anulacionId) {
    throw new ApiError(500, "No se pudo anular el caso.", "ANULAR_FAILED");
  }

  const after = await client.query<{ anulado_en: unknown }>(
    `select anulado_en from core.casos where id = $1::uuid`,
    [String(row.id)],
  );

  await auditChange(client, {
    tabla: "core.casos",
    registroId: String(row.id),
    accion: "DELETE",
    usuarioId: session.usuarioId,
    rolCodigo: session.rolCodigo,
    antes: pick(row, CASE_WRITE_COLUMNS),
    despues: { anuladoEn: after.rows[0]?.anulado_en ?? null, motivo: razon },
  });

  return { anulacionId: String(anulacionId) };
}

export async function deleteCase(
  client: PoolClient,
  session: WriteSession,
  code: string,
  motivo?: string,
): Promise<void> {
  await anularCase(client, session, code, motivo);
}

export async function restoreCase(
  client: PoolClient,
  code: string,
): Promise<void> {
  const current = await client.query(
    `select id from core.casos where codigo_caso = $1`,
    [code],
  );
  const row = current.rows[0];
  if (!row) throw new ApiError(404, "El caso no existe.", "NOT_FOUND");

  await client.query(`select core.restaurar_caso($1::uuid)`, [String(row.id)]);
}
