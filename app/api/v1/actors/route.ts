import { jsonError } from "@/lib/db/errors";
import { jsonOk, queryParams, requireSession } from "@/lib/db/http";
import { listActors, type ActorListQuery } from "@/lib/db/repos/actors";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTERS = ["q", "naturaleza", "tipo", "region", "sort"] as const;

function asInt(value: string | null): number | undefined {
  if (!value || !/^\d{1,6}$/.test(value)) return undefined;
  return Number(value);
}

export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);

    const query: ActorListQuery = {
      page: asInt(params.get("page")),
      pageSize: asInt(params.get("pageSize")),
    };
    for (const key of FILTERS) {
      const value = params.get(key);
      if (value) query[key] = value;
    }

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listActors(client, query),
    );

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
