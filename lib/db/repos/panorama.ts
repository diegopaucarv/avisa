import type { PoolClient } from "pg";

/**
 * Indicadores del Panorama territorial: cifras por región, por sectorista y
 * totales nacionales. SÓLO LECTURA.
 *
 * Se calcula sobre datos reales bajo la RLS de la sesión (`withSession`), igual
 * que `analitica.ts`: un rol con menor `clasificacion_max` ve menos filas y sus
 * conteos lo reflejan. No se cachea ni se rellena nada.
 *
 * DEFINICIONES EXACTAS (no reinterpretar)
 *   · caso abierto        → `core.casos.anulado_en is null and estado_id = 1`.
 *   · manifiesto          → caso abierto con `nivel_conflicto_id in (3,4)`
 *                           (Conflicto social / Crisis social).
 *   · riesgoAlto          → caso abierto con `nivel_riesgo_id = 3` (Alto).
 *   · alertas90d          → `core.alertas_tempranas` con `anulado_en is null`,
 *                           `archivado_en is null` y
 *                           `fecha_reporte >= current_date - interval '90 days'`.
 *   · alertasRiesgoAlto   → alertas90d con `nivel_riesgo_id = 3`.
 *   · región de una alerta → `coalesce(al.region_id, c.region_principal_id)`,
 *                           usando el caso vinculado como respaldo. Si sigue
 *                           nula, la alerta NO entra en el desglose por región
 *                           (pero sí en `totales`).
 *   · sectorista          → usuario con rol `sectorista` vigente en
 *                           `core.usuario_roles` (`hasta is null` u
 *                           `hasta >= current_date`). Sus `regiones` son las de
 *                           `core.usuario_territorio`. Sus conteos son los casos
 *                           donde `punto_focal_usuario_id = él` (sin desglose
 *                           por región) y las alertas donde
 *                           `sectorista_usuario_id = él`.
 *   · totales             → agregado nacional de los mismos conjuntos, incluidas
 *                           las filas sin región (por eso sumar el desglose
 *                           regional puede dar menos que el total).
 *
 * `regiones` sólo lista regiones con alguna actividad (casos o alertas); las
 * regiones sin actividad no aparecen con ceros. Los `sectoristas` sí aparecen
 * aunque no tengan actividad, con sus conteos en 0.
 */

/** Ventana de las alertas contadas, en días. */
export const PANORAMA_VENTANA_ALERTAS = 90;

export type IndicadorRegion = {
  /** `core.regiones.ubigeo`. */
  ubigeo: string;
  region: string;
  casos: number;
  manifiestos: number;
  riesgoAlto: number;
  alertas90d: number;
  alertasRiesgoAlto: number;
};

export type IndicadorSectorista = {
  /** `core.usuarios.id`. */
  id: string;
  nombre: string;
  /** Nombres de región asignados en `core.usuario_territorio`. */
  regiones: string[];
  /**
   * Desglose por región de la actividad del sectorista. Una fila por región
   * donde tenga casos o alertas (misma clave que el resto del endpoint).
   * Sumar sus `casos` coincide con el `casos` del sectorista, salvo los casos
   * sin región, que no aparecen aquí.
   */
  regionesDetalle: IndicadorSectoristaRegion[];
  casos: number;
  manifiestos: number;
  riesgoAlto: number;
  alertas90d: number;
  alertasRiesgoAlto: number;
};

export type IndicadorSectoristaRegion = {
  region: string;
  ubigeo: string;
  casos: number;
  manifiestos: number;
  riesgoAlto: number;
  alertas90d: number;
  alertasRiesgoAlto: number;
};

export type PanoramaTotales = {
  casos: number;
  manifiestos: number;
  riesgoAlto: number;
  alertas90d: number;
  alertasRiesgoAlto: number;
};

export type PanoramaIndicadores = {
  regiones: IndicadorRegion[];
  sectoristas: IndicadorSectorista[];
  totales: PanoramaTotales;
  generadoEn: string;
};

