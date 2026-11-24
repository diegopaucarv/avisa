import type { PoolClient } from "pg";

import { listCommitments } from "./commitments";
import { listarConflictividad } from "./conflictividad";
import { listReportes } from "./reportes";

/**
 * Datos de los anexos imprimibles que no tienen repositorio propio.
 *
 * Se apoya en piezas ya existentes: la matriz de conflictividad (Anexo 15) sale
 * de `listarConflictividad`, el registro de reportes (Anexo 17) de
 * `listReportes` y el fallback del Anexo 14 de `listCommitments`. Aquí sólo vive
 * lo que faltaba: la vista del Anexo 14, las fuentes documentales de los anexos
 * 03 a 13, las reuniones del Anexo 16 y el catálogo de disponibilidad.
 *
 * Aviso de seguridad: `analytics.vw_anexo_14_seguimiento_compromisos` y
 * `analytics.vw_anexo_15_matriz_conflictividad` NO son `security_invoker`
 * (se comprobó en vivo), así que sus consultas reaplican la RLS con `join
 * core.casos` / `join core.compromisos`. Las vistas 16 y 17 sí son
 * `security_invoker` y la aplican solas.
 *
 * El contexto de sesión lo fija `withSession`; este repositorio nunca abre una
 * conexión propia.
 */

/* ------------------------------------------------------------------------- *
 * Anexo 14 — Matriz de seguimiento de compromisos
 * ------------------------------------------------------------------------- */

/** Una fila de la matriz. Las fechas son ISO (`YYYY-MM-DD`) o `null`. */
export type FilaAnexo14 = {
  codigoCompromiso: string;
  codigoCaso: string | null;
  region: string | null;
  provincia: string | null;
  distrito: string | null;
  alcanceGeografico: string | null;
  documentoOrigen: string | null;
  fechaInicio: string | null;
  tematica: string | null;
  accionCompromiso: string | null;
  areaResponsable: string | null;
  codigoHito: string | null;
  hito: string | null;
  estadoHito: string | null;
  semaforo: string | null;
  fechaPlanificada: string | null;
  fechaReal: string | null;
};

export type Anexo14Query = {
  /** Código exacto del caso. */
  caso?: string | null;
  /** Estados del hito: Registrado, En ejecución, Paralizado, Cumplido, Desestimado. */
  estado?: string | null;
  /** `YYYY-MM-DD` sobre `fecha_inicio` del compromiso, inclusive. */
  desde?: string | null;
  /** `YYYY-MM-DD` inclusive. */
  hasta?: string | null;
};

export type Anexo14Resultado = {
  filas: FilaAnexo14[];
  /** Columnas del formato oficial sin fuente en el conjunto devuelto. */
  faltantes: string[];
  /** `true` si se leyó la vista; `false` si se usó el respaldo de compromisos. */
  desdeVista: boolean;
};

const VISTA_ANEXO_14 = "analytics.vw_anexo_14_seguimiento_compromisos";

/** `to_regclass` es barato y no requiere permisos sobre la tabla. */
export async function existeRelacion(
  client: PoolClient,
  nombre: string,
): Promise<boolean> {
  const result = await client.query<{ existe: boolean }>(
    "select to_regclass($1) is not null as existe",
    [nombre],
  );
  return Boolean(result.rows[0]?.existe);
}

function texto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const limpio = String(valor).trim();
  return limpio === "" ? null : limpio;
}

function fechaIso(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return valor.toISOString().slice(0, 10);
  }
  const limpio = texto(valor);
  if (!limpio) return null;
  const coincidencia = /^(\d{4}-\d{2}-\d{2})/.exec(limpio);
  if (coincidencia) return coincidencia[1] ?? null;
  const fecha = new Date(limpio);
  return Number.isNaN(fecha.getTime())
    ? null
    : fecha.toISOString().slice(0, 10);
}

