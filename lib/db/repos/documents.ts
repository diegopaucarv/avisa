import type { PoolClient } from "pg";
import { auditChange } from "../audit";
import { nextSequentialCode } from "../codes";
import { ApiError } from "../errors";

/**
 * `core.documentos.estado` es texto libre y sólo contiene 'Activo' o NULL.
 * No existe todavía un workflow de estados (rechazado, en revisión...), así
 * que la interfaz muestra 'Cargado' para ambos casos y preserva el valor
 * crudo en `estado`. Cuando la migración D3 defina un catálogo de estados
 * habrá que reemplazar esta derivación por el join al catálogo.
 */
const ESTADO_UI = `
  case
    when d.estado is null then 'Cargado'
    when lower(btrim(d.estado)) = 'activo' then 'Cargado'
    else d.estado
  end
`;

const DOCUMENT_SELECT = `
  d.id,
  d.codigo,
  d.titulo,
  to_char(d.fecha, 'YYYY-MM-DD') as fecha,
  td.codigo as tipo,
  td.nombre as tipo_nombre,
  td.anexo_numero,
  d.caso_id,
  c.codigo_caso as caso_code,
  c.nombre_caso as caso_titulo,
  d.estado,
  ${ESTADO_UI} as estado_ui,
  d.resumen_ejecutivo as resumen,
  d.url_pdf as archivo,
  d.url_lista,
  d.url_foto,
  d.origen_dato as origen,
  d.confidence::float8 as confianza,
  d.es_validado_humano as validado,
  d.nivel_clasificacion as clasificacion,
  d.responsable_usuario_id,
  d.reunion_id,
  d.distrito_id
`;

const DOCUMENT_FROM = `
  from core.documentos d
  left join core.cat_tipos_documento td on td.id = d.tipo_id
  left join core.casos c on c.id = d.caso_id
`;

export type DocumentListQuery = {
  q?: string;
  caso?: string;
  tipo?: string;
  estado?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
};

export type DocumentListItem = {
  id: string;
  codigo: string | null;
  titulo: string | null;
  fecha: string | null;
  tipo: string | null;
  tipoNombre: string | null;
  anexoNumero: number | null;
  casoId: string | null;
  casoCode: string | null;
  casoTitulo: string | null;
  estado: string | null;
  estadoUi: string;
  resumen: string | null;
  archivo: string | null;
  urlLista: string | null;
  urlFoto: string | null;
  origen: string | null;
  confianza: number | null;
  validado: boolean | null;
  clasificacion: number | null;
  responsableUsuarioId: string | null;
  reunionId: string | null;
  distritoId: number | null;
};

export type DocumentListResult = {
  items: DocumentListItem[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
};

const SORTS: Record<string, string> = {
  recent: "d.fecha desc nulls last, d.codigo",
  code: "d.codigo",
};

function mapDocument(row: Record<string, unknown>): DocumentListItem {
  return {
    id: row.id as string,
    codigo: row.codigo as string | null,
    titulo: row.titulo as string | null,
    fecha: row.fecha as string | null,
    tipo: row.tipo as string | null,
    tipoNombre: row.tipo_nombre as string | null,
    anexoNumero: row.anexo_numero as number | null,
    casoId: row.caso_id as string | null,
    casoCode: row.caso_code as string | null,
    casoTitulo: row.caso_titulo as string | null,
    estado: row.estado as string | null,
    estadoUi: row.estado_ui as string,
    resumen: row.resumen as string | null,
    archivo: row.archivo as string | null,
    urlLista: row.url_lista as string | null,
    urlFoto: row.url_foto as string | null,
    origen: row.origen as string | null,
    confianza: row.confianza as number | null,
    validado: row.validado as boolean | null,
    clasificacion: row.clasificacion as number | null,
    responsableUsuarioId: row.responsable_usuario_id as string | null,
    reunionId: row.reunion_id as string | null,
    distritoId: row.distrito_id as number | null,
  };
}

export async function listDocuments(
  client: PoolClient,
  query: DocumentListQuery,
): Promise<DocumentListResult> {
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
      `(d.codigo ilike ${like} or d.titulo ilike ${like} or coalesce(d.resumen_ejecutivo, '') ilike ${like})`,
    );
  }
  if (query.caso) where.push(`c.codigo_caso = ${bind(query.caso)}`);
  if (query.tipo) where.push(`td.codigo = ${bind(query.tipo)}`);
  if (query.estado === "sin_estado") {
    where.push("d.estado is null");
  } else if (query.estado === "con_estado") {
    where.push("d.estado is not null");
  } else if (query.estado) {
    where.push(`lower(btrim(d.estado)) = lower(${bind(query.estado)})`);
  }

  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 25)));
  const order = SORTS[query.sort ?? "recent"] ?? SORTS.recent;

  const sql = `
    select ${DOCUMENT_SELECT},
           count(*) over()::int as total
    ${DOCUMENT_FROM}
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by ${order}
    limit ${bind(pageSize)} offset ${bind((page - 1) * pageSize)}
  `;

  const result = await client.query(sql, params);
  const total = result.rows[0]?.total ?? 0;

  return {
    items: result.rows.map(mapDocument),
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
  };
}

