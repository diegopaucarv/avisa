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
  nat.codigo as naturaleza,
  su.nombre as subsector,
  uo.siglas as unidad_responsable,
  c.origen_dato as origen,
  c.nivel_clasificacion as clasificacion,
  -- Nombre para mostrar y ubigeo como llave: hay 15 «Santa Rosa» y sólo el
  -- ubigeo empareja con «territorio.distrito» sin ambigüedad.
  dp.nombre as distrito,
  dp.ubigeo::text as distrito_ubigeo,
  c.anulado_en as anulado_en,
  c.motivo_anulacion as motivo_anulacion,
  c.anulado_por as anulado_por,
  ua.nombre as anulado_por_nombre,
  c.anulacion_id as anulacion_id
`;

const CASE_FROM = `
  from core.casos c
  left join core.cat_estados_caso ec on ec.id = c.estado_id
  left join core.cat_niveles_riesgo nr on nr.id = c.nivel_riesgo_id
  left join core.cat_prioridades_atencion pa on pa.id = c.prioridad_id
  left join core.cat_alcances_geograficos ag on ag.id = core.alcance_caso(c.id)
  left join core.cat_niveles_conflicto nc on nc.id = c.nivel_conflicto_id
  left join core.cat_ciclos_intervencion ci on ci.id = c.ciclo_intervencion_id
  left join core.cat_tematicas te on te.id = c.tematica_id
  left join core.cat_naturalezas_caso nat on nat.id = c.naturaleza_id
  left join core.cat_subsectores su on su.id = c.subsector_id
  left join core.cat_unidades_organicas uo on uo.id = c.unidad_responsable_id
  left join core.regiones rp on rp.id = c.region_principal_id
  left join core.usuarios ua on ua.id = c.anulado_por
  -- El distrito principal viaja con el caso para que la coropleta distrital
  -- una por ubigeo y no por nombre. «dp.id» es PK: el join no duplica filas.
  left join core.distritos dp on dp.id = c.distrito_principal_id
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
  /** Nivel de conflictividad (`core.cat_niveles_conflicto.codigo`). */
  nivel?: string;
  alcance?: string;
  tematica?: string;
  /**
   * Naturaleza declarada del caso (`core.cat_naturalezas_caso.codigo`) o el
   * literal «Sin declarar», que aísla los casos con `naturaleza_id` nulo.
   */
  naturaleza?: string;
  unidad?: string;
  region?: string;
  /**
   * `true` deja sólo los casos sin región principal: es el complemento de
   * `region` y alimenta la fila «Sin región» del panorama territorial.
   */
  sinRegion?: boolean;
  /** `true` lista la papelera: sólo casos con `anulado_en` no nulo. */
  anulados?: boolean;
  /**
   * `true` se queda con los estados abiertos del catálogo (`es_activo`), no con
   * una etiqueta concreta: tras la migración 33 sólo `Abierto` lo es, pero la
   * regla no depende de su grafía.
   */
  abiertos?: boolean;
  /**
   * `true` añade al resultado el bloque `conteos` de la barra de estados. Se
   * calcula con los mismos filtros de la consulta pero ignorando `estado` y
   * `abiertos`, para que los chips muestren cuántos casos hay al cambiar de chip.
   */
  conteos?: boolean;
  page?: number;
  pageSize?: number;
  sort?: string;
};

/**
 * Geografía principal del caso. `distrito` es el nombre para mostrar;
 * `distritoUbigeo` es la llave INEI de 6 dígitos. Ambos `null` cuando el caso
 * no declara distrito principal.
 */
export type CaseGeografia = {
  distrito: string | null;
  distritoUbigeo: string | null;
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
  /**
   * Distrito principal: nombre para mostrar y ubigeo como llave. Hay 15 «Santa
   * Rosa», así que sólo el ubigeo une con la capa GIS sin emparejar por nombre.
   */
  geografia: CaseGeografia;
  estado: string | null;
  risk: string | null;
  riskSource: "casos.nivel_riesgo_id";
  riskDerived: false;
  prioridad: string | null;
  alcance: string | null;
  nivelConflicto: string | null;
  stage: string | null;
  tematica: string | null;
  /**
   * Naturaleza declarada (Territorial / Nacional o sectorial) o `null` si aún
   * no se declaró. No se deriva del alcance geográfico.
   */
  naturaleza: string | null;
  subsector: string | null;
  unidadResponsable: string | null;
  origen: string | null;
  clasificacion: number;
  /** Fecha real del caso (la del legado), no la de carga. */
  fechaInicio: string | null;
  anuladoEn: string | Date | null;
  /** Motivo declarado al anular; sólo se puebla en la papelera. */
  motivoAnulacion: string | null;
  /** Usuario que anuló (id); sólo se puebla en la papelera. */
  anuladoPor: string | null;
  /** Nombre legible de quien anuló; `null` si no se puede resolver. */
  anuladoPorNombre: string | null;
  /** Lote de anulación al que pertenece la fila. */
  anulacionId: string | null;
};

