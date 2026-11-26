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
  /** Momento en que se marcó como leída; `null` si nunca se leyó. */
  leidoEn: string | Date | null;
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
  /**
   * Avisos sin leer con el mismo alcance que el listado, **sin** aplicar el
   * filtro `estado`: es el contador de la bandeja, no el de la página.
   */
  noLeidas: number;
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
  n.leido_en,
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
    leidoEn: row.leido_en as string | Date | null,
    createdAt: row.created_at as string | Date | null,
  };
}

export async function listNotifications(
  client: PoolClient,
  session: DbSession,
  query: NotificationListQuery = {},
): Promise<NotificationListResult> {
  const unrestricted = UNRESTRICTED_ROLES.has(session.rolCodigo);

  // Alcance base (dueño o bandeja completa), compartido por el listado y el
  // contador de no leídas. El filtro `estado` se añade sólo al listado.
  const baseParams: unknown[] = [];
  const baseConditions: string[] = [];
  if (!unrestricted) {
    baseParams.push(session.usuarioId);
    baseConditions.push(`n.usuario_id = $${baseParams.length}`);
  }

  const params = [...baseParams];
  const conditions = [...baseConditions];
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

  // `count(*) over()` cuenta sólo las filas que pasan el filtro.
  const sql = `
    select ${NOTIFICATION_SELECT},
           count(*) over()::int as total
      from core.notificaciones n
      ${NOTIFICATION_JOIN}
      ${where}
     order by n.created_at desc, n.id
     limit $${limit} offset $${offset}
  `;

  // «Sin leer» es el complemento de leída: ni `estado = 'leida'` ni `leido_en`
  // fijado. Se cuenta con el alcance base para que el número no dependa del
  // filtro de la lista.
  const baseWhere = baseConditions.length
    ? `${baseConditions.join(" and ")} and `
    : "";
  const pendientesSql = `
    select count(*)::int as n
      from core.notificaciones n
     where ${baseWhere}coalesce(n.estado, '') <> 'leida'
       and n.leido_en is null
  `;

  const [result, pendientes] = await Promise.all([
    client.query(sql, params),
    client.query(pendientesSql, baseParams),
  ]);
  const total = (result.rows[0]?.total as number | undefined) ?? 0;
  const noLeidas = (pendientes.rows[0]?.n as number | undefined) ?? 0;

  return {
    items: result.rows.map(mapNotificationRow),
    total,
    page,
    pageSize,
    noLeidas,
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

  // `leido_en` se sincroniza con el estado: marca el instante la primera vez
  // que se lee (no lo reescribe) y se limpia al deshacer.
  const sql = `
    with actualizada as (
      update core.notificaciones
         set estado = $1,
             leido_en = case
               when $1::text = 'leida' then coalesce(leido_en, now())
               else null
             end
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

/**
 * Marca una notificación como leída.
 *
 * Es el `POST /api/v1/notifications/{id}/leer`: mismo alcance y mismos errores
 * que `updateNotificationState`, pero con el estado fijado. Devuelve el aviso
 * con `leidoEn` ya sincronizado.
 */
export async function markNotificationRead(
  client: PoolClient,
  session: DbSession,
  id: string,
): Promise<NotificationItem> {
  return updateNotificationState(client, session, id, "leida");
}

/**
 * Marca como leídas todas las notificaciones sin leer del alcance de la sesión.
 *
 * No falla si no hay ninguna: responde `{ actualizadas: 0 }`. Es idempotente y
 * no toca los avisos ya leídos (`leido_en` se conserva).
 */
export async function markAllNotificationsRead(
  client: PoolClient,
  session: DbSession,
): Promise<{ actualizadas: number }> {
  const params: unknown[] = [];
  let ownership = "";
  if (!UNRESTRICTED_ROLES.has(session.rolCodigo)) {
    params.push(session.usuarioId);
    ownership = `and usuario_id = $${params.length}`;
  }

  const sql = `
    update core.notificaciones
       set estado = 'leida',
           leido_en = coalesce(leido_en, now())
     where coalesce(estado, '') <> 'leida'
       and leido_en is null
       ${ownership}
  `;

  const result = await client.query(sql, params);
  return { actualizadas: result.rowCount ?? 0 };
}