function mapFilaAnexo14(row: Record<string, unknown>): FilaAnexo14 {
  return {
    codigoCompromiso: String(row.codigo_compromiso ?? ""),
    codigoCaso: texto(row.codigo_caso),
    region: texto(row.region),
    provincia: texto(row.provincia),
    distrito: texto(row.distrito),
    alcanceGeografico: texto(row.alcance_geografico),
    documentoOrigen: texto(row.documento_origen),
    fechaInicio: fechaIso(row.fecha_inicio),
    tematica: texto(row.tematica),
    accionCompromiso: texto(row.accion_compromiso),
    areaResponsable: texto(row.area_responsable),
    codigoHito: texto(row.codigo_hito),
    hito: texto(row.hito),
    estadoHito: texto(row.estado_hito),
    semaforo: texto(row.semaforo),
    fechaPlanificada: fechaIso(row.fecha_planificada),
    fechaReal: fechaIso(row.fecha_real),
  };
}

/**
 * Columnas del formato oficial que no tienen ningún valor en el conjunto.
 * Se informan a nivel de documento: un hueco puntual se marca con `—` en la
 * celda, pero una columna entera vacía se declara en las notas.
 */
function faltantesAnexo14(filas: readonly FilaAnexo14[]): string[] {
  if (filas.length === 0) return [];
  const faltantes: string[] = [];

  const vacia = <T>(selector: (fila: FilaAnexo14) => T | null): boolean =>
    filas.every((fila) => selector(fila) === null);

  if (vacia((fila) => fila.region)) {
    faltantes.push(
      "Región: ningún compromiso tiene distritos vinculados en core.compromiso_distritos.",
    );
  }
  if (vacia((fila) => fila.provincia)) {
    faltantes.push(
      "Provincia: ningún compromiso tiene distritos vinculados en core.compromiso_distritos.",
    );
  }
  if (vacia((fila) => fila.distrito)) {
    faltantes.push(
      "Distrito: ningún compromiso tiene distritos vinculados en core.compromiso_distritos.",
    );
  }
  if (vacia((fila) => fila.alcanceGeografico)) {
    faltantes.push("Alcance geográfico: los compromisos no declaran alcance.");
  }
  if (vacia((fila) => fila.documentoOrigen)) {
    faltantes.push(
      "Documento de origen: los compromisos no tienen documento de origen vinculado.",
    );
  }
  if (vacia((fila) => fila.tematica)) {
    faltantes.push(
      "Temática: ni el compromiso ni el caso declaran temática principal.",
    );
  }
  return faltantes;
}

async function consultarAnexo14Vista(
  client: PoolClient,
  query: Anexo14Query,
): Promise<Anexo14Resultado> {
  const params: unknown[] = [];
  const where: string[] = ["cs.anulado_en is null"];

  const caso = texto(query.caso);
  if (caso) {
    params.push(caso);
    where.push(`btrim(v.codigo_caso) = btrim($${params.length})`);
  }

  const estado = texto(query.estado);
  if (estado) {
    params.push(estado);
    where.push(`lower(btrim(v.estado_hito)) = lower(btrim($${params.length}))`);
  }

  const desde = texto(query.desde);
  if (desde) {
    params.push(desde);
    where.push(`v.fecha_inicio >= $${params.length}::date`);
  }

  const hasta = texto(query.hasta);
  if (hasta) {
    params.push(hasta);
    where.push(`v.fecha_inicio < ($${params.length}::date + 1)`);
  }

  // El join a core.casos y core.compromisos reaplica la RLS (ambas tablas son
  // FORCE RLS) y descarta casos y compromisos anulados. La temática no está en
  // la vista desde la migración 44: se resuelve del compromiso y, si falta, del
  // caso, que es la «temática principal del caso» que pide el formato oficial.
  const result = await client.query<Record<string, unknown>>(
    `select v.codigo_compromiso,
            v.codigo_caso,
            v.region,
            v.provincia,
            v.distrito,
            v.alcance_geografico,
            v.documento_origen,
            v.fecha_inicio,
            coalesce(tmc.nombre, tm.nombre) as tematica,
            v.accion_compromiso,
            v.area_responsable,
            v.codigo_hito,
            v.hito,
            v.estado_hito,
            v.semaforo,
            v.fecha_planificada,
            v.fecha_real
       from ${VISTA_ANEXO_14} v
       join core.casos cs on cs.codigo_caso = v.codigo_caso
       join core.compromisos c on c.codigo_compromiso = v.codigo_compromiso
       left join core.cat_tematicas tm on tm.id = c.tematica_id
       left join core.cat_tematicas tmc on tmc.id = cs.tematica_id
      where ${where.join(" and ")}
      order by v.codigo_caso, v.codigo_compromiso, v.codigo_hito nulls last`,
    params,
  );

  const filas = result.rows.map(mapFilaAnexo14);
  return { filas, faltantes: faltantesAnexo14(filas), desdeVista: true };
}

