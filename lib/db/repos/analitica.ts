import type { PoolClient } from "pg";

import { ApiError } from "../errors";
import { excluirCasosMesa } from "./casos-filtro";

/**
 * Dashboard analítico: series temporales de actividad de la oficina (item 57).
 *
 * Todo se calcula sobre datos reales y bajo la RLS de la sesión. El diseño tiene
 * dos ejes que **no** se mezclan:
 *
 * - **Fecha de negocio** (`fecha_inicio`, `fecha_reporte`, `fecha_registro`,
 *   `fecha` de documentos y reuniones): es el eje histórico defendible. Alimenta
 *   el volumen por periodo, la mezcla latente/manifiesto y la tabla-resumen.
 * - **Marca de carga** (`created_at` + `created_by`): sólo sirve para ver quién
 *   subió registros y qué día. En el legado es una única fecha de importación,
 *   así que se devuelve con un veredicto de confiabilidad explícito; la UI no
 *   debe presentarla como actividad histórica si no lo es.
 *
 * No hay vista `analytics.vw_*` ni migración: la lógica vive aquí y se apoya en
 * una tabla temporal construida una vez por petición.
 */

export type GranularidadAnalitica = "mes" | "semana";

export type AnaliticaQuery = {
  desde?: string;
  hasta?: string;
  granularidad?: string;
  region?: string;
  subsector?: string;
};

export type OpcionAnalitica = { valor: string; etiqueta: string };

export type PeriodoVolumen = {
  inicio: string;
  fin: string;
  casos: number;
  demandas: number;
  alertas: number;
  compromisos: number;
  documentos: number;
  reuniones: number;
  manifiesto: number;
  latente: number;
  sinNivel: number;
};

export type TotalesVolumen = {
  casos: number;
  demandas: number;
  alertas: number;
  compromisos: number;
  documentos: number;
  reuniones: number;
  manifiesto: number;
  latente: number;
  sinNivel: number;
};

export type FilaResumenAnalitica = {
  clave: string;
  etiqueta: string;
  conFecha: number;
  sinFecha: number;
  primera: string | null;
  ultima: string | null;
  usuarios: number;
};

export type ActividadDia = {
  fecha: string;
  registros: number;
  usuarios: number;
  legado: number;
  sinUsuario: number;
};

export type ActividadUsuario = {
  usuarioId: string | null;
  usuario: string | null;
  registros: number;
  legado: number;
  primera: string | null;
  ultima: string | null;
};

export type AnaliticaPayload = {
  generadoEn: string;
  zonaHoraria: string;
  corte: {
    datosDesde: string | null;
    datosHasta: string | null;
    ventanaDesde: string | null;
    ventanaHasta: string | null;
    solicitadoDesde: string | null;
    solicitadoHasta: string | null;
  };
  filtros: {
    granularidad: GranularidadAnalitica;
    region: string | null;
    subsector: string | null;
  };
  volumen: {
    granularidad: GranularidadAnalitica;
    series: readonly string[];
    periodos: readonly PeriodoVolumen[];
    totales: TotalesVolumen;
  };
  actividad: {
    confiable: boolean;
    motivo: string | null;
    dias: number;
    rango: { primera: string | null; ultima: string | null };
    totalRegistros: number;
    totalLegado: number;
    totalSinUsuario: number;
    porDia: readonly ActividadDia[];
    porUsuario: readonly ActividadUsuario[];
  };
  resolucionCompromisos: {
    total: number;
    terminales: number;
    conVencimiento: number;
    muestra: number;
    mediaDias: number | null;
    hitosCumplidos: number;
    mediaHitosDias: number | null;
    hitosMinDias: number | null;
    hitosMaxDias: number | null;
    motivo: string | null;
  };
  resumen: {
    filas: readonly FilaResumenAnalitica[];
    totalRegistros: number;
    totalSinFecha: number;
  };
  catalogos: {
    regiones: readonly OpcionAnalitica[];
    subsectores: readonly OpcionAnalitica[];
  };
};

