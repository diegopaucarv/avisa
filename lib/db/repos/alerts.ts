import type { PoolClient } from "pg";
import { auditChange } from "../audit";
import { filtroTexto } from "../busqueda";
import { nextSequentialCode } from "../codes";
import { ApiError } from "../errors";
import { anularRegistro, restaurarRegistro } from "./anulacion";

/**
 * El estado no existe como columna: el legado sólo guarda `paso_actual`, así que
 * se deriva en SQL para que la lista y los filtros usen exactamente el mismo
 * criterio. Cuando el paso llega a 5 la alerta ya está atendida aunque
 * `aprobada_por` / `validada_por` sigan nulos.
 *
 * Se exporta para que la búsqueda de duplicados de alertas pinte el mismo
 * estado derivado sin duplicar el `case` y arriesgar que diverjan.
 */
export const ALERT_STATE = `case
    when a.paso_actual >= 5 then 'Atendida'
    when a.aprobada_por is not null then 'Aprobada'
    when a.validada_por is not null then 'Validada'
    when a.paso_actual >= 3 then 'En revisión'
    else 'Pendiente de revisión'
  end`;

const ALERT_ATENDIDA = `(a.paso_actual >= 5)`;

/**
 * Eje de riesgo de la alerta: el declarado en `nivel_riesgo_id` y, si falta, el
 * del caso vinculado ("riesgo heredado del caso"). La SPA pinta esta etiqueta
 * y filtra por ella, así que filtro, orden y select comparten la expresión.
 */
const ALERT_RIESGO = `coalesce(nr.codigo, nrc.codigo)`;
const ALERT_RIESGO_ORDEN = `coalesce(nr.orden, nrc.orden)`;

/**
 * Proyección común del listado y del detalle. Incluye el triaje persistido
 * (`core.alerta_triaje`) para que la ficha muestre el motivo del descarte y la
 * alerta duplicada sin una segunda consulta.
 */
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
  ${ALERT_RIESGO} as riesgo,
  ag.codigo as alcance,
  a.paso_actual::int as paso_actual,
  a.estado_legado as estado_legado,
  a.visibilidad,
  to_char(a.fecha_reporte, 'YYYY-MM-DD') as fecha_reporte,
  to_char(a.fecha_validacion, 'YYYY-MM-DD') as fecha_validacion,
  to_char(a.aprobada_en, 'YYYY-MM-DD') as fecha_aprobacion,
  a.aprobada_por as aprobada_por,
  a.validada_por as validada_por,
  ar.ultimo_revisor,
  ar.historial,
  a.updated_at as ultima_modificacion,
  mu.nombre as modificado_por,
  a.descripcion_riesgo,
  a.hechos_recientes,
  a.situacion_actual,
  a.acciones_oaipcs,
  a.riesgos_json as riesgos,
  a.acciones_sugeridas_json as acciones_sugeridas,
  a.actores_clave,
  a.demandas_inmediatas,
  a.plantilla_whatsapp,
  a.fuente_tipo,
  a.fuente_descripcion,
  a.fuente_url,
  a.distrito_id as distrito_id,
  d.nombre as distrito,
  concat_ws(' · ', d.nombre, pd.nombre, rd.nombre) as distrito_ruta,
  coalesce(rr.nombre, rd.nombre) as region,
  coalesce(pr.nombre, pd.nombre) as provincia,
  c.distrito_principal_id as caso_distrito_id,
  cd.nombre as caso_distrito,
  concat_ws(' · ', cd.nombre, pcd.nombre, rcd.nombre) as caso_distrito_ruta,
  case
    when a.distrito_id is null or c.distrito_principal_id is null then null
    else a.distrito_id = c.distrito_principal_id
  end as distrito_coincide_con_caso,
  ss.nombre as subsector,
  a.mesa_id,
  a.sectorista_usuario_id,
  coalesce(nsr.nombre, su.nombre) as sectorista,
  a.origen_dato as origen,
  a.confidence::float8 as confianza,
  a.es_validado_humano as validado,
  a.nivel_clasificacion::int as clasificacion,
  a.anulado_en as anulado_en,
  a.motivo_anulacion as motivo_anulacion,
  a.anulado_por as anulado_por,
  ua.nombre as anulado_por_nombre,
  a.anulacion_id as anulacion_id,
  a.archivado_en as archivado_en,
  a.motivo_archivo as motivo_archivo,
  a.archivado_por as archivado_por,
  ur.nombre as archivado_por_nombre,
  t.estado as triaje_estado,
  t.motivo as motivo_descarte,
  dup.codigo_alerta as duplicada_de_codigo,
  ${ALERT_STATE} as estado,
  ${ALERT_ATENDIDA} as atendida