/**
 * Conteos de la barra de filtros de estado. Se calculan con los filtros
 * vigentes (búsqueda, ámbito, temática, unidad, prioridad, región, anulados)
 * pero sin aplicar `estado` ni `abiertos`.
 */
export type CaseConteos = {
  /** Filas visibles no anuladas con los filtros vigentes. */
  todos: number;
  /** Estados con `es_activo = true` (tras la migración 33, sólo `Abierto`). */
  abiertos: number;
  /** Casos en el estado canónico `Resuelto`. */
  resueltos: number;
  /** Casos en el estado canónico `Archivado`. */
  archivados: number;
};

export type CaseListResult = {
  items: CaseListItem[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
  /** Sólo presente cuando la consulta pidió `conteos=true`. */
  conteos?: CaseConteos;
};

const SORTS: Record<string, string> = {
  // «Más reciente» ordena por la fecha real del caso. `fecha_ultima_actualizacion`
  // es el instante de carga del legado (2026-10-31) para casi todas las filas y
  // dejaba el orden sin efecto.
  recent: "c.fecha_inicio desc nulls last, c.codigo_caso asc",
  risk: "nr.orden desc nulls last, c.codigo_caso asc",
  priority: "pa.orden asc nulls last, c.codigo_caso asc",
  code: "c.codigo_caso asc",
};

/**
 * Acepta los valores booleanos de la API (`true`) y también los que reenvía la
 * exportación como texto (`"true"`). `"false"` no activa el filtro.
 */
function esVerdadero(valor: unknown): boolean {
  if (typeof valor === "boolean") return valor;
  if (typeof valor === "string") {
    return ["true", "1", "si", "sí", "on"].includes(valor.trim().toLowerCase());
  }
  return false;
}

/**
 * Constructor único de `WHERE` del listado de casos.
 *
 * `sinEstado` omite los filtros `estado` y `abiertos`: es lo que usan los
 * conteos de la barra para no depender del chip activo. El resto de filtros
 * (búsqueda, ámbito/RLS, temática, unidad, prioridad, región, anulados) se
 * aplican igual que en la consulta paginada.
 */
async function construirWhere(
  client: PoolClient,
  query: CaseListQuery,
  opciones: { sinEstado?: boolean } = {},
): Promise<{ where: string[]; params: unknown[] }> {
  const params: unknown[] = [];
  const where: string[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const search = query.q?.trim();
  if (search) {
    const like = bind(`%${search}%`);
    // Se normaliza la columna y el patrón para que la búsqueda ignore tildes
    // («produccion» encuentra «Producción»); `normalizar_ref` conserva los `%`.
    where.push(
      `(core.normalizar_ref(c.codigo_caso) like core.normalizar_ref(${like}) or core.normalizar_ref(c.nombre_caso) like core.normalizar_ref(${like}) or core.normalizar_ref(coalesce(c.resumen_ejecutivo, '')) like core.normalizar_ref(${like}))`,
    );
  }

  // La RLS de `core.casos` ya oculta las filas anuladas; el filtro explícito sólo
  // se añade al abrir la papelera (`anulados=true`).
  if (query.anulados) where.push("c.anulado_en is not null");

  if (!opciones.sinEstado) {
    // «Abiertos» se define por catálogo, no por una etiqueta: la migración 33
    // unificó `Activo` y `En seguimiento` en `Abierto` con `es_activo = true`,
    // así que el indicador no depende del nombre que tome el estado abierto.
    if (esVerdadero(query.abiertos)) where.push("ec.es_activo is true");

    // Cada filtro de catálogo se resuelve a su id y se compara la columna FK, no
    // la etiqueta. Así un valor fuera de catálogo se rechaza (422) en vez de
    // llegar al SQL, y el mismo valor sirve aunque la etiqueta cambie de grafía
    // (`En seguimiento` / `En_seguimiento`).
    await filtrarPorCatalogo(
      client,
      where,
      bind,
      "estado",
      "estado",
      "c.estado_id",
      query.estado,
    );
  }

  await filtrarPorCatalogo(
    client,
    where,
    bind,
    "riesgo",
    "riesgo",
    "c.nivel_riesgo_id",
    query.riesgo,
  );
  await filtrarPorCatalogo(
    client,
    where,
    bind,
    "prioridad",
    "prioridad",
    "c.prioridad_id",
    query.prioridad,
  );
  await filtrarPorCatalogo(
    client,
    where,
    bind,
    "nivel",
    "nivelConflicto",
    "c.nivel_conflicto_id",
    query.nivel,
  );
  await filtrarPorCatalogo(
    client,
    where,
    bind,
    "alcance",
    "alcance",
    "ag.id",
    query.alcance,
  );
  await filtrarPorCatalogo(
    client,
    where,
    bind,
    "tematica",
    "tematica",
    "c.tematica_id",
    query.tematica,
  );

  // «Sin declarar» no es un valor del catálogo sino la ausencia de valor: se
  // reconoce aquí para poder aislar los casos con `naturaleza_id` nulo.
  const naturaleza = query.naturaleza?.trim();
  if (naturaleza) {
    const sinDeclarar = await client.query<{ coincide: boolean }>(
      `select core.normalizar_ref($1) = 'sindeclarar' as coincide`,
      [naturaleza],
    );
    if (sinDeclarar.rows[0]?.coincide) {
      where.push("c.naturaleza_id is null");
    } else {
      await filtrarPorCatalogo(
        client,
        where,
        bind,
        "naturaleza",
        "naturaleza",
        "c.naturaleza_id",
        naturaleza,
      );
    }
  }
  await filtrarPorCatalogo(
    client,
    where,
    bind,
    "unidad",
    "unidadResponsable",
    "c.unidad_responsable_id",
    query.unidad,
  );

  // «Sin región» complementa el filtro por región: un caso no puede estar en
  // ambos conjuntos, así que si llegaran los dos manda `sinregion`.
  if (esVerdadero(query.sinRegion)) {
    where.push(`coalesce(reg.nombre, rp.nombre) is null`);
  } else if (query.region) {
    const nombre = await resolverRegion(client, query.region);
    where.push(
      `core.normalizar_ref(coalesce(reg.nombre, rp.nombre)) = core.normalizar_ref(${bind(nombre)})`,
    );
  }

  return { where, params };
}

async function contarCasos(
  client: PoolClient,
  query: CaseListQuery,
): Promise<CaseConteos> {
  // Sin `estado` ni `abiertos`: los chips se pintan siempre sobre el resto de la
  // barra. Una sola consulta agregada, no una por chip.
  const { where, params } = await construirWhere(client, query, {
    sinEstado: true,
  });

  const sql = `
    select
      count(*)::int as todos,
      count(*) filter (where ec.es_activo is true)::int as abiertos,
      count(*) filter (where ec.codigo = 'Resuelto')::int as resueltos,
      count(*) filter (where ec.codigo = 'Archivado')::int as archivados
    ${CASE_FROM}
    ${where.length ? `where ${where.join(" and ")}` : ""}
  `;

  const row = (await client.query(sql, params)).rows[0] ?? {};
  return {
    todos: Number(row.todos ?? 0),
    abiertos: Number(row.abiertos ?? 0),
    resueltos: Number(row.resueltos ?? 0),
    archivados: Number(row.archivados ?? 0),
  };
}

export async function listCases(
  client: PoolClient,
  query: CaseListQuery,
): Promise<CaseListResult> {
  const { where, params } = await construirWhere(client, query);

  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 25)));
  const order = SORTS[query.sort ?? "recent"] ?? SORTS.recent;

  const limit = `$${params.length + 1}`;
  const offset = `$${params.length + 2}`;
  params.push(pageSize, (page - 1) * pageSize);

  const sql = `
    select ${CASE_SELECT},
           count(*) over()::int as total
    ${CASE_FROM}
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by ${order}
    limit ${limit} offset ${offset}
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
    geografia: {
      distrito: row.distrito,
      distritoUbigeo: row.distrito_ubigeo,
    },
    estado: row.estado,
    risk: row.risk,
    riskSource: "casos.nivel_riesgo_id",
    riskDerived: false,
    prioridad: row.prioridad,
    alcance: row.alcance,
    nivelConflicto: row.nivel_conflicto,
    stage: row.stage,
    tematica: row.tematica,
    naturaleza: row.naturaleza,
    subsector: row.subsector,
    unidadResponsable: row.unidad_responsable,
    origen: row.origen,
    clasificacion: row.clasificacion,
    fechaInicio: row.fecha_inicio,
    anuladoEn: row.anulado_en,
    motivoAnulacion: row.motivo_anulacion,
    anuladoPor: row.anulado_por,
    anuladoPorNombre: row.anulado_por_nombre,
    anulacionId: row.anulacion_id,
  }));

  const conteos = query.conteos ? await contarCasos(client, query) : undefined;

  return {
    items,
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
    // Aditivo: sólo aparece cuando la consulta pide `conteos=true`.
    ...(conteos ? { conteos } : {}),
  };
}

export type CaseActor = {
  id: string;
  nombre: string;
  /**
   * `core.actores` sólo guarda el nombre completo (`nombre_actual`); ni la tabla
   * viva ni `legacy.dim_actores` separan apellidos y nombres. Se devuelven nulos
   * y no se parten por espacios: el dato no existe.
   */
  apellidos: string | null;
  nombres: string | null;
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
  /** `core.caso_cronologia.actor_uid`; nulo si el hecho no tiene actor. */
  actorId: string | null;
  /** Nombre del actor del hecho resuelto desde `core.actores`. */
  actor: string | null;
};

/** Alerta vinculada al caso, con el estado derivado de su flujo de revisión. */
export type CaseAlert = {
  id: string;
  codigo: string;
  nivel: string | null;
  prioridad: string | null;
  estado: string;
  fechaReporte: string | null;
  anulada: boolean;
};

/** Tramo de `core.caso_estado_historial`. */
export type CaseStateHistoryEntry = {
  id: string;
  estado: string | null;
  desde: string | Date | null;
  hasta: string | Date | null;
  motivo: string | null;
  /** Nombre de `core.usuarios`; nulo cuando el tramo no registra usuario. */
  usuario: string | null;
};

/**
 * Conteos ya persistidos para el indicador de completitud (item 68). Son
 * recuentos y banderas: no hay puntuación ni porcentaje.
 */
export type CaseCompleteness = {
  hechos: { total: number; validados: number };
  actores: { total: number; conTipoYFuncion: number };
  demandas: { total: number; con3PCompletos: number };
  geografia: {
    tieneGeografia: boolean;
    regiones: number;
    distrito: string | null;
  };
  /**
   * Robustez de `analytics.vw_marco_situacional_robustez`. La vista devuelve una
   * fila por caso, así que `null` sólo ocurriría si la vista deja de cubrirlo.
   */
  marcoSituacional: {
    consistencia: boolean;
    correspondencia: boolean;
    coherenciaContextual: boolean;
    saturacion: boolean;
    trazabilidad: boolean;
  } | null;
};

export type CaseDemanda = {
  id: string;
  problema: string | null;
  propuesta: string | null;
  pedido: string | null;
  descripcion: string | null;
  estado: string;
  motivo: string | null;
  documento_origen_id: string | null;
  documento_origen_codigo: string | null;
  documento_origen_titulo: string | null;
};

export type CaseHito = {
  id: string;
  codigo: string;
  descripcion: string;
  fecha: string | null;
  fechaTexto: string | null;
  fechaReal: string | null;
  fechaRealTexto: string | null;
  estado: string | null;
  terminal: boolean;
  validacion: string | null;
  descripcionEvidencia: string | null;
  linkEvidencia: string | null;
  responsableTexto: string | null;
  responsableUsuarioId: string | null;
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
  alerts: CaseAlert[];
  stateHistory: CaseStateHistoryEntry[];
  completeness: CaseCompleteness;
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

  const [
    actors,
    events,
    demandas,
    commitments,
    documents,
    alerts,
    stateHistory,
    completeness,
  ] = await Promise.all([
    client.query(
      `select a.actor_uid as id,
              a.nombre_actual as nombre,
              -- Sin columnas separadas: el dato no existe, no se deriva.
              null::text as apellidos,
              null::text as nombres,
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
              ev.link_evidencia as evidencia,
              ev.actor_uid as actor_id,
              act.nombre_actual as actor
         from core.caso_cronologia ev
         left join core.cat_tipos_hecho th on th.id = ev.tipo_hecho_id
         left join core.actores act on act.actor_uid = ev.actor_uid
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
              d.motivo_no_atencion as motivo,
              d.documento_origen_id as documento_origen_id,
              doc.codigo as documento_origen_codigo,
              doc.titulo as documento_origen_titulo
         from core.demandas d
         left join core.documentos doc on doc.id = d.documento_origen_id
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
                         'codigo', h.codigo_hito,
                         'descripcion', h.descripcion_hito,
                         'fecha', to_char(h.fecha_vencimiento, 'YYYY-MM-DD'),
                         'fechaTexto', h.fecha_vencimiento_texto,
                         'fechaReal', to_char(h.fecha_real, 'YYYY-MM-DD'),
                         'fechaRealTexto', h.fecha_real_texto,
                         'estado', replace(eh.codigo, '_', ' '),
                         'terminal', coalesce(eh.es_terminal, false),
                         'validacion', h.validacion,
                         'descripcionEvidencia', h.descripcion_evidencia,
                         'linkEvidencia', h.link_evidencia,
                         'responsableTexto', h.responsable_texto,
                         'responsableUsuarioId', h.responsable_usuario_id::text
                       ) order by h.fecha_vencimiento nulls last, h.codigo_hito)
                  from core.hitos_compromiso h
                  left join core.cat_estados_hito eh on eh.id = h.estado_id
                 where h.compromiso_id = cmp.id
                   and h.anulado_en is null
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
    // El estado de la alerta no es columna: se deriva igual que en `alerts.ts`.
    client.query(
      `select a.id,
              a.codigo_alerta as codigo,
              na.nombre as nivel,
              pa.codigo as prioridad,
              case
                when a.paso_actual >= 5 then 'Atendida'
                when a.aprobada_por is not null then 'Aprobada'
                when a.validada_por is not null then 'Validada'
                when a.paso_actual >= 3 then 'En revisión'
                else 'Pendiente de revisión'
              end as estado,
              to_char(a.fecha_reporte, 'YYYY-MM-DD') as fecha_reporte,
              (a.anulado_en is not null) as anulada
         from core.alertas_tempranas a
         left join core.cat_prioridades_alerta pa on pa.id = a.prioridad_id
         left join core.cat_niveles_alerta na on na.id = a.nivel_alerta_id
        where a.caso_id = $1
        order by a.fecha_reporte desc nulls last, a.codigo_alerta`,
      [row.id],
    ),
    client.query(
      `select h.id,
              replace(ec.codigo, '_', ' ') as estado,
              h.desde,
              h.hasta,
              h.motivo,
              u.nombre as usuario
         from core.caso_estado_historial h
         left join core.cat_estados_caso ec on ec.id = h.estado_id
         left join core.usuarios u on u.id = h.usuario_id
        where h.caso_id = $1
        order by h.desde asc nulls last, h.id`,
      [row.id],
    ),
    // Conteos persistidos para el item 68; sin puntuación derivada.
    client.query(
      `select
              (select count(*)::int from core.caso_cronologia ev
                where ev.caso_id = c.id and ev.anulado_en is null) as hechos,
              (select count(*)::int from core.caso_cronologia ev
                where ev.caso_id = c.id and ev.anulado_en is null
                  and ev.es_validado_humano) as hechos_validados,
              (select count(*)::int from core.casos_actores ca
                where ca.caso_id = c.id) as actores_total,
              -- 'No determinado' ('categoria.vacia') es la ausencia declarada:
              -- no cuenta como función determinada.
              (select count(*)::int
                 from core.casos_actores ca
                 join core.actores a on a.actor_uid = ca.actor_id
                 left join core.cat_roles_actor ra on ra.id = a.rol_actor_id
                where ca.caso_id = c.id
                  and a.tipo_actor_id is not null
                  and a.rol_actor_id is not null
                  and coalesce(ra.codigo_legado, '') <> 'categoria.vacia')
                as actores_con_tipo_funcion,
              (select count(*)::int from core.demandas d
                where d.caso_id = c.id and d.anulado_en is null) as demandas_total,
              (select count(*)::int
                 from core.demandas d
                where d.caso_id = c.id and d.anulado_en is null
                  and nullif(btrim(d.problema_3p), '') is not null
                  and nullif(btrim(d.propuesta_3p), '') is not null
                  and nullif(btrim(d.pedido_3p), '') is not null)
                as demandas_con_3p,
              (select count(*)::int from core.caso_regiones cr
                where cr.caso_id = c.id) as regiones,
              dp.nombre as distrito,
              ms.consistencia,
              ms.correspondencia,
              ms.coherencia_contextual,
              ms.saturacion,
              ms.trazabilidad
         from core.casos c
         left join core.distritos dp on dp.id = c.distrito_principal_id
         left join analytics.vw_marco_situacional_robustez ms on ms.caso_id = c.id
        where c.codigo_caso = $1`,
      [code],
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
    geografia: {
      distrito: row.distrito,
      distritoUbigeo: row.distrito_ubigeo,
    },
    estado: row.estado,
    risk: row.risk,
    riskSource: "casos.nivel_riesgo_id",
    riskDerived: false,
    prioridad: row.prioridad,
    alcance: row.alcance,
    nivelConflicto: row.nivel_conflicto,
    stage: row.stage,
    tematica: row.tematica,
    naturaleza: row.naturaleza,
    subsector: row.subsector,
    unidadResponsable: row.unidad_responsable,
    origen: row.origen,
    clasificacion: row.clasificacion,
    fechaInicio: row.fecha_inicio,
    anuladoEn: row.anulado_en,
    motivoAnulacion: row.motivo_anulacion,
    anuladoPor: row.anulado_por,
    anuladoPorNombre: row.anulado_por_nombre,
    anulacionId: row.anulacion_id,
  };

  const c = completeness.rows[0];

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
    alerts: alerts.rows as CaseAlert[],
    stateHistory: stateHistory.rows as CaseStateHistoryEntry[],
    completeness: {
      hechos: { total: c.hechos, validados: c.hechos_validados },
      actores: {
        total: c.actores_total,
        conTipoYFuncion: c.actores_con_tipo_funcion,
      },
      demandas: { total: c.demandas_total, con3PCompletos: c.demandas_con_3p },
      geografia: {
        tieneGeografia: c.regiones > 0 || c.distrito !== null,
        regiones: c.regiones,
        distrito: c.distrito,
      },
      marcoSituacional:
        c.consistencia === null
          ? null
          : {
              consistencia: c.consistencia,
              correspondencia: c.correspondencia,
              coherenciaContextual: c.coherencia_contextual,
              saturacion: c.saturacion,
              trazabilidad: c.trazabilidad,
            },
    },
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
  "nivel_conflicto_id",
  "ciclo_intervencion_id",
  "tematica_id",
  "naturaleza_id",
  "subsector_id",
  "unidad_responsable_id",
  "region_principal_id",
  "distrito_principal_id",
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
  | "naturaleza"
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
  naturaleza: {
    table: "core.cat_naturalezas_caso",
    code: "codigo",
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

/**
 * El alcance es derivado (`core.alcance_caso`), no un campo de escritura. Se
 * rechaza cualquier intento de fijarlo para no dar la falsa impresión de que el
 * valor enviado se respeta: la columna `core.casos.alcance_id` ya no existe.
 */
function rechazarAlcanceManual(body: Record<string, unknown>): void {
  const alcance = readField(body, ["alcance", "alcanceId", "alcance_id"]);
  if (alcance.present) {
    throw new ApiError(
      422,
      "El alcance se deriva de las regiones del caso y no se puede fijar manualmente.",
      "ALCANCE_DERIVADO",
    );
  }
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

/**
 * Busca el id de un valor de catálogo por código o por etiqueta visible.
 * Las etiquetas llevan espacio y tilde (`En ejecución`), pero la API también
 * acepta `En_ejecucion`; `core.normalizar_ref` iguala ambas formas. Devuelve
 * `null` si el valor no existe: el llamador decide si eso es un error.
 */
async function lookupCatalog(
  client: PoolClient,
  key: CatalogKey,
  value: string,
): Promise<number | null> {
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
  return id === undefined || id === null ? null : Number(id);
}

/** Un filtro de listado fuera de catálogo se rechaza antes de llegar al SQL. */
function filtroInvalido(clave: string): never {
  throw new ApiError(
    422,
    `El filtro «${clave}» no coincide con el catálogo.`,
    "FILTRO_INVALIDO",
  );
}

async function resolverFiltroCatalogo(
  client: PoolClient,
  key: CatalogKey,
  clave: string,
  raw: string,
): Promise<number> {
  const value = raw.trim();
  if (!value) filtroInvalido(clave);
  const id = await lookupCatalog(client, key, value);
  if (id === null) filtroInvalido(clave);
  return id;
}

/**
 * Añade a `where` el filtro de un catálogo sólo si llegó un valor. La columna
 * es siempre una FK literal del repositorio; el valor va parametrizado.
 */
async function filtrarPorCatalogo(
  client: PoolClient,
  where: string[],
  bind: (value: unknown) => string,
  clave: string,
  key: CatalogKey,
  columna: string,
  raw: string | undefined,
): Promise<void> {
  if (!raw) return;
  const id = await resolverFiltroCatalogo(client, key, clave, raw);
  where.push(`${columna} = ${bind(id)}`);
}

/** El nombre canónico se toma de `core.regiones` para no comparar etiquetas. */
async function resolverRegion(
  client: PoolClient,
  raw: string,
): Promise<string> {
  const value = raw.trim();
  if (!value) filtroInvalido("region");
  const result = await client.query<{ nombre: string }>(
    `select nombre
       from core.regiones
      where core.normalizar_ref(nombre) = core.normalizar_ref($1)
      order by id
      limit 1`,
    [value],
  );
  const nombre = result.rows[0]?.nombre;
  if (!nombre) filtroInvalido("region");
  return nombre;
}

async function resolveCatalog(
  client: PoolClient,
  key: CatalogKey,
  raw: unknown,
): Promise<number> {
  if (typeof raw !== "string") invalid();
  const value = raw.trim();
  if (!value) invalid();
  const id = await lookupCatalog(client, key, value);
  if (id === null) invalid();
  return id;
}

async function catalogValue(
  client: PoolClient,
  key: CatalogKey,
  raw: unknown,
): Promise<number> {
  if (raw === null || raw === undefined) invalid();
  return resolveCatalog(client, key, raw);
}

/**
 * Catálogo anulable: `null`, `undefined` o cadena vacía significan «pendiente»
 * y se guardan como NULL. Cualquier otro valor debe existir en el catálogo;
 * si no, es un dato inválido (422) y no un borrado encubierto.
 *
 * `tematica` (migración 0003) y `naturaleza` (migración 40) son anulables: en
 * ambas, NULL significa «pendiente» y la interfaz lo pinta como tal. El resto de
 * columnas de catálogo de `core.casos` siguen siendo NOT NULL.
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

function enteroCrudo(raw: unknown): number {
  const numero =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim()
        ? Number(raw)
        : Number.NaN;
  if (!Number.isInteger(numero) || numero <= 0) invalid();
  return numero;
}

/**
 * El distrito se valida contra `core.distritos` (1 891 filas del INEI): un id
 * inexistente es 422 y no una clave ajena que reviente con un 500.
 */
async function resolveDistritoId(
  client: PoolClient,
  raw: unknown,
): Promise<number> {
  const id = enteroCrudo(raw);
  const found = await client.query(
    `select id from core.distritos where id = $1`,
    [id],
  );
  if (!found.rows[0]) {
    throw new ApiError(
      422,
      "El distrito indicado no existe en el catálogo del INEI.",
      "DISTRITO_INVALIDO",
    );
  }
  return id;
}

/**
 * Un lugar operativo —puerto, caleta, desembarcadero— no es un distrito aunque
 * esté dentro de uno: Matarani es puerto del distrito de Islay. Se guarda en
 * `core.caso_lugares` y nunca se degrada al distrito que lo contiene.
 */
async function resolveLugarId(
  client: PoolClient,
  raw: unknown,
): Promise<string> {
  if (typeof raw !== "string" || !raw.trim()) invalid();
  const id = raw.trim();
  // Sin castear a uuid: un id mal formado debe ser 422, no un error de tipo.
  const found = await client.query(
    `select id::text as id from territorio.lugares where id::text = $1`,
    [id],
  );
  const lugar = found.rows[0]?.id;
  if (!lugar) {
    throw new ApiError(
      422,
      "El lugar indicado no existe en el catálogo de territorios.",
      "LUGAR_INVALIDO",
    );
  }
  return String(lugar);
}

async function linkCaseLugar(
  client: PoolClient,
  casoId: string,
  lugarId: string,
): Promise<void> {
  await client.query(
    `insert into core.caso_lugares (caso_id, lugar_id) values ($1, $2)
     on conflict do nothing`,
    [casoId, lugarId],
  );
}

/**
 * `core.caso_lugares` es un conjunto, no una columna: un caso puede señalar el
 * puerto y la caleta donde ocurrió. El cuerpo admite una forma corta (`lugarId`,
 * la que usa el alta de la SPA) y una completa (`lugares`).
 */
function readLugarIds(body: Record<string, unknown>): {
  present: boolean;
  values: unknown[];
} {
  const multiple = readField(body, ["lugares", "lugarIds", "lugar_ids"]);
  const single = readField(body, ["lugarId", "lugar_id"]);
  if (!multiple.present && !single.present) {
    return { present: false, values: [] };
  }

  const values: unknown[] = [];
  if (multiple.present && multiple.value !== null) {
    if (!Array.isArray(multiple.value)) invalid();
    values.push(...multiple.value);
  }
  if (single.present && single.value !== null) values.push(single.value);
  return { present: true, values };
}

async function resolveLugarIds(
  client: PoolClient,
  values: readonly unknown[],
): Promise<string[]> {
  const out: string[] = [];
  const vistos = new Set<string>();
  for (const value of values) {
    const id = await resolveLugarId(client, value);
    if (vistos.has(id)) continue;
    vistos.add(id);
    out.push(id);
  }
  return out;
}

async function replaceCaseLugares(
  client: PoolClient,
  casoId: string,
  lugarIds: readonly string[],
): Promise<void> {
  await client.query(`delete from core.caso_lugares where caso_id = $1`, [
    casoId,
  ]);
  for (const lugarId of lugarIds) {
    await linkCaseLugar(client, casoId, lugarId);
  }
}

async function listCaseLugares(
  client: PoolClient,
  casoId: string,
): Promise<string[]> {
  const result = await client.query(
    `select lugar_id::text as id from core.caso_lugares where caso_id = $1 order by 1`,
    [casoId],
  );
  return result.rows.map((row) => String(row.id));
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
  rechazarAlcanceManual(body);

  const title = requiredText(
    readField(body, ["titulo", "nombreCaso", "nombre_caso"]).value,
    MAX_TITLE_LENGTH,
  );
  const regionNames = readRegionNames(body, true);
  if (!regionNames) invalid();
  const regions = await resolveRegions(client, regionNames);

  // El código del caso se compone con estos dos catálogos, así que se resuelven
  // antes de construir las columnas.
  //
  // `core.casos.tematica_id` es anulable (migración 0003): omitir la temática
  // guarda NULL y `core.siguiente_codigo_caso` emite el sufijo `GEN`
  // (`core.codigo_tematica(NULL) = 'GEN'`). No se siembra un «sin clasificar»
  // en el catálogo: el código del caso es inmutable y quedaría marcado para
  // siempre.
  const tematica = readField(body, ["tematica"]);
  const tematicaId = await resolveOptionalCatalog(
    client,
    "tematica",
    tematica.value,
  );
  // Naturaleza declarada: opcional. Omitirla guarda NULL («sin declarar»), que
  // es un estado legítimo y no un valor por defecto.
  const naturalezaId = await resolveOptionalCatalog(
    client,
    "naturaleza",
    readField(body, ["naturaleza"]).value,
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
    { column: "naturaleza_id", value: naturalezaId },
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

  // Ubicación del caso. El distrito es del catálogo INEI y el lugar es un punto
  // operativo dentro de un distrito (Matarani es puerto de Islay): se guardan en
  // columnas distintas para no confundir un puerto con un distrito.
  const distrito = readField(body, [
    "distritoPrincipalId",
    "distrito_principal_id",
    "distritoId",
    "distrito_id",
  ]);
  if (distrito.present && distrito.value !== null) {
    fields.push({
      column: "distrito_principal_id",
      value: await resolveDistritoId(client, distrito.value),
    });
  }

  const lugar = readLugarIds(body);
  const lugarIds = lugar.present
    ? await resolveLugarIds(client, lugar.values)
    : null;

  const row = await insertCaseRow(client, subsectorId, tematicaId, (codigo) => [
    { column: "codigo_caso", value: codigo },
    ...fields,
  ]);

  await replaceCaseRegions(client, String(row.id), regions);
  if (lugarIds) await replaceCaseLugares(client, String(row.id), lugarIds);

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
      ...(lugarIds ? { lugares: lugarIds } : {}),
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
  rechazarAlcanceManual(body);

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
    add(
      "tematica_id",
      await resolveOptionalCatalog(client, "tematica", tematica.value),
    );
  }

  const naturaleza = readField(body, ["naturaleza"]);
  if (naturaleza.present) {
    add(
      "naturaleza_id",
      await resolveOptionalCatalog(client, "naturaleza", naturaleza.value),
    );
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

  // Ubicación: `null` limpia la relación, igual que `prioridad` o `ciclo`.
  const distrito = readField(body, [
    "distritoPrincipalId",
    "distrito_principal_id",
    "distritoId",
    "distrito_id",
  ]);
  if (distrito.present) {
    add(
      "distrito_principal_id",
      distrito.value === null
        ? null
        : await resolveDistritoId(client, distrito.value),
    );
  }

  const lugares = readLugarIds(body);
  let lugarIds: string[] | null = null;
  let previousLugares: string[] = [];
  if (lugares.present) {
    previousLugares = await listCaseLugares(client, String(row.id));
    lugarIds = await resolveLugarIds(client, lugares.values);
  }

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
  if (lugarIds) await replaceCaseLugares(client, String(row.id), lugarIds);

  const antes: Record<string, unknown> = pick(row, CASE_WRITE_COLUMNS);
  const despues: Record<string, unknown> = pick(updatedRow, CASE_WRITE_COLUMNS);
  if (regions) {
    antes.regiones = previousRegions;
    despues.regiones = regions.map((region) => region.nombre);
  }
  if (lugarIds) {
    antes.lugares = previousLugares;
    despues.lugares = lugarIds;
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
