import type { PoolClient } from "pg";
import { auditChange } from "../audit";
import { filtroTexto } from "../busqueda";
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
  -- Espacio de diálogo real del caso, derivado por la 1:1 mesas_dialogo.caso_id
  -- (migración 81). Un caso común no tiene mesa y estos campos vienen nulos.
  m.id as mesa_id,
  m.codigo as mesa_codigo,
  m.titulo as mesa_titulo,
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
  -- Vínculo a la demanda y punto focal del compromiso (migración 41).
  cmp.demanda_id as demanda_id,
  dm.codigo_legado as demanda_codigo,
  cmp.punto_focal_usuario_id as punto_focal_usuario_id,
  cmp.punto_focal_texto as punto_focal_texto,
  pf.nombre as punto_focal_usuario_nombre,
  cmp.atiende_brecha_genero as atiende_genero,
  cmp.clasificacion_alcance as clasificacion_alcance,
  cmp.formal_verbal as formal_verbal,
  cmp.asumido_ministro as asumido_ministro,
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
  left join core.mesas_dialogo m on m.caso_id = cmp.caso_id
  left join core.cat_estados_compromiso ec on ec.id = cmp.estado_id
  left join core.cat_unidades_organicas uo on uo.id = cmp.unidad_responsable_id
  left join core.cat_alcances_geograficos ag on ag.id = cmp.alcance_id
  left join core.cat_tematicas te on te.id = cmp.tematica_id
  left join core.demandas dm on dm.id = cmp.demanda_id
  left join core.usuarios pf on pf.id = cmp.punto_focal_usuario_id
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
             'terminal', eh.es_terminal,
             'responsableTexto', h.responsable_texto,
             'responsableUsuarioId', h.responsable_usuario_id,
             'fechaTexto', h.fecha_vencimiento_texto,
             'fechaRealTexto', h.fecha_real_texto
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
             'linkEvidencia', h.link_evidencia,
             'responsableTexto', h.responsable_texto,
             'responsableUsuarioId', h.responsable_usuario_id,
             'fechaTexto', h.fecha_vencimiento_texto,
             'fechaRealTexto', h.fecha_real_texto
           ) order by h.fecha_vencimiento nulls last, h.codigo_hito)
      from core.hitos_compromiso h
      left join core.cat_estados_hito eh on eh.id = h.estado_id
     where h.compromiso_id = cmp.id
  ), '[]'::json)