`;

// El triaje es una fila por alerta (`unique (alerta_id)`), así que el join no
// puede multiplicar las filas del listado; `dup` sólo aporta el código legible
// de la alerta de la que ésta es duplicada.
const ALERT_FROM = `
  from core.alertas_tempranas a
  left join core.casos c on c.id = a.caso_id
  left join core.cat_prioridades_alerta pa on pa.id = a.prioridad_id
  left join core.cat_niveles_alerta na on na.id = a.nivel_alerta_id
  left join core.cat_niveles_riesgo nr on nr.id = a.nivel_riesgo_id
  left join core.cat_niveles_riesgo nrc on nrc.id = c.nivel_riesgo_id
  left join core.cat_alcances_alerta ag on ag.id = a.alcance_id
  left join core.distritos d on d.id = a.distrito_id
  left join core.provincias pd on pd.id = d.provincia_id
  left join core.regiones rd on rd.id = pd.region_id
  left join core.regiones rr on rr.id = a.region_id
  left join core.provincias pr on pr.id = a.provincia_id
  left join core.distritos cd on cd.id = c.distrito_principal_id
  left join core.provincias pcd on pcd.id = cd.provincia_id
  left join core.regiones rcd on rcd.id = pcd.region_id
  left join core.cat_subsectores ss on ss.id = a.subsector_id
  left join core.usuarios ua on ua.id = a.anulado_por
  left join core.usuarios ur on ur.id = a.archivado_por
  left join core.usuarios mu on mu.id = a.updated_by
  left join core.usuarios su on su.id = a.sectorista_usuario_id
  -- El nombre del sectorista no se puede leer con el join a core.usuarios
  -- cuando el rol de la sesión no es administrador: p18_usuarios_sel sólo deja
  -- ver la fila propia. core.nombres_sectoristas() (migración 74) es security
  -- definer y expone únicamente (id, nombre) de los sectoristas activos, así que
  -- resuelve el nombre para cualquier rol. Se deja el join original como
  -- respaldo por si el asignado no es un sectorista vigente.
  left join core.nombres_sectoristas() nsr on nsr.id = a.sectorista_usuario_id
  left join core.alerta_triaje t on t.alerta_id = a.id
  left join core.alertas_tempranas dup on dup.id = t.duplicada_de
  left join lateral (
    select (array_agg(coalesce(urv.nombre, 'Sin identificar') order by r.created_at desc))[1] as ultimo_revisor,
           json_agg(
             json_build_object(
               'autor', coalesce(urv.nombre, 'Sin identificar'),
               'fecha', to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               'accion', r.accion
             ) order by r.created_at desc
           ) as historial
      from core.alerta_revision r
      left join core.usuarios urv on urv.id = r.usuario_id
     where r.alerta_id = a.id
  ) ar on true