/** Orden fijo de las entidades en series, tabla y exportación. */
const ENTIDADES: readonly { clave: string; etiqueta: string }[] = [
  { clave: "casos", etiqueta: "Casos" },
  { clave: "demandas", etiqueta: "Demandas" },
  { clave: "alertas", etiqueta: "Alertas" },
  { clave: "compromisos", etiqueta: "Compromisos" },
  { clave: "documentos", etiqueta: "Documentos" },
  { clave: "reuniones", etiqueta: "Reuniones" },
];

const SERIES = ENTIDADES.map((entidad) => entidad.clave);

const MENSAJE_ESQUEMA =
  "El dashboard analítico todavía no está disponible: falta una pieza del esquema en la base de datos.";

const COLUMNAS_REQUERIDAS: readonly (readonly [string, string])[] = [
  ["core.casos", "id"],
  ["core.casos", "fecha_inicio"],
  ["core.casos", "created_at"],
  ["core.casos", "created_by"],
  ["core.casos", "origen_dato"],
  ["core.casos", "anulado_en"],
  ["core.casos", "nivel_conflicto_id"],
  ["core.casos", "region_principal_id"],
  ["core.casos", "subsector_id"],
  ["core.caso_regiones", "caso_id"],
  ["core.caso_regiones", "region_id"],
  ["core.demandas", "id"],
  ["core.demandas", "caso_id"],
  ["core.demandas", "fecha_registro"],
  ["core.demandas", "created_at"],
  ["core.demandas", "created_by"],
  ["core.demandas", "origen_dato"],
  ["core.demandas", "anulado_en"],
  ["core.alertas_tempranas", "id"],
  ["core.alertas_tempranas", "fecha_reporte"],
  ["core.alertas_tempranas", "region_id"],
  ["core.alertas_tempranas", "subsector_id"],
  ["core.alertas_tempranas", "created_at"],
  ["core.alertas_tempranas", "created_by"],
  ["core.alertas_tempranas", "origen_dato"],
  ["core.alertas_tempranas", "anulado_en"],
  ["core.compromisos", "id"],
  ["core.compromisos", "caso_id"],
  ["core.compromisos", "fecha_inicio"],
  ["core.compromisos", "estado_id"],
  ["core.compromisos", "fecha_vencimiento"],
  ["core.compromisos", "created_at"],
  ["core.compromisos", "created_by"],
  ["core.compromisos", "origen_dato"],
  ["core.compromisos", "anulado_en"],
  ["core.documentos", "id"],
  ["core.documentos", "caso_id"],
  ["core.documentos", "fecha"],
  ["core.documentos", "created_at"],
  ["core.documentos", "created_by"],
  ["core.documentos", "origen_dato"],
  ["core.documentos", "anulado_en"],
  ["core.reuniones_dialogo", "id"],
  ["core.reuniones_dialogo", "caso_id"],
  ["core.reuniones_dialogo", "fecha"],
  ["core.reuniones_dialogo", "created_at"],
  ["core.reuniones_dialogo", "created_by"],
  ["core.reuniones_dialogo", "origen_dato"],
  ["core.reuniones_dialogo", "archivado_en"],
  ["core.hitos_compromiso", "compromiso_id"],
  ["core.hitos_compromiso", "fecha_real"],
  ["core.hitos_compromiso", "estado_id"],
  ["core.hitos_compromiso", "anulado_en"],
  ["core.regiones", "id"],
  ["core.regiones", "nombre"],
  ["core.cat_subsectores", "id"],
  ["core.cat_subsectores", "nombre"],
  ["core.usuarios", "id"],
  ["core.usuarios", "nombre"],
];

/**
 * Corta con 503 `ESQUEMA_PENDIENTE` si falta alguna columna de la que dependen
 * las series. Se comprueba antes de consultar para no dibujar una tarjeta con
 * ceros que en realidad significan «no existe la tabla».
 */