type RegionFila = {
  ubigeo: string;
  region: string;
  casos: number | string;
  manifiestos: number | string;
  riesgo_alto: number | string;
  alertas90d: number | string;
  alertas_riesgo_alto: number | string;
};

type SectoristaFila = {
  id: string;
  nombre: string;
  regiones: string[] | null;
  /** `json_agg` de PostgreSQL: ya llega como array de objetos. */
  regiones_detalle: SectoristaRegionFilaJson[] | null;
  casos: number | string;
  manifiestos: number | string;
  riesgo_alto: number | string;
  alertas90d: number | string;
  alertas_riesgo_alto: number | string;
};

type SectoristaRegionFilaJson = {
  region: string;
  ubigeo: string;
  casos: number | string;
  manifiestos: number | string;
  riesgoAlto: number | string;
  alertas90d: number | string;
  alertasRiesgoAlto: number | string;
};

type TotalesFila = {
  casos: number | string;
  manifiestos: number | string;
  riesgo_alto: number | string;
  alertas90d: number | string;
  alertas_riesgo_alto: number | string;
};

function n(valor: number | string | null | undefined): number {
  return Number(valor ?? 0);
}

/**
 * Desglose por región. La clave se toma del caso (`region_principal_id`) y de la
 * alerta (`coalesce(region_id, region_principal_id)`); las filas sin región se
 * excluyen AQUÍ a propósito (entran en `totales`). `join core.regiones` (no
 * left) descarta cualquier id que ya no exista en el catálogo.
 */
const SQL_REGIONES = `
with casos as (
  select c.region_principal_id as region_id,
         count(*)::int as casos,
         count(*) filter (where c.nivel_conflicto_id in (3, 4))::int as manifiestos,
         count(*) filter (where c.nivel_riesgo_id = 3)::int as riesgo_alto
    from core.casos c
   where c.anulado_en is null
     and c.estado_id = 1
     and c.region_principal_id is not null
   group by 1
),
alertas as (
  select coalesce(al.region_id, c.region_principal_id) as region_id,
         count(*)::int as alertas90d,
         count(*) filter (where al.nivel_riesgo_id = 3)::int as alertas_riesgo_alto
    from core.alertas_tempranas al
    left join core.casos c on c.id = al.caso_id
   where al.anulado_en is null
     and al.archivado_en is null
     and al.fecha_reporte >= current_date - ($1::int * interval '1 day')
     and (al.region_id is not null or c.region_principal_id is not null)
   group by 1
),
claves as (
  select region_id from casos
  union
  select region_id from alertas
)
select cr.ubigeo::text as ubigeo,
       cr.nombre as region,
       coalesce(ca.casos, 0) as casos,
       coalesce(ca.manifiestos, 0) as manifiestos,
       coalesce(ca.riesgo_alto, 0) as riesgo_alto,
       coalesce(al.alertas90d, 0) as alertas90d,
       coalesce(al.alertas_riesgo_alto, 0) as alertas_riesgo_alto
  from claves k
  join core.regiones cr on cr.id = k.region_id
  left join casos ca on ca.region_id = k.region_id
  left join alertas al on al.region_id = k.region_id
 order by cr.ubigeo asc`;

/**
 * Totales nacionales, sin recortar por región: incluyen los casos y alertas sin
 * región para que el titular no dependa de que la desagregación tenga match.
 */
const SQL_TOTALES = `
select
  (select count(*)
     from core.casos
    where anulado_en is null and estado_id = 1)::int as casos,
  (select count(*)
     from core.casos
    where anulado_en is null and estado_id = 1
      and nivel_conflicto_id in (3, 4))::int as manifiestos,
  (select count(*)
     from core.casos
    where anulado_en is null and estado_id = 1
      and nivel_riesgo_id = 3)::int as riesgo_alto,
  (select count(*)
     from core.alertas_tempranas
    where anulado_en is null and archivado_en is null
      and fecha_reporte >= current_date - ($1::int * interval '1 day'))::int as alertas90d,
  (select count(*)
     from core.alertas_tempranas
    where anulado_en is null and archivado_en is null
      and fecha_reporte >= current_date - ($1::int * interval '1 day')
      and nivel_riesgo_id = 3)::int as alertas_riesgo_alto`;

