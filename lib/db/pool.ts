import { Pool } from "pg";
import { ConfigError } from "./config-error";

type PoolGlobal = typeof globalThis & { __avisaPool?: Pool };

function resolveConnectionString(): string {
  const url = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new ConfigError(
      "Falta la variable de entorno APP_DATABASE_URL en el servidor. Debe usar el rol avisa_api (nunca el superusuario avisa).",
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
      max: Number(process.env.APP_DB_POOL_MAX ?? 3),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: "avisa-next",
      // Los timeouts viven en el rol `avisa_api` (ALTER ROLE ... SET): el pooler
      // de Neon rechaza el parámetro de arranque `options`.
    });
    globalPool.__avisaPool.on("error", (error) => {
      console.error("[avisa-db] error en el pool", error);
    });
  }
  return globalPool.__avisaPool;
}