`;

export type AlertListQuery = {
  /**
   * Búsqueda libre por código, título, descripción del riesgo, nombre del
   * sectorista asignado y último revisor. No hay parámetro nuevo: comparte el
   * mismo `q` que ya usaba el listado.
   *
   * El sectorista se resuelve con `core.nombres_sectoristas()` (migración 74),
   * que es `security definer` y por eso funciona para todos los roles. El
   * último revisor, en cambio, sale del historial contra `core.usuarios`, que
   * la RLS sólo deja leer ajeno a `administrador`: para el resto llega como
   * «Sin identificar». El `coalesce` del filtro evita que el nulo apague el
   * resto del `or`.
   */
  q?: string;
  caso?: string;
  /**
   * `true` sólo alertas sin caso asignado; `false`, sólo con caso. Mismo
   * parámetro que el listado de demandas, para no inventar otro vocabulario.
   */
  sinCaso?: string;
  prioridad?: string;
  /**
   * Código de `core.cat_niveles_riesgo` (`Bajo` · `Medio` · `Alto`). Compara
   * contra el riesgo declarado o, en su defecto, el heredado del caso.
   */
  riesgo?: string;
  nivel?: string;
  estado?: string;
  /**
   * `core.distritos.id` exacto. A diferencia de `q`, no busca por prefijo: el
   * filtro llega del buscador territorial y ya trae el id resuelto.
   */
  distritoId?: string;
  sort?: string;
  /**
   * `true` lista la papelera: añade `anulado_en is not null`. Requiere abrir
   * la RLS con `withSession(..., { verAnulados: true })`; si no, la política
   * sigue ocultando las filas y el listado sale vacío.
   */
  incluirAnulados?: boolean;
  /**
   * `true` lista sólo las alertas archivadas; por omisión el listado de trabajo
   * oculta las archivadas (`archivado_en is null`). Archivar no es anular.
   *
   * Acepta también su forma en texto porque la exportación reenvía los filtros
   * tal como llegan en la URL (`archivados=true|false`).
   */
  incluirArchivados?: boolean | string;
  page?: number;
  pageSize?: number;
};

export type AlertRevision = {
  /** Nombre legible de quien revisó; `'Sin identificar'` si no se resuelve. */
  autor: string;
  /** Instante de la revisión en ISO 8601 UTC. */
  fecha: string;
  /** Acción registrada (validar, aprobar, solicitar modificación...). */
  accion: string | null;
};

/** Actor vigente del caso vinculado; sólo lo puebla el detalle de la alerta. */
export type AlertCasoActor = {
  id: string | null;
  nombre: string;
  cargo: string | null;
  rol: string | null;
};

/** Demanda vigente del caso vinculado; sólo la puebla el detalle de la alerta. */
export type AlertCasoDemanda = {
  id: string | null;
  descripcion: string;
  estado: string | null;
};

export type AlertItem = {
  id: string;
  codigo: string;
  titulo: string | null;
  casoId: string | null;
  casoCode: string | null;
  casoTitulo: string | null;
  /** Resumen ejecutivo del caso vinculado (`core.casos.resumen_ejecutivo`). */
  casoResumen: string | null;
  /** Actores vigentes del caso vinculado (tope 20, orden estable). */
  casoActores: AlertCasoActor[];
  /** Demandas vigentes del caso vinculado (tope 20, orden estable). */
  casoDemandas: AlertCasoDemanda[];
  /** Riesgo declarado o heredado del caso (`core.cat_niveles_riesgo.codigo`). */
  riesgo: string | null;
  /** Granularidad geográfica declarada (`core.cat_alcances_alerta.codigo`). */
  alcance: string | null;
  /** Región declarada o, si falta, derivada del distrito de la alerta. */
  region: string | null;
  /** Provincia declarada o, si falta, derivada del distrito de la alerta. */
  provincia: string | null;
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
  /** Quién revisó por última vez (última fila de `core.alerta_revision`). */
  ultimoRevisor: string | null;
  /** Instante de la última modificación del contenido o los metadatos. */
  ultimaModificacion: string | null;
  /** Quién modificó por última vez la fila. */
  modificadoPor: string | null;
  /** Revisiones registradas, de la más reciente a la más antigua. */
  historial: AlertRevision[];
  descripcionRiesgo: string | null;
  hechosRecientes: string | null;
  situacionActual: string | null;
  accionesOaipcs: string | null;
  riesgos: unknown;
  accionesSugeridas: unknown;
  /** Actores clave del territorio o del sector (`jsonb` → lista de textos). */
  actoresClave: unknown;
  /** Demandas inmediatas recogidas en campo (`jsonb` → lista de textos). */
  demandasInmediatas: unknown;
  /** Plantilla de WhatsApp editada a mano; `null` usa la generada. */
  plantillaWhatsapp: string | null;
  fuenteTipo: string | null;
  fuenteDescripcion: string | null;
  fuenteUrl: string | null;
  /** `core.alertas_tempranas.distrito_id`; `null` si la alerta no declara distrito. */
  distritoId: number | null;
  distrito: string | null;
  /** «Distrito · Provincia · Región», para desambiguar nombres repetidos. */
  distritoRuta: string | null;
  /** Distrito principal del caso vinculado (`core.casos.distrito_principal_id`). */
  casoDistritoId: number | null;
  casoDistrito: string | null;
  casoDistritoRuta: string | null;
  /**
   * `null` cuando falta uno de los dos distritos: no hay coincidencia que
   * afirmar. `false` no es un error de carga por sí mismo —una alerta puede
   * ocurrir en otro punto del territorio que el expediente—, pero sí exige
   * confirmación antes de guardar un cambio de distrito.
   */
  distritoCoincideConCaso: boolean | null;
  subsector: string | null;
  mesaId: string | null;
  sectoristaUsuarioId: string | null;
  /** Nombre legible del sectorista asignado; `null` si no se resuelve. */
  sectorista: string | null;
  origen: string;
  confianza: number | null;
  validado: boolean;
  clasificacion: number;
  estado: string;
  atendida: boolean;
  /**
   * Estado de triaje persistido en `core.alerta_triaje`; `null` cuando la
   * alerta todavía no tiene fila (equivale a «pendiente» en la cola RED-RADAR).
   */
  triajeEstado: string | null;
  /** Motivo declarado al descartar o marcar la alerta como duplicada. */
  motivoDescarte: string | null;
  /** Código de la alerta de la que ésta es duplicada, si se declaró. */
  duplicadaDeCodigo: string | null;
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
  /**
   * Marca de archivo (ISO 8601). Archivada no es anulada: la fila se conserva
   * y sigue siendo consultable, pero sale de las colas de trabajo.
   */
  archivadoEn: string | null;
  /** Motivo declarado al archivar; sólo se puebla en las archivadas. */
  motivoArchivo: string | null;
  /** Usuario que archivó (id). */
  archivadoPor: string | null;
  /** Nombre legible de quien archivó; `null` si no se puede resolver. */
  archivadoPorNombre: string | null;
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
  // «Riesgo (alto primero)»: `orden` 3 es Alto y 1 Bajo; lo desconocido al final.
  riesgo: `${ALERT_RIESGO_ORDEN} desc nulls last, a.fecha_reporte desc nulls last, a.codigo_alerta asc`,
};

// Sólo estos estados derivados se pueden filtrar; cualquier otro valor se ignora.
// «En revisión» se emite desde `ALERT_STATE`, así que también se ofrece.
const ESTADOS = new Set([
  "Atendida",
  "Aprobada",
  "Validada",
  "En revisión",
  "Pendiente de revisión",
]);

/** Texto recortado o `null`; tolera que el agregado JSON traiga nulos. */
function textoONull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mapCasoActores(value: unknown): AlertCasoActor[] {
  if (!Array.isArray(value)) return [];
  const actores: AlertCasoActor[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const nombre = textoONull(row.nombre);
    if (!nombre) continue;
    actores.push({
      id: typeof row.id === "string" ? row.id : null,
      nombre,
      cargo: textoONull(row.cargo),
      rol: textoONull(row.rol),
    });
  }
  return actores;
}

function mapCasoDemandas(value: unknown): AlertCasoDemanda[] {
  if (!Array.isArray(value)) return [];
  const demandas: AlertCasoDemanda[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const descripcion = textoONull(row.descripcion);
    if (!descripcion) continue;
    demandas.push({
      id: typeof row.id === "string" ? row.id : null,
      descripcion,
      estado: textoONull(row.estado),
    });
  }
  return demandas;
}

function mapAlert(row: Record<string, any>): AlertItem {
  return {
    id: row.id,
    codigo: row.codigo,
    titulo: row.titulo,
    casoId: row.caso_id,
    casoCode: row.caso_code,
    casoTitulo: row.caso_titulo,
    casoResumen: textoONull(row.caso_resumen),
    casoActores: mapCasoActores(row.caso_actores),
    casoDemandas: mapCasoDemandas(row.caso_demandas),
    riesgo: row.riesgo,
    alcance: row.alcance,
    region: row.region,
    provincia: row.provincia,
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
    ultimoRevisor: row.ultimo_revisor,
    ultimaModificacion: isoOrNull(row.ultima_modificacion),
    modificadoPor: row.modificado_por,
    historial: Array.isArray(row.historial) ? row.historial : [],
    descripcionRiesgo: row.descripcion_riesgo,
    hechosRecientes: row.hechos_recientes,
    situacionActual: row.situacion_actual,
    accionesOaipcs: row.acciones_oaipcs,
    riesgos: row.riesgos,
    accionesSugeridas: row.acciones_sugeridas,
    actoresClave: row.actores_clave,
    demandasInmediatas: row.demandas_inmediatas,
    plantillaWhatsapp: row.plantilla_whatsapp,
    fuenteTipo: row.fuente_tipo,
    fuenteDescripcion: row.fuente_descripcion,
    fuenteUrl: row.fuente_url,
    distritoId: row.distrito_id,
    distrito: row.distrito,
    distritoRuta: row.distrito_ruta,
    casoDistritoId: row.caso_distrito_id,
    casoDistrito: row.caso_distrito,
    casoDistritoRuta: row.caso_distrito_ruta,
    distritoCoincideConCaso: row.distrito_coincide_con_caso,
    subsector: row.subsector,
    mesaId: row.mesa_id,
    sectoristaUsuarioId: row.sectorista_usuario_id,
    sectorista: row.sectorista,
    origen: row.origen,
    confianza: row.confianza,
    validado: row.validado,
    clasificacion: row.clasificacion,
    estado: row.estado,
    atendida: row.atendida,
    triajeEstado: row.triaje_estado,
    motivoDescarte: row.motivo_descarte,
    duplicadaDeCodigo: row.duplicada_de_codigo,
    anuladoEn: isoOrNull(row.anulado_en),
    motivoAnulacion: row.motivo_anulacion,
    anuladoPor: row.anulado_por,
    anuladoPorNombre: row.anulado_por_nombre,
    anulacionId: row.anulacion_id,
    archivadoEn: isoOrNull(row.archivado_en),
    motivoArchivo: row.motivo_archivo,
    archivadoPor: row.archivado_por,
    archivadoPorNombre: row.archivado_por_nombre,
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

  // Un solo término para todo el listado: código, título, descripción del
  // riesgo, sectorista asignado y último revisor. Los `coalesce` no son
  // decorativos: la RLS de `core.usuarios` deja nombres en nulo y un nulo en el
  // `or` no rompe el resultado, pero sí apaga esa columna; con el coalesce el
  // `or` conserva las demás.
  //
  // El sectorista se busca por la función de la migración 74 (no por el join a
  // `core.usuarios`) porque el rol `sectorista` o `direccion_oaipcs` no ve la
  // fila del compañero. El último revisor sigue viniendo del historial, que aún
  // depende de esa RLS: sólo acierta para `administrador`. Ver pendiente en
  // `docs/06_operacion/migraciones-neon-estado.md`.
  const porTexto = filtroTexto(
    [
      "a.codigo_alerta",
      "a.titulo",
      "coalesce(a.descripcion_riesgo, '')",
      "coalesce(nsr.nombre, su.nombre, '')",
      "coalesce(ar.ultimo_revisor, '')",
    ],
    query.q,
    bind,
  );
  if (porTexto) where.push(porTexto);
  if (query.caso) where.push(`c.codigo_caso = ${bind(query.caso)}`);
  if (query.sinCaso === "true") where.push("a.caso_id is null");
  else if (query.sinCaso === "false") where.push("a.caso_id is not null");
  if (query.prioridad) where.push(`pa.codigo = ${bind(query.prioridad)}`);
  if (query.riesgo) where.push(`${ALERT_RIESGO} = ${bind(query.riesgo)}`);
  if (query.nivel) where.push(`na.codigo_legado = ${bind(query.nivel)}`);
  const distritoId = query.distritoId?.trim();
  if (distritoId) {
    const id = Number(distritoId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError(
        422,
        "El filtro de distrito debe ser un id numérico del catálogo INEI.",
        "DISTRITO_INVALIDO",
      );
    }
    where.push(`a.distrito_id = ${bind(id)}`);
  }
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

  // Archivo: no es un estado ni un borrado lógico. Por omisión las archivadas
  // salen de la cola de trabajo; `archivados=true` las lista. La papelera las
  // sigue mostrando porque ya está acotada a las anuladas.
  if (query.incluirArchivados === true || query.incluirArchivados === "true") {
    where.push("a.archivado_en is not null");
  } else if (!query.incluirAnulados) {
    where.push("a.archivado_en is null");
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
  //
  // Los datos heredados del caso vinculado se agregan aquí (y sólo aquí): la
  // lista no necesita cargar actores ni demandas. Los topes de 20 y los órdenes
  // se aplican dentro de cada subconsulta para que el resultado sea estable.
  const result = await client.query(
    `select ${ALERT_SELECT},
            c.resumen_ejecutivo as caso_resumen,
            (
              select coalesce(json_agg(
                       json_build_object(
                         'id', x.id,
                         'nombre', x.nombre,
                         'cargo', x.cargo,
                         'rol', x.rol
                       ) order by x.orden
                     ), '[]'::json)
                from (
                  select ac.actor_uid as id,
                         ac.nombre_actual as nombre,
                         ac.cargo_actual as cargo,
                         ca.rol_en_caso as rol,
                         row_number() over (
                           order by ca.nivel_influencia desc nulls last,
                                    ac.nombre_actual asc,
                                    ac.actor_uid asc
                         ) as orden
                    from core.casos_actores ca
                    join core.actores ac on ac.actor_uid = ca.actor_id
                   where ca.caso_id = a.caso_id
                     and ca.anulado_en is null
                   order by ca.nivel_influencia desc nulls last,
                            ac.nombre_actual asc,
                            ac.actor_uid asc
                   limit 20
                ) x
            ) as caso_actores,
            (
              select coalesce(json_agg(
                       json_build_object(
                         'id', x.id,
                         'descripcion', x.descripcion,
                         'estado', x.estado
                       ) order by x.orden
                     ), '[]'::json)
                from (
                  select d.id,
                         coalesce(
                           nullif(btrim(d.descripcion_demanda), ''),
                           nullif(btrim(d.pedido_3p), ''),
                           nullif(btrim(d.problema_3p), ''),
                           nullif(btrim(d.propuesta_3p), '')
                         ) as descripcion,
                         replace(d.estado_atencion, '_', ' ') as estado,
                         row_number() over (
                           order by d.fecha_registro desc nulls last,
                                    d.created_at desc,
                                    d.id asc
                         ) as orden
                    from core.demandas d
                   where d.caso_id = a.caso_id
                     and d.anulado_en is null
                   order by d.fecha_registro desc nulls last,
                            d.created_at desc,
                            d.id asc
                   limit 20
                ) x
               where x.descripcion is not null
            ) as caso_demandas
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
const MAX_MOTIVO_LENGTH = 500;
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
  "nivel_riesgo_id",
  "alcance_id",
  "region_id",
  "provincia_id",
  "titulo",
  "descripcion_riesgo",
  "hechos_recientes",
  "situacion_actual",
  "acciones_oaipcs",
  "riesgos_json",
  "acciones_sugeridas_json",
  "actores_clave",
  "demandas_inmediatas",
  "plantilla_whatsapp",
  "fuente_tipo",
  "fuente_descripcion",
  "fuente_url",
  "distrito_id",
  "subsector_id",
  "fecha_reporte",
  "paso_actual",
  "visibilidad",
  "estado_legado",
  "archivado_en",
  "archivado_por",
  "motivo_archivo",
] as const;