/**
 * Respaldo si la vista del Anexo 14 no está aplicada. Los compromisos se
 * paginan por el tope de 100 del listado y se expanden por hito; la geografía y
 * el documento de origen no existen en ese repositorio y se declaran.
 */
async function consultarAnexo14Compromisos(
  client: PoolClient,
  query: Anexo14Query,
): Promise<Anexo14Resultado> {
  const filas: FilaAnexo14[] = [];
  const desde = texto(query.desde);
  const hasta = texto(query.hasta);
  let pagina = 1;
  let total = Number.POSITIVE_INFINITY;

  while (pagina <= 200 && filas.length < total) {
    const resultado = await listCommitments(client, {
      caso: texto(query.caso) ?? undefined,
      estado: texto(query.estado) ?? undefined,
      page: pagina,
      pageSize: 100,
    });
    if (resultado.items.length === 0) break;
    total = resultado.total;

    for (const item of resultado.items) {
      const fechaInicio = item.fechaInicio
        ? item.fechaInicio.slice(0, 10)
        : null;
      if (desde && (!fechaInicio || fechaInicio < desde)) continue;
      if (hasta && (!fechaInicio || fechaInicio > hasta)) continue;

      const hitos = item.hitos.length > 0 ? item.hitos : [null];
      for (const hito of hitos) {
        filas.push({
          codigoCompromiso: item.codigo,
          codigoCaso: item.casoCode,
          region: null,
          provincia: null,
          distrito: null,
          alcanceGeografico: item.alcance,
          documentoOrigen: null,
          fechaInicio,
          tematica: item.tematica,
          accionCompromiso: item.accion,
          areaResponsable: item.unidad,
          codigoHito: hito?.codigo ?? null,
          hito: hito?.descripcion ?? null,
          estadoHito: hito?.estado ?? item.estado,
          semaforo: null,
          fechaPlanificada: hito?.fecha ? hito.fecha.slice(0, 10) : null,
          fechaReal: hito?.fechaReal ? hito.fechaReal.slice(0, 10) : null,
        });
      }
    }

    if (resultado.items.length < 100) break;
    pagina += 1;
  }

  const faltantes = faltantesAnexo14(filas);
  faltantes.unshift(
    "La vista analytics.vw_anexo_14_seguimiento_compromisos no está aplicada: se usó el respaldo de compromisos (sin región, provincia, distrito ni documento de origen).",
  );
  return { filas, faltantes, desdeVista: false };
}

export async function obtenerAnexo14(
  client: PoolClient,
  query: Anexo14Query,
): Promise<Anexo14Resultado> {
  if (await existeRelacion(client, VISTA_ANEXO_14)) {
    return consultarAnexo14Vista(client, query);
  }
  return consultarAnexo14Compromisos(client, query);
}

/* ------------------------------------------------------------------------- *
 * Anexos 04/05/10/12/13 — documentos oficiales
 * ------------------------------------------------------------------------- */

/** Tipo de `core.cat_tipos_documento` que alimenta cada anexo. */
export const TIPOS_DOCUMENTO_ANEXO: Readonly<Record<string, number>> = {
  "04": 2, // Clima Social General
  "05": 3, // Clima Social Focalizado
  "06": 4, // Plan de Acción Rápida
  "10": 8, // Acta de Acuerdo
  "12": 10, // Ayuda Memoria
  "13": 11, // Relatoría
};

export type BloqueContenido = { clave: string; texto: string };

export type DocumentoFuente = {
  id: string;
  codigo: string | null;
  tipoId: number;
  tipoNombre: string | null;
  titulo: string;
  fecha: string | null;
  resumen: string | null;
  autorTexto: string | null;
  responsable: string | null;
  casoCodigo: string | null;
  casoTitulo: string | null;
  region: string | null;
  provincia: string | null;
  distrito: string | null;
  urlPdf: string | null;
  urlFoto: string | null;
  /** Bloques de texto de `contenido_json`, ordenados por su clave `cNN`. */
  bloques: BloqueContenido[];
};

