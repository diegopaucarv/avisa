import { Pool } from "pg";

type PoolGlobal = typeof globalThis & { __avisaPool?: Pool };

function resolveConnectionString(): string {
  const url = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Falta APP_DATABASE_URL. Usa el rol avisa_api (nunca el superusuario avisa).",
    );
  }
  return url;
}

/**
 * Pool único por proceso. En desarrollo, Next recarga módulos y sin esta caché
 * en globalThis se acumularían pools y conexiones.
 */
export function getPool(): Pool {
  const globalPool = globalThis as PoolGlobal;
  if (!globalPool.__avisaPool) {
    globalPool.__avisaPool = new Pool({
      connectionString: resolveConnectionString(),
      max: Number(process.env.APP_DB_POOL_MAX ?? 8),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: "avisa-next",
      // Ninguna consulta de la interfaz puede quedarse colgada sin límite.
      options:
        "-c statement_timeout=10000 -c idle_in_transaction_session_timeout=15000",
    });
    globalPool.__avisaPool.on("error", (error) => {
      console.error("[avisa-db] error en el pool", error);
    });
  }
  return globalPool.__avisaPool;
}