type AlertCatalogKey =
  "prioridad" | "nivel" | "riesgo" | "alcance" | "subsector";

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
  riesgo: { table: "core.cat_niveles_riesgo", code: "codigo" },
  alcance: { table: "core.cat_alcances_alerta", code: "codigo" },
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

/**
 * Región por id o por nombre. La interfaz manda el nombre del selector
 * (`Piura`, `Áncash`); `core.normalizar_ref` iguala tildes y mayúsculas.
 */
async function resolveRegionId(
  client: PoolClient,
  raw: unknown,
): Promise<number> {
  if (typeof raw === "number" && Number.isInteger(raw)) {
    const byId = await client.query(
      `select id from core.regiones where id = $1`,
      [raw],
    );
    if (!byId.rows[0]) invalid();
    return raw;
  }
  if (typeof raw !== "string") invalid();
  const nombre = raw.trim();
  if (!nombre) invalid();
  const result = await client.query(
    `select id from core.regiones
      where core.normalizar_ref(nombre) = core.normalizar_ref($1)
      order by id limit 1`,
    [nombre],
  );
  const id = result.rows[0]?.id;
  if (id === undefined || id === null) invalid();
  return Number(id);
}

/**
 * Provincia por id o por nombre. El nombre de provincia no es único en todo el
 * país (`UNIQUE (region_id, nombre)`), así que se acota a la región cuando se
 * conoce; sin ella se toma la primera coincidencia, como `resolveCatalog`.
 */
