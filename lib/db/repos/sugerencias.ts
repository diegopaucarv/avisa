import type { PoolClient } from "pg";

import { auditChange } from "../audit";
import { filtroTexto } from "../busqueda";
import { nextSequentialCode } from "../codes";
import { ApiError } from "../errors";

/**
 * Sugerencias y recomendaciones de intervención (matriz de sugerencias).
 *
 * Una fila declara qué se sugiere, a quién, con qué prioridad, en qué estado
 * va, quién la atiende y con qué sustento, y apunta a un caso o a un
 * territorio. La decisión es siempre humana: el repositorio nunca aplica una
 * sugerencia; sólo registra quién decidió y cuándo.
 */

const SUGERENCIA_COLUMNS = `
  s.id,
  s.codigo,
  to_char(s.created_at, 'YYYY-MM-DD') as fecha,
  s.created_at as creada_en,
  s.entidad_tipo,
  s.caso_id,
  c.codigo_caso as caso_codigo,
  c.nombre_caso as caso_titulo,
  s.region_id,
  r.nombre as region,
  s.provincia_id,
  p.nombre as provincia,
  s.distrito_id,
  d.nombre as distrito,
  s.territorio_texto,
  s.tipo_id,
  ts.codigo as tipo_codigo,
  ts.etiqueta as tipo,
  s.titulo,
  s.detalle,
  s.destinatario,
  s.unidad_responsable_id,
  uo.siglas as unidad,
  s.prioridad_id,
  pa.codigo as prioridad,
  pa.orden as prioridad_orden,
  s.estado_id,
  es.codigo as estado_codigo,
  es.etiqueta as estado,
  es.categoria as estado_categoria,
  es.es_terminal as terminal,
  s.responsable_usuario_id,
  ur.nombre as responsable_usuario_nombre,
  s.responsable_texto,
  s.sustento,
  s.sustento_uri,
  s.origen,
  s.confianza::float8 as confianza,
  s.decision_nota,
  s.motivo_rechazo,
  s.decidido_por,
  ud.nombre as decidido_por_nombre,
  s.decidido_en,
  s.vence_en,
  s.nivel_clasificacion,
  s.anulado_en,
  s.motivo_anulacion,
  to_char(current_date, 'YYYY-MM-DD') as today
`;

const SUGERENCIA_FROM = `
  from core.sugerencia s
  left join core.casos c on c.id = s.caso_id
  left join core.regiones r on r.id = s.region_id
  left join core.provincias p on p.id = s.provincia_id
  left join core.distritos d on d.id = s.distrito_id
  left join core.cat_tipos_sugerencia ts on ts.id = s.tipo_id
  left join core.cat_unidades_organicas uo on uo.id = s.unidad_responsable_id
  left join core.cat_prioridades_atencion pa on pa.id = s.prioridad_id
  left join core.cat_estados_sugerencia es on es.id = s.estado_id
  left join core.usuarios ur on ur.id = s.responsable_usuario_id
  left join core.usuarios ud on ud.id = s.decidido_por
`;

export type SugerenciaEntidadTipo = "caso" | "territorio";
export type SugerenciaOrigen = "persona" | "agente" | "mesa" | "sistema";

export type SugerenciaListQuery = {
  q?: string;
  caso?: string;
  entidad?: string;
  region?: string;
  territorio?: string;
  estado?: string;
  prioridad?: string;
  tipo?: string;
  /** `campo` (asc) o `-campo` (desc). Sólo se aceptan campos de la lista blanca. */
  sort?: string;
  page?: number;
  pageSize?: number;
};

export type SugerenciaListItem = {
  id: string;
  codigo: string;
  /** Fecha de alta en `YYYY-MM-DD`. */
  fecha: string | null;
  creadaEn: string | null;
  entidadTipo: SugerenciaEntidadTipo;
  casoId: string | null;
  casoCodigo: string | null;
  casoTitulo: string | null;
  regionId: number | null;
  region: string | null;
  provinciaId: number | null;
  provincia: string | null;
  distritoId: number | null;
  distrito: string | null;
  territorioTexto: string | null;
  tipoId: number;
  tipoCodigo: string;
  tipo: string;
  titulo: string;
  detalle: string | null;
  destinatario: string | null;
  unidadId: number | null;
  unidad: string | null;
  prioridadId: number;
  prioridad: string;
  prioridadOrden: number | null;
  estadoId: number;
  estadoCodigo: string;
  estado: string;
  estadoCategoria: string;
  terminal: boolean;
  responsableUsuarioId: string | null;
  responsableUsuarioNombre: string | null;
  responsableTexto: string | null;
  /** Usuario resuelto o, si no lo hay, el texto declarado. */
  responsable: string | null;
  sustento: string | null;
  sustentoUri: string | null;
  origen: SugerenciaOrigen | string;
  confianza: number | null;
  decisionNota: string | null;
  motivoRechazo: string | null;
  decididoPor: string | null;
  decididoPorNombre: string | null;
  decididoEn: string | null;
  venceEn: string | null;
  clasificacion: number;
  anuladoEn: string | null;
  motivoAnulacion: string | null;
  /** Código del caso o, en territorio, la ruta regional declarada. */
  entidad: string;
  /** `true` cuando la fecha de vencimiento ya pasó y la fila sigue sin cerrar. */
  vencida: boolean;
};