export async function verificarEsquemaAnalitica(
  client: PoolClient,
): Promise<void> {
  const result = await client.query<{ tabla: string; columna: string }>(`
    select table_schema || '.' || table_name as tabla,
           column_name as columna
      from information_schema.columns
     where table_schema = 'core'
       and table_name in ('casos', 'caso_regiones', 'demandas', 'alertas_tempranas',
                          'compromisos', 'documentos', 'reuniones_dialogo',
                          'hitos_compromiso', 'regiones', 'cat_subsectores', 'usuarios')
  `);

  const presentes = new Set(
    result.rows.map((fila) => `${fila.tabla}.${fila.columna}`),
  );
  const faltantes = COLUMNAS_REQUERIDAS.filter(
    ([tabla, columna]) => !presentes.has(`${tabla}.${columna}`),
  ).map(([tabla, columna]) => `${tabla}.${columna}`);

  if (faltantes.length > 0) {
    throw new ApiError(
      503,
      `${MENSAJE_ESQUEMA} Falta: ${faltantes.join(", ")}.`,
      "ESQUEMA_PENDIENTE",
    );
  }
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function validarFecha(valor: string, parametro: string): string {
  if (!FECHA_ISO.test(valor)) {
    throw new ApiError(
      422,
      `El parámetro ${parametro} debe tener el formato aaaa-mm-dd.`,
      "FECHA_INVALIDA",
    );
  }
  return valor;
}

function numero(valor: unknown): number {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string" && valor.trim() !== "") {
    const leido = Number(valor);
    if (Number.isFinite(leido)) return leido;
  }
  return 0;
}

function numeroONulo(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string" && valor.trim() !== "") {
    const leido = Number(valor);
    if (Number.isFinite(leido)) return leido;
  }
  return null;
}

function textoONulo(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim();
  return limpio === "" ? null : limpio;
}

function fechaDdMmAaaa(valor: string | null): string {
  if (!valor) return "sin fecha";
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor);
  if (!partes) return valor;
  return `${partes[3]}/${partes[2]}/${partes[1]}`;
}

function formatearPorcentaje(valor: number): string {
  return `${new Intl.NumberFormat("es-PE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(valor)} %`;
}

/**
 * Resuelve el nombre de una región o subsector al id que usan los filtros.
 * Un nombre desconocido se rechaza con 422 en vez de devolver una serie vacía
 * que parecería «no hay datos».
 */
async function resolverRegion(
  client: PoolClient,
  nombre: string | null,
): Promise<number | null> {
  if (!nombre) return null;
  const result = await client.query<{ id: number }>(
    `select id
       from core.regiones
      where nombre = $1 or lower(nombre) = lower($1)
      order by (nombre = $1) desc
      limit 1`,
    [nombre],
  );
  const fila = result.rows[0];
  if (!fila) {
    throw new ApiError(422, "Región no reconocida.", "REGION_INVALIDA");
  }
  return fila.id;
}

async function resolverSubsector(
  client: PoolClient,
  nombre: string | null,
): Promise<number | null> {
  if (!nombre) return null;
  const result = await client.query<{ id: number }>(
    `select id
       from core.cat_subsectores
      where nombre = $1 or lower(nombre) = lower($1)
      order by (nombre = $1) desc
      limit 1`,
    [nombre],
  );
  const fila = result.rows[0];
  if (!fila) {
    throw new ApiError(422, "Subsector no reconocido.", "SUBSECTOR_INVALIDO");
  }
  return fila.id;
}

/**
 * Construye la base homogénea de las seis entidades. Todas las filas quedan con
 * `fecha` (eje de negocio), `creado_en`, `creado_por` y `origen`.
 *
 * Región y subsector se aplican aquí una sola vez. Para las entidades que
 * cuelgan de un caso, el filtro exige que el caso exista y no esté anulado: con
 * un filtro territorial activo, las filas sin caso quedan fuera y la UI lo
 * declara.
 */