async function resolveProvinciaId(
  client: PoolClient,
  raw: unknown,
  regionId: number | null = null,
): Promise<number> {
  if (typeof raw === "number" && Number.isInteger(raw)) {
    const result = await client.query(
      `select id from core.provincias
        where id = $1${regionId === null ? "" : " and region_id = $2"}`,
      regionId === null ? [raw] : [raw, regionId],
    );
    if (!result.rows[0]) invalid();
    return raw;
  }
  if (typeof raw !== "string") invalid();
  const nombre = raw.trim();
  if (!nombre) invalid();
  const params: unknown[] = [nombre];
  let filtro = "";
  if (regionId !== null) {
    params.push(regionId);
    filtro = " and region_id = $2";
  }
  const result = await client.query(
    `select id from core.provincias
      where core.normalizar_ref(nombre) = core.normalizar_ref($1)${filtro}
      order by id limit 1`,
    params,
  );
  const id = result.rows[0]?.id;
  if (id === undefined || id === null) invalid();
  return Number(id);
}

/**
 * Distrito principal del caso, para heredarlo cuando la alerta no declara uno.
 *
 * La herencia sólo cubre el hueco real. Medición sobre la carga local (76
 * alertas vivas, 18 con caso y sin distrito): 4 se benefician y las otras 14
 * pertenecen a casos de alcance nacional que tampoco tienen distrito, de modo
 * que heredar no inventaría dato. Nunca se sobrescribe un distrito declarado:
 * las alertas que ocurren en otro territorio que el expediente son legítimas
 * (movilización en la sede central frente a proyecto en Chilca).
 */
async function caseDistritoId(
  client: PoolClient,
  casoId: string,
): Promise<number | null> {
  const result = await client.query(
    `select distrito_principal_id as distrito_id from core.casos where id = $1`,
    [casoId],
  );
  return result.rows[0]?.distrito_id ?? null;
}

