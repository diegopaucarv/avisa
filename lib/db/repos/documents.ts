import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { auditChange } from "../audit";
import { nextSequentialCode } from "../codes";
import { ApiError } from "../errors";
import { anularRegistro, restaurarRegistro } from "./anulacion";

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
  d.mime,
  d.tamano_bytes,
  d.hash_sha256,
  -- Sólo se comprueba la presencia del binario: el bytea no viaja en el sobre.
  (d.contenido is not null) as tiene_archivo,
  -- Versión actual = versiones históricas + la que vive en la fila.
  ((select count(*) from core.documento_version v where v.documento_id = d.id) + 1)::int
    as version_actual,
  d.origen_dato as origen,
  d.confidence::float8 as confianza,
  d.es_validado_humano as validado,
  d.nivel_clasificacion as clasificacion,
  d.responsable_usuario_id,
  ur.nombre as responsable_nombre,
  d.reunion_id,
  d.distrito_id,
  d.anulado_en as anulado_en,
  d.motivo_anulacion as motivo_anulacion,
  d.anulado_por as anulado_por,
  ua.nombre as anulado_por_nombre,
  d.anulacion_id as anulacion_id
`;

const DOCUMENT_FROM = `
  from core.documentos d
  left join core.cat_tipos_documento td on td.id = d.tipo_id
  left join core.casos c on c.id = d.caso_id
  left join core.usuarios ua on ua.id = d.anulado_por
  left join core.usuarios ur on ur.id = d.responsable_usuario_id
