import type { PoolClient } from "pg";

import { auditChange } from "../audit";
import { ApiError } from "../errors";
import {
  getAlertById,
  type AlertDemanda,
  type AlertItem,
  type WriteSession,
} from "./alerts";

/* ------------------------------------------------------------------------- *
 * Tipos del contrato
 * ------------------------------------------------------------------------- */

/**
 * Estados del triaje de la bandeja RED-RADAR.
 *
 * `pendiente` es el estado implícito de toda alerta que todavía no tiene fila
 * en `core.alerta_triaje`; los demás los persiste una acción de triaje.
 */
export type EstadoTriaje =
  "pendiente" | "en_triage" | "confirmada" | "descartada" | "duplicada";

export const ESTADOS_TRIAJE: readonly EstadoTriaje[] = [
  "pendiente",
  "en_triage",
  "confirmada",
  "descartada",
  "duplicada",
];

/** Estados que exigen motivo declarado (Anexo 03 · item 38). */
const ESTADOS_CON_MOTIVO = new Set<EstadoTriaje>(["descartada", "duplicada"]);

export function esEstadoTriaje(valor: unknown): valor is EstadoTriaje {
  return (
    typeof valor === "string" &&
    (ESTADOS_TRIAJE as readonly string[]).includes(valor)
  );
}