const MAX_REVISION_ACCION_LENGTH = 255;

/**
 * Etiqueta legible de una transición de paso. El PATCH de revisión de la SPA
 * manda sólo `pasoActual` (y opcionalmente `motivo`), así que la acción se
 * deduce del paso previo y del destino.
 */
function revisionAccion(
  desde: unknown,
  hasta: number,
  motivo: string | null,
): string {
  const origen = typeof desde === "number" ? desde : null;
  let accion: string;
  if (hasta === 2) {
    if ((origen ?? 1) >= 3) {
      accion = motivo
        ? "Solicitó modificación"
        : "Devolvió a validación previa";
    } else {
      accion = "Envió a validación previa";
    }
  } else if (hasta === 3) {
    accion = "Aprobó la alerta";
  } else if (hasta === 1) {
    accion = "Devolvió a elaboración";
  } else if (hasta === 4) {
    accion = "Ordenó la remisión";
  } else if (hasta === 5) {
    accion = "Archivó la alerta";
  } else {
    accion = `Cambió el paso a ${hasta}`;
  }
  const texto = motivo ? `${accion}: ${motivo}` : accion;
  return texto.slice(0, MAX_REVISION_ACCION_LENGTH);
}

async function registrarRevision(
  client: PoolClient,
  alertaId: string,
  usuarioId: string,
  accion: string,
): Promise<void> {
  await client.query(
    `insert into core.alerta_revision (alerta_id, usuario_id, accion)
     values ($1::uuid, $2::uuid, $3)`,
    [alertaId, usuarioId, accion],
  );
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
  // La prioridad se retiró de la interfaz: si no llega, la alerta se guarda sin
  // ella. Se sigue aceptando por compatibilidad con clientes antiguos.
  const prioridad = readField(body, ["prioridad", "priority"]);

  const paso = readField(body, ["pasoActual", "paso_actual"]);
  const visibilidad = readField(body, ["visibilidad"]);

  const fields: SqlField[] = [{ column: "titulo", value: titulo }];
  if (prioridad.present && prioridad.value !== null) {
    fields.push({
      column: "prioridad_id",
      value: await resolveCatalog(client, "prioridad", prioridad.value),
    });
  }
  fields.push(
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
  );

  const caso = readField(body, ["casoCode", "caso", "caso_codigo"]);
  let casoId: string | null = null;
  if (caso.present && caso.value !== null) {
    casoId = await resolveCaseId(client, caso.value);
    fields.push({ column: "caso_id", value: casoId });
  }

  const nivel = readField(body, ["nivel", "nivelAlerta"]);
  if (nivel.present && nivel.value !== null) {
    fields.push({
      column: "nivel_alerta_id",
      value: await resolveCatalog(client, "nivel", nivel.value),
    });
  }

  const riesgo = readField(body, ["riesgo"]);
  if (riesgo.present && riesgo.value !== null) {
    fields.push({
      column: "nivel_riesgo_id",
      value: await resolveCatalog(client, "riesgo", riesgo.value),
    });
  }

  const alcance = readField(body, ["alcance"]);
  if (alcance.present && alcance.value !== null) {
    fields.push({
      column: "alcance_id",
      value: await resolveCatalog(client, "alcance", alcance.value),
    });
  }

  // Región y provincia declaradas. Si faltan, la lectura las deriva del
  // distrito; si llegan, se guardan y tienen prioridad sobre la derivación.
  const region = readField(body, ["region"]);
  let regionId: number | null = null;
  if (region.present && region.value !== null) {
    regionId = await resolveRegionId(client, region.value);
    fields.push({ column: "region_id", value: regionId });
  }

  const provincia = readField(body, ["provincia"]);
  if (provincia.present && provincia.value !== null) {
    fields.push({
      column: "provincia_id",
      value: await resolveProvinciaId(client, provincia.value, regionId),
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

  const actores = readField(body, ["actoresClave", "actores_clave"]);
  if (actores.present) {
    fields.push({
      column: "actores_clave",
      value: jsonValue(actores.value),
      cast: "jsonb",
    });
  }

  const demandasInmediatas = readField(body, [
    "demandasInmediatas",
    "demandas_inmediatas",
  ]);
  if (demandasInmediatas.present) {
    fields.push({
      column: "demandas_inmediatas",
      value: jsonValue(demandasInmediatas.value),
      cast: "jsonb",
    });
  }

  const plantilla = readField(body, [
    "plantillaWhatsapp",
    "plantilla_whatsapp",
  ]);
  if (plantilla.present) {
    fields.push({
      column: "plantilla_whatsapp",
      value: text(plantilla.value, MAX_TEXT_LENGTH, false),
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
  if (distrito.present) {
    // Un `null` explícito significa «sin distrito»: no se hereda nada.
    if (distrito.value !== null) {
      fields.push({
        column: "distrito_id",
        value: await resolveDistritoId(client, distrito.value),
      });
    }
  } else if (casoId) {
    // Sin distrito declarado y con caso vinculado: se hereda el del caso, que
    // es el único dato que ya existe. Si el caso tampoco lo tiene, se guarda
    // sin distrito y la interfaz lo declara vacío.
    const heredado = await caseDistritoId(client, casoId);
    if (heredado !== null) {
      fields.push({ column: "distrito_id", value: heredado });
    }
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
      { column: "created_by", value: session.usuarioId },
      { column: "updated_by", value: session.usuarioId },
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

/**
 * Roles con potestad de dirección sobre el circuito de alertas.
 */
const ROLES_DIRECCION_FLUJO: ReadonlySet<string> = new Set([
  "direccion_oaipcs",
  "alta_direccion",
]);

const ROL_ADMINISTRADOR = "administrador";

/**
 * Quién recorre cada arista del circuito (§3.4 de `docs/03_ejecucion/mvp.md`).
 *
 * Es la misma tabla que pinta la SPA (`ACCIONES_POR_PASO`), pero aquí manda:
 * el cliente no decide el flujo. `direccion` abrevia los dos roles de
 * dirección; cualquier arista ausente queda cerrada —incluido reabrir desde el
 * paso 5, que la Guía prohíbe («5 → ninguna»).
 */
type RolFlujo = "sectorista" | "direccion" | "servicio_agente";

const TRANSICIONES_LEGALES: Readonly<Record<string, readonly RolFlujo[]>> = {
  "1>2": ["sectorista"],
  "2>3": ["direccion"],
  "2>1": ["sectorista"],
  "3>4": ["servicio_agente"],
  "3>2": ["direccion"],
  "3>1": ["direccion"],
  "4>5": ["sectorista"],
};

function rolRecorreArista(
  rolCodigo: string,
  exigidos: readonly RolFlujo[],
): boolean {
  return exigidos.some((exigido) =>
    exigido === "direccion"
      ? ROLES_DIRECCION_FLUJO.has(rolCodigo)
      : exigido === rolCodigo,
  );
}

/**
 * Guardia de dirección del flujo (E10).
 *
 * Antes el PATCH aceptaba cualquier `pasoActual`: un sectorista podía rebobinar
 * la alerta y cualquier rol podía saltar a la aprobación definitiva o darla por
 * atendida. Ahora sólo se recorre una arista con el rol que la Guía le asigna, y
 * `administrador` puede corregir cualquier paso.
 *
 * Se evalúa sólo cuando el paso cambia: reenviar el mismo valor sigue siendo un
 * no-op sin traza, porque la SPA repite el paso al pulsar sin comprobarlo.
 *
 * Excepción deliberada: el «Deshacer» de la SPA devuelve al paso previo exacto.
 * Se permite retroceder a quien hizo el último cambio según
 * `core.alerta_revision` —no a cualquier portador del rol— y sólo por esa
 * traza, nunca porque el cliente lo afirme.
 */
async function validarTransicionPaso(
  client: PoolClient,
  session: WriteSession,
  alertaId: string,
  desde: unknown,
  hasta: number,
): Promise<void> {
  // Un `NULL` en `paso_actual` no describe un punto del circuito: sin origen no
  // hay arista que validar, y bloquearlo rompería las alertas del legado.
  if (desde === null || desde === undefined) return;
  const actual = Number(desde);
  if (!Number.isFinite(actual)) return;
  if (hasta === actual) return;
  if (session.rolCodigo === ROL_ADMINISTRADOR) return;

  const exigidos = TRANSICIONES_LEGALES[`${actual}>${hasta}`];
  if (exigidos && rolRecorreArista(session.rolCodigo, exigidos)) return;

  if (
    hasta < actual &&
    (await esAutorDelUltimoCambio(client, alertaId, session.usuarioId))
  ) {
    return;
  }

  throw new ApiError(
    409,
    hasta < actual
      ? "No puede devolver la alerta a un paso anterior: sólo quien hizo el último cambio, o administración, puede deshacerlo."
      : "Ese paso no corresponde a su rol en el circuito de alertas.",
    "TRANSICION_NO_PERMITIDA",
  );
}

/** `true` si el usuario registró la última revisión de la alerta. */
async function esAutorDelUltimoCambio(
  client: PoolClient,
  alertaId: string,
  usuarioId: string,
): Promise<boolean> {
  const result = await client.query<{ usuario_id: string | null }>(
    `select usuario_id
       from core.alerta_revision
      where alerta_id = $1::uuid
      order by created_at desc, id desc
      limit 1`,
    [alertaId],
  );
  const autor = result.rows[0]?.usuario_id;
  return Boolean(autor) && autor === usuarioId;
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
  let pasoNuevo: number | null = null;
  if (paso.present) {
    pasoNuevo = intIn(paso.value, 1, 99);
    // Corta antes de escribir: una transición ilegal no debe tocar la fila ni
    // dejar traza de revisión.
    await validarTransicionPaso(
      client,
      session,
      String(row.id),
      row.paso_actual,
      pasoNuevo,
    );
    add("paso_actual", pasoNuevo);
  }

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

  const riesgo = readField(body, ["riesgo"]);
  if (riesgo.present) {
    add(
      "nivel_riesgo_id",
      riesgo.value === null
        ? null
        : await resolveCatalog(client, "riesgo", riesgo.value),
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

  // Región y provincia declaradas. Son las que envía `guardarMetadatos()` para
  // `alcance='Región'` (región) y `alcance='Distrito'` (provincia). Al
  // persistirlas, un PATCH que sólo las traiga ya no choca con el guardia de
  // «nada que actualizar», y la lectura las prefiere sobre las derivadas.
  const region = readField(body, ["region"]);
  let regionId: number | null = null;
  if (region.present) {
    regionId =
      region.value === null
        ? null
        : await resolveRegionId(client, region.value);
    add("region_id", regionId);
  }

  const provincia = readField(body, ["provincia"]);
  if (provincia.present) {
    // Se acota a la región declarada en este PATCH o, si no vino, a la que ya
    // tenía la alerta: el nombre de provincia sólo es único dentro de su región.
    const regionAlmacenada =
      typeof row.region_id === "number" ? row.region_id : null;
    const regionScope = regionId ?? regionAlmacenada;
    add(
      "provincia_id",
      provincia.value === null
        ? null
        : await resolveProvinciaId(client, provincia.value, regionScope),
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

  const actores = readField(body, ["actoresClave", "actores_clave"]);
  if (actores.present) {
    add("actores_clave", jsonValue(actores.value), "jsonb");
  }

  const demandasInmediatas = readField(body, [
    "demandasInmediatas",
    "demandas_inmediatas",
  ]);
  if (demandasInmediatas.present) {
    add("demandas_inmediatas", jsonValue(demandasInmediatas.value), "jsonb");
  }

  const plantilla = readField(body, [
    "plantillaWhatsapp",
    "plantilla_whatsapp",
  ]);
  if (plantilla.present) {
    add("plantilla_whatsapp", text(plantilla.value, MAX_TEXT_LENGTH, false));
  }

  const caso = readField(body, ["casoCode", "caso", "caso_codigo"]);
  let casoVinculado: string | null = null;
  if (caso.present) {
    casoVinculado =
      caso.value === null ? null : await resolveCaseId(client, caso.value);
    add("caso_id", casoVinculado);
  }

  const distrito = readField(body, ["distritoId", "distrito_id"]);
  if (distrito.present) {
    add(
      "distrito_id",
      distrito.value === null
        ? null
        : await resolveDistritoId(client, distrito.value),
    );
  } else if (casoVinculado && row.distrito_id === null) {
    // Al vincular un caso a una alerta que no tenía distrito se aplica la
    // misma herencia que en el alta. Un distrito ya declarado no se toca.
    const heredado = await caseDistritoId(client, casoVinculado);
    if (heredado !== null) add("distrito_id", heredado);
  }

  if (sets.length === 0) invalid();
  add("updated_by", session.usuarioId, "uuid");
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

  // Cada cambio de paso es una acción de revisión: se deja traza con quién,
  // qué acción y el motivo declarado (si vino).
  if (pasoNuevo !== null && pasoNuevo !== row.paso_actual) {
    const motivo = text(
      readField(body, ["motivo"]).value,
      MAX_MOTIVO_LENGTH,
      false,
    );
    await registrarRevision(
      client,
      String(updatedRow.id),
      session.usuarioId,
      revisionAccion(row.paso_actual, pasoNuevo, motivo),
    );
  }

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

/**
 * Archiva una alerta que no tiene caso vinculado.
 *
 * Archivar no es anular: sólo fija `archivado_en`/`archivado_por`/`motivo_archivo`
 * para sacar la fila de las colas de trabajo. La alerta sigue existiendo y se
 * consulta con `archivados=true`. La regla «sólo sin caso» es la del archivo de
 * la matriz: una alerta ya vinculada se trabaja desde su caso.
 */
export async function archiveAlert(
  client: PoolClient,
  session: WriteSession,
  idOrCode: string,
  motivo: string | undefined,
): Promise<AlertDetail> {
  const row = await findAlert(client, idOrCode);

  if (row.anulado_en) {
    throw new ApiError(
      409,
      "Una alerta anulada no se archiva; primero debe restaurarse.",
      "ALERT_ANULADA",
    );
  }
  if (row.caso_id) {
    throw new ApiError(
      409,
      "Sólo se archivan alertas sin caso vinculado.",
      "ALERT_CON_CASO",
    );
  }

  const razon = (motivo ?? "").trim();
  if (!razon) {
    throw new ApiError(
      400,
      "El motivo del archivo es obligatorio.",
      "MOTIVO_REQUERIDO",
    );
  }

  const updated = await archiveUpdate(client, row.id, session.usuarioId, razon);

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
      "No se pudo leer la alerta archivada.",
      "READ_BACK_FAILED",
    );
  }
  return detail;
}

/** Quita una alerta del archivo sin tocar su estado ni su trazabilidad. */
export async function unarchiveAlert(
  client: PoolClient,
  session: WriteSession,
  idOrCode: string,
): Promise<AlertDetail> {
  const row = await findAlert(client, idOrCode);

  const updated = await unarchiveUpdate(client, row.id);

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
      "No se pudo leer la alerta desarchivada.",
      "READ_BACK_FAILED",
    );
  }
  return detail;
}

/**
 * Fija las columnas de archivo. El trigger G21 (`P0001`) se traduce igual que en
 * `updateAlert`: una alerta publicada sin sus firmas no puede archivarse.
 */
async function archiveUpdate(
  client: PoolClient,
  id: unknown,
  usuarioId: string,
  motivo: string,
): Promise<{ rows: Record<string, any>[] }> {
  try {
    return await client.query(
      `update core.alertas_tempranas
          set archivado_en = coalesce(archivado_en, now()),
              archivado_por = coalesce(archivado_por, $2::uuid),
              motivo_archivo = $3,
              updated_at = now()
        where id = $1::uuid
        returning *`,
      [id, usuarioId, motivo.slice(0, MAX_MOTIVO_LENGTH)],
    );
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
}

/** Limpia las columnas de archivo sin tocar estado, visibilidad ni trazabilidad. */
async function unarchiveUpdate(
  client: PoolClient,
  id: unknown,
): Promise<{ rows: Record<string, any>[] }> {
  try {
    return await client.query(
      `update core.alertas_tempranas
          set archivado_en = null,
              archivado_por = null,
              motivo_archivo = null,
              updated_at = now()
        where id = $1::uuid
        returning *`,
      [id],
    );
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
}
