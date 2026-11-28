import type { PoolClient } from "pg";

import { palabrasDe } from "../busqueda";

/**
 * Buscador territorial del alta: distritos del catálogo INEI y **lugares
 * operativos** que no son distrito.
 *
 * Matarani es el caso que lo motivó: no existe como distrito —es puerto del
 * distrito de Islay (`040704`)— y el alta debe poder registrarlo sin
 * convertirlo en un distrito inventado. Por eso la búsqueda devuelve dos
 * colecciones separadas y el payload del caso guarda `distritoPrincipalId` o
 * `lugarId`, nunca «el distrito más parecido».
 *
 * `core.distritos`, `core.provincias`, `core.regiones` y `territorio.lugares`
 * no tienen RLS; la consulta pasa igualmente por `withSession` para no abrir
 * una vía de acceso distinta al pool.
 *
 * La comparación usa `core.normalizar_ref`: quita tildes, mayúsculas, espacios,
 * guiones y guiones bajos. Así «nuñoa», «Nunoa» y «NUÑOA» encuentran lo mismo, y
 * `san juan` sigue encontrando `San Juan Bautista`.
 *
 * Además, este módulo expone la capa GIS distrital (`territorio.distrito`):
 * listado paginado, ficha con geometría, colección GeoJSON para el mapa y
 * denominadores poblacionales por región. Esa tabla no reemplaza a
 * `core.distritos` ni la búsqueda del alta: la geometría dice dónde está un
 * territorio, no cuánto pesa, y la población es sólo denominador.
 */

export const TERRITORIO_LIMITE_POR_DEFECTO = 20;
export const TERRITORIO_LIMITE_MAX = 50;
/** Una sola letra devolvería casi los 1 891 distritos. */
export const TERRITORIO_Q_MIN = 2;

export type TerritorioQuery = {
  q?: string;
  limite?: number;
};

export type DistritoTerritorio = {
  id: number;
  ubigeo: string;
  nombre: string;
  provincia: string;
  region: string;
  /** «Distrito · Provincia · Región»: desambigua los 15 «Santa Rosa». */
  ruta: string;
};

export type LugarTerritorio = {
  id: string;
  nombre: string;
  /** `territorio.cat_tipos_lugar.codigo`: `puerto`, `caleta`, `desembarcadero_artesanal`… */
  tipo: string;
  distrito: string;
  provincia: string;
  region: string;
  /** «Lugar · Distrito · Región», con el tipo como distintivo aparte. */
  ruta: string;
};

export type TerritorioResult = {
  q: string;
  /** `false` cuando la consulta es más corta que `TERRITORIO_Q_MIN`. */
  aplicada: boolean;
  distritos: DistritoTerritorio[];
  lugares: LugarTerritorio[];
};

function rutaDistrito(
  distrito: string,
  provincia: string,
  region: string,
): string {
  return `${distrito} · ${provincia} · ${region}`;
}

function rutaLugar(lugar: string, distrito: string, region: string): string {
  return `${lugar} · ${distrito} · ${region}`;
}

function limiteDe(valor: number | undefined): number {
  if (valor === undefined || !Number.isFinite(valor)) {
    return TERRITORIO_LIMITE_POR_DEFECTO;
  }
  const entero = Math.trunc(valor);
  if (entero < 1) return 1;
  return Math.min(TERRITORIO_LIMITE_MAX, entero);
}

export async function buscarTerritorio(
  client: PoolClient,
  query: TerritorioQuery,
): Promise<TerritorioResult> {
  const crudo = (query.q ?? "").trim();
  const limite = limiteDe(query.limite);

  if (crudo.length < TERRITORIO_Q_MIN) {
    return { q: crudo, aplicada: false, distritos: [], lugares: [] };
  }

  // El ubigeo se busca por prefijo sólo si lo tecleado son dígitos; así «04»
  // lista los distritos de Arequipa y «0407» los de Islay. Cuando no es
  // numérico se usa un patrón vacío, que no coincide con ningún `char(6)`, en
  // vez de `null`: un parámetro nulo sin tipo deja a Postgres sin poder
  // inferirlo y la consulta falla en el parseo.
  const porUbigeo = /^\d{1,6}$/.test(crudo) ? `${crudo}%` : "";
  // Una palabra por patrón: «san juan» encuentra «San Juan de Lurigancho»
  // (con `%san juan%` no aparecía porque el texto lleva «de» en medio).
  const patrones = palabrasDe(crudo).map((palabra) => `%${palabra}%`);
  const empieza = `${crudo}%`;

  const distritos = await client.query<{
    id: number;
    ubigeo: string;
    nombre: string;
    provincia: string;
    region: string;
  }>(
    `select d.id,
            d.ubigeo,
            d.nombre,
            p.nombre as provincia,
            r.nombre as region
       from core.distritos d
       join core.provincias p on p.id = d.provincia_id
       join core.regiones r on r.id = p.region_id
      where coalesce((select bool_and(
                        core.normalizar_ref(d.nombre) like core.normalizar_ref(pal)
                     or core.normalizar_ref(p.nombre) like core.normalizar_ref(pal)
                     or core.normalizar_ref(r.nombre) like core.normalizar_ref(pal))
                    from unnest($1::text[]) as t(pal)), true)
         or d.ubigeo like $2
      order by (core.normalizar_ref(d.nombre) like core.normalizar_ref($3)) desc,
               d.nombre asc,
               p.nombre asc
      limit $4`,
    [patrones, porUbigeo, empieza, limite],
  );

  const lugares = await client.query<{
    id: string;
    nombre: string;
    tipo: string;
    distrito: string;
    provincia: string;
    region: string;
  }>(
    `select l.id::text as id,
            l.nombre,
            t.codigo as tipo,
            d.nombre as distrito,
            p.nombre as provincia,
            r.nombre as region
       from territorio.lugares l
       join territorio.cat_tipos_lugar t on t.id = l.tipo_id
       join core.distritos d on d.id = l.distrito_id
       join core.provincias p on p.id = d.provincia_id
       join core.regiones r on r.id = p.region_id
      where l.operativo
        and coalesce((select bool_and(
                        core.normalizar_ref(l.nombre) like core.normalizar_ref(pal)
                     or core.normalizar_ref(d.nombre) like core.normalizar_ref(pal)
                     or core.normalizar_ref(p.nombre) like core.normalizar_ref(pal)
                     or core.normalizar_ref(r.nombre) like core.normalizar_ref(pal))
                    from unnest($1::text[]) as t(pal)), true)
      order by (core.normalizar_ref(l.nombre) like core.normalizar_ref($2)) desc,
               l.nombre asc
      limit $3`,
    [patrones, empieza, limite],
  );

  return {
    q: crudo,
    aplicada: true,
    distritos: distritos.rows.map((row) => ({
      id: Number(row.id),
      ubigeo: row.ubigeo,
      nombre: row.nombre,
      provincia: row.provincia,
      region: row.region,
      ruta: rutaDistrito(row.nombre, row.provincia, row.region),
    })),
    lugares: lugares.rows.map((row) => ({
      id: row.id,
      nombre: row.nombre,
      tipo: row.tipo,
      distrito: row.distrito,
      provincia: row.provincia,
      region: row.region,
      ruta: rutaLugar(row.nombre, row.distrito, row.region),
    })),
  };
}

