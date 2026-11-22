import type { PoolClient } from "pg";
import { auditChange } from "../audit";
import { ApiError } from "../errors";
import { anularRegistro, normalizarMotivo } from "./anulacion";

export type WriteSession = {
  usuarioId: string;
  rolCodigo: string;
};

const MAX_TEXT_LENGTH = 20000;
const MAX_EVIDENCE_LENGTH = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EVENT_SELECT = `
  ev.id,
  to_char(ev.fecha_evento, 'YYYY-MM-DD') as fecha,
  ev.descripcion_hecho as descripcion,
  th.nombre as tipo,
  ev.es_hecho_critico as critico,
  ev.es_validado_humano as validado,
  ev.link_evidencia as evidencia,
  ev.actor_uid as actor_id,
  a.nombre_actual as actor,
  ev.origen_dato as origen,
  ev.confidence::float8 as confianza,
  to_char(ev.created_at at time zone 'America/Lima', 'YYYY-MM-DD') as creado
`;

const EVENT_FROM = `
  from core.caso_cronologia ev
  left join core.cat_tipos_hecho th on th.id = ev.tipo_hecho_id
  left join core.actores a on a.actor_uid = ev.actor_uid
`;

const EVENT_AUDIT_COLUMNS = [
  "caso_id",
  "fecha_evento",
  "descripcion_hecho",
  "es_hecho_verificable",
  "actor_uid",
  "tipo_hecho_id",
  "es_hecho_critico",
  "sectorista_usuario_id",
  "link_evidencia",
  "tipo_evidencia_legado",
  "origen_dato",
  "confidence",
  "es_validado_humano",
  "nivel_clasificacion",
  "codigo_legado",
] as const;

export type CaseEventItem = {
  id: string;
  fecha: string | null;
  descripcion: string;
  tipo: string | null;
  critico: boolean;
  validado: boolean;
  evidencia: string | null;
  actorId: string | null;
  actor: string | null;
  origen: string;
  confianza: number | null;
  creado: string | null;
};

export type CaseEventListResult = {
  items: CaseEventItem[];
  total: number;
  generatedAt: string;
};

function invalid(): never {
  throw new ApiError(422, "Datos inválidos.", "INVALID_INPUT");
}

function notFound(): never {
  throw new ApiError(404, "El evento no existe.", "NOT_FOUND");
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

function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !DATE_RE.test(value)) invalid();
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) invalid();
  if (parsed.toISOString().slice(0, 10) !== value) invalid();
  return value;
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
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

function mapEvent(row: Record<string, any>): CaseEventItem {
  return {
    id: String(row.id),
    fecha: row.fecha ?? null,
    descripcion: String(row.descripcion),
    tipo: row.tipo ?? null,
    critico: Boolean(row.critico),
    validado: Boolean(row.validado),
    evidencia: row.evidencia ?? null,
    actorId: row.actor_id ?? null,
    actor: row.actor ?? null,
    origen: String(row.origen),
    confianza: row.confianza ?? null,
    creado: row.creado ?? null,
  };
}

