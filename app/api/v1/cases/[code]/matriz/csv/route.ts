import { jsonError } from "@/lib/db/errors";
import { requireSession } from "@/lib/db/http";
import { matrizCsv } from "@/lib/db/repos/cases";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOM = "\uFEFF";

/**
 * Descarga de la matriz del caso en CSV (formato largo: una fila por demanda y
 * dimensión). BOM UTF-8 para Excel y escapado RFC 4180.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const session = requireSession(request);
    const { code } = await context.params;
    const decoded = decodeURIComponent(code);

    const matriz = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => matrizCsv(client, decoded),
    );

    const fecha = new Date().toISOString().slice(0, 10);
    const nombre = `avisa_matriz_${matriz.caso.codigo}_${fecha}.csv`;

    return new Response(BOM + matriz.contenido, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nombre}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