`;

export type CommitmentListQuery = {
  q?: string;
  caso?: string;
  /** Código de la mesa de diálogo (`core.mesas_dialogo.codigo`, p. ej. `OAIPCS-001`). */
  mesa?: string;
  /**
   * `true` restringe a los compromisos cuyo caso está enlazado a una mesa de
   * diálogo (`core.mesas_dialogo.caso_id`, migración 81). Es el filtro «solo
   * mesas»; un caso común sin mesa queda fuera. Sin el campo no se filtra.
   */
  soloMesas?: boolean;
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
  /** Responsable escrito en el origen, sin usuario resuelto. */
  responsableTexto: string | null;
  /** Usuario del equipo resuelto como responsable; excluyente con el texto. */
  responsableUsuarioId: string | null;
  /** Fecha sin tipar (`No aplica`, `Julio 2026`); convive con `fecha` nula. */
  fechaTexto: string | null;
  fechaRealTexto: string | null;
};

export type CommitmentHitoDetail = CommitmentHito & {
  validacion: string | null;
  descripcionEvidencia: string | null;
  linkEvidencia: string | null;
};

export type CommitmentProximoHito = {
  id: string;
  codigo: string | null;
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
  /** Espacio de diálogo real del caso (`core.mesas_dialogo`), si el caso lo es. */
  mesaId: string | null;
  mesaCodigo: string | null;
  mesaTitulo: string | null;
  tipo: string | null;
  /** Item 16: progresivo_parcial | entendimiento_operativo | condicionado. */
  clasificacionAlcance: ClasificacionAlcance | null;
  /** Item 24: formal | verbal. */
  formalVerbal: FormalVerbal | null;
  /** Item 123: dimensión «asumido por el Señor Ministro». */
  asumidoMinistro: boolean;
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
  /** Demanda del caso que este compromiso atiende (`core.compromisos.demanda_id`). */
  demandaId: string | null;
  /** Código legado de la demanda (`core.demandas.codigo_legado`, p. ej. DEM-2026-0003). */
  demandaCodigo: string | null;
  /** Usuario punto focal resuelto; excluyente con `puntoFocalTexto`. */
  puntoFocalUsuarioId: string | null;
  /** Punto focal en texto libre; excluyente con `puntoFocalUsuarioId`. */
  puntoFocalTexto: string | null;
  /** Nombre del punto focal: usuario resuelto o, si no hay, el texto libre. */
  puntoFocal: string | null;
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
        codigo: hito.codigo,
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
    mesaId: row.mesa_id ?? null,
    mesaCodigo: row.mesa_codigo ?? null,
    mesaTitulo: row.mesa_titulo ?? null,
    tipo: row.tipo,
    clasificacionAlcance: row.clasificacion_alcance ?? null,
    formalVerbal: row.formal_verbal ?? null,
    asumidoMinistro: Boolean(row.asumido_ministro),
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
    demandaId: row.demanda_id ?? null,
    demandaCodigo: row.demanda_codigo ?? null,
    puntoFocalUsuarioId: row.punto_focal_usuario_id ?? null,
    puntoFocalTexto: row.punto_focal_texto ?? null,
    puntoFocal: row.punto_focal_usuario_nombre ?? row.punto_focal_texto ?? null,
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

  const porTexto = filtroTexto(
    ["cmp.codigo_compromiso", "cmp.accion_compromiso"],
    query.q,
    bind,
  );
  if (porTexto) where.push(porTexto);
  if (query.caso) where.push(`c.codigo_caso = ${bind(query.caso)}`);
  if (query.mesa) where.push(`m.codigo = ${bind(query.mesa)}`);
  // «Solo mesas»: el caso tiene que estar enlazado a una mesa. Se apoya en el
  // left join a `core.mesas_dialogo` que ya forma parte de COMMITMENT_FROM.
  if (query.soloMesas) where.push("m.id is not null");
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

/** Item 16. Valores del CHECK de `core.compromisos.clasificacion_alcance`. */
type ClasificacionAlcance =
  "progresivo_parcial" | "entendimiento_operativo" | "condicionado";

/** Item 24. Valores del CHECK de `core.compromisos.formal_verbal`. */
type FormalVerbal = "formal" | "verbal";

/**
 * Clave tolerante para leer valores de la interfaz: sin acentos, sin mayúsculas
 * y sin separadores. Así «Progresivo y parcial» y «progresivo_parcial» se
 * aceptan como el mismo valor del CHECK.
 */
function claveEnum(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const CLASIFICACION_ALCANCE_POR_CLAVE: Record<string, ClasificacionAlcance> = {
  progresivoparcial: "progresivo_parcial",
  progresivoyparcial: "progresivo_parcial",
  progresivooparcial: "progresivo_parcial",
  entendimientooperativo: "entendimiento_operativo",
  condicionado: "condicionado",
};

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

/**
 * Referencia a catálogo: acepta el id numérico o un texto (id o nombre). Se
 * normaliza a texto para `resolveTematica`.
 */
function optionalRef(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!has(body, key)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
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
 * Normaliza la clasificación de alcance contra el CHECK de la migración 45.
 * Un valor fuera del vocabulario devuelve 422 con un código legible, no un
 * error de base de datos.
 */
function clasificacionAlcanceValor(value: string): ClasificacionAlcance {
  const valor = CLASIFICACION_ALCANCE_POR_CLAVE[claveEnum(value)];
  if (!valor) {
    throw new ApiError(
      422,
      "La clasificación de alcance debe ser «progresivo_parcial», «entendimiento_operativo» o «condicionado».",
      "INVALID_CLASIFICACION_ALCANCE",
    );
  }
  return valor;
}

/** Normaliza el carácter formal/verbal contra el CHECK de la migración 45. */
function formalVerbalValor(value: string): FormalVerbal {
  const clave = claveEnum(value);
  if (clave === "formal") return "formal";
  if (clave === "verbal") return "verbal";
  throw new ApiError(
    422,
    "El carácter del compromiso debe ser «formal» o «verbal».",
    "INVALID_FORMAL_VERBAL",
  );
}

function optionalClasificacionAlcance(
  body: Record<string, unknown>,
  key: string,
): ClasificacionAlcance | null | undefined {
  if (!has(body, key)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) invalid();
  return clasificacionAlcanceValor(value);
}

function optionalFormalVerbal(
  body: Record<string, unknown>,
  key: string,
): FormalVerbal | null | undefined {
  if (!has(body, key)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) invalid();
  return formalVerbalValor(value);
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

/**
 * Resuelve una demanda por id o por su código legado (`DEM-2026-0003`).
 * Devuelve también su `tematica_id` para poder heredarla (B5) cuando el
 * compromiso no declara temática propia.
 */
async function resolveDemanda(
  client: PoolClient,
  ref: string,
): Promise<{ id: string; tematicaId: number | null }> {
  const result = await client.query<{
    id: string;
    tematica_id: number | null;
  }>(
    `select id, tematica_id from core.demandas
      where id::text = $1 or codigo_legado = $1
      limit 1`,
    [ref],
  );
  const row = result.rows[0];
  if (!row) invalid();
  return { id: row.id, tematicaId: row.tematica_id ?? null };
}

/** Resuelve un usuario de AVISA por id; si no existe, 422. */
async function resolveUsuario(
  client: PoolClient,
  ref: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `select id from core.usuarios where id::text = $1 limit 1`,
    [ref],
  );
  const row = result.rows[0];
  if (!row) invalid();
  return row.id;
}

/**
 * `punto_focal_usuario_id` y `punto_focal_texto` son excluyentes, igual que
 * `responsable_usuario_id` / `responsable_texto` en `core.hitos_compromiso`.
 * Ambos nulos o uno solo son válidos; los dos con valor responden 422.
 */
function validarPuntoFocalExcluyente(
  usuarioId: string | null | undefined,
  texto: string | null | undefined,
): void {
  const tieneUsuario = usuarioId !== undefined && usuarioId !== null;
  const tieneTexto = texto !== undefined && texto !== null;
  if (tieneUsuario && tieneTexto) {
    throw new ApiError(
      422,
      "«puntoFocalUsuarioId» y «puntoFocalTexto» son excluyentes: envía sólo uno.",
      "PUNTO_FOCAL_EXCLUYENTE",
    );
  }
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

  const clasificacionAlcance =
    optionalClasificacionAlcance(input, "clasificacionAlcance") ?? null;
  const formalVerbal = optionalFormalVerbal(input, "formalVerbal") ?? null;
  const asumidoMinistro = optionalBoolean(input, "asumidoMinistro") ?? false;

  const alcanceCodigo = optionalText(input, "alcance");
  const alcanceId = alcanceCodigo
    ? await resolveAlcance(client, alcanceCodigo)
    : null;

  const tematicaIdRef = optionalRef(input, "tematicaId");
  const tematicaNombreRef = optionalText(input, "tematica");
  const tematicaRef =
    tematicaIdRef !== undefined ? tematicaIdRef : tematicaNombreRef;
  let tematicaId = tematicaRef
    ? await resolveTematica(client, tematicaRef)
    : null;

  // Demanda vinculada y punto focal (usuario/texto son excluyentes).
  const demandaRef = optionalText(input, "demandaId");
  const demanda = demandaRef ? await resolveDemanda(client, demandaRef) : null;
  const demandaId = demanda?.id ?? null;

  const puntoFocalUsuarioRef = optionalUuid(input, "puntoFocalUsuarioId");
  const puntoFocalTexto = optionalText(input, "puntoFocalTexto");
  validarPuntoFocalExcluyente(puntoFocalUsuarioRef, puntoFocalTexto);
  const puntoFocalUsuarioId = puntoFocalUsuarioRef
    ? await resolveUsuario(client, puntoFocalUsuarioRef)
    : null;
  // Con usuario resuelto se guarda sólo el id; con texto, sólo el texto.
  const puntoFocalTextoFinal = puntoFocalUsuarioId
    ? null
    : (puntoFocalTexto ?? null);

  // B5: si llega demanda y no se declara temática, se hereda la de la demanda.
  if (tematicaRef === undefined && demanda) {
    tematicaId = demanda.tematicaId;
  }

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
       origen_dato, clasificacion_alcance, formal_verbal, asumido_ministro,
       demanda_id, punto_focal_usuario_id, punto_focal_texto)
    values ($1, $2, $3, $4, $5, $6, coalesce($7::date, current_date), $8::date,
            $9, $10, $11, $12, $13, $14, $15::jsonb, 'MANUAL',
            $16, $17, $18, $19, $20, $21)
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
      clasificacionAlcance,
      formalVerbal,
      asumidoMinistro,
      demandaId,
      puntoFocalUsuarioId,
      puntoFocalTextoFinal,
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

  // Vínculo a demanda: si llega y no se declara temática, se hereda (B5).
  if (has(input, "demandaId")) {
    const demandaRef = optionalText(input, "demandaId");
    const demanda = demandaRef
      ? await resolveDemanda(client, demandaRef)
      : null;
    add("demanda_id", demanda?.id ?? null);
    if (demanda && !has(input, "tematicaId") && !has(input, "tematica")) {
      add("tematica_id", demanda.tematicaId);
    }
  }

  const tematicaIdRef = optionalRef(input, "tematicaId");
  const tematicaNombreRef = optionalText(input, "tematica");
  const tematicaRef =
    tematicaIdRef !== undefined ? tematicaIdRef : tematicaNombreRef;
  if (tematicaRef !== undefined) {
    add(
      "tematica_id",
      tematicaRef === null ? null : await resolveTematica(client, tematicaRef),
    );
  }

  // Punto focal: usuario / texto son excluyentes. Declarar uno limpia el otro,
  // sin emitir dos asignaciones a la misma columna en el mismo UPDATE.
  const puntoFocalUsuarioRef = optionalUuid(input, "puntoFocalUsuarioId");
  const puntoFocalTexto = optionalText(input, "puntoFocalTexto");
  validarPuntoFocalExcluyente(puntoFocalUsuarioRef, puntoFocalTexto);
  const usuarioConValor =
    puntoFocalUsuarioRef !== undefined && puntoFocalUsuarioRef !== null;
  const textoConValor =
    puntoFocalTexto !== undefined && puntoFocalTexto !== null;
  if (puntoFocalUsuarioRef !== undefined && !textoConValor) {
    add(
      "punto_focal_usuario_id",
      usuarioConValor
        ? await resolveUsuario(client, puntoFocalUsuarioRef as string)
        : null,
    );
    // Si el texto no viene en el cuerpo, declarar usuario lo retira.
    if (usuarioConValor && puntoFocalTexto === undefined) {
      add("punto_focal_texto", null);
    }
  }
  if (puntoFocalTexto !== undefined) {
    add("punto_focal_texto", puntoFocalTexto);
    if (textoConValor) add("punto_focal_usuario_id", null);
  }

  const clasificacionAlcance = optionalClasificacionAlcance(
    input,
    "clasificacionAlcance",
  );
  if (clasificacionAlcance !== undefined) {
    add("clasificacion_alcance", clasificacionAlcance);
  }

  const formalVerbal = optionalFormalVerbal(input, "formalVerbal");
  if (formalVerbal !== undefined) {
    add("formal_verbal", formalVerbal);
  }

  const asumidoMinistro = optionalBoolean(input, "asumidoMinistro");
  if (asumidoMinistro !== undefined) {
    add("asumido_ministro", asumidoMinistro);
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
         h.link_evidencia as link_evidencia,
         h.responsable_texto as responsable_texto,
         h.responsable_usuario_id as responsable_usuario_id,
         h.fecha_vencimiento_texto as fecha_vencimiento_texto,
         h.fecha_real_texto as fecha_real_texto
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
    responsableTexto: row.responsable_texto ?? null,
    responsableUsuarioId: row.responsable_usuario_id ?? null,
    fechaTexto: row.fecha_vencimiento_texto ?? null,
    fechaRealTexto: row.fecha_real_texto ?? null,
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
  const estadoFinal = estadoCodigo ?? "Registrado";
  const estadoId = await resolveEstadoHito(client, estadoFinal);
  const evidencia = optionalText(input, "evidencia");
  const responsableTexto = optionalText(input, "responsableTexto");
  const fechaTexto = optionalText(input, "fechaTexto");
  const fechaReal = optionalDate(input, "fechaReal");
  const fechaRealTexto = optionalText(input, "fechaRealTexto");

  // Un hito «Cumplido» exige la fecha real: sin ella no hay evidencia temporal
  // de que se cumplió.
  const esCumplido = await client.query<{ es: boolean }>(
    `select core.normalizar_ref($1) = core.normalizar_ref('Cumplido') as es`,
    [estadoFinal],
  );
  if (
    esCumplido.rows[0]?.es &&
    (fechaReal === undefined || fechaReal === null)
  ) {
    throw new ApiError(
      422,
      "Un hito en estado «Cumplido» exige `fechaReal` (fecha real de cumplimiento).",
      "FECHA_REAL_REQUERIDA",
    );
  }

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
          fecha_real, estado_id, descripcion_evidencia, origen_dato,
          responsable_texto, fecha_vencimiento_texto, fecha_real_texto)
       values ($1, $2, $3, $4::date, $5::date, $6, $7, 'MANUAL', $8, $9, $10)
       returning *`,
      [
        compromisoId,
        codigo,
        descripcion,
        fecha ?? null,
        fechaReal ?? null,
        estadoId,
        evidencia ?? null,
        responsableTexto ?? null,
        fechaTexto ?? null,
        fechaRealTexto ?? null,
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

  const responsableTexto = optionalText(input, "responsableTexto");
  if (responsableTexto !== undefined) {
    add("responsable_texto", responsableTexto);
    // Las dos columnas son mutuamente excluyentes
    // (chk_hitos_compromiso_responsable_excl): declarar el responsable en texto
    // retira la resolución a usuario.
    if (responsableTexto !== null) add("responsable_usuario_id", null);
  }

  const fechaTexto = optionalText(input, "fechaTexto");
  if (fechaTexto !== undefined) add("fecha_vencimiento_texto", fechaTexto);

  const fechaRealTexto = optionalText(input, "fechaRealTexto");
  if (fechaRealTexto !== undefined) add("fecha_real_texto", fechaRealTexto);

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

/**
 * Sobre de conteos para el Resumen operativo. No devuelve filas: sólo los
 * agregados que la vista necesita.
 *
 * El plazo se mide por hitos porque `core.compromisos` no tiene fecha de
 * vencimiento propia: un compromiso "con plazo" es el que tiene al menos un
 * hito vigente con `fecha_vencimiento`. Se usan subselects en una sola
 * consulta para que todos los bloques se lean con la misma instantánea y
 * bajo la misma RLS de la transacción.
 */
export type CommitmentSummary = {
  compromisos: number;
  hitos: number;
  hitosConFecha: number;
  hitosCumplidos: number;
  hitosCumplidosConFecha: number;
  compromisosConPlazo: number;
  generatedAt: string;
};

type CommitmentSummaryRow = {
  compromisos: number;
  hitos: number;
  hitos_con_fecha: number;
  hitos_cumplidos: number;
  hitos_cumplidos_con_fecha: number;
  compromisos_con_plazo: number;
};

export async function getCommitmentsSummary(
  client: PoolClient,
): Promise<CommitmentSummary> {
  const result = await client.query<CommitmentSummaryRow>(`
    select
      (select count(*)::int
         from core.compromisos c
        where c.anulado_en is null) as compromisos,
      (select count(*)::int
         from core.hitos_compromiso h
         join core.compromisos c on c.id = h.compromiso_id
        where h.anulado_en is null and c.anulado_en is null) as hitos,
      (select count(*)::int
         from core.hitos_compromiso h
         join core.compromisos c on c.id = h.compromiso_id
        where h.anulado_en is null and c.anulado_en is null
          and h.fecha_vencimiento is not null) as hitos_con_fecha,
      (select count(*)::int
         from core.hitos_compromiso h
         join core.compromisos c on c.id = h.compromiso_id
         join core.cat_estados_hito e on e.id = h.estado_id
        where h.anulado_en is null and c.anulado_en is null
          and e.codigo = 'Cumplido') as hitos_cumplidos,
      (select count(*)::int
         from core.hitos_compromiso h
         join core.compromisos c on c.id = h.compromiso_id
         join core.cat_estados_hito e on e.id = h.estado_id
        where h.anulado_en is null and c.anulado_en is null
          and e.codigo = 'Cumplido'
          and h.fecha_vencimiento is not null) as hitos_cumplidos_con_fecha,
      (select count(distinct h.compromiso_id)::int
         from core.hitos_compromiso h
         join core.compromisos c on c.id = h.compromiso_id
        where h.anulado_en is null and c.anulado_en is null
          and h.fecha_vencimiento is not null) as compromisos_con_plazo
  `);

  const row = result.rows[0];

  return {
    compromisos: row?.compromisos ?? 0,
    hitos: row?.hitos ?? 0,
    hitosConFecha: row?.hitos_con_fecha ?? 0,
    hitosCumplidos: row?.hitos_cumplidos ?? 0,
    hitosCumplidosConFecha: row?.hitos_cumplidos_con_fecha ?? 0,
    compromisosConPlazo: row?.compromisos_con_plazo ?? 0,
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Estadísticas: conteos, ranking por área y situación de plazo        */
/* ------------------------------------------------------------------ */

/** Conteo por estado del catálogo `core.cat_estados_compromiso`. */
export type CommitmentEstadisticaEstado = {
  estado: string;
  categoria: string;
  total: number;
};

/** Fila del ranking por área responsable (unidad orgánica). */
export type CommitmentEstadisticaArea = {
  area: string;
  nombre: string;
  total: number;
  cumplidos: number;
  noCumplidos: number;
  /** Porcentaje de cumplimiento redondeado a un decimal; 0 si no hay filas. */
  porcentajeCumplimiento: number;
};

/** Conteo de hitos por estado (`core.cat_estados_hito`). */
export type CommitmentEstadisticaEstadoHito = {
  estado: string;
  total: number;
};

/**
 * Sobre de estadísticas de compromisos (Guía §8.3.2 / C1).
 *
 * Los bloques se derivan del catálogo real `core.cat_estados_compromiso`
 * (Por iniciar · En proceso · Cumplido · Redefinido · Desestimado):
 *   · `vigentes`    = estados no terminales (abiertos).
 *   · `cumplidos`   = estado `Cumplido`.
 *   · `noCumplidos` = estados terminales distintos de `Cumplido`
 *                     (`Redefinido`, `Desestimado`). Es la misma regla que
 *                     aplica `estadoCumplimientoDe` en la SPA para pintar la
 *                     columna «Estado de cumplimiento».
 *   · `enProceso`   = estado `En proceso`.
 *   · `pendientes`  = estado `Por iniciar`.
 *
 * El plazo se mide con `hitos_compromiso.fecha_vencimiento`, igual que
 * `getCommitmentsSummary`: `core.compromisos` no guarda un vencimiento propio
 * del que fiarse para este corte.
 */
export type CommitmentsEstadisticas = {
  total: number;
  vigentes: number;
  cumplidos: number;
  noCumplidos: number;
  enProceso: number;
  pendientes: number;
  porEstado: CommitmentEstadisticaEstado[];
  porArea: CommitmentEstadisticaArea[];
  porPlazo: {
    /** Compromisos con al menos un hito vencido y sin cumplir. */
    vencidos: number;
    /** Con plazo y sin hitos vencidos pendientes. */
    alDia: number;
    /** Sin ningún hito con `fecha_vencimiento` (no se puede medir el plazo). */
    sinPlazo: number;
  };
  porEstadoHito: CommitmentEstadisticaEstadoHito[];
  generatedAt: string;
};

type CommitmentsEstadisticasRow = {
  total: number;
  vigentes: number;
  cumplidos: number;
  no_cumplidos: number;
  en_proceso: number;
  pendientes: number;
  plazo_vencidos: number;
  plazo_al_dia: number;
  plazo_sin_plazo: number;
  por_estado: CommitmentEstadisticaEstado[] | null;
  por_area:
    | {
        area: string;
        nombre: string;
        total: number;
        cumplidos: number;
        noCumplidos: number;
      }[]
    | null;
  por_estado_hito: CommitmentEstadisticaEstadoHito[] | null;
};

/**
 * Porcentaje de cumplimiento de un área, redondeado a un decimal.
 * Un total de cero no produce `NaN`: se declara 0.
 */
function porcentajeCumplimiento(cumplidos: number, total: number): number {
  if (!total) return 0;
  return Math.round((cumplidos / total) * 1000) / 10;
}

/**
 * Opciones de `getCommitmentsEstadisticas`. Hoy sólo el filtro «solo mesas».
 */
export type CommitmentsEstadisticasOpciones = {
  /**
   * `true` limita los agregados a los compromisos cuyo caso está enlazado a una
   * mesa de diálogo (`core.mesas_dialogo.caso_id`, migración 81). Mismo
   * contrato que `soloMesas` en el listado; sin el campo no se filtra.
   */
  soloMesas?: boolean;
};

/**
 * Estadísticas agregadas de compromisos para la pestaña «Estadísticas».
 *
 * Se resuelve en **una sola consulta** con una CTE `base` que marca, por
 * compromiso, su estado y si tiene hitos vencidos o con plazo. Así todos los
 * bloques leen la misma instantánea y, sobre todo, la misma RLS: la función
 * recibe el cliente de `withSession` (nunca abre uno propio ni eleva el rol),
 * y `core.compromisos` / `core.hitos_compromiso` siguen protegidos por sus
 * políticas.
 *
 * Los `json_agg(... order by ...)` ya devuelven el ranking y el orden del
 * catálogo listos; el porcentaje se calcula aquí, en JS, para no depender de
 * cómo serialice `numeric` el driver.
 */
export async function getCommitmentsEstadisticas(
  client: PoolClient,
  opciones: CommitmentsEstadisticasOpciones = {},
): Promise<CommitmentsEstadisticas> {
  // El filtro se inyecta como fragmento constante (nunca con datos del usuario)
  // en la CTE `base` y en el agregado de estados de hito, que consulta
  // `core.compromisos` por su cuenta y no lee de `base`.
  const filtroMesas = opciones.soloMesas
    ? "and exists (select 1 from core.mesas_dialogo m where m.caso_id = c.caso_id)"
    : "";
  const result = await client.query<CommitmentsEstadisticasRow>(`
    with base as (
      select
        c.id,
        c.unidad_responsable_id,
        ec.id as estado_id,
        ec.codigo as estado_codigo,
        ec.categoria as estado_categoria,
        ec.es_terminal as terminal,
        exists (
          select 1
            from core.hitos_compromiso h
            left join core.cat_estados_hito eh on eh.id = h.estado_id
           where h.compromiso_id = c.id
             and h.anulado_en is null
             and h.fecha_vencimiento is not null
             and h.fecha_vencimiento < current_date
             and coalesce(eh.codigo, '') <> 'Cumplido'
        ) as vencido,
        exists (
          select 1
            from core.hitos_compromiso h
           where h.compromiso_id = c.id
             and h.anulado_en is null
             and h.fecha_vencimiento is not null
        ) as con_plazo
      from core.compromisos c
      join core.cat_estados_compromiso ec on ec.id = c.estado_id
     where c.anulado_en is null ${filtroMesas}
    )
    select
      (select count(*)::int from base) as total,
      (select count(*)::int from base b where not b.terminal) as vigentes,
      (select count(*)::int from base b
        where b.estado_codigo = 'Cumplido') as cumplidos,
      (select count(*)::int from base b
        where b.terminal and b.estado_codigo <> 'Cumplido') as no_cumplidos,
      (select count(*)::int from base b
        where b.estado_codigo = 'En proceso') as en_proceso,
      (select count(*)::int from base b
        where b.estado_codigo = 'Por iniciar') as pendientes,
      (select count(*)::int from base b where b.vencido) as plazo_vencidos,
      (select count(*)::int from base b
        where b.con_plazo and not b.vencido) as plazo_al_dia,
      (select count(*)::int from base b where not b.con_plazo) as plazo_sin_plazo,
      coalesce((
        select json_agg(json_build_object(
                 'estado', e.estado_codigo,
                 'categoria', e.estado_categoria,
                 'total', e.total
               ) order by e.estado_id)
          from (
            select
              b.estado_id,
              b.estado_codigo,
              b.estado_categoria,
              count(*)::int as total
              from base b
             group by b.estado_id, b.estado_codigo, b.estado_categoria
          ) e
      ), '[]'::json) as por_estado,
      coalesce((
        select json_agg(json_build_object(
                 'area', a.area,
                 'nombre', a.nombre,
                 'total', a.total,
                 'cumplidos', a.cumplidos,
                 'noCumplidos', a.no_cumplidos
               ) order by a.total desc, a.area)
          from (
            select
              uo.siglas as area,
              uo.nombre_completo as nombre,
              count(*)::int as total,
              (count(*) filter (
                 where b.estado_codigo = 'Cumplido'
               ))::int as cumplidos,
              (count(*) filter (
                 where b.terminal and b.estado_codigo <> 'Cumplido'
               ))::int as no_cumplidos
              from base b
              join core.cat_unidades_organicas uo
                on uo.id = b.unidad_responsable_id
             group by uo.id, uo.siglas, uo.nombre_completo
          ) a
      ), '[]'::json) as por_area,
      coalesce((
        select json_agg(json_build_object(
                 'estado', eh.codigo,
                 'total', h.total
               ) order by eh.id)
          from (
            select hh.estado_id, count(*)::int as total
              from core.hitos_compromiso hh
              join core.compromisos c on c.id = hh.compromiso_id
             where hh.anulado_en is null and c.anulado_en is null ${filtroMesas}
             group by hh.estado_id
          ) h
          join core.cat_estados_hito eh on eh.id = h.estado_id
      ), '[]'::json) as por_estado_hito
  `);

  const row = result.rows[0];

  // El porcentaje se calcula en JS: `numeric` llega como texto con el driver de
  // `pg` y aquí el valor es un entero pequeño que conviene redondear de forma
  // explícita antes de exponerlo al cliente.
  const porArea: CommitmentEstadisticaArea[] = (row?.por_area ?? []).map(
    (fila) => ({
      area: fila.area,
      nombre: fila.nombre,
      total: fila.total,
      cumplidos: fila.cumplidos,
      noCumplidos: fila.noCumplidos,
      porcentajeCumplimiento: porcentajeCumplimiento(
        fila.cumplidos,
        fila.total,
      ),
    }),
  );

  return {
    total: row?.total ?? 0,
    vigentes: row?.vigentes ?? 0,
    cumplidos: row?.cumplidos ?? 0,
    noCumplidos: row?.no_cumplidos ?? 0,
    enProceso: row?.en_proceso ?? 0,
    pendientes: row?.pendientes ?? 0,
    porEstado: row?.por_estado ?? [],
    porArea,
    porPlazo: {
      vencidos: row?.plazo_vencidos ?? 0,
      alDia: row?.plazo_al_dia ?? 0,
      sinPlazo: row?.plazo_sin_plazo ?? 0,
    },
    porEstadoHito: row?.por_estado_hito ?? [],
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Historial: eventos, hitos y adjuntos de un compromiso               */
/* ------------------------------------------------------------------ */

/** Evento declarado en `core.compromiso_evento` (migración 49). */
export type CommitmentEvento = {
  id: string;
  /** Slug libre y corto: `nota`, `cambio_estado`, `hito_creado`… */
  tipo: string;
  /** Cuerpo libre del evento; la forma la decide quien lo escribe. */
  detalle: unknown;
  /** Nombre legible de quien registró el evento; `null` si no se resuelve. */
  autor: string | null;
  usuarioId: string | null;
  createdAt: string | null;
};

/** Hito dentro de la línea de tiempo, con su conteo de adjuntos vigentes. */
export type CommitmentHistorialHito = {
  id: string;
  codigo: string | null;
  descripcion: string | null;
  fecha: string | null;
  fechaReal: string | null;
  estado: string | null;
  terminal: boolean | null;
  responsableTexto: string | null;
  adjuntos: number;
};

/** Adjunto vigente de un compromiso o de uno de sus hitos. */
export type CommitmentHistorialAdjunto = {
  id: string;
  entidadTipo: "compromiso" | "hito";
  entidadId: string;
  nombre: string;
  mime: string | null;
  tamanoBytes: number | null;
  descripcion: string | null;
  subidoPor: string | null;
  createdAt: string | null;
  /** Código del hito cuando el adjunto cuelga de uno; `null` si es del compromiso. */
  hitoCodigo: string | null;
};

/**
 * Ítem de la línea de tiempo unificada. `evento`, `hito` y `adjunto` son
 * opcionales a propósito: la plantilla discrimina por `tipo` sin uniones
 * anidadas que TypeScript no pueda estrechar.
 */
export type CommitmentHistorialItem = {
  tipo: "evento" | "hito" | "adjunto";
  id: string;
  /** ISO 8601 para ordenar; `null` si el hito no declara fecha. */
  fecha: string | null;
  evento?: CommitmentEvento;
  hito?: CommitmentHistorialHito;
  adjunto?: CommitmentHistorialAdjunto;
};

export type CommitmentHistorial = {
  compromisoId: string;
  codigo: string | null;
  eventos: CommitmentEvento[];
  hitos: CommitmentHistorialHito[];
  adjuntos: CommitmentHistorialAdjunto[];
  /** Eventos, hitos y adjuntos en una sola secuencia ascendente. */
  linea: CommitmentHistorialItem[];
  generatedAt: string;
};

const ORDEN_TIPO_HISTORIAL: Record<CommitmentHistorialItem["tipo"], number> = {
  evento: 0,
  hito: 1,
  adjunto: 2,
};

/**
 * Historial completo de un compromiso en cuatro lecturas constantes (sin
 * N+1): el compromiso, sus eventos con autor, sus hitos con el conteo de
 * adjuntos y los adjuntos del compromiso y de sus hitos.
 *
 * La tabla `core.compromiso_evento` puede estar vacía: se devuelve `[]` y la
 * línea sigue mostrando hitos y adjuntos. El orden es cronológico ascendente;
 * dentro del mismo instante, evento → hito → adjunto y luego por id.
 */
export async function getCommitmentHistorial(
  client: PoolClient,
  ref: string,
): Promise<CommitmentHistorial | null> {
  const target = await client.query<{ id: string; codigo: string | null }>(
    `select id, codigo_compromiso as codigo
       from core.compromisos
      where id::text = $1 or codigo_compromiso = $1
      limit 1`,
    [ref],
  );
  const compromiso = target.rows[0];
  if (!compromiso) return null;

  const [eventosResult, hitosResult, adjuntosResult] = await Promise.all([
    // Eventos con el nombre del autor resuelto en el mismo viaje.
    client.query<{
      id: string;
      tipo: string;
      detalle: unknown;
      usuario_id: string | null;
      created_at: Date | string | null;
      autor: string | null;
    }>(
      `select e.id,
              e.tipo,
              e.detalle,
              e.usuario_id,
              e.created_at,
              u.nombre as autor
         from core.compromiso_evento e
         left join core.usuarios u on u.id = e.usuario_id
        where e.compromiso_id = $1::uuid
        order by e.created_at asc, e.id`,
      [compromiso.id],
    ),

    // Hitos vigentes con el estado del Anexo 14 y cuántos adjuntos tienen.
    client.query<{
      id: string;
      codigo: string | null;
      descripcion: string | null;
      fecha: string | null;
      fecha_real: string | null;
      estado: string | null;
      terminal: boolean | null;
      responsable_texto: string | null;
      adjuntos: number;
    }>(
      `select h.id,
              h.codigo_hito as codigo,
              h.descripcion_hito as descripcion,
              to_char(h.fecha_vencimiento, 'YYYY-MM-DD') as fecha,
              to_char(h.fecha_real, 'YYYY-MM-DD') as fecha_real,
              replace(eh.codigo, '_', ' ') as estado,
              eh.es_terminal as terminal,
              h.responsable_texto as responsable_texto,
              coalesce((
                select count(*)::int
                  from core.adjunto a
                 where a.entidad_tipo = 'hito'
                   and a.entidad_id = h.id
                   and a.anulado_en is null
              ), 0) as adjuntos
         from core.hitos_compromiso h
         left join core.cat_estados_hito eh on eh.id = h.estado_id
        where h.compromiso_id = $1::uuid
          and h.anulado_en is null
        order by h.fecha_vencimiento asc nulls last, h.codigo_hito`,
      [compromiso.id],
    ),

    // Adjuntos del compromiso y de sus hitos vigentes.
    client.query<{
      id: string;
      entidad_tipo: "compromiso" | "hito";
      entidad_id: string;
      nombre: string;
      mime: string | null;
      tamano_bytes: string | number | null;
      descripcion: string | null;
      subido_por: string | null;
      created_at: Date | string | null;
      hito_codigo: string | null;
    }>(
      `select a.id,
              a.entidad_tipo,
              a.entidad_id,
              a.nombre,
              a.mime,
              a.tamano_bytes,
              a.descripcion,
              a.subido_por,
              a.created_at,
              h.codigo_hito as hito_codigo
         from core.adjunto a
         left join core.hitos_compromiso h
                on h.id = a.entidad_id
               and a.entidad_tipo = 'hito'
               and h.compromiso_id = $1::uuid
               and h.anulado_en is null
        where a.anulado_en is null
          and (
            (a.entidad_tipo = 'compromiso' and a.entidad_id = $1::uuid)
            or (a.entidad_tipo = 'hito' and h.compromiso_id = $1::uuid)
          )
        order by a.created_at asc, a.id`,
      [compromiso.id],
    ),
  ]);

  const eventos: CommitmentEvento[] = eventosResult.rows.map((row) => ({
    id: row.id,
    tipo: row.tipo,
    detalle: row.detalle ?? null,
    autor: row.autor ?? null,
    usuarioId: row.usuario_id ?? null,
    createdAt: isoOrNull(row.created_at),
  }));

  const hitos: CommitmentHistorialHito[] = hitosResult.rows.map((row) => ({
    id: row.id,
    codigo: row.codigo ?? null,
    descripcion: row.descripcion ?? null,
    fecha: row.fecha ?? null,
    fechaReal: row.fecha_real ?? null,
    estado: row.estado ?? null,
    terminal: row.terminal ?? null,
    responsableTexto: row.responsable_texto ?? null,
    adjuntos: Number(row.adjuntos ?? 0),
  }));

  const adjuntos: CommitmentHistorialAdjunto[] = adjuntosResult.rows.map(
    (row) => ({
      id: row.id,
      entidadTipo: row.entidad_tipo,
      entidadId: row.entidad_id,
      nombre: row.nombre,
      mime: row.mime ?? null,
      tamanoBytes: row.tamano_bytes === null ? null : Number(row.tamano_bytes),
      descripcion: row.descripcion ?? null,
      subidoPor: row.subido_por ?? null,
      createdAt: isoOrNull(row.created_at),
      hitoCodigo: row.hito_codigo ?? null,
    }),
  );

  const linea: CommitmentHistorialItem[] = [
    ...eventos.map<CommitmentHistorialItem>((evento) => ({
      tipo: "evento",
      id: evento.id,
      fecha: evento.createdAt,
      evento,
    })),
    ...hitos.map<CommitmentHistorialItem>((hito) => {
      const fecha = hito.fechaReal ?? hito.fecha;
      return {
        tipo: "hito",
        id: hito.id,
        // La fecha del hito es un día sin hora: se fija a medianoche UTC.
        fecha: fecha ? `${fecha}T00:00:00.000Z` : null,
        hito,
      };
    }),
    ...adjuntos.map<CommitmentHistorialItem>((adjunto) => ({
      tipo: "adjunto",
      id: adjunto.id,
      fecha: adjunto.createdAt,
      adjunto,
    })),
  ];

  linea.sort((izquierda, derecha) => {
    if (izquierda.fecha === null && derecha.fecha === null) {
      return ordenarEmpate(izquierda, derecha);
    }
    if (izquierda.fecha === null) return 1;
    if (derecha.fecha === null) return -1;
    const porFecha = izquierda.fecha.localeCompare(derecha.fecha);
    return porFecha !== 0 ? porFecha : ordenarEmpate(izquierda, derecha);
  });

  return {
    compromisoId: compromiso.id,
    codigo: compromiso.codigo ?? null,
    eventos,
    hitos,
    adjuntos,
    linea,
    generatedAt: new Date().toISOString(),
  };
}

/** Desempate estable dentro del mismo instante: tipo y luego id. */
function ordenarEmpate(
  izquierda: CommitmentHistorialItem,
  derecha: CommitmentHistorialItem,
): number {
  const porTipo =
    ORDEN_TIPO_HISTORIAL[izquierda.tipo] - ORDEN_TIPO_HISTORIAL[derecha.tipo];
  return porTipo !== 0 ? porTipo : izquierda.id.localeCompare(derecha.id);
}

/** Slugs aceptados en `core.compromiso_evento.tipo` (varchar(30)). */
const TIPO_EVENTO = /^[a-z0-9][a-z0-9_-]{0,29}$/;

/**
 * Registra un evento manual en `core.compromiso_evento`.
 *
 * La tabla no tiene RLS propia, así que la autorización se replica en un CTE:
 * sólo se inserta si el compromiso existe bajo la RLS vigente, el rol puede
 * editar y su nivel de clasificación alcanza el del compromiso. Si no se
 * inserta, se distingue 404 (no existe) de 403 (sin permiso) sin exponer datos.
 */
export async function createCommitmentEvento(
  client: PoolClient,
  ctx: CommitmentWriteContext,
  ref: string,
  body: unknown,
): Promise<CommitmentEvento> {
  const input = asObject(body);
  const tipo = requiredText(input, "tipo").toLowerCase();
  if (!TIPO_EVENTO.test(tipo)) invalid();
  const detalle = has(input, "detalle")
    ? optionalJson(input, "detalle")
    : undefined;
  // El detalle es un objeto libre; un arreglo o un escalar no es un evento.
  if (Array.isArray(detalle)) invalid();

  const inserted = await client.query<{
    id: string;
    tipo: string;
    detalle: unknown;
    usuario_id: string | null;
    created_at: Date | string | null;
    autor: string | null;
  }>(
    `with autorizado as (
       select id
         from core.compromisos
        where (id::text = $1 or codigo_compromiso = $1)
          and core.puede_editar()
          and core.clasificacion_max() >= 2
          and nivel_clasificacion <= core.clasificacion_max()
     ), creado as (
       insert into core.compromiso_evento (compromiso_id, tipo, detalle, usuario_id)
       select id, $2, $3::jsonb, $4::uuid from autorizado
       returning id, tipo, detalle, usuario_id, created_at
     )
     select c.id,
            c.tipo,
            c.detalle,
            c.usuario_id,
            c.created_at,
            u.nombre as autor
       from creado c
       left join core.usuarios u on u.id = c.usuario_id`,
    [ref, tipo, jsonParam(detalle), ctx.usuarioId],
  );

  const row = inserted.rows[0];
  if (!row) {
    const existe = await client.query<{ id: string }>(
      `select id from core.compromisos
        where id::text = $1 or codigo_compromiso = $1
        limit 1`,
      [ref],
    );
    if (existe.rowCount === 0) {
      throw new ApiError(404, "El compromiso no existe.", "NOT_FOUND");
    }
    throw new ApiError(
      403,
      "Sin permiso para registrar eventos en este compromiso.",
      "SIN_PERMISO",
    );
  }

  return {
    id: row.id,
    tipo: row.tipo,
    detalle: row.detalle ?? null,
    autor: row.autor ?? null,
    usuarioId: row.usuario_id ?? null,
    createdAt: isoOrNull(row.created_at),
  };
}