async function caseIdByCode(client: PoolClient, code: string): Promise<string> {
  const result = await client.query(
    `select id from core.casos where codigo_caso = $1`,
    [code],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new ApiError(404, "El caso no existe.", "NOT_FOUND");
  return String(id);
}

async function resolveTipoHecho(
  client: PoolClient,
  raw: unknown,
): Promise<number> {
  if (typeof raw === "number" && Number.isInteger(raw)) {
    const byId = await client.query(
      `select id from core.cat_tipos_hecho where id = $1`,
      [raw],
    );
    if (!byId.rows[0]) invalid();
    return raw;
  }
  if (typeof raw !== "string") invalid();
  const name = raw.trim();
  if (!name) invalid();
  const result = await client.query(
    `select id from core.cat_tipos_hecho
      where lower(nombre) = lower($1)
      order by id
      limit 1`,
    [name],
  );
  const id = result.rows[0]?.id;
  if (id === undefined || id === null) invalid();
  return Number(id);
}

async function readEvent(
  client: PoolClient,
  id: string,
): Promise<CaseEventItem> {
  const result = await client.query(
    `select ${EVENT_SELECT} ${EVENT_FROM} where ev.id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) invalid();
  return mapEvent(row);
}

export async function listCaseEvents(
  client: PoolClient,
  code: string,
): Promise<CaseEventListResult> {
  const caseId = await caseIdByCode(client, code);
  const result = await client.query(
    `select ${EVENT_SELECT}
     ${EVENT_FROM}
     where ev.caso_id = $1
     order by ev.fecha_evento desc, ev.created_at desc`,
    [caseId],
  );

  return {
    items: result.rows.map(mapEvent),
    total: result.rows.length,
    generatedAt: new Date().toISOString(),
  };
}

export async function createCaseEvent(
  client: PoolClient,
  session: WriteSession,
  code: string,
  body: Record<string, unknown>,
): Promise<CaseEventItem> {
  const caseId = await caseIdByCode(client, code);

  const descripcion = text(
    readField(body, ["descripcion", "descripcionHecho", "descripcion_hecho"])
      .value,
    MAX_TEXT_LENGTH,
    true,
  );
  if (descripcion === null) invalid();

  const fecha = readField(body, ["fecha", "fechaEvento"]);
  const critico = readField(body, ["critico", "esCritico"]);
  const validado = readField(body, ["validado", "esValidado"]);
  const evidencia = readField(body, ["evidencia", "linkEvidencia"]);
  const actor = readField(body, ["actor", "actorUid"]);
  const tipo = readField(body, ["tipoHecho", "tipo_hecho", "tipo"]);

  let actorUid: string | null = null;
  if (actor.present && actor.value !== null) {
    if (typeof actor.value !== "string" || !UUID_RE.test(actor.value.trim())) {
      invalid();
    }
    actorUid = actor.value.trim();
  }

  const tipoId =
    tipo.present && tipo.value !== null
      ? await resolveTipoHecho(client, tipo.value)
      : null;

  let created: { rows: Record<string, any>[] };
  try {
    created = await client.query(
      `insert into core.caso_cronologia
         (caso_id, fecha_evento, descripcion_hecho, es_hecho_critico,
          es_validado_humano, actor_uid, tipo_hecho_id, sectorista_usuario_id,
          link_evidencia, origen_dato)
       values ($1, coalesce($2::date, (now() at time zone 'America/Lima')::date),
               $3, coalesce($4::boolean, false), coalesce($5::boolean, false),
               $6, $7, $8, $9, $10)
       returning id`,
      [
        caseId,
        fecha.present ? dateOnly(fecha.value) : null,
        descripcion,
        critico.present ? booleanValue(critico.value) : null,
        validado.present ? booleanValue(validado.value) : null,
        actorUid,
        tipoId,
        session.usuarioId,
        evidencia.present
          ? text(evidencia.value, MAX_EVIDENCE_LENGTH, false)
          : null,
        "MANUAL",
      ],
    );
  } catch (error) {
    // actor_uid / tipo_hecho_id apuntan a catálogos resueltos en el body.
    if ((error as { code?: string }).code === "23503") invalid();
    throw error;
  }

  const item = await readEvent(client, String(created.rows[0].id));

  await auditChange(client, {
    tabla: "core.caso_cronologia",
    registroId: item.id,
    accion: "INSERT",
    usuarioId: session.usuarioId,
    rolCodigo: session.rolCodigo,
    antes: null,
    despues: {
      caso_id: caseId,
      fecha_evento: item.fecha,
      descripcion_hecho: item.descripcion,
      tipo_hecho_id: tipoId,
      es_hecho_critico: item.critico,
      es_validado_humano: item.validado,
      actor_uid: actorUid,
      sectorista_usuario_id: session.usuarioId,
      link_evidencia: item.evidencia,
      origen_dato: item.origen,
    },
  });

  return item;
}

export async function updateCaseEvent(
  client: PoolClient,
  session: WriteSession,
  code: string,
  eventId: string,
  body: Record<string, unknown>,
): Promise<CaseEventItem> {
  if (!UUID_RE.test(eventId)) notFound();
  const caseId = await caseIdByCode(client, code);

  const current = await client.query(
    `select * from core.caso_cronologia where id = $1 and caso_id = $2`,
    [eventId, caseId],
  );
  const row = current.rows[0];
  if (!row) notFound();

  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  const descripcion = readField(body, [
    "descripcion",
    "descripcionHecho",
    "descripcion_hecho",
  ]);
  if (descripcion.present) {
    add("descripcion_hecho", text(descripcion.value, MAX_TEXT_LENGTH, true));
  }

  const fecha = readField(body, ["fecha", "fechaEvento"]);
  if (fecha.present) add("fecha_evento", dateOnly(fecha.value));

  const critico = readField(body, ["critico", "esCritico"]);
  if (critico.present) add("es_hecho_critico", booleanValue(critico.value));

  const validado = readField(body, ["validado", "esValidado"]);
  if (validado.present) add("es_validado_humano", booleanValue(validado.value));

  const evidencia = readField(body, ["evidencia", "linkEvidencia"]);
  if (evidencia.present) {
    add("link_evidencia", text(evidencia.value, MAX_EVIDENCE_LENGTH, false));
  }

  if (sets.length === 0) invalid();
  sets.push("updated_at = now()");
  params.push(eventId);

  const updated = await client.query(
    `update core.caso_cronologia set ${sets.join(", ")}
      where id = $${params.length}
      returning *`,
    params,
  );
  const updatedRow = updated.rows[0];
  if (!updatedRow) notFound();

  await auditChange(client, {
    tabla: "core.caso_cronologia",
    registroId: eventId,
    accion: "UPDATE",
    usuarioId: session.usuarioId,
    rolCodigo: session.rolCodigo,
    antes: pick(row, EVENT_AUDIT_COLUMNS),
    despues: pick(updatedRow, EVENT_AUDIT_COLUMNS),
  });

  return readEvent(client, eventId);
}

export async function deleteCaseEvent(
  client: PoolClient,
  session: WriteSession,
  code: string,
  eventId: string,
  motivo?: string,
): Promise<void> {
  if (!UUID_RE.test(eventId)) notFound();
  const razon = normalizarMotivo(motivo);
  const caseId = await caseIdByCode(client, code);

  const current = await client.query(
    `select * from core.caso_cronologia where id = $1 and caso_id = $2`,
    [eventId, caseId],
  );
  const row = current.rows[0];
  if (!row) notFound();

  const anulacion = await anularRegistro(
    client,
    "caso_cronologia",
    eventId,
    razon,
  );

  await auditChange(client, {
    tabla: "core.caso_cronologia",
    registroId: eventId,
    accion: "DELETE",
    usuarioId: session.usuarioId,
    rolCodigo: session.rolCodigo,
    antes: pick(row, EVENT_AUDIT_COLUMNS),
    despues: { anuladoEn: anulacion.anuladoEn, motivo: anulacion.motivo },
  });
}