/** `contenido_json` es un objeto `cNN → texto` del importador. */
function bloquesDeContenido(valor: unknown): BloqueContenido[] {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return [];
  const entradas = Object.entries(valor as Record<string, unknown>)
    .filter(
      ([, contenido]) =>
        typeof contenido === "string" && contenido.trim() !== "",
    )
    .sort(([a], [b]) => a.localeCompare(b, "es", { numeric: true }));
  return entradas.map(([clave, contenido]) => ({
    clave,
    texto: String(contenido).trim(),
  }));
}

function mapDocumentoFuente(row: Record<string, unknown>): DocumentoFuente {
  return {
    id: String(row.id ?? ""),
    codigo: texto(row.codigo),
    tipoId: Number(row.tipo_id ?? 0),
    tipoNombre: texto(row.tipo_nombre),
    titulo: texto(row.titulo) ?? "Documento sin título",
    fecha: fechaIso(row.fecha),
    resumen: texto(row.resumen_ejecutivo),
    autorTexto: texto(row.autor_texto),
    responsable: texto(row.responsable),
    casoCodigo: texto(row.codigo_caso),
    casoTitulo: texto(row.nombre_caso),
    region: texto(row.region),
    provincia: texto(row.provincia),
    distrito: texto(row.distrito),
    urlPdf: texto(row.url_pdf),
    urlFoto: texto(row.url_foto),
    bloques: bloquesDeContenido(row.contenido_json),
  };
}

/**
 * Documento más reciente de un tipo, o el que coincida con `codigo` (código de
 * documento o de caso). Devuelve `null` si no hay ninguno visible.
 */
export async function obtenerDocumentoFuente(
  client: PoolClient,
  tipoId: number,
  codigo: string | null,
): Promise<DocumentoFuente | null> {
  const result = await client.query<Record<string, unknown>>(
    `select d.id::text as id,
            d.codigo,
            d.tipo_id,
            t.nombre as tipo_nombre,
            d.titulo,
            d.fecha,
            d.resumen_ejecutivo,
            d.autor_texto,
            u.nombre as responsable,
            cs.codigo_caso,
            cs.nombre_caso,
            g.region,
            g.provincia,
            g.distrito,
            d.url_pdf,
            d.url_foto,
            d.contenido_json
       from core.documentos d
       join core.cat_tipos_documento t on t.id = d.tipo_id
       left join core.usuarios u on u.id = d.responsable_usuario_id
       left join core.casos cs on cs.id = d.caso_id
       left join analytics.vw_geo_distrito g on g.distrito_id = d.distrito_id
      where d.tipo_id = $1
        and d.anulado_en is null
        and ($2::text is null or d.codigo = $2 or cs.codigo_caso = $2)
      order by d.fecha desc nulls last, d.codigo
      limit 1`,
    [tipoId, codigo],
  );

  const fila = result.rows[0];
  return fila ? mapDocumentoFuente(fila) : null;
}

/** Conteo de documentos por tipo, con las banderas que usa el catálogo. */
export type ConteoDocumentos = {
  tipoId: number;
  total: number;
  conResumen: number;
  conBloques: number;
  conFoto: number;
  conDistrito: number;
};

export async function contarDocumentosAnexos(
  client: PoolClient,
  tipos: readonly number[],
): Promise<ConteoDocumentos[]> {
  if (tipos.length === 0) return [];
  const result = await client.query<Record<string, unknown>>(
    `select tipo_id,
            count(*)::int as total,
            count(*) filter (
              where resumen_ejecutivo is not null and btrim(resumen_ejecutivo) <> ''
            )::int as con_resumen,
            count(*) filter (
              where contenido_json is not null and contenido_json <> '{}'::jsonb
            )::int as con_bloques,
            count(*) filter (where url_foto is not null and btrim(url_foto) <> '')::int as con_foto,
            count(*) filter (where distrito_id is not null)::int as con_distrito
       from core.documentos
      where anulado_en is null and tipo_id = any($1::smallint[])
      group by tipo_id
      order by tipo_id`,
    [tipos],
  );

  return result.rows.map((row) => ({
    tipoId: Number(row.tipo_id ?? 0),
    total: Number(row.total ?? 0),
    conResumen: Number(row.con_resumen ?? 0),
    conBloques: Number(row.con_bloques ?? 0),
    conFoto: Number(row.con_foto ?? 0),
    conDistrito: Number(row.con_distrito ?? 0),
  }));
}

