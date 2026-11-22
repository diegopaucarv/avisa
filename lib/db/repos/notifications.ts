import type { PoolClient } from "pg";
import type { DbSession } from "../tenant";

export type NotificationItem = {
  id: string;
  tipo: string;
  entidadTipo: string | null;
  entidadId: string | null;
  venceEn: string | null;
  estado: string | null;
  createdAt: string | Date | null;
};

export type NotificationListQuery = {
  page?: number;
  pageSize?: number;
};

export type NotificationListResult = {
  items: NotificationItem[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
};

// Roles que ven la bandeja completa; el resto sólo sus propias notificaciones.
const UNRESTRICTED_ROLES = new Set(["administrador", "direccion_oaipcs"]);

/**
 * core.notificaciones todavía no tiene título, detalle ni marca de lectura, y
 * no aplica RLS. El filtro por usuario es de aplicación; los títulos, el
 * estado "leída" y el aislamiento por fila llegan en la migración D3 de fase 2.
 */
export async function listNotifications(
  client: PoolClient,
  session: DbSession,
  query: NotificationListQuery = {},
): Promise<NotificationListResult> {
  const unrestricted = UNRESTRICTED_ROLES.has(session.rolCodigo);
  const params: unknown[] = unrestricted ? [] : [session.usuarioId];

  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 25)));
  const limit = params.push(pageSize);
  const offset = params.push((page - 1) * pageSize);

  const sql = `
    select n.id::text as id,
           n.tipo,
           n.entidad_tipo,
           n.entidad_id::text as entidad_id,
           to_char(n.vence_en, 'YYYY-MM-DD') as vence_en,
           n.estado,
           n.created_at,
           count(*) over()::int as total
      from core.notificaciones n
      ${unrestricted ? "" : "where n.usuario_id = $1"}
     order by n.created_at desc, n.id
     limit $${limit} offset $${offset}
  `;

  const result = await client.query(sql, params);
  const total = (result.rows[0]?.total as number | undefined) ?? 0;

  return {
    items: result.rows.map((row) => ({
      id: row.id as string,
      tipo: row.tipo as string,
      entidadTipo: row.entidad_tipo as string | null,
      entidadId: row.entidad_id as string | null,
      venceEn: row.vence_en as string | null,
      estado: row.estado as string | null,
      createdAt: row.created_at as string | Date | null,
    })),
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
  };
}
