import type { PoolClient } from "pg";

/**
 * Motivo por defecto exigido por el principio de finalidad (Ley 29733).
 * `core.actor_datos_personales_descifrar` audita este texto antes de descifrar.
 */
export const DEFAULT_PII_MOTIVO = "Consulta de ficha de actor";

export type ActorPii = {
  dni: string | null;
  email: string | null;
  telefono: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La referencia puede ser el UUID o el código legado. Se resuelve aquí para no
 * pasar texto arbitrario al cast `::uuid` (fallaría con 22P02).
 */
async function resolveActorUid(
  client: PoolClient,
  actorRef: string,
): Promise<string | null> {
  const ref = actorRef.trim();
  if (!ref) return null;
  if (UUID_RE.test(ref)) return ref;

  const result = await client.query<{ actor_uid: string }>(
    `select actor_uid::text as actor_uid
       from core.actores
      where codigo_legado = $1
      limit 1`,
    [ref],
  );
  return result.rows[0]?.actor_uid ?? null;
}

/**
 * Descifra DNI, email y teléfono de un actor.
 *
 * La función `core.actor_datos_personales_descifrar` es quien aplica las reglas
 * (nivel de clasificación, motivo obligatorio y auditoría previa al descifrado);
 * aquí sólo se valida la forma de la entrada. La PII no se registra ni se
 * retiene: se devuelve al llamador y se descarta.
 */
export async function getActorPii(
  client: PoolClient,
  actorRef: string,
  motivo: string,
): Promise<ActorPii | null> {
  const actorUid = await resolveActorUid(client, actorRef);
  if (!actorUid) return null;

  const finalMotivo = motivo.trim() || DEFAULT_PII_MOTIVO;

  const result = await client.query<ActorPii>(
    `select dni, email, telefono
       from core.actor_datos_personales_descifrar($1::uuid, $2)`,
    [actorUid, finalMotivo],
  );

  const row = result.rows[0];
  if (row) {
    return {
      dni: row.dni ?? null,
      email: row.email ?? null,
      telefono: row.telefono ?? null,
    };
  }

  // Un actor puede existir sin ficha de datos personales. Eso no es un 404:
  // la ficha se devuelve con los campos en `null` y la UI muestra los huecos.
  const exists = await client.query(
    `select 1 from core.actores where actor_uid = $1::uuid limit 1`,
    [actorUid],
  );
  if (exists.rows.length === 0) return null;

  return { dni: null, email: null, telefono: null };
}