/* ------------------------------------------------------------------------- *
 * Anexo 03 — alertas tempranas
 * ------------------------------------------------------------------------- */

export type AlertaFuente = {
  id: string;
  codigo: string | null;
  titulo: string | null;
  fecha: string | null;
  situacionActual: string | null;
  hechosRecientes: string | null;
  descripcionRiesgo: string | null;
  accionesOaipcs: string | null;
  accionesSugeridas: string | null;
  actoresClave: string | null;
  demandasInmediatas: string | null;
  prioridad: string | null;
  nivel: string | null;
  alcance: string | null;
  region: string | null;
  provincia: string | null;
  distrito: string | null;
  casoCodigo: string | null;
  casoTitulo: string | null;
};

/** Texto de un jsonb que puede ser cadena, `{texto}` o lista de textos. */
export function textoDeJson(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "string") return texto(valor);

  if (Array.isArray(valor)) {
    const partes = valor
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "texto" in item) {
          return texto((item as { texto?: unknown }).texto);
        }
        return null;
      })
      .filter((item): item is string => Boolean(item));
    return partes.length > 0 ? partes.join("\n") : null;
  }

  if (typeof valor === "object") {
    const objeto = valor as Record<string, unknown>;
    const directo = texto(objeto.texto);
    if (directo) return directo;
    const partes = Object.values(objeto)
      .map((item) => (typeof item === "string" ? item : null))
      .filter((item): item is string => Boolean(item));
    return partes.length > 0 ? partes.join("\n") : null;
  }

  return null;
}

export async function obtenerAlertaFuente(
  client: PoolClient,
  codigo: string | null,
): Promise<AlertaFuente | null> {
  const result = await client.query<Record<string, unknown>>(
    `select a.id::text as id,
            a.codigo_alerta as codigo,
            a.titulo,
            a.fecha_reporte as fecha,
            a.situacion_actual,
            a.hechos_recientes,
            a.descripcion_riesgo,
            a.acciones_oaipcs,
            a.acciones_sugeridas_json,
            a.actores_clave,
            a.demandas_inmediatas,
            p.codigo as prioridad,
            n.codigo as nivel,
            al.codigo as alcance,
            g.region,
            g.provincia,
            g.distrito,
            cs.codigo_caso,
            cs.nombre_caso
       from core.alertas_tempranas a
       left join core.cat_prioridades_atencion p on p.id = a.prioridad_id
       left join core.cat_niveles_riesgo n on n.id = coalesce(a.nivel_alerta_id, a.nivel_riesgo_id)
       left join core.cat_alcances_geograficos al on al.id = a.alcance_id
       left join analytics.vw_geo_distrito g on g.distrito_id = a.distrito_id
       left join core.casos cs on cs.id = a.caso_id
      where a.anulado_en is null
        and ($1::text is null or a.codigo_alerta = $1 or cs.codigo_caso = $1)
      order by a.fecha_reporte desc nulls last
      limit 1`,
    [codigo],
  );

  const fila = result.rows[0];
  if (!fila) return null;

  return {
    id: String(fila.id ?? ""),
    codigo: texto(fila.codigo),
    titulo: texto(fila.titulo),
    fecha: fechaIso(fila.fecha),
    situacionActual: texto(fila.situacion_actual),
    hechosRecientes: texto(fila.hechos_recientes),
    descripcionRiesgo: texto(fila.descripcion_riesgo),
    accionesOaipcs: texto(fila.acciones_oaipcs),
    accionesSugeridas: textoDeJson(fila.acciones_sugeridas_json),
    actoresClave: textoDeJson(fila.actores_clave),
    demandasInmediatas: textoDeJson(fila.demandas_inmediatas),
    prioridad: texto(fila.prioridad),
    nivel: texto(fila.nivel),
    alcance: texto(fila.alcance),
    region: texto(fila.region),
    provincia: texto(fila.provincia),
    distrito: texto(fila.distrito),
    casoCodigo: texto(fila.codigo_caso),
    casoTitulo: texto(fila.nombre_caso),
  };
}