export type DocumentDetail = {
  document:
    | (DocumentListItem & {
        contenido: unknown;
        codigoLegado: string | null;
      })
    | null;
  fuentes: DocumentFuente[];
  fragmentos: DocumentFragmento[];
  generatedAt: string;
};

export type DocumentFuente = {
  id: string;
  titulo: string | null;
  tipo: string | null;
  url: string | null;
  fechaIngesta: string | null;
  hashContenido: string | null;
  textoVersion: number | null;
};

export type DocumentFragmento = {
  id: string;
  orden: number | null;
  paginaOMinuto: number | null;
  texto: string | null;
  textoVersion: number | null;
};

export async function getDocumentById(
  client: PoolClient,
  id: string,
): Promise<DocumentDetail | null> {
  const result = await client.query(
    `select ${DOCUMENT_SELECT},
            d.contenido_json as contenido,
            d.codigo_legado
     ${DOCUMENT_FROM}
     where d.id::text = $1 or d.codigo = $1
     limit 1`,
    [id],
  );

  const row = result.rows[0];
  if (!row) return null;

  // Los fragmentos viven colgados de kag.documento_fuente, no del documento
  // core: se llega por core_documento_id (FK a core.documentos).
  const [fuentes, fragmentos] = await Promise.all([
    client.query(
      `select f.id,
              f.titulo,
              f.tipo,
              f.url,
              to_char(f.fecha_ingesta, 'YYYY-MM-DD') as fecha_ingesta,
              f.hash_contenido,
              f.texto_version
         from kag.documento_fuente f
        where f.core_documento_id = $1
        order by f.fecha_ingesta desc nulls last, f.titulo`,
      [row.id],
    ),
    client.query(
      `select fr.id,
              fr.orden,
              fr.pagina_o_minuto,
              fr.texto,
              fr.texto_version
         from kag.documento_fuente f
         join kag.documento_fragmento fr on fr.documento_id = f.id
        where f.core_documento_id = $1
        order by fr.orden`,
      [row.id],
    ),
  ]);

  return {
    document: {
      ...mapDocument(row),
      contenido: row.contenido,
      codigoLegado: row.codigo_legado as string | null,
    },
    fuentes: fuentes.rows.map((f) => ({
      id: f.id as string,
      titulo: f.titulo as string | null,
      tipo: f.tipo as string | null,
      url: f.url as string | null,
      fechaIngesta: f.fecha_ingesta as string | null,
      hashContenido: f.hash_contenido as string | null,
      textoVersion: f.texto_version as number | null,
    })),
    fragmentos: fragmentos.rows.map((f) => ({
      id: f.id as string,
      orden: f.orden as number | null,
      paginaOMinuto: f.pagina_o_minuto as number | null,
      texto: f.texto as string | null,
      textoVersion: f.texto_version as number | null,
    })),
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Escrituras                                                          */
/* ------------------------------------------------------------------ */

export type DocumentWriteContext = {
  usuarioId: string;
  rolCodigo: string;
};

const ESTADOS_DOCUMENTO = [
  "Cargado",
  "En análisis",
  "Extraído",
  "Validado",
  "Rechazado",
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

function validateEstadoDocumento(value: string): string {
  if (!(ESTADOS_DOCUMENTO as readonly string[]).includes(value)) invalid();
  return value;
}

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

async function resolveTipoDocumento(
  client: PoolClient,
  codigo: string,
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `select id from core.cat_tipos_documento where codigo = $1 limit 1`,
    [codigo],
  );
  const row = result.rows[0];
  if (!row) invalid();
  return row.id;
}

async function resolveCasoId(
  client: PoolClient,
  codigo: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `select id from core.casos where codigo_caso = $1 or id::text = $1 limit 1`,
    [codigo],
  );
  const row = result.rows[0];
  if (!row) invalid();
  return row.id;
}

async function fetchDocumentRow(
  client: PoolClient,
  ref: string,
): Promise<Record<string, any> | undefined> {
  const result = await client.query(
    `select * from core.documentos
      where id::text = $1 or codigo = $1
      limit 1`,
    [ref],
  );
  return result.rows[0] as Record<string, any> | undefined;
}

export async function createDocument(
  client: PoolClient,
  ctx: DocumentWriteContext,
  body: unknown,
): Promise<DocumentDetail> {
  const input = asObject(body);

  const titulo = requiredText(input, "titulo");
  const tipoId = await resolveTipoDocumento(
    client,
    requiredText(input, "tipo"),
  );

  const casoCode = optionalText(input, "casoCode");
  const casoId = casoCode ? await resolveCasoId(client, casoCode) : null;

  const fecha = optionalDate(input, "fecha");
  if (fecha === null) invalid();

  const resumen = optionalText(input, "resumen");
  const archivo = optionalText(input, "archivo");
  const urlLista = optionalText(input, "urlLista");
  const urlFoto = optionalText(input, "urlFoto");

  const estadoRaw = optionalText(input, "estado");
  const estado = estadoRaw ? validateEstadoDocumento(estadoRaw) : "Cargado";

  const contenido = optionalJson(input, "contenido");
  const providedCode = optionalText(input, "codigo") ?? null;

  let prefix: string | null = null;
  if (!providedCode) {
    const yearResult = await client.query<{ year: number }>(
      `select extract(year from current_date)::int as year`,
    );
    const year = yearResult.rows[0]?.year ?? new Date().getFullYear();
    prefix = `RED-${year}-`;
  }

  const sql = `
    insert into core.documentos
      (tipo_id, codigo, caso_id, titulo, fecha, resumen_ejecutivo, estado,
       contenido_json, url_pdf, url_lista, url_foto, origen_dato)
    values ($1, $2, $3, $4, coalesce($5::date, current_date), $6, $7,
            coalesce($8::jsonb, '{}'::jsonb), $9, $10, $11, 'MANUAL')
    returning *
  `;

  const inserted = await retryUnique(client, async () => {
    const codigo =
      providedCode ??
      (await nextSequentialCode(
        client,
        "core.documentos",
        "codigo",
        prefix as string,
        3,
      ));
    const result = await client.query(sql, [
      tipoId,
      codigo,
      casoId,
      titulo,
      fecha ?? null,
      resumen ?? null,
      estado,
      jsonParam(contenido),
      archivo ?? null,
      urlLista ?? null,
      urlFoto ?? null,
    ]);
    return result.rows[0] as Record<string, any>;
  });

  await auditChange(client, {
    tabla: "core.documentos",
    registroId: inserted.id as string,
    accion: "INSERT",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    despues: inserted,
  });

  const detail = await getDocumentById(client, inserted.id as string);
  if (!detail) throw new Error("No se pudo leer el documento recién creado.");
  return detail;
}

export async function updateDocument(
  client: PoolClient,
  ctx: DocumentWriteContext,
  ref: string,
  body: unknown,
): Promise<DocumentDetail> {
  const input = asObject(body);
  const current = await fetchDocumentRow(client, ref);
  if (!current) {
    throw new ApiError(404, "El documento no existe.", "NOT_FOUND");
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (column: string, value: unknown, cast = "") => {
    params.push(value);
    sets.push(`${column} = $${params.length}${cast}`);
  };

  const titulo = optionalText(input, "titulo");
  if (titulo === null) invalid();
  if (titulo !== undefined) add("titulo", titulo);

  const tipo = optionalText(input, "tipo");
  if (tipo === null) invalid();
  if (tipo !== undefined) {
    add("tipo_id", await resolveTipoDocumento(client, tipo));
  }

  const fecha = optionalDate(input, "fecha");
  if (fecha === null) invalid();
  if (fecha !== undefined) add("fecha", fecha, "::date");

  const resumen = optionalText(input, "resumen");
  if (resumen !== undefined) add("resumen_ejecutivo", resumen);

  const archivo = optionalText(input, "archivo");
  if (archivo !== undefined) add("url_pdf", archivo);

  const estadoRaw = optionalText(input, "estado");
  if (estadoRaw !== undefined) {
    add(
      "estado",
      estadoRaw === null ? null : validateEstadoDocumento(estadoRaw),
    );
  }

  const casoCode = optionalText(input, "casoCode");
  if (casoCode !== undefined) {
    add(
      "caso_id",
      casoCode === null ? null : await resolveCasoId(client, casoCode),
    );
  }

  const contenido = optionalJson(input, "contenido");
  if (contenido !== undefined) {
    params.push(jsonParam(contenido));
    sets.push(
      `contenido_json = coalesce($${params.length}::jsonb, '{}'::jsonb)`,
    );
  }

  if (sets.length === 0) invalid();

  params.push(current.id);
  const updated = (
    await client.query(
      `update core.documentos
          set ${sets.join(", ")}
        where id = $${params.length}
        returning *`,
      params,
    )
  ).rows[0] as Record<string, any> | undefined;
  if (!updated) {
    throw new ApiError(404, "El documento no existe.", "NOT_FOUND");
  }

  await auditChange(client, {
    tabla: "core.documentos",
    registroId: current.id as string,
    accion: "UPDATE",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    antes: current,
    despues: updated,
  });

  const detail = await getDocumentById(client, current.id as string);
  if (!detail) throw new Error("No se pudo leer el documento actualizado.");
  return detail;
}

export async function deleteDocument(
  client: PoolClient,
  ctx: DocumentWriteContext,
  ref: string,
): Promise<void> {
  const current = await fetchDocumentRow(client, ref);
  if (!current) {
    throw new ApiError(404, "El documento no existe.", "NOT_FOUND");
  }

  try {
    await client.query(`delete from core.documentos where id = $1`, [
      current.id,
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === "23503") {
      throw new ApiError(
        409,
        "El registro tiene datos asociados; no se puede eliminar.",
        "CONFLICT",
      );
    }
    throw error;
  }

  await auditChange(client, {
    tabla: "core.documentos",
    registroId: current.id as string,
    accion: "DELETE",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    antes: current,
    despues: null,
  });
}
