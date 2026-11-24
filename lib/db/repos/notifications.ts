import type { PoolClient } from "pg";
import { ApiError } from "../errors";
import type { DbSession } from "../tenant";

export type NotificationItem = {
  id: string;
  tipo: string;
  entidadTipo: string | null;
  entidadId: string | null;
  /** Código legible del registro cuando la entidad tiene ficha por código. */
  entidadCodigo: string | null;
  venceEn: string | null;
  estado: string | null;
  createdAt: string | Date | null;
};

/**
 * Estados que admite el CHECK de `core.notificaciones`
 * (`pendiente' | 'enviada' | 'leida`). La columna ya existe: no hay migración.
 */
export const NOTIFICATION_ESTADOS = ["pendiente", "enviada", "leida"] as const;
export type NotificationEstado = (typeof NOTIFICATION_ESTADOS)[number];

/** Sólo estos dos los escribe el `PATCH` del centro de notificaciones. */
export const NOTIFICATION_ESTADOS_LECTURA = ["leida", "pendiente"] as const;
export type NotificationEstadoLectura =
  (typeof NOTIFICATION_ESTADOS_LECTURA)[number];

export function esEstadoNotificacion(
  valor: string,
): valor is NotificationEstado {
  return (NOTIFICATION_ESTADOS as readonly string[]).includes(valor);
}

export function esEstadoLectura(
  valor: string,
): valor is NotificationEstadoLectura {
  return (NOTIFICATION_ESTADOS_LECTURA as readonly string[]).includes(valor);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esUuidNotificacion(valor: string): boolean {
  return UUID.test(valor);
}

export type NotificationListQuery = {
  page?: number;
  pageSize?: number;
  estado?: NotificationEstado;
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
 * `core.notificaciones` guarda el aviso, su vencimiento y el estado de lectura
 * (`pendiente` | `enviada` | `leida`). No aplica RLS: el filtro por usuario es
 * de aplicación y se estrecha en cada consulta, salvo para los roles que ven la
 * bandeja completa.
 *
 * El enlace al registro concreto necesita un código, no el UUID interno. Sólo
 * los casos tienen ficha por código en la SPA (`/casos/{código}`), así que la
 * consulta resuelve `entidad_codigo` uniendo `core.casos` cuando el aviso
 * apunta a un caso. El resto de entidades se enlazan a su sección.
 */
const NOTIFICATION_SELECT = `
  n.id::text as id,
  n.tipo,
  n.entidad_tipo,
  n.entidad_id::text as entidad_id,
  c.codigo_caso as entidad_codigo,
  to_char(n.vence_en, 'YYYY-MM-DD') as vence_en,
  n.estado,
  n.created_at
`;

/**
 * Unión 1:1 con el caso referido. La RLS de `core.casos` sigue vigente: si el
 * usuario no puede ver el caso, `entidad_codigo` llega nulo y la SPA enlaza a
 * la sección en lugar de a una ficha que devolvería 404.
 */
const NOTIFICATION_JOIN = `
  left join core.casos c
    on c.id = n.entidad_id
   and lower(n.entidad_tipo) in ('caso', 'casos')
`;

function mapNotificationRow(row: Record<string, any>): NotificationItem {
  return {
    id: row.id as string,
    tipo: row.tipo as string,
    entidadTipo: row.entidad_tipo as string | null,
    entidadId: row.entidad_id as string | null,
    entidadCodigo: row.entidad_codigo as string | null,
    venceEn: row.vence_en as string | null,
    estado: row.estado as string | null,
    createdAt: row.created_at as string | Date | null,
  };
}

export async function listNotifications(
  client: PoolClient,
  session: DbSession,
  query: NotificationListQuery = {},
): Promise<NotificationListResult> {
  const unrestricted = UNRESTRICTED_ROLES.has(session.rolCodigo);
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (!unrestricted) {
    params.push(session.usuarioId);
    conditions.push(`n.usuario_id = $${params.length}`);
  }
  if (query.estado !== undefined) {
    if (!esEstadoNotificacion(query.estado)) {
      throw new ApiError(
        422,
        "El filtro «estado» admite pendiente, enviada o leida.",
        "FILTRO_INVALIDO",
      );
    }
    params.push(query.estado);
    conditions.push(`n.estado = $${params.length}`);
  }

  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 25)));
  const limit = params.push(pageSize);
  const offset = params.push((page - 1) * pageSize);
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";

  // `count(*) over()` cuenta sólo las filas que pasan el filtro; con
  // `pageSize=1` el `total` del sobre sirve de contador de pendientes.
  const sql = `
    select ${NOTIFICATION_SELECT},
           count(*) over()::int as total
      from core.notificaciones n
      ${NOTIFICATION_JOIN}
      ${where}
     order by n.created_at desc, n.id
     limit $${limit} offset $${offset}
  `;

  const result = await client.query(sql, params);
  const total = (result.rows[0]?.total as number | undefined) ?? 0;

  return {
    items: result.rows.map(mapNotificationRow),
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Cambia el estado de lectura de una notificación.
 *
 * Sólo el dueño puede marcar la suya; `administrador` y `direccion_oaipcs`
 * pueden marcar cualquiera. Si la fila no existe o no es del usuario se
 * responde 404 `NOT_FOUND`, igual que si el UUID está mal formado. Devuelve el
 * aviso con el mismo mapeo que el listado.
 */
export async function updateNotificationState(
  client: PoolClient,
  session: DbSession,
  id: string,
  estado: NotificationEstadoLectura,
): Promise<NotificationItem> {
  if (!esUuidNotificacion(id)) {
    throw new ApiError(404, "La notificación no existe.", "NOT_FOUND");
  }

  const unrestricted = UNRESTRICTED_ROLES.has(session.rolCodigo);
  const params: unknown[] = [estado, id];
  let ownership = "";
  if (!unrestricted) {
    params.push(session.usuarioId);
    ownership = `and usuario_id = $${params.length}`;
  }

  const sql = `
    with actualizada as (
      update core.notificaciones
         set estado = $1
       where id = $2::uuid
         ${ownership}
      returning *
    )
    select ${NOTIFICATION_SELECT}
      from actualizada n
      ${NOTIFICATION_JOIN}
  `;

  const result = await client.query(sql, params);
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "La notificación no existe.", "NOT_FOUND");
  }

  return mapNotificationRow(row);
}