export type ColaFiltros = {
  estado?: string;
  regionId?: string;
  distritoId?: string;
  /** `YYYY-MM-DD`, inclusivo. */
  desde?: string;
  /** `YYYY-MM-DD`, inclusivo. */
  hasta?: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

/**
 * Fila de la cola. La tabla no tiene código de señal ni tipo de señal: se
 * expone el código de la alerta temprana y el resto de columnas reales. La UI
 * declara el hueco con «—» en vez de inventarlo.
 */
export type ItemCola = {
  id: string;
  codigo: string;
  titulo: string | null;
  fecha: string | null;
  distritoId: number | null;
  distrito: string | null;
  ubigeo: string | null;
  provincia: string | null;
  region: string | null;
  prioridad: string | null;
  nivel: string | null;
  nivelCodigo: string | null;
  casoCodigo: string | null;
  situacionActual: string | null;
  hechosRecientes: string | null;
  descripcionRiesgo: string | null;
  riesgos: unknown;
  accionesSugeridas: unknown;
  fuenteTipo: string | null;
  fuenteDescripcion: string | null;
  fuenteUrl: string | null;
  clasificacion: number;
  estado: EstadoTriaje;
  motivo: string | null;
  /** Código de la alerta de la que ésta es duplicada, si se declaró. */
  duplicadaDe: string | null;
  triadoPor: string | null;
  /** Instante ISO 8601 del último triaje, o `null`. */
  triadoEn: string | null;
};

export type ConteosCola = {
  total: number;
  pendiente: number;
  en_triage: number;
  confirmada: number;
  descartada: number;
  duplicada: number;
};

export type FuenteCola = {
  /** `null`: no hay conector RED-RADAR ni tabla de señales. */
  senalesRecibidas: number | null;
  /** Filas de la cola cuyo `fuente_tipo` declara RADAR. */
  conFuenteRadar: number;
};

export type ColaResultado = {
  elementos: ItemCola[];
  total: number;
  pagina: number;
  tamanoPagina: number;
  conteos: ConteosCola;
  fuente: FuenteCola;
  /** Fecha de hoy (`YYYY-MM-DD`) para comparaciones de la interfaz. */
  hoy: string;
  generadoEn: string;
};

export type TriajeAlerta = {
  estado: EstadoTriaje;
  motivo: string | null;
  duplicadaDe: string | null;
  duplicadaDeCodigo: string | null;
  triadoPor: string | null;
  triadoEn: string | null;
};

export type DetalleRedRadar = {
  alerta: AlertItem;
  demandas: AlertDemanda[];
  /** Ubigeo INEI del distrito de la alerta; la ficha de alertas no lo trae. */
  ubigeo: string | null;
  /** `null` mientras la alerta no tenga fila de triaje. */
  triaje: TriajeAlerta | null;
  generadoEn: string;
};

/* ------------------------------------------------------------------------- *
 * Utilidades
 * ------------------------------------------------------------------------- */

/** `pg` devuelve `timestamptz` como `Date`; se normaliza a ISO. */
function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function idPositivo(valor: string | undefined): number | null {
  const texto = valor?.trim();
  if (!texto) return null;
  const numero = Number(texto);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

function fechaValida(valor: string | undefined): string | null {
  const texto = valor?.trim();
  return texto && FECHA_ISO.test(texto) ? texto : null;
}

/**
 * Construye el WHERE y los parámetros de la cola.
 *
 * Los filtros tolerantes son deliberados: un estado, región o fecha que no se
 * reconoce se ignora en vez de romper la consulta, igual que en el listado de
 * alertas. El filtro de estado se puede omitir para calcular los contadores de
 * los chips (que muestran el total por estado bajo el resto de filtros).
 */
function filtrosSql(filtros: ColaFiltros, conEstado: boolean) {
  const params: unknown[] = [];
  const where: string[] = ["a.anulado_en is null", "a.archivado_en is null"];
  const bind = (valor: unknown): string => {
    params.push(valor);
    return `$${params.length}`;
  };

  if (conEstado && esEstadoTriaje(filtros.estado)) {
    where.push(`coalesce(t.estado, 'pendiente') = ${bind(filtros.estado)}`);
  }

  const regionId = idPositivo(filtros.regionId);
  if (regionId !== null)
    where.push(`coalesce(rr.id, rd.id) = ${bind(regionId)}`);

  const distritoId = idPositivo(filtros.distritoId);
  if (distritoId !== null) where.push(`a.distrito_id = ${bind(distritoId)}`);

  const desde = fechaValida(filtros.desde);
  if (desde) where.push(`a.fecha_reporte >= ${bind(desde)}::date`);

  const hasta = fechaValida(filtros.hasta);
  if (hasta) where.push(`a.fecha_reporte <= ${bind(hasta)}::date`);

  const busqueda = filtros.q?.trim();
  if (busqueda) {
    const like = bind(`%${busqueda}%`);
    where.push(
      `(core.normalizar_ref(a.codigo_alerta) like core.normalizar_ref(${like})
        or core.normalizar_ref(a.titulo) like core.normalizar_ref(${like})
        or core.normalizar_ref(coalesce(a.situacion_actual, '')) like core.normalizar_ref(${like}))`,
    );
  }

  return { where, params, bind };
}

const COLA_SELECT = `
  a.id,
  a.codigo_alerta as codigo,
  a.titulo,
  to_char(a.fecha_reporte, 'YYYY-MM-DD') as fecha,
  a.distrito_id,
  d.nombre as distrito,
  d.ubigeo,
  pd.nombre as provincia,
  coalesce(rr.nombre, rd.nombre) as region,
  pa.codigo as prioridad,
  na.nombre as nivel,
  na.codigo_legado as nivel_codigo,
  c.codigo_caso as caso_codigo,
  a.situacion_actual,
  a.hechos_recientes,
  a.descripcion_riesgo,
  a.riesgos_json as riesgos,
  a.acciones_sugeridas_json as acciones_sugeridas,
  a.fuente_tipo,
  a.fuente_descripcion,
  a.fuente_url,
  a.nivel_clasificacion::int as clasificacion,
  coalesce(t.estado, 'pendiente') as estado,
  t.motivo,
  at.codigo_alerta as duplicada_codigo,
  tu.nombre as triado_por,
  t.triado_en
`;

const COLA_FROM = `
  from core.alertas_tempranas a
  left join core.alerta_triaje t on t.alerta_id = a.id
  left join core.alertas_tempranas at on at.id = t.duplicada_de
  left join core.usuarios tu on tu.id = t.triado_por
  left join core.casos c on c.id = a.caso_id
  left join core.cat_prioridades_alerta pa on pa.id = a.prioridad_id
  left join core.cat_niveles_alerta na on na.id = a.nivel_alerta_id
  left join core.distritos d on d.id = a.distrito_id
  left join core.provincias pd on pd.id = d.provincia_id
  left join core.regiones rd on rd.id = pd.region_id
  left join core.regiones rr on rr.id = a.region_id
`;

function mapItem(row: Record<string, any>): ItemCola {
  const estado: EstadoTriaje = esEstadoTriaje(row.estado)
    ? row.estado
    : "pendiente";

  return {
    id: row.id,
    codigo: row.codigo,
    titulo: row.titulo,
    fecha: row.fecha,
    distritoId: row.distrito_id,
    distrito: row.distrito,
    ubigeo: row.ubigeo,
    provincia: row.provincia,
    region: row.region,
    prioridad: row.prioridad,
    nivel: row.nivel,
    nivelCodigo: row.nivel_codigo,
    casoCodigo: row.caso_codigo,
    situacionActual: row.situacion_actual,
    hechosRecientes: row.hechos_recientes,
    descripcionRiesgo: row.descripcion_riesgo,
    riesgos: row.riesgos,
    accionesSugeridas: row.acciones_sugeridas,
    fuenteTipo: row.fuente_tipo,
    fuenteDescripcion: row.fuente_descripcion,
    fuenteUrl: row.fuente_url,
    clasificacion: row.clasificacion,
    estado,
    motivo: row.motivo,
    duplicadaDe: row.duplicada_codigo,
    triadoPor: row.triado_por,
    triadoEn: isoOrNull(row.triado_en),
  };
}

/* ------------------------------------------------------------------------- *
 * Lectura
 * ------------------------------------------------------------------------- */

/**
 * Cola de la bandeja RED-RADAR.
 *
 * No hay tabla de señales: la cola se alimenta de `core.alertas_tempranas`
 * vigentes (no anuladas ni archivadas) con su estado de triaje resuelto
 * (`pendiente` cuando no hay fila en `core.alerta_triaje`). Los contadores se
 * calculan sin el filtro de estado para alimentar los chips.
 */
export async function listarCola(
  client: PoolClient,
  filtros: ColaFiltros,
): Promise<ColaResultado> {
  const page = Math.max(1, Math.trunc(filtros.page ?? 1));
  const pageSize = Math.min(
    100,
    Math.max(1, Math.trunc(filtros.pageSize ?? 25)),
  );

  const { where, params, bind } = filtrosSql(filtros, true);

  const sql = `
    select ${COLA_SELECT},
           count(*) over()::int as total
    ${COLA_FROM}
    where ${where.join(" and ")}
    order by a.fecha_reporte desc nulls last, a.codigo_alerta asc
    limit ${bind(pageSize)} offset ${bind((page - 1) * pageSize)}
  `;

  const resultado = await client.query(sql, params);

  const conteos = await contarPorEstado(client, filtros);
  const fuente = await contarFuente(client);
  const total = resultado.rows[0]?.total ?? 0;

  return {
    elementos: resultado.rows.map(mapItem),
    total,
    pagina: page,
    tamanoPagina: pageSize,
    conteos,
    fuente,
    hoy: new Date().toISOString().slice(0, 10),
    generadoEn: new Date().toISOString(),
  };
}

/** Contadores por estado bajo el resto de filtros (sin filtrar por estado). */
async function contarPorEstado(
  client: PoolClient,
  filtros: ColaFiltros,
): Promise<ConteosCola> {
  const { where, params } = filtrosSql(filtros, false);

  const sql = `
    select coalesce(t.estado, 'pendiente') as estado, count(*)::int as n
    ${COLA_FROM}
    where ${where.join(" and ")}
    group by 1
  `;

  const resultado = await client.query(sql, params);
  const conteos: ConteosCola = {
    total: 0,
    pendiente: 0,
    en_triage: 0,
    confirmada: 0,
    descartada: 0,
    duplicada: 0,
  };

  for (const fila of resultado.rows) {
    const estado = fila.estado as EstadoTriaje;
    const n = Number(fila.n) || 0;
    if (esEstadoTriaje(estado)) conteos[estado] += n;
    conteos.total += n;
  }

  return conteos;
}

/**
 * «Convertidas en alerta» del mockup: filas cuyo `fuente_tipo` declara RADAR.
 * Hoy no hay ninguna. No se estima: si no hay filas, el número es 0.
 */
async function contarFuente(client: PoolClient): Promise<FuenteCola> {
  const resultado = await client.query(
    `select count(*)::int as n
       from core.alertas_tempranas a
      where a.anulado_en is null
        and a.archivado_en is null
        and a.fuente_tipo ilike '%radar%'`,
  );

  return {
    senalesRecibidas: null,
    conFuenteRadar: Number(resultado.rows[0]?.n ?? 0),
  };
}

/**
 * Detalle de una alerta de la cola: reutiliza `getAlertById` (mismo contrato que
 * la ficha de alertas) y añade el triaje vigente. Devuelve `null` si la alerta
 * no existe o queda fuera del alcance de la sesión.
 */
export async function obtenerDetalle(
  client: PoolClient,
  idOrCodigo: string,
): Promise<DetalleRedRadar | null> {
  const detalle = await getAlertById(client, idOrCodigo);
  if (!detalle) return null;

  const triaje = await leerTriaje(client, detalle.alert.id);

  // `getAlertById` no selecciona el ubigeo; se resuelve aparte para que el
  // bloque «Ubicación» del panel lo pueda mostrar sin inventarlo.
  let ubigeo: string | null = null;
  if (detalle.alert.distritoId !== null) {
    const ubigeoResult = await client.query(
      `select ubigeo from core.distritos where id = $1 limit 1`,
      [detalle.alert.distritoId],
    );
    ubigeo = ubigeoResult.rows[0]?.ubigeo ?? null;
  }

  return {
    alerta: detalle.alert,
    demandas: detalle.demandas,
    ubigeo,
    triaje,
    generadoEn: new Date().toISOString(),
  };
}

async function leerTriaje(
  client: PoolClient,
  alertaId: string,
): Promise<TriajeAlerta | null> {
  const resultado = await client.query(
    `select t.estado,
            t.motivo,
            t.duplicada_de,
            at.codigo_alerta as duplicada_codigo,
            tu.nombre as triado_por,
            t.triado_en
       from core.alerta_triaje t
       left join core.alertas_tempranas at on at.id = t.duplicada_de
       left join core.usuarios tu on tu.id = t.triado_por
      where t.alerta_id = $1
      limit 1`,
    [alertaId],
  );

  const fila = resultado.rows[0];
  if (!fila) return null;

  const estado: EstadoTriaje = esEstadoTriaje(fila.estado)
    ? fila.estado
    : "pendiente";

  return {
    estado,
    motivo: fila.motivo,
    duplicadaDe: fila.duplicada_de,
    duplicadaDeCodigo: fila.duplicada_codigo,
    triadoPor: fila.triado_por,
    triadoEn: isoOrNull(fila.triado_en),
  };
}

/* ------------------------------------------------------------------------- *
 * Escritura · triaje
 * ------------------------------------------------------------------------- */

function leerTexto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim();
  return limpio ? limpio : null;
}

/**
 * Registra (o rehace) el triaje de una alerta.
 *
 * Las reglas que la base también impone se cortan antes con un mensaje claro:
 * descartar o marcar duplicada exige motivo; marcar duplicada de una alerta
 * inexistente es un 422, no un 404 genérico. El cambio queda en la misma
 * transacción que la fila de auditoría.
 */
export async function registrarTriaje(
  client: PoolClient,
  session: WriteSession,
  idOrCodigo: string,
  cuerpo: Record<string, unknown>,
): Promise<TriajeAlerta> {
  const estado = cuerpo["estado"];
  if (!esEstadoTriaje(estado)) {
    throw new ApiError(
      422,
      "El estado de triaje no es válido.",
      "ESTADO_INVALIDO",
    );
  }

  const motivo = leerTexto(cuerpo["motivo"]);
  if (ESTADOS_CON_MOTIVO.has(estado) && !motivo) {
    throw new ApiError(
      422,
      "El motivo es obligatorio al descartar o marcar una alerta como duplicada.",
      "MOTIVO_REQUERIDO",
    );
  }

  // La alerta debe existir y estar vigente dentro del alcance de la sesión.
  const alertaResult = await client.query(
    `select a.id, a.nivel_clasificacion::int as clasificacion
       from core.alertas_tempranas a
      where (a.id::text = $1 or a.codigo_alerta = $1)
        and a.anulado_en is null
      limit 1`,
    [idOrCodigo],
  );
  const alerta = alertaResult.rows[0];
  if (!alerta) {
    throw new ApiError(404, "La alerta no existe.", "NOT_FOUND");
  }

  // Duplicada: el código referido debe existir y no ser la misma alerta.
  let duplicadaDe: string | null = null;
  if (estado === "duplicada") {
    const referencia = leerTexto(cuerpo["duplicadaDeCodigo"]);
    if (referencia) {
      const dupResult = await client.query(
        `select a.id
           from core.alertas_tempranas a
          where a.codigo_alerta = $1
            and a.anulado_en is null
          limit 1`,
        [referencia],
      );
      const dup = dupResult.rows[0];
      if (!dup) {
        throw new ApiError(
          422,
          `No existe una alerta con el código «${referencia}».`,
          "DUPLICADA_INEXISTENTE",
        );
      }
      if (dup.id === alerta.id) {
        throw new ApiError(
          422,
          "Una alerta no puede ser duplicada de sí misma.",
          "DUPLICADA_CICLICA",
        );
      }
      duplicadaDe = dup.id;
    }
  }

  const previo = await client.query(
    `select id, estado, motivo, duplicada_de
       from core.alerta_triaje
      where alerta_id = $1
      limit 1`,
    [alerta.id],
  );
  const antes = previo.rows[0] ?? null;

  const resultado = await client.query(
    `insert into core.alerta_triaje
       (alerta_id, estado, motivo, duplicada_de, nivel_clasificacion, triado_por, triado_en)
     values ($1, $2, $3, $4, $5, $6, now())
     on conflict (alerta_id) do update
        set estado = excluded.estado,
            motivo = excluded.motivo,
            duplicada_de = excluded.duplicada_de,
            nivel_clasificacion = excluded.nivel_clasificacion,
            triado_por = excluded.triado_por,
            triado_en = now()
     returning id, estado, motivo, duplicada_de, triado_por, triado_en`,
    [
      alerta.id,
      estado,
      motivo,
      duplicadaDe,
      alerta.clasificacion,
      session.usuarioId,
    ],
  );

  const fila = resultado.rows[0];

  await auditChange(client, {
    tabla: "core.alerta_triaje",
    registroId: fila.id,
    accion: antes ? "UPDATE" : "INSERT",
    usuarioId: session.usuarioId,
    rolCodigo: session.rolCodigo,
    antes: antes
      ? {
          estado: antes.estado,
          motivo: antes.motivo,
          duplicada_de: antes.duplicada_de,
        }
      : null,
    despues: {
      alerta_id: alerta.id,
      estado: fila.estado,
      motivo: fila.motivo,
      duplicada_de: fila.duplicada_de,
    },
  });

  const duplicateCode = duplicadaDe
    ? ((
        await client.query(
          `select codigo_alerta from core.alertas_tempranas where id = $1`,
          [duplicadaDe],
        )
      ).rows[0]?.codigo_alerta ?? null)
    : null;

  return {
    estado: esEstadoTriaje(fila.estado) ? fila.estado : "pendiente",
    motivo: fila.motivo,
    duplicadaDe: fila.duplicada_de,
    duplicadaDeCodigo: duplicateCode,
    triadoPor: fila.triado_por,
    triadoEn: isoOrNull(fila.triado_en),
  };
}