export type SugerenciaListResult = {
  items: SugerenciaListItem[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
};

export type SugerenciaCasoRef = {
  id: string;
  codigo: string;
  titulo: string | null;
};

export type SugerenciaDetail = {
  sugerencia: SugerenciaListItem;
  caso: SugerenciaCasoRef | null;
  generatedAt: string;
};

export type SugerenciaResumen = {
  total: number;
  pendientes: number;
  decididas: number;
  aceptadas: number;
  aceptadasConCambios: number;
  rechazadas: number;
  expiradas: number;
  sinDecision: number;
  conSustento: number;
  /** Por diseño: el sistema nunca aplica una sugerencia. */
  autoAplicadas: number;
  /** (aceptadas + con cambios) ÷ decididas; `null` si no hay decisiones. */
  tasaAceptacion: number | null;
  /** Horas entre el alta y la decisión; `null` si no hay decisiones. */
  tiempoMedioHoras: number | null;
  generatedAt: string;
};

export type SugerenciaOpciones = {
  estados: {
    codigo: string;
    etiqueta: string;
    categoria: string;
    terminal: boolean;
  }[];
  tipos: { codigo: string; etiqueta: string }[];
  prioridades: { codigo: string; orden: number }[];
  unidades: { siglas: string; nombre: string | null }[];
  responsables: { id: string; nombre: string; cargo: string | null }[];
  generatedAt: string;
};

const ORIGENES: readonly SugerenciaOrigen[] = [
  "persona",
  "agente",
  "mesa",
  "sistema",
];

const ENTIDADES: readonly SugerenciaEntidadTipo[] = ["caso", "territorio"];

const ORDENES: Record<string, string> = {
  codigo: "s.codigo",
  fecha: "s.created_at",
  tipo: "ts.etiqueta",
  entidad: "c.codigo_caso",
  prioridad: "pa.orden",
  estado: "es.orden",
  atiende: "coalesce(ur.nombre, s.responsable_texto)",
  vence: "s.vence_en",
};

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function entidadLegible(row: Record<string, any>): string {
  if (row.caso_codigo) return String(row.caso_codigo);
  const partes = [row.region, row.provincia, row.distrito, row.territorio_texto]
    .filter((parte) => typeof parte === "string" && parte.trim())
    .map((parte) => String(parte));
  return partes.length ? partes.join(" / ") : "—";
}

function mapItem(row: Record<string, any>): SugerenciaListItem {
  const responsable =
    row.responsable_usuario_nombre ?? row.responsable_texto ?? null;
  const venceEn = row.vence_en ? toIsoDate(row.vence_en) : null;

  return {
    id: row.id,
    codigo: row.codigo,
    fecha: row.fecha ?? null,
    creadaEn: isoOrNull(row.creada_en),
    entidadTipo: row.entidad_tipo,
    casoId: row.caso_id ?? null,
    casoCodigo: row.caso_codigo ?? null,
    casoTitulo: row.caso_titulo ?? null,
    regionId: row.region_id ?? null,
    region: row.region ?? null,
    provinciaId: row.provincia_id ?? null,
    provincia: row.provincia ?? null,
    distritoId: row.distrito_id ?? null,
    distrito: row.distrito ?? null,
    territorioTexto: row.territorio_texto ?? null,
    tipoId: Number(row.tipo_id),
    tipoCodigo: row.tipo_codigo,
    tipo: row.tipo,
    titulo: row.titulo,
    detalle: row.detalle ?? null,
    destinatario: row.destinatario ?? null,
    unidadId: row.unidad_responsable_id ?? null,
    unidad: row.unidad ?? null,
    prioridadId: Number(row.prioridad_id),
    prioridad: row.prioridad,
    prioridadOrden: row.prioridad_orden ?? null,
    estadoId: Number(row.estado_id),
    estadoCodigo: row.estado_codigo,
    estado: row.estado,
    estadoCategoria: row.estado_categoria,
    terminal: Boolean(row.terminal),
    responsableUsuarioId: row.responsable_usuario_id ?? null,
    responsableUsuarioNombre: row.responsable_usuario_nombre ?? null,
    responsableTexto: row.responsable_texto ?? null,
    responsable,
    sustento: row.sustento ?? null,
    sustentoUri: row.sustento_uri ?? null,
    origen: row.origen as SugerenciaOrigen,
    confianza: row.confianza ?? null,
    decisionNota: row.decision_nota ?? null,
    motivoRechazo: row.motivo_rechazo ?? null,
    decididoPor: row.decidido_por ?? null,
    decididoPorNombre: row.decidido_por_nombre ?? null,
    decididoEn: isoOrNull(row.decidido_en),
    venceEn,
    clasificacion: Number(row.nivel_clasificacion ?? 2),
    anuladoEn: isoOrNull(row.anulado_en),
    motivoAnulacion: row.motivo_anulacion ?? null,
    entidad: entidadLegible(row),
    vencida: Boolean(venceEn && venceEn < String(row.today) && !row.terminal),
  };
}

/** `pg` devuelve `date` como `Date` a medianoche local; se fija a ISO `YYYY-MM-DD`. */
function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const anio = value.getFullYear();
    const mes = String(value.getMonth() + 1).padStart(2, "0");
    const dia = String(value.getDate()).padStart(2, "0");
    return `${anio}-${mes}-${dia}`;
  }
  const texto = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(texto) ? texto.slice(0, 10) : null;
}