/**
 * Por sectorista. `act` fija quién cuenta como sectorista vigente. Los casos se
 * agrupan por `punto_focal_usuario_id` y las alertas por
 * `sectorista_usuario_id`; NO se desglosan por región (los conteos son el total
 * del sectorista). `regiones` viene de `usuario_territorio` y es sólo la lista
 * de nombres asignados.
 */
const SQL_SECTORISTAS = `
with act as (
  select ur.usuario_id
    from core.usuario_roles ur
    join core.roles r on r.id = ur.rol_id
   where r.codigo = 'sectorista'
     and (ur.hasta is null or ur.hasta >= current_date)
   group by ur.usuario_id
),
casos as (
  select c.punto_focal_usuario_id as usuario_id,
         count(*)::int as casos,
         count(*) filter (where c.nivel_conflicto_id in (3, 4))::int as manifiestos,
         count(*) filter (where c.nivel_riesgo_id = 3)::int as riesgo_alto
    from core.casos c
    join act a on a.usuario_id = c.punto_focal_usuario_id
   where c.anulado_en is null
     and c.estado_id = 1
   group by 1
),
alertas as (
  select al.sectorista_usuario_id as usuario_id,
         count(*)::int as alertas90d,
         count(*) filter (where al.nivel_riesgo_id = 3)::int as alertas_riesgo_alto
    from core.alertas_tempranas al
    join act a on a.usuario_id = al.sectorista_usuario_id
   where al.anulado_en is null
     and al.archivado_en is null
     and al.fecha_reporte >= current_date - ($1::int * interval '1 day')
   group by 1
),
regiones as (
  select ut.usuario_id,
         array_agg(cr.nombre order by cr.nombre) as nombres
    from core.usuario_territorio ut
    join core.regiones cr on cr.id = ut.region_id
   where ut.region_id is not null
   group by ut.usuario_id
),
casos_region as (
  select c.punto_focal_usuario_id as usuario_id,
         c.region_principal_id as region_id,
         count(*)::int as casos,
         count(*) filter (where c.nivel_conflicto_id in (3, 4))::int as manifiestos,
         count(*) filter (where c.nivel_riesgo_id = 3)::int as riesgo_alto
    from core.casos c
    join act a on a.usuario_id = c.punto_focal_usuario_id
   where c.anulado_en is null
     and c.estado_id = 1
     and c.region_principal_id is not null
   group by 1, 2
),
alertas_region as (
  select al.sectorista_usuario_id as usuario_id,
         coalesce(al.region_id, c.region_principal_id) as region_id,
         count(*)::int as alertas90d,
         count(*) filter (where al.nivel_riesgo_id = 3)::int as alertas_riesgo_alto
    from core.alertas_tempranas al
    join act a on a.usuario_id = al.sectorista_usuario_id
    left join core.casos c on c.id = al.caso_id
   where al.anulado_en is null
     and al.archivado_en is null
     and al.fecha_reporte >= current_date - ($1::int * interval '1 day')
     and (al.region_id is not null or c.region_principal_id is not null)
   group by 1, 2
),
detalle_claves as (
  select usuario_id, region_id from casos_region
  union
  select usuario_id, region_id from alertas_region
),
detalle as (
  select d.usuario_id,
         json_agg(
           json_build_object(
             'region', cr.nombre,
             'ubigeo', cr.ubigeo::text,
             'casos', coalesce(ca.casos, 0),
             'manifiestos', coalesce(ca.manifiestos, 0),
             'riesgoAlto', coalesce(ca.riesgo_alto, 0),
             'alertas90d', coalesce(ar.alertas90d, 0),
             'alertasRiesgoAlto', coalesce(ar.alertas_riesgo_alto, 0)
           ) order by cr.ubigeo
         ) as detalle
    from detalle_claves d
    join core.regiones cr on cr.id = d.region_id
    left join casos_region ca
           on ca.usuario_id = d.usuario_id and ca.region_id = d.region_id
    left join alertas_region ar
           on ar.usuario_id = d.usuario_id and ar.region_id = d.region_id
   group by d.usuario_id
)
select u.id,
       u.nombre,
       coalesce(rg.nombres, '{}'::text[]) as regiones,
       coalesce(de.detalle, '[]'::json) as regiones_detalle,
       coalesce(ca.casos, 0) as casos,
       coalesce(ca.manifiestos, 0) as manifiestos,
       coalesce(ca.riesgo_alto, 0) as riesgo_alto,
       coalesce(al.alertas90d, 0) as alertas90d,
       coalesce(al.alertas_riesgo_alto, 0) as alertas_riesgo_alto
  from core.usuarios u
  join act a on a.usuario_id = u.id
  left join casos ca on ca.usuario_id = u.id
  left join alertas al on al.usuario_id = u.id
  left join regiones rg on rg.usuario_id = u.id
  left join detalle de on de.usuario_id = u.id
 order by u.nombre asc, u.id asc`;