const SQL_BASE = `
create temp table analitica_base on commit drop as
select 'casos'::text as clave,
       c.id as registro_id,
       c.fecha_inicio as fecha,
       c.created_at as creado_en,
       c.created_by as creado_por,
       c.origen_dato::text as origen,
       (case when c.nivel_conflicto_id in (3, 4) then 'manifiesto'
             when c.nivel_conflicto_id in (1, 2) then 'latente'
             else 'sin_nivel' end) as grupo,
       null::smallint as estado,
       null::date as vencimiento
  from core.casos c
 where c.anulado_en is null
   and ${excluirCasosMesa("c")}
   and ($1::int is null
        or c.region_principal_id = $1
        or exists (select 1
                     from core.caso_regiones cr
                    where cr.caso_id = c.id and cr.region_id = $1))
   and ($2::int is null or c.subsector_id = $2)

union all
select 'demandas'::text,
       d.id,
       d.fecha_registro,
       d.created_at,
       d.created_by,
       d.origen_dato::text,
       null::text,
       null::smallint,
       null::date
  from core.demandas d
  left join core.casos c on c.id = d.caso_id and c.anulado_en is null
 where d.anulado_en is null
   and ($1::int is null
        or c.region_principal_id = $1
        or exists (select 1
                     from core.caso_regiones cr
                    where cr.caso_id = c.id and cr.region_id = $1))
   and ($2::int is null or c.subsector_id = $2)

union all
select 'alertas'::text,
       a.id,
       a.fecha_reporte,
       a.created_at,
       a.created_by,
       a.origen_dato::text,
       null::text,
       null::smallint,
       null::date
  from core.alertas_tempranas a
 where a.anulado_en is null
   and ($1::int is null or a.region_id = $1)
   and ($2::int is null or a.subsector_id = $2)

union all
select 'compromisos'::text,
       cm.id,
       cm.fecha_inicio,
       cm.created_at,
       cm.created_by,
       cm.origen_dato::text,
       null::text,
       cm.estado_id,
       cm.fecha_vencimiento
  from core.compromisos cm
  left join core.casos c on c.id = cm.caso_id and c.anulado_en is null
 where cm.anulado_en is null
   and ($1::int is null
        or c.region_principal_id = $1
        or exists (select 1
                     from core.caso_regiones cr
                    where cr.caso_id = c.id and cr.region_id = $1))
   and ($2::int is null or c.subsector_id = $2)

union all
select 'documentos'::text,
       doc.id,
       doc.fecha,
       doc.created_at,
       doc.created_by,
       doc.origen_dato::text,
       null::text,
       null::smallint,
       null::date
  from core.documentos doc
  left join core.casos c on c.id = doc.caso_id and c.anulado_en is null
 where doc.anulado_en is null
   and ($1::int is null
        or c.region_principal_id = $1
        or exists (select 1
                     from core.caso_regiones cr
                    where cr.caso_id = c.id and cr.region_id = $1))
   and ($2::int is null or c.subsector_id = $2)

union all
select 'reuniones'::text,
       r.id,
       (r.fecha at time zone 'America/Lima')::date,
       r.created_at,
       r.created_by,
       r.origen_dato::text,
       null::text,
       null::smallint,
       null::date
  from core.reuniones_dialogo r
  left join core.casos c on c.id = r.caso_id and c.anulado_en is null
 where r.archivado_en is null
   and ($1::int is null
        or c.region_principal_id = $1
        or exists (select 1
                     from core.caso_regiones cr
                    where cr.caso_id = c.id and cr.region_id = $1))
   and ($2::int is null or c.subsector_id = $2)
`;

type FilaPeriodo = {
  inicio: string;
  fin: string;
  casos: number;
  demandas: number;
  alertas: number;
  compromisos: number;
  documentos: number;
  reuniones: number;
  manifiesto: number;
  latente: number;
  sin_nivel: number;
};

type FilaResumen = {
  clave: string;
  con_fecha: number;
  sin_fecha: number;
  primera: string | null;
  ultima: string | null;
  usuarios: number;
};

type FilaDia = {
  fecha: string;
  registros: number;
  usuarios: number;
  legado: number;
  sin_usuario: number;
};

type FilaUsuario = {
  usuario_id: string | null;
  usuario: string | null;
  registros: number;
  legado: number;
  primera: string | null;
  ultima: string | null;
};

type FilaCompromisos = {
  total: number;
  terminales: number;
  con_vencimiento: number;
};

type FilaMedia = {
  muestra: number;
  media_dias: number | null;
  minimo?: number | null;
  maximo?: number | null;
};