/**
 * Arma el `where` compartido por el listado y el resumen. `bind` devuelve el
 * marcador (`$n`) y acumula el valor; nunca se concatena entrada del usuario.
 */
function construirFiltros(
  query: SugerenciaListQuery,
  bind: (value: unknown) => string,
): string[] {
  const where: string[] = [];

  const porTexto = filtroTexto(
    [
      "s.codigo",
      "s.titulo",
      "coalesce(s.detalle, '')",
      "coalesce(s.destinatario, '')",
      "coalesce(s.sustento, '')",
    ],
    query.q,
    bind,
  );
  if (porTexto) where.push(porTexto);

  const caso = query.caso?.trim();
  if (caso) {
    const ref = bind(caso);
    where.push(
      `(core.normalizar_ref(c.codigo_caso) = core.normalizar_ref(${ref})
        or s.caso_id::text = ${ref})`,
    );
  }

  const entidad = query.entidad?.trim();
  if (entidad) {
    where.push(`s.entidad_tipo = ${bind(entidad)}`);
  }

  const region = query.region?.trim();
  if (region) {
    const ref = bind(region);
    where.push(
      `(r.id::text = ${ref}
        or core.normalizar_ref(coalesce(r.nombre, '')) = core.normalizar_ref(${ref}))`,
    );
  }

  const territorio = query.territorio?.trim();
  if (territorio) {
    const ref = bind(`%${territorio}%`);
    where.push(
      `core.normalizar_ref(
         coalesce(r.nombre, '') || ' ' || coalesce(p.nombre, '') || ' ' ||
         coalesce(d.nombre, '') || ' ' || coalesce(s.territorio_texto, '')
       ) like core.normalizar_ref(${ref})`,
    );
  }

  const estado = query.estado?.trim();
  if (estado) {
    const ref = bind(estado);
    where.push(
      `(es.codigo = ${ref}
        or core.normalizar_ref(es.etiqueta) = core.normalizar_ref(${ref}))`,
    );
  }

  const prioridad = query.prioridad?.trim();
  if (prioridad) {
    const ref = bind(prioridad);
    where.push(
      `(pa.codigo = ${ref}
        or core.normalizar_ref(pa.codigo) = core.normalizar_ref(${ref}))`,
    );
  }

  const tipo = query.tipo?.trim();
  if (tipo) {
    const ref = bind(tipo);
    where.push(
      `(ts.codigo = ${ref}
        or core.normalizar_ref(ts.etiqueta) = core.normalizar_ref(${ref}))`,
    );
  }

  return where;
}

/** Orden: `campo` ascendente, `-campo` descendente, siempre con desempate. */
function ordenDe(sort: string | undefined): string {
  const limpio = sort?.trim();
  if (!limpio) return "s.created_at desc, s.codigo";

  const descendente = limpio.startsWith("-");
  const campo = descendente ? limpio.slice(1) : limpio;
  const expresion = ORDENES[campo];
  if (!expresion) return "s.created_at desc, s.codigo";

  return `${expresion} ${descendente ? "desc" : "asc"} nulls last, s.codigo`;
}

