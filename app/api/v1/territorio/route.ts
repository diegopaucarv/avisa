import { ApiError, jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerBooleano,
  leerPagina,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import {
  buscarTerritorio,
  DISTRITO_TOLERANCIA_MAX,
  listarAnpReservaNacional,
  listarDistritos,
  listarDistritosGeoJson,
  listarProvinciasCapa,
  listarRegionesCapa,
  poblacionPorRegion,
  type CapaGeometriaQuery,
  type DistritoGeometriaQuery,
  type DistritoListQuery,
  type TerritorioQuery,
} from "@/lib/db/repos/territorio";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Buscador territorial del alta de caso y listado de la capa GIS.
 *
 * `GET /api/v1/territorio?q=matarani&limite=20`
 *   Devuelve dos colecciones: `distritos` (catálogo INEI, 1 891) y `lugares`
 *   (puertos, caletas, desembarcaderos). Son cosas distintas a propósito:
 *   Matarani es puerto del distrito de Islay, no un distrito, y el alta debe
 *   guardarlo como lugar. Una sola `q` alimenta a ambas, de modo que quien
 *   escribe «Matarani» lo encuentra sin saber de antemano en qué colección está.
 *
 * `GET /api/v1/territorio?recurso=distritos&region=Loreto&provincia=Maynas&pagina=1&tamano=25`
 *   Lista paginada de la capa GIS (`territorio.distrito`). Filtros opcionales
 *   por región y provincia, sin distinguir tildes ni mayúsculas. Devuelve
 *   ubigeo, nombre, provincia, región, población (denominador, puede ser null)
 *   y centroide. La ficha con geometría vive en
 *   `/api/v1/territorio/distritos/[ubigeo]`.
 *
 * `GET /api/v1/territorio?recurso=distritos&geometria=1&region=Lima&tolerancia=0.01`
 *   Devuelve la capa distrital completa como `FeatureCollection` para pintar
 *   polígonos en Leaflet:
 *
 *     { type: "FeatureCollection", features: [ Feature… ], total, generadoEn }
 *
 *   Cada `Feature` trae `id` = ubigeo y `properties` = { ubigeo, nombre,
 *   provincia, region, poblacion, centroide }. `poblacion` y `centroide` son
 *   `null` si la fila no los trae (nunca 0 inventado). `region`/`provincia`
 *   salen tal cual de la tabla (mayúsculas): la SPA reconcilia con
 *   `normalizarRegion`. No se pagina: el mapa necesita la silueta completa.
 *
 *   La simplificación es siempre del servidor con
 *   `ST_SimplifyPreserveTopology`; `tolerancia` es opcional, por defecto 0,01 y
 *   se acota a [0, 0,05]. `tolerancia=0` sirve la geometría cruda. Un valor no
 *   numérico responde 422 `TOLERANCIA_INVALIDA`. Peso medido de las 1 892
 *   geometrías: 1,48 MB crudas, ~862 kB con 0,01 y ~328 kB con 0,05, más los
 *   `properties`.
 *
 * `GET /api/v1/territorio?recurso=poblacion&agrupar=region`
 *   Denominadores poblacionales por región (item 131):
 *
 *     { agrupar: "region", items: [ { clave, nombre, poblacion, distritos,
 *       distritosConPoblacion } ], total, generadoEn }
 *
 *   `clave` es `left(ubigeo, 2)`, el mismo código INEI de región que usa el
 *   mapa. Suma sólo filas con `poblacion_total` no nulo; `distritos` y
 *   `distritosConPoblacion` permiten declarar cobertura sin inventar. Otro
 *   `agrupar` (o su ausencia) responde 400 `RECURSO_INVALIDO`. La población es
 *   SÓLO denominador de tasas por 100 000 hab.; nunca entra en el riesgo.
 *
 * `GET /api/v1/territorio?recurso=regiones[&alcance=Norte][&tolerancia=0.01]`
 * `GET /api/v1/territorio?recurso=provincias[&region=Lima][&tolerancia=0.01]`
 * `GET /api/v1/territorio?recurso=anp`
 *   Capas coropléticas agregadas como `FeatureCollection` (no se pagina: son 25
 *   regiones, ~196 provincias y 42 reservas):
 *
 *     regiones   · `properties` = { ubigeo, nombre, regionId, poblacion }
 *     provincias · `properties` = { ubigeo, nombre, regionUbigeo, poblacion }
 *     anp        · `properties` = { codigo, nombre, categoria }
 *
 *   `regionId` es `core.regiones.id` (o `null` si no hubo match) y `poblacion`
 *   es `territorio.region.poblacion_total` (denominador; nunca 0 inventado). El
 *   filtro `alcance` (Norte/Centro/Sur/Oriente/Nacional) se resuelve con
 *   `core.cat_alcances_geograficos` vía `core.regiones.alcance_id`. En
 *   `provincias`, `regionUbigeo` es `left(ubigeo,2)` y el filtro `region` es el
 *   NOMBRE de la región, comparado sin tildes ni mayúsculas. `anp` son las
 *   Reservas Nacionales del SERNANP (48 features disueltas en 42 por `codigo`).
 *   La simplificación es del servidor con `ST_SimplifyPreserveTopology`; la
 *   `tolerancia` se acota a [0, 0,05] y un valor no numérico responde 422
 *   `TOLERANCIA_INVALIDA` (`anp` no usa tolerancia).
 *
 * Sólo lectura: no hay POST/PATCH/DELETE. Los catálogos no tienen RLS, pero se
 * exige sesión para que la interfaz tenga un único contrato y no dependa de
 * datos anónimos. Si `territorio.distrito` todavía no existe, la consulta falla
 * con 503 («capa de datos no inicializada»), nunca con datos de relleno.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };

    const recurso = params.get("recurso")?.trim().toLowerCase();
    if (recurso === "distritos") {
      // `geometria=1` es la variante de mapa; sin él se mantiene el listado
      // paginado que ya consume la tabla de distritos.
      if (leerBooleano(params.get("geometria"))) {
        const query: DistritoGeometriaQuery = {};

        const region = params.get("region")?.trim();
        if (region) query.region = region;
        const provincia = params.get("provincia")?.trim();
        if (provincia) query.provincia = provincia;
        const tolerancia = leerTolerancia(params);
        if (tolerancia !== undefined) query.tolerancia = tolerancia;

        const coleccion = await withSession(scope, (client) =>
          listarDistritosGeoJson(client, query),
        );

        return jsonOk(coleccion);
      }

      const { page, pageSize } = leerPagina(params);
      const query: DistritoListQuery = { page, pageSize };

      const region = params.get("region")?.trim();
      if (region) query.region = region;
      const provincia = params.get("provincia")?.trim();
      if (provincia) query.provincia = provincia;

      const result = await withSession(scope, (client) =>
        listarDistritos(client, query),
      );

      return jsonOk(conAliasDePagina(result));
    }
    if (recurso === "poblacion") {
      // Sólo existe el agrupamiento por región: es el denominador que necesita
      // el coropleta. Otro valor es un error de contrato, no un vacío.
      const agrupar = params.get("agrupar")?.trim().toLowerCase();
      if (agrupar !== "region") {
        throw new ApiError(
          400,
          "El recurso poblacion sólo admite agrupar=region.",
          "RECURSO_INVALIDO",
        );
      }

      const result = await withSession(scope, (client) =>
        poblacionPorRegion(client),
      );

      return jsonOk(result);
    }
    if (recurso === "regiones" || recurso === "provincias") {
      const query: CapaGeometriaQuery = {};
      if (recurso === "regiones") {
        // `alcance` es un corte geográfico agregado, propio de región.
        const alcance = params.get("alcance")?.trim();
        if (alcance) query.alcance = alcance;
      } else {
        // En provincia el corte es por NOMBRE de región, no por alcance.
        const region = params.get("region")?.trim();
        if (region) query.region = region;
      }
      const tolerancia = leerTolerancia(params);
      if (tolerancia !== undefined) query.tolerancia = tolerancia;

      const generadoEn = new Date().toISOString();

      if (recurso === "regiones") {
        const items = await withSession(scope, (client) =>
          listarRegionesCapa(client, query),
        );
        const features = items.map((item) => ({
          type: "Feature" as const,
          id: item.ubigeo,
          geometry: item.geometria,
          properties: {
            ubigeo: item.ubigeo,
            nombre: item.nombre,
            regionId: item.regionId,
            alcance: item.alcance,
            poblacion: item.poblacion,
          },
        }));
        return jsonOk({
          type: "FeatureCollection",
          features,
          total: features.length,
          generadoEn,
        });
      }

      const items = await withSession(scope, (client) =>
        listarProvinciasCapa(client, query),
      );
      const features = items.map((item) => ({
        type: "Feature" as const,
        id: item.ubigeo,
        geometry: item.geometria,
        properties: {
          ubigeo: item.ubigeo,
          nombre: item.nombre,
          regionUbigeo: item.regionUbigeo,
          poblacion: item.poblacion,
        },
      }));
      return jsonOk({
        type: "FeatureCollection",
        features,
        total: features.length,
        generadoEn,
      });
    }
    if (recurso === "anp") {
      const items = await withSession(scope, (client) =>
        listarAnpReservaNacional(client),
      );
      const features = items.map((item) => ({
        type: "Feature" as const,
        id: item.codigo,
        geometry: item.geometria,
        properties: {
          codigo: item.codigo,
          nombre: item.nombre,
          categoria: item.categoria,
        },
      }));
      return jsonOk({
        type: "FeatureCollection",
        features,
        total: features.length,
        generadoEn: new Date().toISOString(),
      });
    }
    if (recurso) {
      throw new ApiError(
        400,
        `Recurso no soportado: ${recurso}. Usá recurso=distritos, recurso=poblacion, recurso=regiones, recurso=provincias o recurso=anp.`,
        "RECURSO_INVALIDO",
      );
    }

    const query: TerritorioQuery = {};
    const q = params.get("q");
    if (q) query.q = q;
    const limite = Number(params.get("limite"));
    if (Number.isFinite(limite)) query.limite = limite;

    const result = await withSession(scope, (client) =>
      buscarTerritorio(client, query),
    );

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Lee `tolerancia` de la query. Ausente o vacía deja que el repositorio aplique
 * el valor por defecto; un texto que no sea número corta con 422 antes de tocar
 * PostGIS. El rango [0, DISTRITO_TOLERANCIA_MAX] lo acota el repositorio.
 */
function leerTolerancia(params: URLSearchParams): number | undefined {
  const crudo = params.get("tolerancia")?.trim();
  if (!crudo) return undefined;

  const numero = Number(crudo);
  if (!Number.isFinite(numero)) {
    throw new ApiError(
      422,
      `La tolerancia debe ser un número entre 0 y ${DISTRITO_TOLERANCIA_MAX}.`,
      "TOLERANCIA_INVALIDA",
    );
  }
  return numero;
}