/** Etiqueta legible del tipo de lugar, para la interfaz. */
const ETIQUETAS_TIPO: Record<string, string> = {
  terminal_pesquero: "terminal pesquero",
  desembarcadero_artesanal: "desembarcadero",
  planta_procesadora: "planta procesadora",
  caleta: "caleta",
  cite: "CITE",
  estacion_hidrica: "estación hidráulica",
  camara_frio: "cámara de frío",
  piscigranja: "piscigranja",
  nec: "NEC",
  puerto: "puerto",
  localidad: "localidad",
};

/**
 * Traduce `cat_tipos_lugar.codigo` a texto. El catálogo no tiene columna de
 * nombre, así que el vocabulario vive aquí; un código nuevo cae al `codigo`
 * crudo en vez de esconderse, para que se note que falta traducirlo.
 */
export function etiquetaTipoLugar(codigo: string): string {
  return ETIQUETAS_TIPO[codigo] ?? codigo.replace(/_/g, " ");
}

/* -------------------------------------------------------------------------- */
/* Capa GIS distrital (`territorio.distrito`, migration/47_gis_distritos.sql)  */
/* -------------------------------------------------------------------------- */

/** Página del listado; los topes son los mismos que usan las demás listas. */
export const DISTRITO_PAGE_SIZE = 25;
export const DISTRITO_PAGE_SIZE_MAX = 100;

export type DistritoListQuery = {
  region?: string;
  provincia?: string;
  page?: number;
  pageSize?: number;
};

export type Centroide = {
  lat: number;
  lon: number;
};

export type DistritoListado = {
  ubigeo: string;
  nombre: string;
  provincia: string | null;
  region: string | null;
  /** Denominador (Censo 2025 geogpsperu). `null` si el insumo no lo trae. */
  poblacion: number | null;
  /** `null` si la fila no tiene centroide calculado. */
  centroide: Centroide | null;
};

