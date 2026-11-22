import type { PoolClient } from "pg";
import { getPool } from "./pool";

export type DbSession = {
  usuarioId: string;
  rolCodigo: string;
};

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
              set_config('app.p9_origen', $4, true)`,
      [
        session.rolCodigo,
        session.usuarioId,
        cryptoKey(),
        `avisa-next usuario=${session.usuarioId}`,
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