export async function listSugerencias(
  client: PoolClient,
  query: SugerenciaListQuery,
): Promise<SugerenciaListResult> {
  const params: unknown[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const where = construirFiltros(query, bind);
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 25)));

  const sql = `
    select ${SUGERENCIA_COLUMNS},
           count(*) over()::int as total
    ${SUGERENCIA_FROM}
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by ${ordenDe(query.sort)}
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

export async function getSugerenciaById(
  client: PoolClient,
  ref: string,
): Promise<SugerenciaDetail | null> {
  const result = await client.query(
    `select ${SUGERENCIA_COLUMNS}
     ${SUGERENCIA_FROM}
     where s.id::text = $1 or s.codigo = $1
     limit 1`,
    [ref],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    sugerencia: mapItem(row),
    caso: row.caso_id
      ? {
          id: row.caso_id,
          codigo: row.caso_codigo,
          titulo: row.caso_titulo ?? null,
        }
      : null,
    generatedAt: new Date().toISOString(),
  };
}

/** Indicadores del período con los mismos filtros del listado. */
export async function getSugerenciasResumen(
  client: PoolClient,
  query: SugerenciaListQuery,
): Promise<SugerenciaResumen> {
  const params: unknown[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const where = construirFiltros(query, bind);

  const result = await client.query(
    `select
       count(*)::int as total,
       count(*) filter (where s.decidido_en is null)::int as sin_decision,
       count(*) filter (where s.decidido_en is not null)::int as decididas,
       count(*) filter (where es.codigo = 'pendiente')::int as pendientes,
       count(*) filter (where es.codigo = 'aceptada')::int as aceptadas,
       count(*) filter (where es.codigo = 'aceptada_con_cambios')::int as aceptadas_con_cambios,
       count(*) filter (where es.codigo = 'rechazada')::int as rechazadas,
       count(*) filter (where es.codigo = 'expirada')::int as expiradas,
       count(*) filter (where s.sustento is not null and btrim(s.sustento) <> '')::int as con_sustento,
       avg(extract(epoch from (s.decidido_en - s.created_at)) / 3600.0)
         filter (where s.decidido_en is not null)::float8 as tiempo_medio_horas
     ${SUGERENCIA_FROM}
     ${where.length ? `where ${where.join(" and ")}` : ""}`,
    params,
  );

  const row = result.rows[0] ?? {};
  const decididas = Number(row.decididas ?? 0);
  const aceptadas = Number(row.aceptadas ?? 0);
  const conCambios = Number(row.aceptadas_con_cambios ?? 0);

  return {
    total: Number(row.total ?? 0),
    pendientes: Number(row.pendientes ?? 0),
    decididas,
    aceptadas,
    aceptadasConCambios: conCambios,
    rechazadas: Number(row.rechazadas ?? 0),
    expiradas: Number(row.expiradas ?? 0),
    sinDecision: Number(row.sin_decision ?? 0),
    conSustento: Number(row.con_sustento ?? 0),
    autoAplicadas: 0,
    tasaAceptacion:
      decididas > 0
        ? Math.round(((aceptadas + conCambios) / decididas) * 1000) / 10
        : null,
    tiempoMedioHoras:
      row.tiempo_medio_horas === null || row.tiempo_medio_horas === undefined
        ? null
        : Math.round(Number(row.tiempo_medio_horas) * 10) / 10,
    generatedAt: new Date().toISOString(),
  };
}

/** Vocabulario propio de la pantalla (estados, tipos) más los responsables. */
export async function getSugerenciaOpciones(
  client: PoolClient,
): Promise<SugerenciaOpciones> {
  const [estados, tipos, prioridades, unidades, responsables] =
    await Promise.all([
      client.query<{
        codigo: string;
        etiqueta: string;
        categoria: string;
        terminal: boolean;
      }>(
        `select codigo, etiqueta, categoria, es_terminal as terminal
           from core.cat_estados_sugerencia
          order by orden, id`,
      ),
      client.query<{ codigo: string; etiqueta: string }>(
        `select codigo, etiqueta from core.cat_tipos_sugerencia order by orden, id`,
      ),
      client.query<{ codigo: string; orden: number }>(
        `select codigo, orden from core.cat_prioridades_atencion order by orden, id`,
      ),
      client.query<{ siglas: string; nombre: string | null }>(
        `select siglas, nombre_completo as nombre
           from core.cat_unidades_organicas
          order by siglas`,
      ),
      client.query<{ id: string; nombre: string; cargo: string | null }>(
        `select id, nombre, cargo from core.usuarios where activo order by nombre`,
      ),
    ]);

  return {
    estados: estados.rows,
    tipos: tipos.rows,
    prioridades: prioridades.rows,
    unidades: unidades.rows,
    responsables: responsables.rows,
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Escrituras                                                          */
/* ------------------------------------------------------------------ */

export type SugerenciaWriteContext = {
  usuarioId: string;
  rolCodigo: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function invalid(mensaje = "Datos inválidos."): never {
  throw new ApiError(400, mensaje, "INVALID_BODY");
}

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid();
  return body as Record<string, unknown>;
}

function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function requiredText(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    invalid(`El campo ${key} es obligatorio.`);
  }
  return value.trim();
}

/**
 * Texto opcional con distinción entre «no enviado» (`undefined`), «vaciar»
 * (`null` o cadena vacía) y valor.
 */
function optionalText(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!has(body, key)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "string") invalid(`El campo ${key} debe ser texto.`);
  const limpio = value.trim();
  return limpio === "" ? null : limpio;
}

function optionalUuid(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const value = optionalText(body, key);
  if (value === null || value === undefined) return value;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    invalid(`El campo ${key} debe ser un identificador válido.`);
  }
  return value;
}

function optionalDate(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const value = optionalText(body, key);
  if (value === null || value === undefined) return value;
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !ISO_DATE.test(value) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    invalid(`El campo ${key} debe ser una fecha válida en formato YYYY-MM-DD.`);
  }
  return value;
}

function optionalNumber(
  body: Record<string, unknown>,
  key: string,
): number | null | undefined {
  if (!has(body, key)) return undefined;
  const value = body[key];
  if (value === null) return null;
  const numero = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numero)) invalid(`El campo ${key} debe ser numérico.`);
  return numero;
}

function optionalEnum<T extends string>(
  body: Record<string, unknown>,
  key: string,
  permitidos: readonly T[],
): T | null | undefined {
  const value = optionalText(body, key);
  if (value === null || value === undefined) return value;
  if (!(permitidos as readonly string[]).includes(value)) {
    invalid(`El campo ${key} no admite ese valor.`);
  }
  return value as T;
}

async function resolveCaso(
  client: PoolClient,
  ref: string,
): Promise<{ id: string; codigo: string; titulo: string | null }> {
  const result = await client.query<{
    id: string;
    codigo_caso: string;
    nombre_caso: string | null;
  }>(
    `select id, codigo_caso, nombre_caso
       from core.casos
      where id::text = $1 or core.normalizar_ref(codigo_caso) = core.normalizar_ref($1)
      limit 1`,
    [ref],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(400, "El caso indicado no existe.", "CASO_INVALIDO");
  }
  return { id: row.id, codigo: row.codigo_caso, titulo: row.nombre_caso };
}

async function resolveRegion(
  client: PoolClient,
  ref: string,
): Promise<{ id: number; nombre: string }> {
  const result = await client.query<{ id: number; nombre: string }>(
    `select id, nombre from core.regiones
      where id::text = $1 or core.normalizar_ref(nombre) = core.normalizar_ref($1)
      limit 1`,
    [ref],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(400, "La región indicada no existe.", "REGION_INVALIDA");
  }
  return row;
}

async function resolveProvincia(
  client: PoolClient,
  ref: string,
): Promise<{ id: number; nombre: string }> {
  const result = await client.query<{ id: number; nombre: string }>(
    `select id, nombre from core.provincias
      where id::text = $1 or core.normalizar_ref(nombre) = core.normalizar_ref($1)
      limit 1`,
    [ref],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      400,
      "La provincia indicada no existe.",
      "PROVINCIA_INVALIDA",
    );
  }
  return row;
}

async function resolveDistrito(
  client: PoolClient,
  ref: string,
): Promise<{ id: number; nombre: string }> {
  const result = await client.query<{ id: number; nombre: string }>(
    `select id, nombre from core.distritos
      where id::text = $1 or core.normalizar_ref(nombre) = core.normalizar_ref($1)
      limit 1`,
    [ref],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      400,
      "El distrito indicado no existe.",
      "DISTRITO_INVALIDO",
    );
  }
  return row;
}

async function resolveEstado(
  client: PoolClient,
  ref: string,
): Promise<{ id: number; codigo: string; categoria: string }> {
  const result = await client.query<{
    id: number;
    codigo: string;
    categoria: string;
  }>(
    `select id, codigo, categoria from core.cat_estados_sugerencia
      where codigo = $1 or core.normalizar_ref(etiqueta) = core.normalizar_ref($1)
      limit 1`,
    [ref],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(400, "El estado indicado no existe.", "ESTADO_INVALIDO");
  }
  return row;
}

async function resolveTipo(client: PoolClient, ref: string): Promise<number> {
  const result = await client.query<{ id: number }>(
    `select id from core.cat_tipos_sugerencia
      where codigo = $1 or core.normalizar_ref(etiqueta) = core.normalizar_ref($1)
      limit 1`,
    [ref],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      400,
      "El tipo de sugerencia no existe.",
      "TIPO_INVALIDO",
    );
  }
  return row.id;
}

async function resolvePrioridad(
  client: PoolClient,
  ref: string,
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `select id from core.cat_prioridades_atencion
      where id::text = $1 or core.normalizar_ref(codigo) = core.normalizar_ref($1)
      limit 1`,
    [ref],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      400,
      "La prioridad indicada no existe.",
      "PRIORIDAD_INVALIDA",
    );
  }
  return row.id;
}

async function resolveUnidad(client: PoolClient, ref: string): Promise<number> {
  const result = await client.query<{ id: number }>(
    `select id from core.cat_unidades_organicas where siglas = $1 limit 1`,
    [ref],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(400, "La unidad indicada no existe.", "UNIDAD_INVALIDA");
  }
  return row.id;
}

/**
 * Reintento único ante el choque del código correlativo. El savepoint es
 * imprescindible: un error aborta la transacción completa de `withSession`.
 */
async function retryUnique<T>(
  client: PoolClient,
  run: () => Promise<T>,
): Promise<T> {
  await client.query("savepoint sugerencia_code_retry");
  try {
    const result = await run();
    await client.query("release savepoint sugerencia_code_retry");
    return result;
  } catch (error) {
    if ((error as { code?: string }).code !== "23505") throw error;
    await client.query("rollback to savepoint sugerencia_code_retry");
    const result = await run();
    await client.query("release savepoint sugerencia_code_retry");
    return result;
  }
}

/** Estado final de una entidad: se valida antes del SQL para responder 400. */
function validarEntidad(
  entidadTipo: SugerenciaEntidadTipo,
  refs: {
    casoId: string | null;
    regionId: number | null;
    provinciaId: number | null;
    distritoId: number | null;
    territorioTexto: string | null;
  },
): void {
  if (entidadTipo === "caso") {
    if (!refs.casoId) {
      invalid(
        "Una sugerencia por caso necesita un caso. Indique el código o el identificador del caso.",
      );
    }
    return;
  }
  if (
    !refs.regionId &&
    !refs.provinciaId &&
    !refs.distritoId &&
    !refs.territorioTexto
  ) {
    invalid(
      "Una sugerencia por territorio necesita al menos una región, provincia, distrito o un texto de territorio.",
    );
  }
}

function primerDefinido<T>(...valores: (T | undefined)[]): T | undefined {
  for (const valor of valores) {
    if (valor !== undefined) return valor;
  }
  return undefined;
}

export async function createSugerencia(
  client: PoolClient,
  ctx: SugerenciaWriteContext,
  body: unknown,
): Promise<SugerenciaDetail> {
  const input = asObject(body);

  const titulo = requiredText(input, "titulo");

  const casoRef = primerDefinido(
    optionalText(input, "caso"),
    optionalText(input, "casoCode"),
    optionalText(input, "casoId"),
  );
  const caso = casoRef ? await resolveCaso(client, casoRef) : null;

  const entidadTipo =
    optionalEnum(input, "entidadTipo", ENTIDADES) ??
    (caso ? "caso" : "territorio");

  const regionRef = primerDefinido(
    optionalText(input, "region"),
    optionalText(input, "regionId"),
  );
  const provinciaRef = primerDefinido(
    optionalText(input, "provincia"),
    optionalText(input, "provinciaId"),
  );
  const distritoRef = primerDefinido(
    optionalText(input, "distrito"),
    optionalText(input, "distritoId"),
  );

  const region = regionRef ? await resolveRegion(client, regionRef) : null;
  const provincia = provinciaRef
    ? await resolveProvincia(client, provinciaRef)
    : null;
  const distrito = distritoRef
    ? await resolveDistrito(client, distritoRef)
    : null;
  const territorioTexto = optionalText(input, "territorioTexto") ?? null;

  validarEntidad(entidadTipo, {
    casoId: caso?.id ?? null,
    regionId: region?.id ?? null,
    provinciaId: provincia?.id ?? null,
    distritoId: distrito?.id ?? null,
    territorioTexto,
  });

  const tipoRef = optionalText(input, "tipo");
  const tipoId = tipoRef
    ? await resolveTipo(client, tipoRef)
    : await resolveTipo(client, "recomendacion_intervencion");

  const prioridadRef = optionalText(input, "prioridad");
  const prioridadId = prioridadRef
    ? await resolvePrioridad(client, prioridadRef)
    : 2;

  const estadoRef = optionalText(input, "estado");
  const estado = estadoRef
    ? await resolveEstado(client, estadoRef)
    : await resolveEstado(client, "pendiente");

  const motivoRechazo = optionalText(input, "motivoRechazo") ?? null;
  if (estado.codigo === "rechazada" && !motivoRechazo) {
    throw new ApiError(
      400,
      "El motivo del rechazo es obligatorio para rechazar una sugerencia.",
      "MOTIVO_REQUERIDO",
    );
  }

  const decisionNota = optionalText(input, "decisionNota") ?? null;
  const decideHumano = estado.categoria === "decidida";

  const unidadRef = optionalText(input, "unidad");
  const unidadId = unidadRef ? await resolveUnidad(client, unidadRef) : null;

  const responsableUsuarioId =
    optionalUuid(input, "responsableUsuarioId") ?? null;
  const responsableTexto = optionalText(input, "responsableTexto") ?? null;
  const destinatario = optionalText(input, "destinatario") ?? null;
  const detalle = optionalText(input, "detalle") ?? null;
  const sustento = optionalText(input, "sustento") ?? null;
  const sustentoUri = optionalText(input, "sustentoUri") ?? null;
  const origen = optionalEnum(input, "origen", ORIGENES) ?? "persona";
  const confianza = optionalNumber(input, "confianza") ?? null;
  if (confianza !== null && (confianza < 0 || confianza > 100)) {
    invalid("La confianza debe estar entre 0 y 100.");
  }
  const venceEn = optionalDate(input, "venceEn") ?? null;

  const sql = `
    insert into core.sugerencia
      (codigo, entidad_tipo, caso_id, region_id, provincia_id, distrito_id,
       territorio_texto, tipo_id, titulo, detalle, destinatario,
       unidad_responsable_id, prioridad_id, estado_id, responsable_usuario_id,
       responsable_texto, sustento, sustento_uri, origen, confianza,
       decision_nota, motivo_rechazo, decidido_por, decidido_en, vence_en)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
            $15, $16, $17, $18, $19, $20, $21, $22,
            case when $23 then $24::uuid else null end,
            case when $23 then now() else null end,
            $25::date)
    returning id
  `;

  const inserted = await retryUnique(client, async () => {
    const anio = new Date().getUTCFullYear();
    const codigo = await nextSequentialCode(
      client,
      "core.sugerencia",
      "codigo",
      `SUG-${anio}-`,
      4,
    );

    return (
      await client.query(sql, [
        codigo,
        entidadTipo,
        caso?.id ?? null,
        region?.id ?? null,
        provincia?.id ?? null,
        distrito?.id ?? null,
        territorioTexto,
        tipoId,
        titulo,
        detalle,
        destinatario,
        unidadId,
        prioridadId,
        estado.id,
        responsableUsuarioId,
        responsableTexto,
        sustento,
        sustentoUri,
        origen,
        confianza,
        decisionNota,
        motivoRechazo,
        decideHumano,
        ctx.usuarioId,
        venceEn,
      ])
    ).rows[0] as { id: string };
  });

  await auditChange(client, {
    tabla: "core.sugerencia",
    registroId: inserted.id,
    accion: "INSERT",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    despues: {
      codigo: `SUG`,
      entidad_tipo: entidadTipo,
      caso_id: caso?.id ?? null,
      titulo,
      estado: estado.codigo,
    },
  });

  const detail = await getSugerenciaById(client, inserted.id);
  if (!detail) {
    throw new Error("No se pudo leer la sugerencia recién creada.");
  }
  return detail;
}

type SugerenciaRow = Record<string, any>;

async function fetchSugerenciaRow(
  client: PoolClient,
  ref: string,
): Promise<SugerenciaRow | undefined> {
  const result = await client.query(
    `select * from core.sugerencia
      where id::text = $1 or codigo = $1
      limit 1`,
    [ref],
  );
  return result.rows[0] as SugerenciaRow | undefined;
}

export async function updateSugerencia(
  client: PoolClient,
  ctx: SugerenciaWriteContext,
  ref: string,
  body: unknown,
): Promise<SugerenciaDetail> {
  const input = asObject(body);
  const current = await fetchSugerenciaRow(client, ref);
  if (!current) {
    throw new ApiError(404, "La sugerencia no existe.", "NOT_FOUND");
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (column: string, value: unknown, cast = "") => {
    params.push(value);
    sets.push(`${column} = $${params.length}${cast}`);
  };

  // --- Datos de la sugerencia -------------------------------------------------
  const titulo = optionalText(input, "titulo");
  if (titulo === null) invalid("El título no puede quedar vacío.");
  if (titulo !== undefined) add("titulo", titulo);

  const detalle = optionalText(input, "detalle");
  if (detalle !== undefined) add("detalle", detalle);

  const destinatario = optionalText(input, "destinatario");
  if (destinatario !== undefined) add("destinatario", destinatario);

  const sustento = optionalText(input, "sustento");
  if (sustento !== undefined) add("sustento", sustento);

  const sustentoUri = optionalText(input, "sustentoUri");
  if (sustentoUri !== undefined) add("sustento_uri", sustentoUri);

  const origen = optionalEnum(input, "origen", ORIGENES);
  if (origen !== undefined) {
    if (origen === null) invalid("El origen no puede quedar vacío.");
    add("origen", origen);
  }

  if (has(input, "confianza")) {
    const confianza = optionalNumber(input, "confianza");
    if (confianza !== undefined && confianza !== null) {
      if (confianza < 0 || confianza > 100) {
        invalid("La confianza debe estar entre 0 y 100.");
      }
      add("confianza", confianza);
    } else {
      add("confianza", null);
    }
  }

  const venceEn = optionalDate(input, "venceEn");
  if (venceEn !== undefined) add("vence_en", venceEn, "::date");

  const unidadRef = optionalText(input, "unidad");
  if (unidadRef !== undefined) {
    add(
      "unidad_responsable_id",
      unidadRef === null ? null : await resolveUnidad(client, unidadRef),
    );
  }

  const tipoRef = optionalText(input, "tipo");
  if (tipoRef !== undefined) {
    if (tipoRef === null)
      invalid("El tipo de sugerencia no puede quedar vacío.");
    add("tipo_id", await resolveTipo(client, tipoRef));
  }

  const prioridadRef = optionalText(input, "prioridad");
  if (prioridadRef !== undefined) {
    if (prioridadRef === null) invalid("La prioridad no puede quedar vacía.");
    add("prioridad_id", await resolvePrioridad(client, prioridadRef));
  }

  // --- Asignación -------------------------------------------------------------
  if (has(input, "responsableUsuarioId")) {
    add("responsable_usuario_id", optionalUuid(input, "responsableUsuarioId"));
  }
  const responsableTexto = optionalText(input, "responsableTexto");
  if (responsableTexto !== undefined)
    add("responsable_texto", responsableTexto);

  // --- Entidad afectada -------------------------------------------------------
  let entidadTipo: SugerenciaEntidadTipo = current.entidad_tipo;
  const entidadInput = optionalEnum(input, "entidadTipo", ENTIDADES);
  if (entidadInput !== undefined && entidadInput !== null) {
    entidadTipo = entidadInput;
  }

  let casoId: string | null = current.caso_id ?? null;
  const casoRef = primerDefinido(
    optionalText(input, "caso"),
    optionalText(input, "casoCode"),
    optionalText(input, "casoId"),
  );
  if (casoRef !== undefined) {
    if (casoRef === null) {
      casoId = null;
    } else {
      casoId = (await resolveCaso(client, casoRef)).id;
    }
    add("caso_id", casoId);
  }

  let regionId: number | null = current.region_id ?? null;
  const regionRef = primerDefinido(
    optionalText(input, "region"),
    optionalText(input, "regionId"),
  );
  if (regionRef !== undefined) {
    regionId =
      regionRef === null ? null : (await resolveRegion(client, regionRef)).id;
    add("region_id", regionId);
  }

  let provinciaId: number | null = current.provincia_id ?? null;
  const provinciaRef = primerDefinido(
    optionalText(input, "provincia"),
    optionalText(input, "provinciaId"),
  );
  if (provinciaRef !== undefined) {
    provinciaId =
      provinciaRef === null
        ? null
        : (await resolveProvincia(client, provinciaRef)).id;
    add("provincia_id", provinciaId);
  }

  let distritoId: number | null = current.distrito_id ?? null;
  const distritoRef = primerDefinido(
    optionalText(input, "distrito"),
    optionalText(input, "distritoId"),
  );
  if (distritoRef !== undefined) {
    distritoId =
      distritoRef === null
        ? null
        : (await resolveDistrito(client, distritoRef)).id;
    add("distrito_id", distritoId);
  }

  let territorioTexto: string | null = current.territorio_texto ?? null;
  const territorioInput = optionalText(input, "territorioTexto");
  if (territorioInput !== undefined) {
    territorioTexto = territorioInput;
    add("territorio_texto", territorioTexto);
  }

  const entidadTocada =
    entidadInput !== undefined ||
    casoRef !== undefined ||
    regionRef !== undefined ||
    provinciaRef !== undefined ||
    distritoRef !== undefined ||
    territorioInput !== undefined;

  if (entidadTocada) {
    // Un caso declarado implica entidad «caso»; un territorio, lo contrario.
    if (casoRef !== undefined && casoRef !== null) {
      entidadTipo = "caso";
      add("entidad_tipo", entidadTipo);
    } else if (entidadInput === undefined && casoRef === null) {
      entidadTipo = "territorio";
      add("entidad_tipo", entidadTipo);
    } else if (entidadInput !== undefined) {
      add("entidad_tipo", entidadTipo);
    }
    validarEntidad(entidadTipo, {
      casoId,
      regionId,
      provinciaId,
      distritoId,
      territorioTexto,
    });
  }

  // --- Decisión y estado ------------------------------------------------------
  const estadoRef = optionalText(input, "estado");
  if (estadoRef !== undefined) {
    if (estadoRef === null) invalid("El estado no puede quedar vacío.");
    const estado = await resolveEstado(client, estadoRef);
    add("estado_id", estado.id);

    if (estado.codigo === "rechazada") {
      const motivo =
        optionalText(input, "motivoRechazo") ?? current.motivo_rechazo ?? null;
      if (!motivo || !String(motivo).trim()) {
        throw new ApiError(
          400,
          "El motivo del rechazo es obligatorio para rechazar una sugerencia.",
          "MOTIVO_REQUERIDO",
        );
      }
      // El motivo acompaña al estado: se persiste siempre, venga del cuerpo o
      // ya estuviera registrado (antes se omitía al enviarse junto al estado).
      add("motivo_rechazo", motivo);
    }

    if (estado.categoria === "decidida") {
      // Primera decisión: se registra al humano de la sesión y la fecha.
      if (!current.decidido_en) {
        add("decidido_por", ctx.usuarioId);
        add("decidido_en", new Date().toISOString(), "::timestamptz");
      }
    } else {
      // Volver a un estado sin decisión borra la traza de decisión.
      add("decidido_por", null);
      add("decidido_en", null);
      add("motivo_rechazo", null);
    }
  }

  const motivoRechazo = optionalText(input, "motivoRechazo");
  if (motivoRechazo !== undefined && estadoRef === undefined) {
    add("motivo_rechazo", motivoRechazo);
  }

  const decisionNota = optionalText(input, "decisionNota");
  if (decisionNota !== undefined) add("decision_nota", decisionNota);

  if (sets.length === 0) invalid("No se envió ningún cambio.");

  params.push(current.id);

  const updated = (
    await client.query(
      `update core.sugerencia
          set ${sets.join(", ")}
        where id = $${params.length}
        returning id`,
      params,
    )
  ).rows[0] as { id: string } | undefined;

  if (!updated) {
    throw new ApiError(404, "La sugerencia no existe.", "NOT_FOUND");
  }

  await auditChange(client, {
    tabla: "core.sugerencia",
    registroId: current.id as string,
    accion: "UPDATE",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    antes: current,
    despues: {
      ...current,
      ...Object.fromEntries(
        sets.map((set, indice) => [set.split(" = ")[0], params[indice]]),
      ),
    },
  });

  const detail = await getSugerenciaById(client, current.id as string);
  if (!detail) {
    throw new Error("No se pudo leer la sugerencia actualizada.");
  }
  return detail;
}