/**
 * Carga el dashboard completo. La granularidad sólo acepta `mes` o `semana`;
 * cualquier otro valor cae en `mes` para no romper la pantalla.
 */
export async function cargarAnalitica(
  client: PoolClient,
  query: AnaliticaQuery,
): Promise<AnaliticaPayload> {
  const granularidad: GranularidadAnalitica =
    query.granularidad === "semana" ? "semana" : "mes";
  const unidad = granularidad === "semana" ? "week" : "month";
  const paso = granularidad === "semana" ? "7 days" : "1 month";

  const desde = query.desde ? validarFecha(query.desde, "desde") : null;
  const hasta = query.hasta ? validarFecha(query.hasta, "hasta") : null;
  if (desde && hasta && hasta < desde) {
    throw new ApiError(
      422,
      "La fecha «hasta» no puede ser anterior a «desde».",
      "RANGO_INVALIDO",
    );
  }

  const regionId = await resolverRegion(client, query.region?.trim() || null);
  const subsectorId = await resolverSubsector(
    client,
    query.subsector?.trim() || null,
  );

  await client.query(SQL_BASE, [regionId, subsectorId]);

  const conteo = await client.query<{ n: number }>(
    "select count(*)::int as n from analitica_base",
  );
  const totalBase = numero(conteo.rows[0]?.n);

  const corteResult = await client.query<{
    desde: string | null;
    hasta: string | null;
  }>(`
    select to_char(min(fecha), 'YYYY-MM-DD') as desde,
           to_char(max(fecha), 'YYYY-MM-DD') as hasta
      from analitica_base
  `);
  const datosDesde = corteResult.rows[0]?.desde ?? null;
  const datosHasta = corteResult.rows[0]?.hasta ?? null;

  const ventanaDesde = desde ?? datosDesde;
  const ventanaHasta = hasta ?? datosHasta;

  const periodos: PeriodoVolumen[] =
    totalBase === 0 || !datosDesde || !datosHasta
      ? []
      : (
          await client.query<FilaPeriodo>(
            `
            with limites as (
              select coalesce($1::date, min(fecha)) as desde,
                     coalesce($2::date, max(fecha)) as hasta
                from analitica_base
            ),
            periodos as (
              select gs::date as inicio,
                     ((gs + interval '${paso}')::date - 1) as fin
                from limites l,
                     generate_series(
                       date_trunc('${unidad}', l.desde::timestamp),
                       date_trunc('${unidad}', coalesce(l.hasta, l.desde)::timestamp),
                       interval '${paso}'
                     ) as gs
               where l.desde is not null
            )
            select to_char(p.inicio, 'YYYY-MM-DD') as inicio,
                   to_char(p.fin, 'YYYY-MM-DD') as fin,
                   count(*) filter (where b.clave = 'casos')::int as casos,
                   count(*) filter (where b.clave = 'demandas')::int as demandas,
                   count(*) filter (where b.clave = 'alertas')::int as alertas,
                   count(*) filter (where b.clave = 'compromisos')::int as compromisos,
                   count(*) filter (where b.clave = 'documentos')::int as documentos,
                   count(*) filter (where b.clave = 'reuniones')::int as reuniones,
                   count(*) filter (where b.grupo = 'manifiesto')::int as manifiesto,
                   count(*) filter (where b.grupo = 'latente')::int as latente,
                   count(*) filter (where b.grupo = 'sin_nivel')::int as sin_nivel
              from periodos p
              left join analitica_base b
                on b.fecha between greatest(p.inicio, coalesce($1::date, p.inicio))
                              and least(p.fin, coalesce($2::date, p.fin))
             group by p.inicio, p.fin
             order by p.inicio
            `,
            [desde, hasta],
          )
        ).rows.map((fila) => ({
          inicio: fila.inicio,
          fin: fila.fin,
          casos: numero(fila.casos),
          demandas: numero(fila.demandas),
          alertas: numero(fila.alertas),
          compromisos: numero(fila.compromisos),
          documentos: numero(fila.documentos),
          reuniones: numero(fila.reuniones),
          manifiesto: numero(fila.manifiesto),
          latente: numero(fila.latente),
          sinNivel: numero(fila.sin_nivel),
        }));

  const totales: TotalesVolumen = periodos.reduce<TotalesVolumen>(
    (acumulado, periodo) => ({
      casos: acumulado.casos + periodo.casos,
      demandas: acumulado.demandas + periodo.demandas,
      alertas: acumulado.alertas + periodo.alertas,
      compromisos: acumulado.compromisos + periodo.compromisos,
      documentos: acumulado.documentos + periodo.documentos,
      reuniones: acumulado.reuniones + periodo.reuniones,
      manifiesto: acumulado.manifiesto + periodo.manifiesto,
      latente: acumulado.latente + periodo.latente,
      sinNivel: acumulado.sinNivel + periodo.sinNivel,
    }),
    {
      casos: 0,
      demandas: 0,
      alertas: 0,
      compromisos: 0,
      documentos: 0,
      reuniones: 0,
      manifiesto: 0,
      latente: 0,
      sinNivel: 0,
    },
  );

  const resumenResult = await client.query<FilaResumen>(
    `
    select clave,
           count(*) filter (
             where fecha is not null
               and ($1::date is null or fecha >= $1::date)
               and ($2::date is null or fecha <= $2::date)
           )::int as con_fecha,
           count(*) filter (where fecha is null)::int as sin_fecha,
           to_char(min(fecha) filter (
             where fecha is not null
               and ($1::date is null or fecha >= $1::date)
               and ($2::date is null or fecha <= $2::date)
           ), 'YYYY-MM-DD') as primera,
           to_char(max(fecha) filter (
             where fecha is not null
               and ($1::date is null or fecha >= $1::date)
               and ($2::date is null or fecha <= $2::date)
           ), 'YYYY-MM-DD') as ultima,
           count(distinct creado_por)::int as usuarios
      from analitica_base
     group by clave
    `,
    [desde, hasta],
  );

  const porClave = new Map(
    resumenResult.rows.map((fila) => [fila.clave, fila]),
  );
  const filasResumen: FilaResumenAnalitica[] = ENTIDADES.map((entidad) => {
    const fila = porClave.get(entidad.clave);
    return {
      clave: entidad.clave,
      etiqueta: entidad.etiqueta,
      conFecha: numero(fila?.con_fecha),
      sinFecha: numero(fila?.sin_fecha),
      primera: fila?.primera ?? null,
      ultima: fila?.ultima ?? null,
      usuarios: numero(fila?.usuarios),
    };
  });

  const resumenTotalRegistros = filasResumen.reduce(
    (suma, fila) => suma + fila.conFecha,
    0,
  );
  const resumenTotalSinFecha = filasResumen.reduce(
    (suma, fila) => suma + fila.sinFecha,
    0,
  );

  const porDiaResult = await client.query<FilaDia>(`
    select to_char((creado_en at time zone 'America/Lima')::date, 'YYYY-MM-DD') as fecha,
           count(*)::int as registros,
           count(distinct creado_por)::int as usuarios,
           count(*) filter (where origen = 'AVISA_HISTORICO')::int as legado,
           count(*) filter (where creado_por is null)::int as sin_usuario
      from analitica_base
     where creado_en is not null
     group by 1
     order by 1
  `);

  const porDia: ActividadDia[] = porDiaResult.rows.map((fila) => ({
    fecha: fila.fecha,
    registros: numero(fila.registros),
    usuarios: numero(fila.usuarios),
    legado: numero(fila.legado),
    sinUsuario: numero(fila.sin_usuario),
  }));

  const porUsuarioResult = await client.query<FilaUsuario>(`
    select b.creado_por::text as usuario_id,
           u.nombre as usuario,
           count(*)::int as registros,
           count(*) filter (where b.origen = 'AVISA_HISTORICO')::int as legado,
           to_char(min((b.creado_en at time zone 'America/Lima')::date), 'YYYY-MM-DD') as primera,
           to_char(max((b.creado_en at time zone 'America/Lima')::date), 'YYYY-MM-DD') as ultima
      from analitica_base b
      left join core.usuarios u on u.id = b.creado_por
     where b.creado_en is not null
     group by b.creado_por, u.nombre
     order by registros desc, u.nombre nulls last
  `);

  const porUsuario: ActividadUsuario[] = porUsuarioResult.rows.map((fila) => ({
    usuarioId: textoONulo(fila.usuario_id),
    usuario: textoONulo(fila.usuario),
    registros: numero(fila.registros),
    legado: numero(fila.legado),
    primera: fila.primera ?? null,
    ultima: fila.ultima ?? null,
  }));

  const totalRegistros = porDia.reduce((suma, dia) => suma + dia.registros, 0);
  const totalLegado = porDia.reduce((suma, dia) => suma + dia.legado, 0);
  const totalSinUsuario = porDia.reduce(
    (suma, dia) => suma + dia.sinUsuario,
    0,
  );
  const dias = porDia.length;
  const proporcionLegado =
    totalRegistros > 0 ? (totalLegado / totalRegistros) * 100 : 100;
  const diaConMasLegado = porDia.reduce<ActividadDia | undefined>(
    (mejor, dia) => (!mejor || dia.legado > mejor.legado ? dia : mejor),
    undefined,
  );

  let motivoActividad: string | null = null;
  if (totalRegistros === 0) {
    motivoActividad =
      "El conjunto filtrado no tiene marcas de tiempo de creación (created_at / created_by).";
  } else if (dias <= 1) {
    motivoActividad = `Todas las marcas de creación caen en un solo día (${fechaDdMmAaaa(
      porDia[0]?.fecha ?? null,
    )}): corresponden a la carga inicial del legado, no a actividad diaria registrada.`;
  } else if (proporcionLegado >= 95) {
    motivoActividad = `${formatearPorcentaje(
      proporcionLegado,
    )} de las marcas de creación provienen de la carga del legado (origen_dato = AVISA_HISTORICO), concentrada el ${fechaDdMmAaaa(
      diaConMasLegado?.fecha ?? null,
    )}. La serie por día no describe trabajo histórico real.`;
  }

  const compromisosResult = await client.query<FilaCompromisos>(
    `
    select count(*)::int as total,
           count(*) filter (where estado = 3)::int as terminales,
           count(*) filter (where vencimiento is not null)::int as con_vencimiento
      from analitica_base
     where clave = 'compromisos'
       and ($1::date is null or fecha is null or fecha >= $1::date)
       and ($2::date is null or fecha is null or fecha <= $2::date)
    `,
    [desde, hasta],
  );
  const compromisos = compromisosResult.rows[0];
  const totalCompromisos = numero(compromisos?.total);
  const terminales = numero(compromisos?.terminales);
  const conVencimiento = numero(compromisos?.con_vencimiento);

  const mediaResult = await client.query<FilaMedia>(
    `
    with cumplidos as (
      select b.registro_id,
             b.fecha as inicio,
             max(h.fecha_real) as cumplimiento
        from analitica_base b
        join core.hitos_compromiso h
          on h.compromiso_id = b.registro_id
         and h.anulado_en is null
         and h.fecha_real is not null
       where b.clave = 'compromisos'
         and b.estado = 3
         and ($1::date is null or b.fecha is null or b.fecha >= $1::date)
         and ($2::date is null or b.fecha is null or b.fecha <= $2::date)
       group by b.registro_id, b.fecha
    )
    select count(*)::int as muestra,
           avg((cumplimiento - inicio))::float8 as media_dias
      from cumplidos
    `,
    [desde, hasta],
  );
  const muestra = numero(mediaResult.rows[0]?.muestra);
  const mediaDias = numeroONulo(mediaResult.rows[0]?.media_dias);

  const hitosResult = await client.query<FilaMedia>(
    `
    with hitos as (
      select b.registro_id,
             b.fecha as inicio,
             max(h.fecha_real) as cumplimiento
        from analitica_base b
        join core.hitos_compromiso h
          on h.compromiso_id = b.registro_id
         and h.anulado_en is null
         and h.fecha_real is not null
       where b.clave = 'compromisos'
         and ($1::date is null or b.fecha is null or b.fecha >= $1::date)
         and ($2::date is null or b.fecha is null or b.fecha <= $2::date)
       group by b.registro_id, b.fecha
    )
    select count(*)::int as muestra,
           avg((cumplimiento - inicio))::float8 as media_dias,
           min((cumplimiento - inicio))::int as minimo,
           max((cumplimiento - inicio))::int as maximo
      from hitos
    `,
    [desde, hasta],
  );
  const hitosCumplidos = numero(hitosResult.rows[0]?.muestra);
  const mediaHitosDias = numeroONulo(hitosResult.rows[0]?.media_dias);
  const hitosMinDias = numeroONulo(hitosResult.rows[0]?.minimo);
  const hitosMaxDias = numeroONulo(hitosResult.rows[0]?.maximo);

  let motivoResolucion: string | null = null;
  if (totalCompromisos === 0) {
    motivoResolucion = "No hay compromisos en la ventana filtrada.";
  } else if (terminales === 0) {
    motivoResolucion = `Ninguno de los ${totalCompromisos} compromisos de la ventana está en estado terminal «Cumplido»: todos siguen en gestión. Además fecha_vencimiento está vacía en ${
      totalCompromisos - conVencimiento
    } de ${totalCompromisos}, así que no hay fecha de resolución que promediar.`;
  } else if (muestra === 0) {
    motivoResolucion = `Hay ${terminales} compromiso(s) en estado «Cumplido», pero ninguno tiene fecha de cumplimiento registrada (sin hitos con fecha real), así que el promedio no se puede calcular.`;
  }

  const regionesResult = await client.query<{ nombre: string }>(
    "select nombre from core.regiones order by nombre",
  );
  const subsectoresResult = await client.query<{ nombre: string }>(
    "select nombre from core.cat_subsectores order by id",
  );

  return {
    generadoEn: new Date().toISOString(),
    zonaHoraria: "America/Lima",
    corte: {
      datosDesde,
      datosHasta,
      ventanaDesde,
      ventanaHasta,
      solicitadoDesde: desde,
      solicitadoHasta: hasta,
    },
    filtros: {
      granularidad,
      region: query.region?.trim() || null,
      subsector: query.subsector?.trim() || null,
    },
    volumen: {
      granularidad,
      series: SERIES,
      periodos,
      totales,
    },
    actividad: {
      confiable: motivoActividad === null,
      motivo: motivoActividad,
      dias,
      rango: {
        primera: porDia[0]?.fecha ?? null,
        ultima: porDia[porDia.length - 1]?.fecha ?? null,
      },
      totalRegistros,
      totalLegado,
      totalSinUsuario,
      porDia,
      porUsuario,
    },
    resolucionCompromisos: {
      total: totalCompromisos,
      terminales,
      conVencimiento,
      muestra,
      mediaDias,
      hitosCumplidos,
      mediaHitosDias,
      hitosMinDias,
      hitosMaxDias,
      motivo: motivoResolucion,
    },
    resumen: {
      filas: filasResumen,
      totalRegistros: resumenTotalRegistros,
      totalSinFecha: resumenTotalSinFecha,
    },
    catalogos: {
      regiones: regionesResult.rows.map((fila) => ({
        valor: fila.nombre,
        etiqueta: fila.nombre,
      })),
      subsectores: subsectoresResult.rows.map((fila) => ({
        valor: fila.nombre,
        etiqueta: etiquetaSubsector(fila.nombre),
      })),
    },
  };
}

/**
 * El catálogo guarda «Pesca y Acuicultura»; la pantalla usa minúscula en
 * «acuicultura» según el vocabulario del proyecto. El valor enviado al filtro
 * sigue siendo el nombre de la base para que la resolución no falle.
 */
function etiquetaSubsector(nombre: string): string {
  const normalizado = nombre.trim().toLowerCase();
  if (normalizado === "pesca y acuicultura") return "Pesca y acuicultura";
  if (normalizado === "mype e industria") return "MYPE e industria";
  return nombre;
}
