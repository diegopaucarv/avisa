import { getPool } from "@/lib/db/pool";
import { jsonError } from "@/lib/db/errors";
import { jsonOk } from "@/lib/db/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Comprobación mínima de la capa de datos. No exige sesión: sirve para saber si
 * el pool llega a Postgres y con qué rol. No devuelve información del dominio.
 */
export async function GET() {
  const started = Date.now();
  try {
    const result = await getPool().query<{
      role: string;
      now: string;
      version: string;
    }>(
      `select current_user as role,
              now()::text as now,
              current_setting('server_version') as version`,
    );
    return jsonOk({
      ok: true,
      role: result.rows[0]?.role ?? null,
      serverVersion: result.rows[0]?.version ?? null,
      latencyMs: Date.now() - started,
    });
  } catch (error) {
    return jsonError(error);
  }
}
