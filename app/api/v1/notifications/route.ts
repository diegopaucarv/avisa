import { jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerPagina,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import { listNotifications } from "@/lib/db/repos/notifications";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const { page, pageSize } = leerPagina(queryParams(request));

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) =>
        listNotifications(
          client,
          {
            usuarioId: session.uid,
            rolCodigo: session.rol,
          },
          { page, pageSize },
        ),
    );

    return jsonOk(conAliasDePagina(result));
  } catch (error) {
    return jsonError(error);
  }
}
