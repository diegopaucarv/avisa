import type { PoolClient } from "pg";

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
  const contiene = `%${crudo}%`;
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
      where core.normalizar_ref(d.nombre) like core.normalizar_ref($1)
         or core.normalizar_ref(p.nombre) like core.normalizar_ref($1)
         or core.normalizar_ref(r.nombre) like core.normalizar_ref($1)
         or d.ubigeo like $2
      order by (core.normalizar_ref(d.nombre) like core.normalizar_ref($3)) desc,
               d.nombre asc,
               p.nombre asc
      limit $4`,
    [contiene, porUbigeo, empieza, limite],
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
        and (core.normalizar_ref(l.nombre) like core.normalizar_ref($1)
             or core.normalizar_ref(d.nombre) like core.normalizar_ref($1)
             or core.normalizar_ref(p.nombre) like core.normalizar_ref($1)
             or core.normalizar_ref(r.nombre) like core.normalizar_ref($1))
      order by (core.normalizar_ref(l.nombre) like core.normalizar_ref($2)) desc,
               l.nombre asc
      limit $3`,
    [contiene, empieza, limite],
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