function aRegion(fila: RegionFila): IndicadorRegion {
  return {
    ubigeo: fila.ubigeo,
    region: fila.region,
    casos: n(fila.casos),
    manifiestos: n(fila.manifiestos),
    riesgoAlto: n(fila.riesgo_alto),
    alertas90d: n(fila.alertas90d),
    alertasRiesgoAlto: n(fila.alertas_riesgo_alto),
  };
}

function aSectoristaRegion(
  fila: SectoristaRegionFilaJson,
): IndicadorSectoristaRegion {
  return {
    region: fila.region,
    ubigeo: fila.ubigeo,
    casos: n(fila.casos),
    manifiestos: n(fila.manifiestos),
    riesgoAlto: n(fila.riesgoAlto),
    alertas90d: n(fila.alertas90d),
    alertasRiesgoAlto: n(fila.alertasRiesgoAlto),
  };
}

function aSectorista(fila: SectoristaFila): IndicadorSectorista {
  return {
    id: fila.id,
    nombre: fila.nombre,
    regiones: fila.regiones ?? [],
    regionesDetalle: (fila.regiones_detalle ?? []).map(aSectoristaRegion),
    casos: n(fila.casos),
    manifiestos: n(fila.manifiestos),
    riesgoAlto: n(fila.riesgo_alto),
    alertas90d: n(fila.alertas90d),
    alertasRiesgoAlto: n(fila.alertas_riesgo_alto),
  };
}

export async function listarIndicadoresPanorama(
  client: PoolClient,
): Promise<PanoramaIndicadores> {
  const dias = PANORAMA_VENTANA_ALERTAS;

  const [regiones, sectoristas, totales] = await Promise.all([
    client.query<RegionFila>(SQL_REGIONES, [dias]),
    client.query<SectoristaFila>(SQL_SECTORISTAS, [dias]),
    client.query<TotalesFila>(SQL_TOTALES, [dias]),
  ]);

  const filaTotales = totales.rows[0];

  return {
    regiones: regiones.rows.map(aRegion),
    sectoristas: sectoristas.rows.map(aSectorista),
    totales: {
      casos: n(filaTotales?.casos),
      manifiestos: n(filaTotales?.manifiestos),
      riesgoAlto: n(filaTotales?.riesgo_alto),
      alertas90d: n(filaTotales?.alertas90d),
      alertasRiesgoAlto: n(filaTotales?.alertas_riesgo_alto),
    },
    generadoEn: new Date().toISOString(),
  };
}