export type DistritoListResult = {
  items: DistritoListado[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
};

export type DistritoDetalle = {
  ubigeo: string;
  nombre: string;
  provincia: string | null;
  region: string | null;
  poblacion: number | null;
  poblacionHombres: number | null;
  poblacionMujeres: number | null;
  /** Declara la fuente de cada cifra y qué quedó NULL; no se recalcula. */
  procedenciaPoblacion: string | null;
  centroide: Centroide | null;
  /** Geometría ya parseada de `ST_AsGeoJSON(geom)`; `null` si no hay. */
  geometria: { type: string; coordinates: unknown } | null;
  creadoEn: Date | null;
};

type DistritoFila = {
  ubigeo: string;
  nombre: string;
  provincia: string | null;
  region: string | null;
  poblacion_total: string | number | null;
  lat: number | string | null;
  lon: number | string | null;
};

function aNumero(valor: string | number | null): number | null {
  if (valor === null) return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function centroideDe(
  lat: number | string | null,
  lon: number | string | null,
): Centroide | null {
  const la = aNumero(lat);
  const lo = aNumero(lon);
  if (la === null || lo === null) return null;
  return { lat: la, lon: lo };
}

/**
 * Lista los distritos de la capa GIS con filtro opcional por región o
 * provincia (comparación sin tildes ni mayúsculas, como el buscador).
 *
 * La población se devuelve como denominador, nunca como peso de riesgo. No se
 * inventan cifras: si la carga no trajo población, el campo es `null`.
 */
export async function listarDistritos(
  client: PoolClient,
  query: DistritoListQuery,
): Promise<DistritoListResult> {
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(
    DISTRITO_PAGE_SIZE_MAX,
    Math.max(1, Math.trunc(query.pageSize ?? DISTRITO_PAGE_SIZE)),
  );
  const region = query.region?.trim() || null;
  const provincia = query.provincia?.trim() || null;

  const where = `
    ($1::text is null or core.normalizar_ref(d.region) = core.normalizar_ref($1))
    and ($2::text is null or core.normalizar_ref(d.provincia) = core.normalizar_ref($2))`;

  const conteo = await client.query<{ total: number | string }>(
    `select count(*)::int as total
       from territorio.distrito d
      where ${where}`,
    [region, provincia],
  );
  const total = Number(conteo.rows[0]?.total ?? 0);

  const resultado = await client.query<DistritoFila>(
    `select d.ubigeo::text as ubigeo,
            d.nombre,
            d.provincia,
            d.region,
            d.poblacion_total,
            ST_Y(d.centroide) as lat,
            ST_X(d.centroide) as lon
       from territorio.distrito d
      where ${where}
      order by d.region nulls last, d.provincia nulls last, d.nombre asc,
               d.ubigeo asc
      limit $3 offset $4`,
    [region, provincia, pageSize, (page - 1) * pageSize],
  );

  return {
    items: resultado.rows.map((fila) => ({
      ubigeo: fila.ubigeo,
      nombre: fila.nombre,
      provincia: fila.provincia,
      region: fila.region,
      poblacion: aNumero(fila.poblacion_total),
      centroide: centroideDe(fila.lat, fila.lon),
    })),
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Ficha de un distrito de la capa GIS, con la geometría ya parseada.
 * Devuelve `null` cuando el ubigeo no está: el llamador decide el 404.
 */
export async function obtenerDistrito(
  client: PoolClient,
  ubigeo: string,
): Promise<DistritoDetalle | null> {
  const resultado = await client.query<{
    ubigeo: string;
    nombre: string;
    provincia: string | null;
    region: string | null;
    poblacion_total: string | number | null;
    poblacion_hombres: string | number | null;
    poblacion_mujeres: string | number | null;
    procedencia_poblacion: string | null;
    lat: number | string | null;
    lon: number | string | null;
    geojson: string | null;
    creado_en: Date | null;
  }>(
    `select d.ubigeo::text as ubigeo,
            d.nombre,
            d.provincia,
            d.region,
            d.poblacion_total,
            d.poblacion_hombres,
            d.poblacion_mujeres,
            d.procedencia_poblacion,
            ST_Y(d.centroide) as lat,
            ST_X(d.centroide) as lon,
            ST_AsGeoJSON(d.geom) as geojson,
            d.creado_en
       from territorio.distrito d
      where d.ubigeo = $1`,
    [ubigeo],
  );

  const fila = resultado.rows[0];
  if (!fila) return null;

  return {
    ubigeo: fila.ubigeo,
    nombre: fila.nombre,
    provincia: fila.provincia,
    region: fila.region,
    poblacion: aNumero(fila.poblacion_total),
    poblacionHombres: aNumero(fila.poblacion_hombres),
    poblacionMujeres: aNumero(fila.poblacion_mujeres),
    procedenciaPoblacion: fila.procedencia_poblacion,
    centroide: centroideDe(fila.lat, fila.lon),
    geometria: fila.geojson
      ? (JSON.parse(fila.geojson) as { type: string; coordinates: unknown })
      : null,
    creadoEn: fila.creado_en,
  };
}

/* -------------------------------------------------------------------------- */
/* Colección GeoJSON de la capa distrital (mapa de coropletas)                 */
/* -------------------------------------------------------------------------- */

/**
 * Tolerancia de simplificación por defecto, en grados (WGS84). Medido sobre las
 * 1 892 filas: la geometría cruda ronda 1,48 MB de GeoJSON; con 0,01 baja a
 * ~862 kB y con el tope de 0,05 a ~328 kB. Es un payload para pintar, no para
 * medir: la ficha individual conserva la geometría de la fila.
 */
export const DISTRITO_TOLERANCIA_POR_DEFECTO = 0.01;
/**
 * Tope de tolerancia. Por encima de 0,05 la silueta distrital deja de ser
 * reconocible y el ubigeo se vuelve inútil para coropletas finas; la ruta acota
 * en vez de aceptar el valor crudo.
 */
export const DISTRITO_TOLERANCIA_MAX = 0.05;

export type DistritoGeometriaQuery = {
  region?: string;
  provincia?: string;
  /**
   * Tolerancia de simplificación en grados. `0` devuelve la geometría cruda;
   * el resto se acota a `[0, DISTRITO_TOLERANCIA_MAX]`.
   */
  tolerancia?: number;
};

export type DistritoFeatureProperties = {
  ubigeo: string;
  /** Tal cual lo trae la capa (mayúsculas); no se reescribe para el mapa. */
  nombre: string;
  provincia: string | null;
  region: string | null;
  /** Denominador (Censo 2025 geogpsperu). `null` si la fila no lo trae. */
  poblacion: number | null;
  centroide: Centroide | null;
};

export type DistritoFeature = {
  type: "Feature";
  id: string;
  geometry: { type: string; coordinates: unknown } | null;
  properties: DistritoFeatureProperties;
};

export type DistritoFeatureCollection = {
  type: "FeatureCollection";
  features: DistritoFeature[];
  total: number;
  generadoEn: string;
};

/**
 * Acota la tolerancia al rango servible. Un valor no numérico ya se rechazó en
 * la ruta (422 `TOLERANCIA_INVALIDA`); aquí sólo se recorta el rango para que
 * ninguna llamada interna pueda pedir una geometría sin sentido.
 */
export function acotarTolerancia(valor: number | undefined): number {
  if (valor === undefined || !Number.isFinite(valor)) {
    return DISTRITO_TOLERANCIA_POR_DEFECTO;
  }
  return Math.min(DISTRITO_TOLERANCIA_MAX, Math.max(0, valor));
}

type DistritoGeometriaFila = {
  ubigeo: string;
  nombre: string;
  provincia: string | null;
  region: string | null;
  poblacion_total: string | number | null;
  lat: number | string | null;
  lon: number | string | null;
  geojson: string | null;
};

/**
 * Devuelve la capa distrital completa como `FeatureCollection`, para pintar
 * polígonos en Leaflet. No pagina: el mapa necesita la silueta entera para que
 * el filtro de región o provincia no deje huecos.
 *
 * La simplificación ocurre SIEMPRE en servidor. `ST_SimplifyPreserveTopology`
 * devuelve `Polygon` aunque la columna sea `MultiPolygon` (las 1 892 filas
 * tienen una sola parte), así que `ST_Multi` restaura el tipo declarado en el
 * contrato. Con tolerancia 0 se sirve la geometría cruda.
 *
 * Los filtros de región/provincia se comparan con `core.normalizar_ref`, igual
 * que el listado: la capa guarda `LIMA`/`ANCASH` sin tildes y el catálogo usa
 * «Lima»/«Áncash». `region` y `provincia` salen tal cual de la tabla.
 */
export async function listarDistritosGeoJson(
  client: PoolClient,
  query: DistritoGeometriaQuery,
): Promise<DistritoFeatureCollection> {
  const region = query.region?.trim() || null;
  const provincia = query.provincia?.trim() || null;
  const tolerancia = acotarTolerancia(query.tolerancia);

  const resultado = await client.query<DistritoGeometriaFila>(
    `select d.ubigeo::text as ubigeo,
            d.nombre,
            d.provincia,
            d.region,
            d.poblacion_total,
            ST_Y(d.centroide) as lat,
            ST_X(d.centroide) as lon,
            case
              when $3::float8 > 0
                then ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(d.geom, $3::float8)))
              else ST_AsGeoJSON(d.geom)
            end as geojson
       from territorio.distrito d
      where ($1::text is null or core.normalizar_ref(d.region) = core.normalizar_ref($1))
        and ($2::text is null or core.normalizar_ref(d.provincia) = core.normalizar_ref($2))
      order by d.ubigeo asc`,
    [region, provincia, tolerancia],
  );

  const features: DistritoFeature[] = resultado.rows.map((fila) => ({
    type: "Feature",
    id: fila.ubigeo,
    geometry: fila.geojson
      ? (JSON.parse(fila.geojson) as { type: string; coordinates: unknown })
      : null,
    properties: {
      ubigeo: fila.ubigeo,
      nombre: fila.nombre,
      provincia: fila.provincia,
      region: fila.region,
      poblacion: aNumero(fila.poblacion_total),
      centroide: centroideDe(fila.lat, fila.lon),
    },
  }));

  return {
    type: "FeatureCollection",
    features,
    total: features.length,
    generadoEn: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Denominadores poblacionales agregados                                      */
/* -------------------------------------------------------------------------- */

export type PoblacionRegionItem = {
  /** Código INEI de región: `left(ubigeo, 2)`. */
  clave: string;
  /** Región de la capa (mayúsculas); `null` si la fila no la declara. */
  nombre: string | null;
  /** Suma de `poblacion_total` no nulo; `null` si ningún distrito trae dato. */
  poblacion: number | null;
  distritos: number;
  /** Distritos con población: permite declarar cobertura sin inventar. */
  distritosConPoblacion: number;
};

export type PoblacionAgrupadaResult = {
  agrupar: "region";
  items: PoblacionRegionItem[];
  total: number;
  generadoEn: string;
};

/**
 * Población agregada por región (código INEI de 2 dígitos). Es denominador de
 * tasas por 100 000 habitantes; nunca entra en el riesgo.
 *
 * `min(region)` y no `group by` de la columna: en la capa cada prefijo INEI
 * tiene una sola grafía de región (25 claves, una región cada una), así que el
 * mínimo es el nombre y sigue siendo `null` si la capa no lo trae.
 */
export async function poblacionPorRegion(
  client: PoolClient,
): Promise<PoblacionAgrupadaResult> {
  const resultado = await client.query<{
    clave: string;
    nombre: string | null;
    poblacion: string | null;
    distritos: number | string;
    distritos_con_poblacion: number | string;
  }>(
    `select left(d.ubigeo::text, 2) as clave,
            min(d.region) as nombre,
            sum(d.poblacion_total)::bigint as poblacion,
            count(*)::int as distritos,
            count(d.poblacion_total)::int as distritos_con_poblacion
       from territorio.distrito d
      group by 1
      order by 1 asc`,
  );

  const items: PoblacionRegionItem[] = resultado.rows.map((fila) => ({
    clave: fila.clave,
    nombre: fila.nombre,
    poblacion: aNumero(fila.poblacion),
    distritos: Number(fila.distritos),
    distritosConPoblacion: Number(fila.distritos_con_poblacion),
  }));

  return {
    agrupar: "region",
    items,
    total: items.length,
    generadoEn: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Capas opcionales del mapa (`territorio.infraestructura_punto` y auditorios) */
/* -------------------------------------------------------------------------- */

/**
 * Página de la capa de puntos. 13 456 filas no entran con holgura en una sola
 * respuesta, así que se pagina; el tope es alto porque el mapa necesita los
 * puntos para dibujarlos con el renderer canvas y el cliente recorre las
 * páginas igual que hace con `GET /api/v1/cases`.
 */
export const CAPAS_PAGE_SIZE = 5_000;
export const CAPAS_PAGE_SIZE_MAX = 10_000;

/** Las dos poblaciones que mezcla `gis/Infraestructuras.kml`. */
export type TipoInfraestructura = "derecho_acuicola" | "institucional";

export function esTipoInfraestructuraValido(valor: string): boolean {
  return valor === "derecho_acuicola" || valor === "institucional";
}

/**
 * Punto de la capa GIS. No se proyecta `titular` ni `nombre`: son datos
 * personales (Ley 29733) y el KML los repite en los derechos acuícolas. El
 * nombre de la instalación sólo se sirve cuando el punto es una sede.
 */
export type InfraestructuraPunto = {
  id: string;
  tipo: TipoInfraestructura;
  lat: number;
  lon: number;
  ubigeo: string | null;
  distrito: string | null;
  provincia: string | null;
  region: string | null;
  /** Institución dueña, sólo en sedes (`null` en derechos acuícolas). */
  identi: string | null;
  /** Nombre de la instalación, sólo en sedes. */
  nombreInfraestructura: string | null;
};

/** Conteos de la tabla completa, independientes del filtro y de la página. */
export type InfraestructurasResumen = {
  /** Filas totales de la capa, con y sin coordenada. */
  total: number;
  derechosAcuicolas: number;
  sedes: number;
  /** Puntos que no se pueden dibujar: se declaran, no se descartan en silencio. */
  sinCoordenada: number;
};

export type InfraestructurasQuery = {
  tipo?: TipoInfraestructura;
  page?: number;
  pageSize?: number;
};

export type InfraestructurasResult = {
  recurso: "infraestructuras";
  tipo: TipoInfraestructura | null;
  items: InfraestructuraPunto[];
  /** Filas con coordenada que cumplen el filtro. */
  total: number;
  page: number;
  pageSize: number;
  resumen: InfraestructurasResumen;
  generadoEn: string;
};

type InfraestructuraFila = {
  id: string;
  tipo_registro: string;
  latitud: number | string | null;
  longitud: number | string | null;
  ubigeo: string | null;
  distrito: string | null;
  provincia: string | null;
  departamento: string | null;
  identi: string | null;
  nombre_infraestructura: string | null;
};

/**
 * Tabla canónica de la capa de puntos. La migración 75 la movió de `gis` a
 * `territorio` y dejó en `gis` solo una vista de compatibilidad; la 75 ya está
 * aplicada, así que se lee siempre el nombre canónico.
 */
const INFRAESTRUCTURAS_CANONICA = "territorio.infraestructura_punto";

/**
 * Puntos de la capa de infraestructuras (13 456 en la carga vigente).
 *
 * La capa no son instalaciones de PRODUCE: mezcla derechos acuícolas privados y
 * sedes institucionales. El tipo se filtra en servidor; el mapa además lo usa
 * para distinguir el símbolo. Se pagina con orden estable por `id`.
 */
export async function listarInfraestructurasPuntos(
  client: PoolClient,
  query: InfraestructurasQuery,
): Promise<InfraestructurasResult> {
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(
    CAPAS_PAGE_SIZE_MAX,
    Math.max(1, Math.trunc(query.pageSize ?? CAPAS_PAGE_SIZE)),
  );
  const tipo = query.tipo ?? null;
  // Es una constante de este módulo (nunca entrada del usuario), por eso se
  // interpola en el SQL: un identificador no se puede pasar como parámetro.
  const tabla = INFRAESTRUCTURAS_CANONICA;

  const resumen = await client.query<{
    total: number | string;
    derechos: number | string;
    sedes: number | string;
    sin_coordenada: number | string;
  }>(
    `select count(*)::int as total,
            count(*) filter (where tipo_registro = 'derecho_acuicola')::int as derechos,
            count(*) filter (where tipo_registro = 'institucional')::int as sedes,
            count(*) filter (where latitud is null or longitud is null)::int as sin_coordenada
       from ${tabla}`,
  );

  const conteo = await client.query<{ total: number | string }>(
    `select count(*)::int as total
       from ${tabla} i
      where i.latitud is not null
        and i.longitud is not null
        and ($1::text is null or i.tipo_registro = $1)`,
    [tipo],
  );

  const resultado = await client.query<InfraestructuraFila>(
    `select i.id,
            i.tipo_registro,
            i.latitud,
            i.longitud,
            i.ubigeo::text as ubigeo,
            i.distrito,
            i.provincia,
            i.departamento,
            i.identi,
            case when i.tipo_registro = 'institucional'
                 then i.nombre_infraestructura
            end as nombre_infraestructura
       from ${tabla} i
      where i.latitud is not null
        and i.longitud is not null
        and ($1::text is null or i.tipo_registro = $1)
      order by i.id asc
      limit $2 offset $3`,
    [tipo, pageSize, (page - 1) * pageSize],
  );

  const items: InfraestructuraPunto[] = [];
  for (const fila of resultado.rows) {
    const lat = aNumero(fila.latitud);
    const lon = aNumero(fila.longitud);
    if (lat === null || lon === null) continue;
    items.push({
      id: fila.id,
      tipo:
        fila.tipo_registro === "institucional"
          ? "institucional"
          : "derecho_acuicola",
      lat,
      lon,
      ubigeo: fila.ubigeo,
      distrito: fila.distrito,
      provincia: fila.provincia,
      region: fila.departamento,
      identi: fila.identi,
      nombreInfraestructura: fila.nombre_infraestructura,
    });
  }

  const resumenFila = resumen.rows[0];

  return {
    recurso: "infraestructuras",
    tipo,
    items,
    total: Number(conteo.rows[0]?.total ?? 0),
    page,
    pageSize,
    resumen: {
      total: Number(resumenFila?.total ?? 0),
      derechosAcuicolas: Number(resumenFila?.derechos ?? 0),
      sedes: Number(resumenFila?.sedes ?? 0),
      sinCoordenada: Number(resumenFila?.sin_coordenada ?? 0),
    },
    generadoEn: new Date().toISOString(),
  };
}

/**
 * Auditorio ubicado por el centroide de su distrito (`core.locales.distrito_id`
 * → `core.distritos.ubigeo` → `territorio.distrito.centroide`).
 *
 * La precisión es «distrito», nunca «dirección»: es una ubicación referencial,
 * no la puerta del local. Si el distrito no tiene centroide, el campo queda
 * `null` y el mapa no inventa un punto.
 */
export type AuditorioMapa = {
  id: string;
  codigo: string;
  nombre: string;
  aforo: number | null;
  activo: boolean;
  ubigeo: string | null;
  distrito: string | null;
  provincia: string | null;
  region: string | null;
  centroide: Centroide | null;
};

export type AuditoriosResult = {
  recurso: "auditorios";
  items: AuditorioMapa[];
  /** Filas del catálogo (27 en la carga vigente). */
  total: number;
  conCentroide: number;
  /** Declarados: no se dibujan porque su distrito no tiene centroide. */
  sinCentroide: number;
  /** Declarados: no se dibujan porque no tienen distrito asignado. */
  sinDistrito: number;
  generadoEn: string;
};

type AuditorioFila = {
  id: string;
  codigo: string;
  nombre: string;
  aforo: number | null;
  activo: boolean;
  ubigeo: string | null;
  distrito: string | null;
  provincia: string | null;
  region: string | null;
  lat: number | string | null;
  lon: number | string | null;
};

export async function listarAuditoriosMapa(
  client: PoolClient,
): Promise<AuditoriosResult> {
  const resultado = await client.query<AuditorioFila>(
    `select l.id::text as id,
            l.codigo,
            l.nombre,
            l.aforo,
            l.activo,
            d.ubigeo::text as ubigeo,
            d.nombre as distrito,
            p.nombre as provincia,
            rg.nombre as region,
            ST_Y(t.centroide) as lat,
            ST_X(t.centroide) as lon
       from core.locales l
       left join core.distritos d on d.id = l.distrito_id
       left join core.provincias p on p.id = d.provincia_id
       left join core.regiones rg on rg.id = p.region_id
       left join territorio.distrito t on t.ubigeo = d.ubigeo
      order by l.nombre asc, l.id asc`,
  );

  const items: AuditorioMapa[] = resultado.rows.map((fila) => ({
    id: fila.id,
    codigo: fila.codigo,
    nombre: fila.nombre,
    aforo: aNumero(fila.aforo),
    activo: fila.activo,
    ubigeo: fila.ubigeo,
    distrito: fila.distrito,
    provincia: fila.provincia,
    region: fila.region,
    centroide: centroideDe(fila.lat, fila.lon),
  }));

  const sinDistrito = items.filter((item) => item.ubigeo === null).length;
  const sinCentroide = items.filter((item) => item.centroide === null).length;

  return {
    recurso: "auditorios",
    items,
    total: items.length,
    conCentroide: items.length - sinCentroide,
    sinCentroide,
    sinDistrito,
    generadoEn: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Institucionales agrupados por identidad (FONDEPES y desembarcaderos)       */
/* -------------------------------------------------------------------------- */

/**
 * Grupos de la capa institucional que el mapa enciende por separado:
 *
 *   `fondepes`        → `identi = 'FONDEPES'` (27 puntos en la carga vigente)
 *   `desembarcaderos` → `identi like 'DPA%'` (31: «DPA - GORE» y la errata
 *                        «DPA -GORE», que el `like` recoge igual)
 *
 * No son capas nuevas de datos: son filtros sobre
 * `territorio.infraestructura_punto`. Devuelven la MISMA forma que
 * `listarInfraestructurasPuntos` para que el cliente reutilice el renderer.
 */
export type GrupoInstitucional = "fondepes" | "desembarcaderos";

export function esGrupoInstitucionalValido(
  valor: string,
): valor is GrupoInstitucional {
  return valor === "fondepes" || valor === "desembarcaderos";
}

export type InstitucionalesQuery = {
  grupo: GrupoInstitucional;
  page?: number;
  pageSize?: number;
};

/** Misma forma que `InfraestructurasResult`, con `recurso` = el grupo pedido. */
export type InfraestructurasGrupoResult = {
  recurso: GrupoInstitucional;
  tipo: TipoInfraestructura | null;
  items: InfraestructuraPunto[];
  total: number;
  page: number;
  pageSize: number;
  resumen: InfraestructurasResumen;
  generadoEn: string;
};

/**
 * Puntos institucionales de un grupo, con la misma forma que la capa completa.
 *
 * Se pagina igual que `listarInfraestructurasPuntos` (orden estable por `id`) y
 * `resumen` se calcula ACOTADO al grupo: `total` es el total del grupo con y sin
 * coordenada, `sedes` sus filas institucionales, `derechosAcuicolas` 0 (el grupo
 * es institucional por definición) y `sinCoordenada` las no dibujables. Así las
 * cifras describen lo que se está mirando y no la tabla entera.
 *
 * `identi` y `nombre_infraestructura` se proyectan: en ambos grupos son sedes
 * institucionales, no derechos acuícolas con titular (Ley 29733).
 */
export async function listarInstitucionalesPorIdentidad(
  client: PoolClient,
  query: InstitucionalesQuery,
): Promise<InfraestructurasGrupoResult> {
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(
    CAPAS_PAGE_SIZE_MAX,
    Math.max(1, Math.trunc(query.pageSize ?? CAPAS_PAGE_SIZE)),
  );
  // Predicado constante de este módulo (nunca entrada del usuario): se
  // interpola porque un identificador/condición no se pasa como parámetro.
  const predicado =
    query.grupo === "fondepes"
      ? "i.identi = 'FONDEPES'"
      : "i.identi like 'DPA%'";
  const tabla = INFRAESTRUCTURAS_CANONICA;

  const resumen = await client.query<{
    total: number | string;
    sedes: number | string;
    derechos: number | string;
    sin_coordenada: number | string;
  }>(
    `select count(*)::int as total,
            count(*) filter (where i.tipo_registro = 'institucional')::int as sedes,
            count(*) filter (where i.tipo_registro = 'derecho_acuicola')::int as derechos,
            count(*) filter (where i.latitud is null or i.longitud is null)::int as sin_coordenada
       from ${tabla} i
      where ${predicado}`,
  );

  const conteo = await client.query<{ total: number | string }>(
    `select count(*)::int as total
       from ${tabla} i
      where i.latitud is not null
        and i.longitud is not null
        and ${predicado}`,
  );

  const resultado = await client.query<InfraestructuraFila>(
    `select i.id,
            i.tipo_registro,
            i.latitud,
            i.longitud,
            i.ubigeo::text as ubigeo,
            i.distrito,
            i.provincia,
            i.departamento,
            i.identi,
            case when i.tipo_registro = 'institucional'
                 then i.nombre_infraestructura
            end as nombre_infraestructura
       from ${tabla} i
      where i.latitud is not null
        and i.longitud is not null
        and ${predicado}
      order by i.id asc
      limit $1 offset $2`,
    [pageSize, (page - 1) * pageSize],
  );

  const items: InfraestructuraPunto[] = [];
  for (const fila of resultado.rows) {
    const lat = aNumero(fila.latitud);
    const lon = aNumero(fila.longitud);
    if (lat === null || lon === null) continue;
    items.push({
      id: fila.id,
      tipo:
        fila.tipo_registro === "institucional"
          ? "institucional"
          : "derecho_acuicola",
      lat,
      lon,
      ubigeo: fila.ubigeo,
      distrito: fila.distrito,
      provincia: fila.provincia,
      region: fila.departamento,
      identi: fila.identi,
      nombreInfraestructura: fila.nombre_infraestructura,
    });
  }

  const resumenFila = resumen.rows[0];

  return {
    recurso: query.grupo,
    tipo: "institucional",
    items,
    total: Number(conteo.rows[0]?.total ?? 0),
    page,
    pageSize,
    resumen: {
      total: Number(resumenFila?.total ?? 0),
      derechosAcuicolas: Number(resumenFila?.derechos ?? 0),
      sedes: Number(resumenFila?.sedes ?? 0),
      sinCoordenada: Number(resumenFila?.sin_coordenada ?? 0),
    },
    generadoEn: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Capas agregadas de región, provincia y Reserva Nacional (coropletas)        */
/* -------------------------------------------------------------------------- */

/**
 * Filtro y tolerancia de las capas coropléticas. `tolerancia` se acota con
 * `acotarTolerancia` (0,01 por defecto, 0,05 máximo): es un payload para pintar,
 * no para medir. `alcance` sólo aplica a región; `region` (nombre de región)
 * sólo aplica a provincia. Se separan en dos campos para no confundir el
 * alcance geográfico (Norte/Centro/Sur/Oriente/Nacional) con una región concreta.
 */
export type CapaGeometriaQuery = {
  alcance?: string;
  region?: string;
  tolerancia?: number;
};

export type RegionCapaItem = {
  ubigeo: string;
  nombre: string;
  /** `territorio.region.region_id` → `core.regiones.id`; `null` sin match. */
  regionId: number | null;
  /**
   * Código de alcance geográfico (`Norte`, `Centro`, `Sur`, `Oriente`…), tomado
   * de `core.cat_alcances_geograficos.codigo`. La SPA lo usa para encuadrar y
   * resaltar las regiones del ámbito vigente. `null` si la región no lo declara.
   */
  alcance: string | null;
  /** Denominador (suma de la población distrital). `null` si no hay dato. */
  poblacion: number | null;
  geometria: { type: string; coordinates: unknown } | null;
};

export type ProvinciaCapaItem = {
  ubigeo: string;
  nombre: string;
  /** `left(distrito.ubigeo,2)`: ubigeo de la región a la que pertenece. */
  regionUbigeo: string | null;
  poblacion: number | null;
  geometria: { type: string; coordinates: unknown } | null;
};

export type AnpReservaItem = {
  codigo: string;
  nombre: string;
  categoria: string;
  geometria: { type: string; coordinates: unknown } | null;
};

type RegionCapaFila = {
  ubigeo: string;
  nombre: string;
  region_id: number | null;
  alcance: string | null;
  poblacion: string | number | null;
  geojson: string | null;
};

type ProvinciaCapaFila = {
  ubigeo: string;
  nombre: string;
  region_ubigeo: string | null;
  poblacion: string | number | null;
  geojson: string | null;
};

type AnpReservaFila = {
  codigo: string;
  nombre: string;
  categoria: string;
  geojson: string | null;
};

function geometriaDe(geojson: string | null): {
  type: string;
  coordinates: unknown;
} | null {
  return geojson
    ? (JSON.parse(geojson) as { type: string; coordinates: unknown })
    : null;
}

/**
 * Capa de región como lista GeoJSON-ready. La simplificación ocurre SIEMPRE en
 * servidor con `ST_SimplifyPreserveTopology` y `ST_Multi` restaura el
 * MultiPolygon declarado (igual que la capa distrital). El filtro `alcance`
 * compara sin tildes ni mayúsculas contra `core.cat_alcances_geograficos.codigo`,
 * alcanzado vía `core.regiones.alcance_id`; por eso `territorio.region` no
 * duplica el alcance: la fuente es el catálogo.
 *
 * Si `territorio.region` no existe, la consulta falla con 42P01 y la API
 * responde 503 («capa de datos no inicializada»): no se devuelven filas falsas.
 */
export async function listarRegionesCapa(
  client: PoolClient,
  query: CapaGeometriaQuery,
): Promise<RegionCapaItem[]> {
  const alcance = query.alcance?.trim() || null;
  const tolerancia = acotarTolerancia(query.tolerancia);

  const resultado = await client.query<RegionCapaFila>(
    `select r.ubigeo::text as ubigeo,
            r.nombre,
            r.region_id,
            a.codigo as alcance,
            r.poblacion_total as poblacion,
            case
              when $2::float8 > 0
                then ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(r.geom, $2::float8)))
              else ST_AsGeoJSON(r.geom)
            end as geojson
       from territorio.region r
       left join core.regiones cr on cr.id = r.region_id
       left join core.cat_alcances_geograficos a on a.id = cr.alcance_id
      where ($1::text is null or core.normalizar_ref(a.codigo) = core.normalizar_ref($1))
      order by r.ubigeo asc`,
    [alcance, tolerancia],
  );

  return resultado.rows.map((fila) => ({
    ubigeo: fila.ubigeo,
    nombre: fila.nombre,
    regionId: fila.region_id === null ? null : Number(fila.region_id),
    alcance: fila.alcance,
    poblacion: aNumero(fila.poblacion),
    geometria: geometriaDe(fila.geojson),
  }));
}

/**
 * Análoga a `listarRegionesCapa`, para `territorio.provincia`. El filtro
 * `region` es el NOMBRE de la región (no su ubigeo): se resuelve contra
 * `core.regiones` por `region_ubigeo`, sin tildes ni mayúsculas.
 */
export async function listarProvinciasCapa(
  client: PoolClient,
  query: CapaGeometriaQuery,
): Promise<ProvinciaCapaItem[]> {
  const region = query.region?.trim() || null;
  const tolerancia = acotarTolerancia(query.tolerancia);

  const resultado = await client.query<ProvinciaCapaFila>(
    `select p.ubigeo::text as ubigeo,
            p.nombre,
            p.region_ubigeo::text as region_ubigeo,
            p.poblacion_total as poblacion,
            case
              when $2::float8 > 0
                then ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(p.geom, $2::float8)))
              else ST_AsGeoJSON(p.geom)
            end as geojson
       from territorio.provincia p
       left join core.regiones cr on cr.ubigeo = p.region_ubigeo
      where ($1::text is null or core.normalizar_ref(cr.nombre) = core.normalizar_ref($1))
      order by p.ubigeo asc`,
    [region, tolerancia],
  );

  return resultado.rows.map((fila) => ({
    ubigeo: fila.ubigeo,
    nombre: fila.nombre,
    regionUbigeo: fila.region_ubigeo,
    poblacion: aNumero(fila.poblacion),
    geometria: geometriaDe(fila.geojson),
  }));
}

/**
 * Reservas Nacionales (48 features disueltas en 42 reservas por `codigo`).
 * Son pocas y ya vienen simplificadas en la fuente, así que se sirve la
 * geometría cruda sin tolerancia: no pesa como las 1 892 distritales.
 */
export async function listarAnpReservaNacional(
  client: PoolClient,
): Promise<AnpReservaItem[]> {
  const resultado = await client.query<AnpReservaFila>(
    `select a.codigo,
            a.nombre,
            a.categoria,
            ST_AsGeoJSON(a.geom) as geojson
       from territorio.anp_reserva_nacional a
      order by a.codigo asc`,
  );

  return resultado.rows.map((fila) => ({
    codigo: fila.codigo,
    nombre: fila.nombre,
    categoria: fila.categoria,
    geometria: geometriaDe(fila.geojson),
  }));
}
