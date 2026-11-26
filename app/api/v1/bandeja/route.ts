import { jsonError } from "@/lib/db/errors";
import { jsonOk, queryParams, requireSession } from "@/lib/db/http";
import {
  getTablero,
  TIPOS_ENTIDAD_TABLERO,
  type TipoEntidadTablero,
} from "@/lib/db/repos/bandeja";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tablero (Kanban) de la bandeja de trabajo.
 *
 * `GET` devuelve las cuatro columnas (`backlog`, `en_curso`, `en_espera`,
 * `hecho`) con sus tarjetas persistidas en `core.tablero_tarjeta` y los datos de
 * la entidad dueña (alerta, compromiso, demanda o caso) resueltos en SQL.
 *
 * `?tipo=` recorta tarjetas y candidatos a un tipo de entidad (valores del
 * CHECK de la tabla). Un valor desconocido no recorta: se declara «todas» en
 * vez de fallar, igual que los filtros tolerantes del resto de la API.
 *
 * `candidatos` son los registros de la bandeja que todavía no tienen tarjeta
 * (alertas pendientes, compromisos no terminales y demandas sin caso). Al
 * moverlos, `PATCH` crea la fila. Nada se estima: la tarjeta vacía se muestra
 * «sin asignar».
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const bruto = params.get("tipo")?.trim().toLowerCase() ?? "";

    const tipo =
      bruto && (TIPOS_ENTIDAD_TABLERO as readonly string[]).includes(bruto)
        ? (bruto as TipoEntidadTablero)
        : undefined;

    const tablero = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => getTablero(client, { tipo }),
    );

    return jsonOk(tablero);
  } catch (error) {
    return jsonError(error);
  }
}
