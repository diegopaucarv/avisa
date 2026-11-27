import type { PoolClient } from "pg";
import { getPool } from "./pool";

export type DbSession = {
  usuarioId: string;
  rolCodigo: string;
};

export type SessionOptions = {
  /**
   * Abre la papelera: `set_config('app.ver_anulados', 'on', true)`.
   *
   * Igual que `app.rol_codigo`, la bandera dura la transacción (`true` es el
   * equivalente a `SET LOCAL`), así que no se filtra a la siguiente petición
   * que reutilice la conexión del pool. Por omisión vale `'off'` y la política
   * `p_anulados` de `core.casos`, `core.alertas_tempranas`, `core.demandas`,
   * `core.compromisos` y `core.documentos` no devuelve filas.
   */
  verAnulados?: boolean;
};

/**
 * Roles que pueden anular y restaurar (borrado lógico).
 *
 * Es exactamente `core.roles.puede_eliminar = true` (parche 15 de la DDL, que
 * lo concede a `sectorista` y `administrador` y a ningún otro rol) y el mismo
 * conjunto que `ANULAN` en la SPA
 * (`angular/src/app/core/permisos/capacidades.service.ts`). Se usa para que
 * `?anulados=true` sólo se sirva a quien puede vaciar la papelera: la RLS ya
 * impone el permiso, pero el listado debe fallar con 403 y no con una papelera
 * vacía. Si la matriz cambia en la base, este conjunto y el de la SPA la
 * siguen.
 */
const ROLES_ANULAN = new Set(["administrador", "sectorista"]);

/**
 * Entidades que la Dirección OAIPCS también puede anular, en espejo de
 * `core.exigir_anulacion(smallint, text)` (migración 78): sólo alertas. La
 * matriz de roles le niega `puede_eliminar`, pero la baja de una alerta es una
 * acción de su flujo; cualquier otra tabla sigue respondiendo 42501.
 */
const DIRECCION_ANULA = new Set(["alertas"]);

/**
 * `true` si `roles` puede anular y restaurar registros.
 *
 * Sin `entidad`, la respuesta es la regla estricta (`puede_eliminar`). Con
 * `entidad`, se admite además a `direccion_oaipcs` cuando esa entidad está en
 * `DIRECCION_ANULA`; así el gate de `?anulados=true` y el lote por entidad no
 * prometen un permiso que la base rechazaría.
 */
export function puedeAnularRegistros(
  roles: readonly string[],
  entidad?: string,
): boolean {
  if (roles.some((rol) => ROLES_ANULAN.has(rol))) return true;
  if (!entidad || !DIRECCION_ANULA.has(entidad)) return false;
  return roles.includes("direccion_oaipcs");
}

/**
 * La clave de cifrado de PII vive fuera de la base (`.env`). Se fija por
 * transacción junto con el resto de GUC; si falta, el descifrado falla con un
 * error explícito en vez de devolver datos vacíos.
 */
function cryptoKey(): string {
  return process.env.APP_CRYPTO_KEY ?? "";
}

/**
 * Una transacción por petición con el contexto de seguridad fijado.
 *
 * `set_config(..., true)` equivale a SET LOCAL: dura la transacción y no se
 * filtra a la siguiente petición que reutilice la misma conexión del pool.
 *
 * Sin `app.rol_codigo`, core.clasificacion_max() devuelve 0 y las tablas con
 * FORCE ROW LEVEL SECURITY no devuelven filas ni aceptan escrituras.
 */
export async function withSession<T>(
  session: DbSession,
  work: (client: PoolClient) => Promise<T>,
  options: SessionOptions = {},
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query(
      `select set_config('app.rol_codigo', $1, true),
              set_config('app.usuario_id', $2, true),
              set_config('app.user_id', $2, true),
              set_config('app.staff_bypass_subject_rls', 'false', true),
              set_config('app.crypto_key', $3, true),
              -- Queda en audit.datos_personales_acceso.contexto->>'origen'.
              set_config('app.p9_origen', $4, true),
              -- Papelera: 'on' sólo si el llamador lo pide explícitamente
              -- (parámetro anulados=true). Dura la transacción, como el resto.
              set_config('app.ver_anulados', $5, true)`,
      [
        session.rolCodigo,
        session.usuarioId,
        cryptoKey(),
        `avisa-next usuario=${session.usuarioId}`,
        options.verAnulados ? "on" : "off",
      ],
    );
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // La conexión quedó inservible; se descarta al liberarla.
    }
    throw error;
  } finally {
    client.release();
  }
}