export type ConteoAlertas = {
  total: number;
  conSituacion: number;
  conHechos: number;
  conRiesgo: number;
  conAcciones: number;
  conActores: number;
  conDemandas: number;
};

export async function contarAlertasAnexo03(
  client: PoolClient,
): Promise<ConteoAlertas> {
  const result = await client.query<Record<string, unknown>>(
    `select count(*)::int as total,
            count(*) filter (where btrim(coalesce(situacion_actual, '')) <> '')::int as con_situacion,
            count(*) filter (where btrim(coalesce(hechos_recientes, '')) <> '')::int as con_hechos,
            count(*) filter (where btrim(coalesce(descripcion_riesgo, '')) <> '')::int as con_riesgo,
            count(*) filter (where btrim(coalesce(acciones_oaipcs, '')) <> '')::int as con_acciones,
            count(*) filter (
              where actores_clave is not null and actores_clave <> 'null'::jsonb
            )::int as con_actores,
            count(*) filter (
              where demandas_inmediatas is not null and demandas_inmediatas <> 'null'::jsonb
            )::int as con_demandas
       from core.alertas_tempranas
      where anulado_en is null`,
  );
  const fila = result.rows[0] ?? {};
  return {
    total: Number(fila.total ?? 0),
    conSituacion: Number(fila.con_situacion ?? 0),
    conHechos: Number(fila.con_hechos ?? 0),
    conRiesgo: Number(fila.con_riesgo ?? 0),
    conAcciones: Number(fila.con_acciones ?? 0),
    conActores: Number(fila.con_actores ?? 0),
    conDemandas: Number(fila.con_demandas ?? 0),
  };
}

/* ------------------------------------------------------------------------- *
 * Anexo 16 — registro de reuniones
 * ------------------------------------------------------------------------- */

export type ReunionFuente = {
  codigo: string;
  titulo: string | null;
  fecha: string | null;
  lugar: string | null;
  region: string | null;
  tipo: string | null;
  responsable: string | null;
  asistentes: number;
  tieneAyudaMemoria: boolean;
  tieneRelatoria: boolean;
  publicacion: string | null;
};

export async function contarReuniones(client: PoolClient): Promise<number> {
  const result = await client.query<{ total: number }>(
    "select count(*)::int as total from core.reuniones_dialogo",
  );
  return Number(result.rows[0]?.total ?? 0);
}

/**
 * Reunión por código (o la más reciente) con sus participantes. Se lee la
 * tabla base y no `analytics.vw_anexo_16_registro_reuniones`, que usa INNER JOIN
 * y descarta las reuniones sin caso.
 */
export async function obtenerReunionFuente(
  client: PoolClient,
  codigo: string | null,
): Promise<ReunionFuente | null> {
  const result = await client.query<Record<string, unknown>>(
    `select r.codigo_reunion as codigo,
            r.titulo,
            r.fecha,
            r.lugar,
            r.region_texto as region,
            t.nombre as tipo,
            u.nombre as responsable,
            r.nota_publicacion_url as publicacion,
            r.acta_am as acta_am,
            r.relatoria_registrada as relatoria,
            (select count(*)::int from core.reunion_participantes p
              where p.reunion_id = r.id and p.asistio) as asistentes
       from core.reuniones_dialogo r
       left join core.cat_tipos_documento t on t.id = r.tipo_id
       left join core.usuarios u on u.id = r.responsable_usuario_id
      where ($1::text is null or r.codigo_reunion = $1)
      order by r.fecha desc nulls last
      limit 1`,
    [codigo],
  );

  const fila = result.rows[0];
  if (!fila) return null;

  return {
    codigo: String(fila.codigo ?? ""),
    titulo: texto(fila.titulo),
    fecha: fechaIso(fila.fecha),
    lugar: texto(fila.lugar),
    region: texto(fila.region),
    tipo: texto(fila.tipo),
    responsable: texto(fila.responsable),
    asistentes: Number(fila.asistentes ?? 0),
    tieneAyudaMemoria: Boolean(fila.acta_am),
    tieneRelatoria: Boolean(fila.relatoria),
    publicacion: texto(fila.publicacion),
  };
}

/* ------------------------------------------------------------------------- *
 * Anexo 17 — registro de reportes
 * ------------------------------------------------------------------------- */

