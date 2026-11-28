import { ApiError, jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import {
  CAPAS_PAGE_SIZE,
  CAPAS_PAGE_SIZE_MAX,
  esTipoInfraestructuraValido,
  listarAuditoriosMapa,
  listarInfraestructurasPuntos,
  listarInstitucionalesPorIdentidad,
  type TipoInfraestructura,
} from "@/lib/db/repos/territorio";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Capas opcionales del panorama territorial. No son capas nuevas del producto:
 * se encienden y apagan sobre el mapa principal que ya existe.
 *
 * `GET /api/v1/territorio/capas?recurso=infraestructuras&tipo=derecho_acuicola`
 *   Puntos de `territorio.infraestructura_punto` (13 456 en la carga vigente;
 *   la migración 75 la movió desde `gis.infraestructuras_puntos`). La capa
 *   mezcla dos poblaciones y el mapa las dibuja distinto:
 *
 *     { recurso: "infraestructuras", tipo, items: [ { id, tipo, lat, lon,
 *       ubigeo, distrito, provincia, region, identi, nombreInfraestructura } ],
 *       total, page, pageSize, pagina, tamanoPagina, resumen: { total,
 *       derechosAcuicolas, sedes, sinCoordenada }, generadoEn }
 *
 *   `total` es el número de filas con coordenada que cumplen el filtro; se
 *   pagina de forma sensata porque 13 456 puntos no entran con holgura en una
 *   sola respuesta. `tamano` se acota a [1, CAPAS_PAGE_SIZE_MAX] (10 000), con
 *   un valor por defecto de CAPAS_PAGE_SIZE (5 000); no se usa `leerPagina`
 *   porque su tope de 100 es demasiado bajo para el renderer canvas.
 *   `tipo` admite `derecho_acuicola` e `institucional`; otro valor responde 422
 *   `TIPO_INVALIDO`. `titular` y `nombre` nunca se proyectan: son datos
 *   personales (Ley 29733).
 *
 * `GET /api/v1/territorio/capas?recurso=auditorios`
 *   Los 27 auditorios (`core.locales`), ubicados por el centroide de su distrito:
 *
 *     { recurso: "auditorios", items: [ { id, codigo, nombre, aforo, activo,
 *       ubigeo, distrito, provincia, region, centroide } ], total, conCentroide,
 *       sinCentroide, sinDistrito, generadoEn }
 *
 *   `distrito_id` ya está poblado en `core.locales`; no es un dato pendiente. La
 *   precisión es «distrito», nunca «dirección»: es una ubicación referencial y
 *   el mapa no inventa un punto cuando el distrito carece de centroide.
 *   `sinCentroide` y `sinDistrito` se declaran en vez de descartarse en silencio.
 *
 * `GET /api/v1/territorio/capas?recurso=fondepes`
 * `GET /api/v1/territorio/capas?recurso=desembarcaderos`
 *   Dos cortes de la capa institucional, con la MISMA forma que
 *   `recurso=infraestructuras` para que el cliente reutilice su renderer:
 *
 *     { recurso: "fondepes" | "desembarcaderos", tipo: "institucional", items:
 *       [ { id, tipo, lat, lon, ubigeo, distrito, provincia, region, identi,
 *       nombreInfraestructura } ], total, page, pageSize, pagina, tamanoPagina,
 *       resumen: { total, derechosAcuicolas, sedes, sinCoordenada }, generadoEn }
 *
 *   `fondepes` = `identi = 'FONDEPES'` (27 puntos); `desembarcaderos` =
 *   `identi like 'DPA%'` (31: «DPA - GORE» y la errata «DPA -GORE»). El
 *   `resumen` se acota al grupo (no a la tabla entera): describe lo que se está
 *   mirando. Paginación idéntica a `infraestructuras`.
 *
 * `recurso` es obligatorio; ausente o distinto responde 400 `RECURSO_INVALIDO`.
 * Sólo lectura, con sesión obligatoria aunque las tablas no tengan RLS. Si
 * `territorio.distrito` o `territorio.infraestructura_punto` todavía no existen, la
 * consulta falla con 503 («capa de datos no inicializada»), nunca con relleno.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };

    const recurso = params.get("recurso")?.trim().toLowerCase();

    if (recurso === "infraestructuras") {
      const tipoCrudo = params.get("tipo")?.trim().toLowerCase();
      let tipo: TipoInfraestructura | undefined;
      if (tipoCrudo) {
        if (!esTipoInfraestructuraValido(tipoCrudo)) {
          throw new ApiError(
            422,
            `Tipo de infraestructura no soportado: ${tipoCrudo}. Usá tipo=derecho_acuicola o tipo=institucional.`,
            "TIPO_INVALIDO",
          );
        }
        tipo = tipoCrudo as TipoInfraestructura;
      }

      const page = enteroDe(
        params.get("pagina") ?? params.get("page"),
        1,
        1_000_000,
      );
      const pageSize = enteroDe(
        params.get("tamano") ?? params.get("pageSize"),
        CAPAS_PAGE_SIZE,
        CAPAS_PAGE_SIZE_MAX,
      );

      const result = await withSession(scope, (client) =>
        listarInfraestructurasPuntos(client, { tipo, page, pageSize }),
      );

      return jsonOk(conAliasDePagina(result));
    }

    if (recurso === "auditorios") {
      const result = await withSession(scope, (client) =>
        listarAuditoriosMapa(client),
      );
      return jsonOk(result);
    }

    if (recurso === "fondepes" || recurso === "desembarcaderos") {
      // `recurso` ya está estrechado al grupo: es el mismo valor que el repo
      // espera, sin traducción de nombres.
      const page = enteroDe(
        params.get("pagina") ?? params.get("page"),
        1,
        1_000_000,
      );
      const pageSize = enteroDe(
        params.get("tamano") ?? params.get("pageSize"),
        CAPAS_PAGE_SIZE,
        CAPAS_PAGE_SIZE_MAX,
      );

      const result = await withSession(scope, (client) =>
        listarInstitucionalesPorIdentidad(client, {
          grupo: recurso,
          page,
          pageSize,
        }),
      );

      return jsonOk(conAliasDePagina(result));
    }

    throw new ApiError(
      400,
      `Recurso no soportado: ${recurso ?? "(ausente)"}. Usá recurso=infraestructuras, recurso=auditorios, recurso=fondepes o recurso=desembarcaderos.`,
      "RECURSO_INVALIDO",
    );
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Entero de la query acotado a [1, maximo]. Un valor ausente o no numérico cae
 * al respaldo en vez de cortar la petición: la paginación es un detalle de
 * transporte, no parte del contrato de la capa.
 */
function enteroDe(
  valor: string | null,
  respaldo: number,
  maximo: number,
): number {
  if (!valor) return respaldo;
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return respaldo;
  return Math.min(maximo, Math.max(1, Math.trunc(numero)));
}
