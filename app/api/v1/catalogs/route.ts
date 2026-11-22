import { getCatalogs } from "@/lib/db/repos/catalogs";
import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vocabulario de referencia. No tiene RLS, pero se exige sesión para que la
 * interfaz tenga un único contrato y no dependa de datos anónimos.
 */
export async function GET(request: Request) {
  try {
    requireSession(request);
    const catalogs = await getCatalogs();
    return jsonOk({ catalogs, generatedAt: new Date().toISOString() });
  } catch (error) {
    return jsonError(error);
  }
}