export async function contarReportes(client: PoolClient): Promise<number> {
  const resultado = await listReportes(client, { page: 1, pageSize: 1 });
  return resultado.total;
}

/* ------------------------------------------------------------------------- *
 * Catálogo de disponibilidad
 * ------------------------------------------------------------------------- */

export type DisponibilidadAnexo = {
  numero: string;
  titulo: string;
  referencia: string;
  disponible: boolean;
  /** Registros con cuerpo suficiente para generar el documento. */
  registros: number;
  /** Registros totales en la fuente. */
  total: number;
  formatos: readonly string[];
  /** Campos del formato oficial sin fuente. */
  faltantes: readonly string[];
};

const FORMATOS_DOCUMENTO = ["html", "pdf", "json"] as const;

function disponibilidadDocumento(
  documento: ConteoDocumentos | undefined,
  faltantesBase: readonly string[],
): {
  disponible: boolean;
  registros: number;
  total: number;
  faltantes: string[];
} {
  const total = documento?.total ?? 0;
  const conResumen = documento?.conResumen ?? 0;
  const faltantes = [...faltantesBase];

  if (total === 0) {
    faltantes.unshift(
      "No hay documentos registrados en la base para este anexo.",
    );
  } else if (conResumen === 0) {
    faltantes.unshift(
      "Ningún documento de este tipo tiene resumen ejecutivo: el cuerpo del anexo saldría vacío.",
    );
  } else if (conResumen < total) {
    faltantes.unshift(
      `${total - conResumen} de ${total} documentos no tienen resumen ejecutivo y no son generables.`,
    );
  }

  return {
    disponible: conResumen > 0,
    registros: conResumen,
    total,
    faltantes,
  };
}

/**
 * Qué anexos se pueden generar hoy y con qué datos. Los conteos pasan por la RLS
 * de la sesión: la galería muestra exactamente lo que ese usuario puede emitir.
 */