`;

export type DocumentListQuery = {
  q?: string;
  caso?: string;
  tipo?: string;
  estado?: string;
  sort?: string;
  /**
   * `true` lista la papelera: añade `anulado_en is not null`. Requiere abrir
   * la RLS con `withSession(..., { verAnulados: true })`; si no, la política
   * sigue ocultando las filas.
   */
  incluirAnulados?: boolean;
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
  /** MIME del binario almacenado, o `null` si el documento no tiene archivo. */
  mime: string | null;
  /** Tamaño del binario en bytes (`core.documentos.tamano_bytes`). */
  tamanoBytes: number | null;
  /** SHA-256 del binario almacenado (64 hex). */
  hashSha256: string | null;
  /** `true` si `core.documentos.contenido` tiene bytes; nunca devuelve el bytea. */
  tieneArchivo: boolean;
  /** Versión vigente (histórico + 1). */
  versionActual: number;
  origen: string | null;
  confianza: number | null;
  validado: boolean | null;
  clasificacion: number | null;
  responsableUsuarioId: string | null;
  /** Nombre legible del responsable; `null` si no se puede resolver. */
  responsableNombre: string | null;
  reunionId: string | null;
  distritoId: number | null;
  /** Fecha de anulación en ISO 8601, o `null` si el documento está vigente. */
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

export type DocumentListResult = {
  items: DocumentListItem[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
};

export type NormativaListItem = {
  id: string;
  codigo: string | null;
  titulo: string;
  tipoNorma: string;
  ambito: string;
  entidadEmisora: string | null;
  /** Fecha en `YYYY-MM-DD`, o `null` si la norma no la declara. */
  fechaPublicacion: string | null;
  url: string | null;
  resumen: string | null;
};

export type OtroDocumentoListItem = {
  id: string;
  codigo: string | null;
  titulo: string;
  tipo: string | null;
  /** Fecha en `YYYY-MM-DD`, o `null` si el documento no la declara. */
  fecha: string | null;
  entidad: string | null;
  url: string | null;
  resumen: string | null;
};

/**
 * Árbol del RAG: todos los documentos que pasan los filtros, sin paginar.
 * Devuelve la misma fila que el listado para que el cliente reutilice el mapeo
 * y la agrupación por tipo documental. Incluye además las otras dos ramas del
 * árbol (normativas y otros documentos) para que la vista central las pinte
 * con una sola petición.
 */
export type DocumentTreeResult = {
  items: DocumentListItem[];
  /** Sólo cuenta documentos: los consumidores previos dependen de ese valor. */
  total: number;
  normativas: NormativaListItem[];
  otros: OtroDocumentoListItem[];
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
    mime: (row.mime as string | null) ?? null,
    tamanoBytes:
      row.tamano_bytes === null || row.tamano_bytes === undefined
        ? null
        : Number(row.tamano_bytes),
    hashSha256: (row.hash_sha256 as string | null) ?? null,
    tieneArchivo: Boolean(row.tiene_archivo),
    versionActual: Number(row.version_actual ?? 1),
    origen: row.origen as string | null,
    confianza: row.confianza as number | null,
    validado: row.validado as boolean | null,
    clasificacion: row.clasificacion as number | null,
    responsableUsuarioId: row.responsable_usuario_id as string | null,
    responsableNombre: row.responsable_nombre as string | null,
    reunionId: row.reunion_id as string | null,
    distritoId: row.distrito_id as number | null,
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
 * Condiciones de filtrado compartidas por el listado paginado y el árbol.
 * `bind` acumula los parámetros y devuelve su marcador `$n`.
 */
function filtrosDocumento(
  query: DocumentListQuery,
  bind: (value: unknown) => string,
): string[] {
  const where: string[] = [];

  const search = query.q?.trim();
  if (search) {
    const like = bind(`%${search}%`);
    where.push(
      `(core.normalizar_ref(d.codigo) like core.normalizar_ref(${like}) or core.normalizar_ref(d.titulo) like core.normalizar_ref(${like}) or core.normalizar_ref(coalesce(d.resumen_ejecutivo, '')) like core.normalizar_ref(${like}))`,
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

  // Papelera: abrir la RLS es cosa de `app.ver_anulados`; aquí sólo se acota
  // el resultado a las filas anuladas. Sin `incluirAnulados` no se añade
  // `anulado_en is null`: `p_clasificacion` ya lo impone.
  if (query.incluirAnulados) {
    where.push("d.anulado_en is not null");
  }

  return where;
}

/**
 * Condición de búsqueda libre para los catálogos que no tienen caso, tipo ni
 * estado (normativas y otros documentos). Replica el comportamiento de `q` en
 * `filtrosDocumento` para que el buscador del árbol filtre las tres ramas con
 * la misma semántica.
 */
function busquedaTexto(
  alias: string,
  columnaResumen: string,
  q: string | undefined,
  bind: (value: unknown) => string,
): string[] {
  const search = q?.trim();
  if (!search) return [];

  const like = bind(`%${search}%`);
  return [
    `(core.normalizar_ref(${alias}.codigo) like core.normalizar_ref(${like}) or core.normalizar_ref(${alias}.titulo) like core.normalizar_ref(${like}) or core.normalizar_ref(coalesce(${columnaResumen}, '')) like core.normalizar_ref(${like}))`,
  ];
}

function mapNormativa(row: Record<string, unknown>): NormativaListItem {
  return {
    id: row.id as string,
    codigo: row.codigo as string | null,
    titulo: row.titulo as string,
    tipoNorma: row.tipo_norma as string,
    ambito: row.ambito as string,
    entidadEmisora: row.entidad_emisora as string | null,
    fechaPublicacion: row.fecha_publicacion as string | null,
    url: row.url as string | null,
    resumen: row.resumen as string | null,
  };
}

function mapOtroDocumento(row: Record<string, unknown>): OtroDocumentoListItem {
  return {
    id: row.id as string,
    codigo: row.codigo as string | null,
    titulo: row.titulo as string,
    tipo: row.tipo as string | null,
    fecha: row.fecha as string | null,
    entidad: row.entidad as string | null,
    url: row.url as string | null,
    resumen: row.resumen as string | null,
  };
}

export async function listDocuments(
  client: PoolClient,
  query: DocumentListQuery,
): Promise<DocumentListResult> {
  const params: unknown[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const where = filtrosDocumento(query, bind);

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

/**
 * Árbol documental completo. Misma consulta que `listDocuments`, sin `limit`:
 * el RAG necesita ver todos los tipos y todas las hojas, no sólo la página.
 * La RLS y los filtros se aplican igual.
 */
export async function listDocumentTree(
  client: PoolClient,
  query: DocumentListQuery,
): Promise<DocumentTreeResult> {
  const params: unknown[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const where = filtrosDocumento(query, bind);
  const order = SORTS[query.sort ?? "recent"] ?? SORTS.recent;

  const sql = `
    select ${DOCUMENT_SELECT}
    ${DOCUMENT_FROM}
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by ${order}
  `;

  const result = await client.query(sql, params);
  const items = result.rows.map(mapDocument);

  // Las tres ramas comparten el mismo `client` para quedar bajo la sesión de
  // RLS que abre `withSession`. Van en secuencia porque `pg` no admite
  // consultas concurrentes sobre una única conexión.
  const normativas = await listNormativas(client, query.q);
  const otros = await listOtrosDocumentos(client, query.q);

  return {
    items,
    total: items.length,
    normativas,
    otros,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Normativas vigentes para la rama correspondiente del árbol. Sólo se aplica
 * `q`: caso, tipo y estado son filtros del expediente y no existen como
 * columnas aquí, así que la rama se muestra completa salvo la búsqueda libre.
 */
export async function listNormativas(
  client: PoolClient,
  q?: string,
): Promise<NormativaListItem[]> {
  const params: unknown[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const where = [
    "n.anulado_en is null",
    ...busquedaTexto("n", "n.resumen", q, bind),
  ];

  const sql = `
    select n.id,
           n.codigo,
           n.titulo,
           n.tipo_norma,
           n.ambito,
           n.entidad_emisora,
           to_char(n.fecha_publicacion, 'YYYY-MM-DD') as fecha_publicacion,
           n.url,
           n.resumen
    from core.normativas n
    where ${where.join(" and ")}
    order by n.fecha_publicacion desc nulls last, n.codigo
  `;

  const result = await client.query(sql, params);
  return result.rows.map(mapNormativa);
}

/**
 * Otros documentos vigentes para su rama del árbol. Igual que en normativas,
 * sólo `q` aplica: el resto de filtros del expediente no tiene equivalente en
 * esta tabla.
 */
export async function listOtrosDocumentos(
  client: PoolClient,
  q?: string,
): Promise<OtroDocumentoListItem[]> {
  const params: unknown[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const where = [
    "o.anulado_en is null",
    ...busquedaTexto("o", "o.resumen", q, bind),
  ];

  const sql = `
    select o.id,
           o.codigo,
           o.titulo,
           o.tipo,
           to_char(o.fecha, 'YYYY-MM-DD') as fecha,
           o.entidad,
           o.url,
           o.resumen
    from core.otros_documentos o
    where ${where.join(" and ")}
    order by o.fecha desc nulls last, o.codigo
  `;

  const result = await client.query(sql, params);
  return result.rows.map(mapOtroDocumento);
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

/**
 * Fila de escritura. Deliberadamente NO selecciona `contenido` (bytea):
 * estas filas alimentan la auditoría y no deben arrastrar el binario. Cuando
 * hace falta el binario previo (reemplazo con versionado) se pide aparte.
 */
async function fetchDocumentRow(
  client: PoolClient,
  ref: string,
): Promise<Record<string, any> | undefined> {
  const result = await client.query(
    `select id, tipo_id, codigo, caso_id, titulo, fecha, resumen_ejecutivo,
            estado, contenido_json, url_pdf, url_lista, url_foto, origen_dato,
            confidence, es_validado_humano, nivel_clasificacion,
            responsable_usuario_id, reunion_id, distrito_id, anulado_en,
            motivo_anulacion, anulado_por, anulacion_id, mime, tamano_bytes,
            hash_sha256, (contenido is not null) as tiene_archivo
       from core.documentos
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
        returning id`,
      params,
    )
  ).rows[0] as { id: string } | undefined;
  if (!updated) {
    throw new ApiError(404, "El documento no existe.", "NOT_FOUND");
  }

  // `returning *` arrastraría el bytea del archivo a la auditoría. Se relee la
  // fila de metadatos (sin `contenido`) para dejar un rastro liviano.
  const despues = await fetchDocumentRow(client, updated.id);

  await auditChange(client, {
    tabla: "core.documentos",
    registroId: current.id as string,
    accion: "UPDATE",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    antes: current,
    despues: despues ?? { id: updated.id },
  });

  const detail = await getDocumentById(client, current.id as string);
  if (!detail) throw new Error("No se pudo leer el documento actualizado.");
  return detail;
}

export async function deleteDocument(
  client: PoolClient,
  ctx: DocumentWriteContext,
  ref: string,
  motivo?: string,
): Promise<void> {
  const current = await fetchDocumentRow(client, ref);
  if (!current) {
    throw new ApiError(404, "El documento no existe.", "NOT_FOUND");
  }

  const anulacion = await anularRegistro(
    client,
    "documentos",
    String(current.id),
    motivo,
  );

  await auditChange(client, {
    tabla: "core.documentos",
    registroId: current.id as string,
    accion: "DELETE",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    antes: current,
    despues: { anuladoEn: anulacion.anuladoEn, motivo: anulacion.motivo },
  });
}

export async function restoreDocument(
  client: PoolClient,
  ref: string,
): Promise<void> {
  const current = await fetchDocumentRow(client, ref);
  if (!current) {
    throw new ApiError(404, "El documento no existe.", "NOT_FOUND");
  }

  await restaurarRegistro(client, "documentos", String(current.id));
}

/* ------------------------------------------------------------------ */
/* Archivo binario, versiones y extracción                            */
/* ------------------------------------------------------------------ */

/** Mismo tope que los adjuntos genéricos (`core.adjunto`): 20 MB. */
const MAX_ARCHIVO_BYTES = 20 * 1024 * 1024;

/**
 * Roles con `core.roles.puede_editar = true`, el mismo conjunto que
 * `CapacidadesService` en la SPA. La RLS también lo impone; aquí se corta antes
 * para devolver un 403 explícito en vez de un error genérico.
 */
const ROLES_ESCRITURA = new Set([
  "administrador",
  "sectorista",
  "direccion_oaipcs",
  "servicio_agente",
  "analista_cualitativo",
  "curador_politica",
]);

export function puedeEditarDocumentos(rolCodigo: string): boolean {
  return ROLES_ESCRITURA.has(rolCodigo);
}

export type VersionDocumento = {
  id: string;
  documentoId: string;
  numero: number;
  titulo: string | null;
  mime: string | null;
  tamanoBytes: number | null;
  hashSha256: string | null;
  /** Ruta externa cuando la versión sólo referencia una URL. */
  url: string | null;
  nota: string | null;
  creadoPor: string | null;
  creadoPorNombre: string | null;
  createdAt: string;
  /** `true` si la versión conserva el bytea; nunca se devuelve el contenido. */
  tieneArchivo: boolean;
};

export type ExtraccionTipo = "ocr" | "temas";

export type ExtraccionEstado =
  "pendiente" | "en_proceso" | "listo" | "error" | "no_disponible";

export type ExtraccionDocumento = {
  id: string;
  tipo: ExtraccionTipo;
  estado: ExtraccionEstado;
  /** Texto reconocido, si lo hubo. `null` cuando no hay motor o falló. */
  texto: string | null;
  /** Cuerpo estructurado (temas, motivo de `no_disponible`, …). */
  resultado: unknown;
  error: string | null;
  /** Motor o método usado (`frecuencia-local`, nombre del motor, …). */
  modelo: string | null;
  createdAt: string;
};

export type DocumentoArchivo = {
  id: string;
  codigo: string | null;
  titulo: string | null;
  mime: string | null;
  /** Nombre propuesto para el `Content-Disposition`. */
  nombre: string;
  contenido: Buffer;
  tamanoBytes: number;
  hashSha256: string | null;
};

type FilaListaBlanca = { mime: string; extension: string };

type FilaArchivoActual = {
  id: string;
  codigo: string | null;
  titulo: string | null;
  mime: string | null;
  tamano_bytes: string | number | null;
  hash_sha256: string | null;
  url_pdf: string | null;
  contenido: Buffer | null;
};

function extensionDe(nombre: string): string | null {
  const punto = nombre.lastIndexOf(".");
  if (punto < 1 || punto === nombre.length - 1) return null;
  return nombre.slice(punto + 1).toLowerCase();
}

function normalizarMime(valor: string | null | undefined): string {
  return (valor ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function etiquetaLista(lista: readonly FilaListaBlanca[]): string {
  return lista.map((fila) => `${fila.extension} (${fila.mime})`).join(", ");
}

/**
 * Lista blanca activa. Si está vacía se declara con 503 en vez de aceptar
 * cualquier archivo: una tabla sin filas no equivale a «todo permitido».
 */
async function leerListaBlanca(client: PoolClient): Promise<FilaListaBlanca[]> {
  const { rows } = await client.query<FilaListaBlanca>(
    `select mime, extension
       from core.documento_lista_blanca
      where activo
      order by extension, mime`,
  );
  if (rows.length === 0) {
    throw new ApiError(
      503,
      "La lista blanca de tipos de archivo está vacía: no se aceptan subidas hasta configurarla.",
      "LISTA_BLANCA_VACIA",
    );
  }
  return rows;
}

/**
 * Valida extensión + MIME contra la lista blanca. Si el navegador no declara
 * un MIME útil (`application/octet-stream`), se deduce por extensión; si lo
 * declara, debe coincidir con la extensión del archivo.
 */
function validarTipoArchivo(
  lista: readonly FilaListaBlanca[],
  nombre: string,
  mimeDeclarado: string | null,
): FilaListaBlanca {
  const extension = extensionDe(nombre);
  if (!extension) {
    throw new ApiError(
      422,
      "El archivo no tiene extensión; no se puede contrastar con la lista blanca.",
      "EXTENSION_REQUERIDA",
    );
  }

  let mime = normalizarMime(mimeDeclarado);
  if (mime === "application/octet-stream") mime = "";

  if (!mime) {
    const porExtension = lista.filter(
      (fila) =>
        fila.extension.toLowerCase() === extension ||
        (extension === "jpeg" && fila.extension.toLowerCase() === "jpg"),
    );
    if (porExtension.length === 0) {
      throw new ApiError(
        422,
        `La extensión «.${extension}» no está en la lista blanca de documentos. Tipos admitidos: ${etiquetaLista(lista)}.`,
        "MIME_NO_PERMITIDO",
      );
    }
    if (porExtension.length > 1) {
      throw new ApiError(
        422,
        `La extensión «.${extension}» admite varios tipos; declare el MIME del archivo.`,
        "MIME_AMBIGUO",
      );
    }
    return porExtension[0];
  }

  const coincidencia = lista.find(
    (fila) =>
      fila.mime.toLowerCase() === mime &&
      (fila.extension.toLowerCase() === extension ||
        (fila.extension.toLowerCase() === "jpg" && extension === "jpeg")),
  );
  if (coincidencia) return coincidencia;

  const existeMime = lista.some((fila) => fila.mime.toLowerCase() === mime);
  const motivo = existeMime
    ? `El tipo «${mime}» no corresponde a la extensión «.${extension}».`
    : `El tipo «${mime}» no está en la lista blanca de documentos.`;
  throw new ApiError(
    422,
    `${motivo} Tipos admitidos: ${etiquetaLista(lista)}.`,
    "MIME_NO_PERMITIDO",
  );
}

function decodificarArchivo(contenidoBase64: string): Buffer {
  const limpio = contenidoBase64
    .replace(/^data:[^;]+;base64,/, "")
    .replace(/\s+/g, "");
  if (!limpio || !/^[A-Za-z0-9+/]*={0,2}$/.test(limpio)) {
    throw new ApiError(
      400,
      "El contenido del archivo no es base64 válido.",
      "BASE64_INVALIDO",
    );
  }
  const buffer = Buffer.from(limpio, "base64");
  if (buffer.length === 0) {
    throw new ApiError(400, "El archivo está vacío.", "ARCHIVO_VACIO");
  }
  if (buffer.length > MAX_ARCHIVO_BYTES) {
    throw new ApiError(
      413,
      "El archivo supera el máximo de 20 MB.",
      "ARCHIVO_DEMASIADO_GRANDE",
    );
  }
  return buffer;
}

function nombreDesdeDocumento(
  titulo: string | null,
  codigo: string | null,
  extension: string,
): string {
  const base = (titulo ?? codigo ?? "documento")
    .replace(/[\\/:*?"<>|\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const limpio = base || "documento";
  return limpio.toLowerCase().endsWith(`.${extension}`)
    ? limpio
    : `${limpio}.${extension}`;
}

async function extensionDesdeMime(
  client: PoolClient,
  mime: string | null,
): Promise<string> {
  if (!mime) return "bin";
  const { rows } = await client.query<{ extension: string }>(
    `select extension from core.documento_lista_blanca where mime = $1 limit 1`,
    [mime],
  );
  return rows[0]?.extension ?? "bin";
}

async function fetchDocumentArchivoActual(
  client: PoolClient,
  ref: string,
): Promise<FilaArchivoActual | undefined> {
  const { rows } = await client.query<FilaArchivoActual>(
    `select id, codigo, titulo, mime, tamano_bytes, hash_sha256, url_pdf, contenido
       from core.documentos
      where (id::text = $1 or codigo = $1) and anulado_en is null
      limit 1`,
    [ref],
  );
  return rows[0];
}

/**
 * Sube o reemplaza el binario de un documento.
 *
 * - Valida extensión + MIME + tamaño contra `core.documento_lista_blanca`.
 * - Calcula SHA-256 y lo guarda junto con `mime` y `tamano_bytes`.
 * - Si ya había un archivo (o una ruta), lo conserva como versión con el
 *   número siguiente en `core.documento_version` antes de sobrescribir.
 * - La respuesta no incluye el binario: es el detalle del documento.
 */
export async function saveDocumentArchivo(
  client: PoolClient,
  ctx: DocumentWriteContext,
  ref: string,
  body: unknown,
): Promise<DocumentDetail> {
  if (!puedeEditarDocumentos(ctx.rolCodigo)) {
    throw new ApiError(
      403,
      "Sin permiso para subir archivos de documentos.",
      "SIN_PERMISO",
    );
  }

  const input = asObject(body);
  const nombre = requiredText(input, "nombre");
  const contenidoBase64 = requiredText(input, "contenidoBase64");
  const mimeRaw = input.mime;
  const mimeDeclarado = typeof mimeRaw === "string" ? mimeRaw : null;
  const notaRaw = input.nota;
  const nota =
    typeof notaRaw === "string" && notaRaw.trim() ? notaRaw.trim() : null;

  const lista = await leerListaBlanca(client);
  const tipo = validarTipoArchivo(lista, nombre, mimeDeclarado);
  const contenido = decodificarArchivo(contenidoBase64);
  const hash = createHash("sha256").update(contenido).digest("hex");

  const actual = await fetchDocumentArchivoActual(client, ref);
  if (!actual) {
    throw new ApiError(404, "El documento no existe.", "NOT_FOUND");
  }

  // Conservar el archivo anterior como versión antes de reemplazarlo.
  const teniaArchivo = Boolean(actual.contenido && actual.contenido.length > 0);
  if (teniaArchivo || actual.url_pdf) {
    const { rows } = await client.query<{ siguiente: number | string }>(
      `select coalesce(max(numero), 0) + 1 as siguiente
         from core.documento_version
        where documento_id = $1`,
      [actual.id],
    );
    const numero = Number(rows[0]?.siguiente ?? 1);
    await client.query(
      `insert into core.documento_version
         (documento_id, numero, titulo, mime, tamano_bytes, contenido, url,
          hash_sha256, nota, creado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid)`,
      [
        actual.id,
        numero,
        actual.titulo,
        actual.mime,
        actual.tamano_bytes,
        teniaArchivo ? actual.contenido : null,
        teniaArchivo ? null : actual.url_pdf,
        actual.hash_sha256,
        nota ?? "Versión anterior conservada al reemplazar el archivo.",
        ctx.usuarioId,
      ],
    );
  }

  await client.query(
    `update core.documentos
        set contenido = $2,
            mime = $3,
            tamano_bytes = $4,
            hash_sha256 = $5
      where id = $1`,
    [actual.id, contenido, tipo.mime, contenido.length, hash],
  );

  await auditChange(client, {
    tabla: "core.documentos",
    registroId: actual.id,
    accion: "UPDATE",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    antes: {
      mime: actual.mime,
      tamanoBytes: actual.tamano_bytes,
      hashSha256: actual.hash_sha256,
      tieneArchivo: teniaArchivo,
    },
    despues: {
      mime: tipo.mime,
      tamanoBytes: contenido.length,
      hashSha256: hash,
      tieneArchivo: true,
      nombreOriginal: nombre,
      extension: tipo.extension,
    },
  });

  const detail = await getDocumentById(client, actual.id);
  if (!detail)
    throw new Error("No se pudo leer el documento tras subir el archivo.");
  return detail;
}

/**
 * Binario del documento vigente. Es uno de los dos únicos puntos que leen
 * `core.documentos.contenido` (el otro es la descarga de una versión).
 */
export async function getDocumentArchivo(
  client: PoolClient,
  ref: string,
): Promise<DocumentoArchivo> {
  const { rows } = await client.query<FilaArchivoActual>(
    `select id, codigo, titulo, mime, tamano_bytes, hash_sha256, url_pdf, contenido
       from core.documentos
      where (id::text = $1 or codigo = $1) and anulado_en is null
      limit 1`,
    [ref],
  );
  const fila = rows[0];
  if (!fila) {
    throw new ApiError(404, "El documento no existe.", "NOT_FOUND");
  }
  if (!fila.contenido || fila.contenido.length === 0) {
    throw new ApiError(
      404,
      "El documento no tiene archivo almacenado: sólo referencia una ruta externa o no tiene adjunto.",
      "SIN_ARCHIVO",
    );
  }

  const extension = await extensionDesdeMime(client, fila.mime);
  return {
    id: fila.id,
    codigo: fila.codigo,
    titulo: fila.titulo,
    mime: fila.mime,
    nombre: nombreDesdeDocumento(fila.titulo, fila.codigo, extension),
    contenido: fila.contenido,
    tamanoBytes: fila.contenido.length,
    hashSha256: fila.hash_sha256,
  };
}

function mapearVersion(fila: Record<string, any>): VersionDocumento {
  return {
    id: fila.id as string,
    documentoId: fila.documento_id as string,
    numero: Number(fila.numero),
    titulo: (fila.titulo as string | null) ?? null,
    mime: (fila.mime as string | null) ?? null,
    tamanoBytes:
      fila.tamano_bytes === null || fila.tamano_bytes === undefined
        ? null
        : Number(fila.tamano_bytes),
    hashSha256: (fila.hash_sha256 as string | null) ?? null,
    url: (fila.url as string | null) ?? null,
    nota: (fila.nota as string | null) ?? null,
    creadoPor: (fila.creado_por as string | null) ?? null,
    creadoPorNombre: (fila.creado_por_nombre as string | null) ?? null,
    createdAt: isoOrNull(fila.created_at) ?? "",
    tieneArchivo: Boolean(fila.tiene_archivo),
  };
}

/** Historial de versiones (metadatos; nunca el bytea). */
export async function listDocumentVersions(
  client: PoolClient,
  ref: string,
): Promise<VersionDocumento[]> {
  const { rows } = await client.query(
    `select v.id, v.documento_id, v.numero, v.titulo, v.mime, v.tamano_bytes,
            v.hash_sha256, v.url, v.nota, v.creado_por,
            u.nombre as creado_por_nombre, v.created_at,
            (v.contenido is not null) as tiene_archivo
       from core.documento_version v
       join core.documentos d on d.id = v.documento_id
       left join core.usuarios u on u.id = v.creado_por
      where d.id::text = $1 or d.codigo = $1
      order by v.numero desc`,
    [ref],
  );
  return rows.map(mapearVersion);
}

export type VersionArchivo = {
  numero: number;
  mime: string | null;
  nombre: string;
  contenido: Buffer;
  tamanoBytes: number;
  hashSha256: string | null;
};

/** Binario de una versión concreta. */
export async function getDocumentVersionArchivo(
  client: PoolClient,
  ref: string,
  numero: number,
): Promise<VersionArchivo> {
  if (!Number.isInteger(numero) || numero < 1) {
    throw new ApiError(
      422,
      "El número de versión no es válido.",
      "VERSION_INVALIDA",
    );
  }

  const { rows } = await client.query<{
    numero: number;
    titulo: string | null;
    codigo: string | null;
    mime: string | null;
    hash_sha256: string | null;
    contenido: Buffer | null;
    url: string | null;
  }>(
    `select v.numero, v.titulo, d.codigo, v.mime, v.hash_sha256, v.contenido, v.url
       from core.documento_version v
       join core.documentos d on d.id = v.documento_id
      where (d.id::text = $1 or d.codigo = $1) and v.numero = $2`,
    [ref, numero],
  );
  const fila = rows[0];
  if (!fila) {
    throw new ApiError(404, "La versión no existe.", "NOT_FOUND");
  }
  if (!fila.contenido || fila.contenido.length === 0) {
    throw new ApiError(
      409,
      `La versión ${numero} sólo referencia una ruta externa (${fila.url ?? "sin URL"}); no conserva un archivo.`,
      "SIN_ARCHIVO",
    );
  }

  const extension = await extensionDesdeMime(client, fila.mime);
  const base = nombreDesdeDocumento(fila.titulo, fila.codigo, extension);
  const nombre = base.toLowerCase().endsWith(`.${extension}`)
    ? `${base.slice(0, -extension.length - 1)}-v${numero}.${extension}`
    : `${base}-v${numero}.${extension}`;

  return {
    numero: Number(fila.numero),
    mime: fila.mime,
    nombre,
    contenido: fila.contenido,
    tamanoBytes: fila.contenido.length,
    hashSha256: fila.hash_sha256,
  };
}

function mapearExtraccion(fila: Record<string, any>): ExtraccionDocumento {
  return {
    id: fila.id as string,
    tipo: fila.tipo as ExtraccionTipo,
    estado: fila.estado as ExtraccionEstado,
    texto: (fila.texto as string | null) ?? null,
    resultado: fila.resultado ?? null,
    error: (fila.error as string | null) ?? null,
    modelo: (fila.modelo as string | null) ?? null,
    createdAt: isoOrNull(fila.created_at) ?? "",
  };
}

/** Última extracción de cada tipo (`ocr` y `temas`). */
export async function listDocumentExtracciones(
  client: PoolClient,
  ref: string,
): Promise<ExtraccionDocumento[]> {
  const { rows } = await client.query(
    `select distinct on (e.tipo)
            e.id, e.tipo, e.estado, e.texto,
            e.resultado_json as resultado, e.error, e.modelo, e.created_at
       from core.documento_extraccion e
       join core.documentos d on d.id = e.documento_id
      where d.id::text = $1 or d.codigo = $1
      order by e.tipo, e.created_at desc`,
    [ref],
  );
  return rows.map(mapearExtraccion);
}

const PALABRAS_VACIAS = new Set([
  "para",
  "porque",
  "como",
  "cuando",
  "donde",
  "sobre",
  "entre",
  "desde",
  "hasta",
  "tambien",
  "también",
  "segun",
  "según",
  "este",
  "esta",
  "estos",
  "estas",
  "aquell",
  "aquel",
  "sera",
  "será",
  "fueron",
  "sido",
  "tiene",
  "tienen",
  "desde",
  "hacia",
  "mediante",
  "mismo",
  "misma",
  "dicho",
  "dicha",
  "solo",
  "sólo",
  "todo",
  "toda",
  "todos",
  "todas",
  "otro",
  "otra",
  "otros",
  "otras",
  "ante",
  "bajo",
  "contra",
  "pero",
  "pues",
  "cada",
  "más",
  "mas",
  "menos",
  "muy",
  "sin",
  "con",
  "por",
  "que",
  "los",
  "las",
  "del",
  "una",
  "unos",
  "unas",
  "sus",
  "les",
  "nos",
  "han",
  "haber",
  "hace",
  "hacer",
  "partir",
  "traves",
  "través",
  "caso",
  "casos",
  "segun",
  "acuerdo",
  "mesa",
]);

/**
 * Temas clave por frecuencia local de términos. No es un modelo entrenado: es
 * un conteo declarado como `frecuencia-local`, para no atribuirle más de lo que
 * hace.
 */
function calcularTemas(
  texto: string,
): readonly { termino: string; frecuencia: number }[] {
  const palabras = texto.toLowerCase().match(/[a-záéíóúüñ0-9]{4,}/g) ?? [];
  const conteo = new Map<string, number>();
  for (const palabra of palabras) {
    if (PALABRAS_VACIAS.has(palabra)) continue;
    conteo.set(palabra, (conteo.get(palabra) ?? 0) + 1);
  }
  return [...conteo.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([termino, frecuencia]) => ({ termino, frecuencia }));
}

type NuevaExtraccion = {
  documentoId: string;
  usuarioId: string;
  tipo: ExtraccionTipo;
  estado: ExtraccionEstado;
  texto: string | null;
  resultado: unknown;
  error: string | null;
  modelo: string | null;
};

async function insertarExtraccion(
  client: PoolClient,
  fila: NuevaExtraccion,
): Promise<ExtraccionDocumento> {
  const { rows } = await client.query(
    `insert into core.documento_extraccion
       (documento_id, tipo, estado, resultado_json, texto, error, modelo, created_by)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::uuid)
     returning id, tipo, estado, texto, resultado_json as resultado, error,
               modelo, created_at`,
    [
      fila.documentoId,
      fila.tipo,
      fila.estado,
      fila.resultado === null || fila.resultado === undefined
        ? null
        : JSON.stringify(fila.resultado),
      fila.texto,
      fila.error,
      fila.modelo,
      fila.usuarioId,
    ],
  );
  return mapearExtraccion(rows[0]);
}

/**
 * Contrato mínimo del motor de OCR externo, si algún día se configura en
 * `AVISA_OCR_ENDPOINT`: `POST { mime, contenidoBase64 }` → `{ texto, modelo? }`.
 * Sin endpoint no se llama a nada y la extracción se declara `no_disponible`.
 */
async function llamarMotorOcr(
  endpoint: string,
  mime: string | null,
  contenido: Buffer,
): Promise<{ texto: string; modelo: string | null }> {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), 30_000);
  try {
    const respuesta = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        mime,
        contenidoBase64: contenido.toString("base64"),
      }),
      signal: control.signal,
    });
    if (!respuesta.ok) {
      throw new Error(`El motor de OCR respondió ${respuesta.status}.`);
    }
    const cuerpo = (await respuesta.json()) as {
      texto?: unknown;
      modelo?: unknown;
    };
    const texto = typeof cuerpo.texto === "string" ? cuerpo.texto.trim() : "";
    if (!texto) throw new Error("El motor de OCR no devolvió texto.");
    return {
      texto,
      modelo: typeof cuerpo.modelo === "string" ? cuerpo.modelo : "externo",
    };
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Ejecuta una extracción (`ocr` o `temas`) sobre un documento.
 *
 * - Sin motor de OCR configurado, `ocr` queda en `no_disponible` con un mensaje
 *   honesto: no se inventa texto.
 * - `temas` usa el texto OCR ya extraído o, en su defecto, el resumen ejecutivo,
 *   y declara `origen` y `modelo` (`frecuencia-local`).
 */
export async function runDocumentExtraccion(
  client: PoolClient,
  ctx: DocumentWriteContext,
  ref: string,
  tipoRaw: string,
): Promise<ExtraccionDocumento> {
  if (!puedeEditarDocumentos(ctx.rolCodigo)) {
    throw new ApiError(
      403,
      "Sin permiso para ejecutar extracciones sobre documentos.",
      "SIN_PERMISO",
    );
  }
  const tipo: ExtraccionTipo | null =
    tipoRaw === "ocr" || tipoRaw === "temas" ? tipoRaw : null;
  if (!tipo) {
    throw new ApiError(
      422,
      "El tipo de extracción debe ser «ocr» o «temas».",
      "TIPO_INVALIDO",
    );
  }

  const baseRes = await client.query<{
    id: string;
    mime: string | null;
    resumen: string | null;
  }>(
    `select id, mime, resumen_ejecutivo as resumen
       from core.documentos
      where (id::text = $1 or codigo = $1) and anulado_en is null
      limit 1`,
    [ref],
  );
  const base = baseRes.rows[0];
  if (!base) {
    throw new ApiError(404, "El documento no existe.", "NOT_FOUND");
  }

  if (tipo === "ocr") {
    const endpoint = (process.env.AVISA_OCR_ENDPOINT ?? "").trim();
    if (!endpoint) {
      return insertarExtraccion(client, {
        documentoId: base.id,
        usuarioId: ctx.usuarioId,
        tipo,
        estado: "no_disponible",
        texto: null,
        resultado: {
          motivo: "no_disponible",
          detalle:
            "No hay motor de OCR configurado (AVISA_OCR_ENDPOINT). No se extrajo ni se inventó texto.",
        },
        error: "No hay motor de OCR configurado.",
        modelo: null,
      });
    }

    // Sólo con motor configurado se lee el bytea (acción, nunca listado).
    const bin = await client.query<{ contenido: Buffer | null }>(
      `select contenido from core.documentos where id = $1`,
      [base.id],
    );
    const contenido = bin.rows[0]?.contenido ?? null;
    if (!contenido || contenido.length === 0) {
      return insertarExtraccion(client, {
        documentoId: base.id,
        usuarioId: ctx.usuarioId,
        tipo,
        estado: "error",
        texto: null,
        resultado: { motivo: "sin_archivo" },
        error:
          "El documento no tiene archivo almacenado; no hay nada que pasar por OCR.",
        modelo: null,
      });
    }

    try {
      const { texto, modelo } = await llamarMotorOcr(
        endpoint,
        base.mime,
        contenido,
      );
      return insertarExtraccion(client, {
        documentoId: base.id,
        usuarioId: ctx.usuarioId,
        tipo,
        estado: "listo",
        texto: texto.slice(0, 20_000),
        resultado: { origen: "ocr_externo", modelo },
        error: null,
        modelo,
      });
    } catch (fallo) {
      return insertarExtraccion(client, {
        documentoId: base.id,
        usuarioId: ctx.usuarioId,
        tipo,
        estado: "error",
        texto: null,
        resultado: { motivo: "error_motor" },
        error: `El motor de OCR falló: ${
          fallo instanceof Error ? fallo.message : "error desconocido"
        }`.slice(0, 500),
        modelo: null,
      });
    }
  }

  // `temas`: fuente = texto OCR ya extraído o, si no, resumen ejecutivo.
  const ocr = await client.query<{ texto: string }>(
    `select texto
       from core.documento_extraccion
      where documento_id = $1 and tipo = 'ocr' and estado = 'listo'
        and texto is not null
      order by created_at desc
      limit 1`,
    [base.id],
  );
  const textoOcr = ocr.rows[0]?.texto?.trim() || null;
  const resumen = base.resumen?.trim() || null;
  const origen = textoOcr ? "texto_ocr" : resumen ? "resumen_ejecutivo" : null;
  const fuente = textoOcr ?? resumen;

  if (!fuente || !origen) {
    return insertarExtraccion(client, {
      documentoId: base.id,
      usuarioId: ctx.usuarioId,
      tipo,
      estado: "no_disponible",
      texto: null,
      resultado: {
        motivo: "sin_fuente",
        detalle:
          "No hay texto OCR ni resumen ejecutivo para calcular temas; no se inventan términos.",
      },
      error: "No hay texto extraído ni resumen ejecutivo.",
      modelo: null,
    });
  }

  const terminos = calcularTemas(fuente);
  if (terminos.length === 0) {
    return insertarExtraccion(client, {
      documentoId: base.id,
      usuarioId: ctx.usuarioId,
      tipo,
      estado: "no_disponible",
      texto: fuente.slice(0, 2_000),
      resultado: { origen, motivo: "sin_terminos" },
      error: "No se encontraron términos suficientes para declarar temas.",
      modelo: "frecuencia-local",
    });
  }

  return insertarExtraccion(client, {
    documentoId: base.id,
    usuarioId: ctx.usuarioId,
    tipo,
    estado: "listo",
    texto: fuente.slice(0, 4_000),
    resultado: { origen, modelo: "frecuencia-local", terminos },
    error: null,
    modelo: "frecuencia-local",
  });
}
