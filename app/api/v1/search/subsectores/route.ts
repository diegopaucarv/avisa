import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { resumenCasosPorSubsector } from "@/lib/db/repos/search";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/search/subsectores`.
 *
 * Totales de casos vigentes por subsector y nivel de riesgo (Alto · medio ·
 * Bajo), para la variante «Por subsector» del Resumen de Dirección (item 52).
 * No recibe `q`: es un agregado, no una búsqueda.
 *
 * Vive bajo `/search` por restricción de alcance —el agregado se calcula en
 * `lib/db/repos/search.ts`—; conceptualmente pertenece a un futuro
 * `/api/v1/analitica/resumen`.
 *
 * Responde `{ subsectores: [{ subsector, total, alto, medio, bajo,
 * codigoMedio }], totalCasos, generatedAt }`. `codigoMedio` es el código real
 * del nivel intermedio del catálogo («Medio» o «Moderado») y evita que la UI
 * fije el vocabulario a mano.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };

    const result = await withSession(scope, (client) =>
      resumenCasosPorSubsector(client),
    );

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