export async function listarAnexosDisponibles(
  client: PoolClient,
): Promise<DisponibilidadAnexo[]> {
  const tipos = [2, 3, 4, 5, 8, 10, 11];
  const [documentos, alertas, reuniones, reportes] = await Promise.all([
    contarDocumentosAnexos(client, tipos),
    contarAlertasAnexo03(client),
    contarReuniones(client),
    contarReportes(client),
  ]);

  const porTipo = new Map(documentos.map((conteo) => [conteo.tipoId, conteo]));
  const salida: DisponibilidadAnexo[] = [];

  // Anexo 03 — alertas tempranas.
  {
    const faltantes: string[] = [];
    if (alertas.total === 0)
      faltantes.push("No hay alertas tempranas registradas.");
    if (alertas.total > 0 && alertas.conActores === 0)
      faltantes.push(
        "Actores clave: ninguna alerta tiene actores registrados.",
      );
    if (alertas.total > 0 && alertas.conDemandas === 0)
      faltantes.push("Demandas inmediatas: ninguna alerta las registra.");
    if (alertas.total > 0 && alertas.conAcciones === 0)
      faltantes.push("Acciones OAIPCS: ninguna alerta las registra.");
    salida.push({
      numero: "03",
      titulo: "Reporte de Alerta Temprana",
      referencia: "Anexo N° 03",
      disponible: alertas.conSituacion > 0,
      registros: alertas.conSituacion,
      total: alertas.total,
      formatos: FORMATOS_DOCUMENTO,
      faltantes,
    });
  }

  // Anexos 04, 05, 06, 10, 12 y 13 — documentos oficiales.
  const documentosAnexos: readonly {
    numero: string;
    titulo: string;
    tipo: number;
    faltantes: readonly string[];
  }[] = [
    {
      numero: "04",
      titulo: "Reporte de Clima Social General",
      tipo: 2,
      faltantes: [
        "Secciones de actores, demandas y oportunidades: se completan sólo con los bloques que traiga contenido_json.",
      ],
    },
    {
      numero: "05",
      titulo: "Reporte de Clima Social Focalizado",
      tipo: 3,
      faltantes: [
        "Secciones de actores, focos de tensión y oportunidades: se completan sólo con los bloques que traiga contenido_json.",
      ],
    },
    {
      numero: "06",
      titulo: "Plan de Acción (Rápida)",
      tipo: 4,
      faltantes: ["No hay documentos de Plan de Acción Rápida (tipo 4)."],
    },
    {
      numero: "10",
      titulo: "Acta de Acuerdo",
      tipo: 8,
      faltantes: [
        "No hay actas de acuerdo (tipo 8) ni reuniones con acta registrada.",
        "Participantes y acuerdos: no están disponibles en core.documentos.",
      ],
    },
    {
      numero: "12",
      titulo: "Ayuda Memoria",
      tipo: 10,
      faltantes: [
        "Participantes, desarrollo de la sesión, acuerdos y compromisos: no están registrados en core.documentos para este tipo.",
      ],
    },
    {
      numero: "13",
      titulo: "Relatoría",
      tipo: 11,
      faltantes: [
        "Participantes, desarrollo de la sesión y acuerdos: no están registrados en core.documentos para este tipo.",
      ],
    },
  ];

  for (const anexo of documentosAnexos) {
    const conteo = porTipo.get(anexo.tipo);
    const disponibilidad = disponibilidadDocumento(conteo, anexo.faltantes);
    if (conteo && conteo.conFoto === 0 && anexo.tipo === 3) {
      disponibilidad.faltantes.push(
        "Foto representativa: ningún reporte focalizado registra url_foto.",
      );
    }
    salida.push({
      numero: anexo.numero,
      titulo: anexo.titulo,
      referencia: `Anexo N° ${anexo.numero}`,
      formatos: FORMATOS_DOCUMENTO,
      ...disponibilidad,
    });
  }

  // Anexo 14 — matriz de seguimiento de compromisos.
  {
    const anexo14 = await obtenerAnexo14(client, {});
    salida.push({
      numero: "14",
      titulo: "Matriz de Seguimiento de Compromisos",
      referencia: "Anexo N° 14",
      disponible: anexo14.filas.length > 0,
      registros: anexo14.filas.length,
      total: anexo14.filas.length,
      formatos: ["html", "pdf", "xlsx", "json"],
      faltantes:
        anexo14.filas.length === 0
          ? ["No hay compromisos con hitos para la matriz."]
          : anexo14.faltantes,
    });
  }

  // Anexo 15 — matriz de conflictividad. El conteo se lee de la vista con el
  // mismo repositorio que usa la exportación; `count(*) over()` da el total del
  // conjunto filtrado aunque la página sea de una fila.
  {
    let total = 0;
    let errorVista = false;
    try {
      const conflictividad = await listarConflictividad(client, {
        page: 1,
        pageSize: 1,
      });
      total = conflictividad.resumen.total;
    } catch {
      errorVista = true;
    }

    salida.push({
      numero: "15",
      titulo: "Matriz de Conflictividad",
      referencia: "Anexo N° 15",
      disponible: total > 0,
      registros: total,
      total,
      formatos: ["html", "pdf", "json"],
      faltantes: errorVista
        ? ["No se pudo leer analytics.vw_anexo_15_matriz_conflictividad."]
        : total === 0
          ? ["No hay casos abiertos para la matriz de conflictividad."]
          : [],
    });
  }

  // Anexo 16 — registro de reuniones.
  {
    salida.push({
      numero: "16",
      titulo: "Registro de Reuniones",
      referencia: "Anexo N° 16",
      disponible: reuniones > 0,
      registros: reuniones,
      total: reuniones,
      formatos: FORMATOS_DOCUMENTO,
      faltantes:
        reuniones === 0
          ? ["No hay reuniones registradas en core.reuniones_dialogo."]
          : [
              "Asistencia nominal y publicación de nota: se leen de core.reunion_participantes y nota_publicacion_url.",
            ],
    });
  }

  // Anexo 17 — registro de reportes.
  {
    salida.push({
      numero: "17",
      titulo: "Registro de Reportes",
      referencia: "Anexo N° 17",
      disponible: reportes > 0,
      registros: reportes,
      total: reportes,
      formatos: FORMATOS_DOCUMENTO,
      faltantes:
        reportes === 0
          ? [
              "No hay reportes registrados en analytics.vw_anexo_17_registro_reportes.",
            ]
          : [],
    });
  }

  return salida.sort((a, b) => a.numero.localeCompare(b.numero));
}
