import type { PoolClient } from "pg";
import { ApiError } from "../errors";

/**
 * Motivo por defecto exigido por el principio de finalidad (Ley 29733).
 * `core.actor_datos_personales_descifrar` audita este texto antes de descifrar.
 */
export const DEFAULT_PII_MOTIVO = "Consulta de ficha de actor";

/** Nivel de clasificación que exige `core.actor_datos_personales_descifrar`. */
export const NIVEL_PII = 3;

export type ActorPii = {
  dni: string | null;
  email: string | null;
  telefono: string | null;
};

/**
 * Resultado del descifrado. `tieneFicha` distingue «el actor no tiene fila de
 * datos personales» de «la fila existe pero no tiene ese campo»: en ambos
 * casos los valores llegan en `null`, pero la UI debe decir cosas distintas.
 */
export type ActorPiiConsulta = ActorPii & { tieneFicha: boolean };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Operaciones cuya autorización se comprueba contra `core.roles`. */
export type RequisitoAutoridad = "pii" | "crear" | "editar" | "eliminar";

export type AutoridadRol = {
  codigo: string;
  maxClasificacion: number;
  puedeCrear: boolean;
  puedeEditar: boolean;
  puedeEliminar: boolean;
};

type FilaRol = {
  codigo: string;
  max_clasificacion: number;
  puede_crear: boolean;
  puede_editar: boolean;
  puede_eliminar: boolean;
};

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

function normalizarRoles(roles: readonly string[]): string[] {
  const vistos = new Set<string>();
  for (const rol of roles) {
    const limpio = (rol ?? "").trim().toLowerCase();
    if (limpio) vistos.add(limpio);
  }
  return [...vistos];
}

function cumpleRequisito(
  fila: FilaRol,
  requisito: RequisitoAutoridad,
): boolean {
  switch (requisito) {
    case "pii":
      return fila.max_clasificacion >= NIVEL_PII;
    case "crear":
      return fila.puede_crear;
    case "editar":
      return fila.puede_editar;
    case "eliminar":
      return fila.puede_eliminar;
  }
}

function errorDeRequisito(requisito: RequisitoAutoridad): ApiError {
  switch (requisito) {
    case "pii":
      return new ApiError(
        403,
        "Su rol no permite ver datos personales.",
        "PII_NO_AUTORIZADO",
      );
    case "crear":
      return new ApiError(
        403,
        "Su rol no permite crear actores.",
        "SIN_PERMISO_CREAR",
      );
    case "editar":
      return new ApiError(
        403,
        "Su rol no permite editar actores.",
        "SIN_PERMISO_EDITAR",
      );
    case "eliminar":
      return new ApiError(
        403,
        "Su rol no permite dar de baja ni fusionar actores.",
        "SIN_PERMISO_ELIMINAR",
      );
  }
}

/**
 * Determina el rol de la sesión que la base debe usar para esta operación y
 * fija `app.rol_codigo` (y `app.clasificacion_max`, por compatibilidad con la
 * definición base de `core.clasificacion_max`).
 *
 * Por qué: la API recibe `session.rol` (rol principal) y `session.roles`
 * (todos). La RLS y `core.actor_datos_personales_descifrar` sólo ven
 * `app.rol_codigo`. Si el rol principal es de nivel 2 y la persona también
 * tiene uno de nivel 3, el descifrado fallaba con 42501 aunque tuviera permiso.
 * Aquí se elige, entre los roles reales de la sesión, el de mayor nivel que
 * cumpla todos los requisitos pedidos. Nunca se usan códigos inventados.
 */
export async function resolverAutoridad(
  client: PoolClient,
  roles: readonly string[],
  requisitos: readonly RequisitoAutoridad[] = [],
): Promise<AutoridadRol> {
  const lista = normalizarRoles(roles);
  const pidePii = requisitos.includes("pii");
  const codigoDesconocido = pidePii ? "PII_ROL_DESCONOCIDO" : "ROL_DESCONOCIDO";

  if (!lista.length) {
    throw new ApiError(
      403,
      "La sesión no declara un rol reconocido por la base.",
      codigoDesconocido,
    );
  }

  const result = await client.query<FilaRol>(
    `select codigo, max_clasificacion, puede_crear, puede_editar, puede_eliminar
       from core.roles
      where codigo = any($1::text[])`,
    [lista],
  );
  const filas = result.rows;
  if (!filas.length) {
    throw new ApiError(
      403,
      "La sesión no declara un rol reconocido por la base.",
      codigoDesconocido,
    );
  }

  // Cada requisito debe estar cubierto por algún rol; si no, se corta con el
  // mensaje de ese requisito (es el que la UI muestra y distingue del vacío).
  for (const requisito of requisitos) {
    if (!filas.some((fila) => cumpleRequisito(fila, requisito))) {
      throw errorDeRequisito(requisito);
    }
  }

  // Un único rol debe cubrir todo: la base sólo tiene un `app.rol_codigo`.
  const candidatas = filas.filter((fila) =>
    requisitos.every((requisito) => cumpleRequisito(fila, requisito)),
  );
  if (!candidatas.length) {
    throw errorDeRequisito(pidePii ? "pii" : requisitos[0]);
  }

  const peso = (fila: FilaRol): number =>
    (fila.puede_crear ? 4 : 0) +
    (fila.puede_editar ? 2 : 0) +
    (fila.puede_eliminar ? 1 : 0);
  candidatas.sort((a, b) => {
    if (b.max_clasificacion !== a.max_clasificacion) {
      return b.max_clasificacion - a.max_clasificacion;
    }
    const diferencia = peso(b) - peso(a);
    if (diferencia !== 0) return diferencia;
    return a.codigo.localeCompare(b.codigo);
  });

  const elegida = candidatas[0];
  await client.query(
    `select set_config('app.rol_codigo', $1, true),
            set_config('app.clasificacion_max', $2, true)`,
    [elegida.codigo, String(elegida.max_clasificacion)],
  );

  return {
    codigo: elegida.codigo,
    maxClasificacion: elegida.max_clasificacion,
    puedeCrear: elegida.puede_crear,
    puedeEditar: elegida.puede_editar,
    puedeEliminar: elegida.puede_eliminar,
  };
}

/**
 * Comprueba que la transacción tenga clave de cifrado antes de intentar
 * descifrar. Sin clave, la función lanza 42501 y el error es indistinguible de
 * «rol sin autorización»; aquí se separa para poder decir 503 «no disponible».
 */
export async function asegurarClaveCifrado(client: PoolClient): Promise<void> {
  const result = await client.query<{ clave: string }>(
    `select coalesce(nullif(current_setting('app.crypto_key', true), ''), '') as clave`,
  );
  if (!result.rows[0]?.clave) {
    throw new ApiError(
      503,
      "La clave de descifrado no está configurada en el servidor.",
      "PII_NO_DISPONIBLE",
    );
  }
}

/** SQL de `pgp_sym_encrypt` con la clave de la transacción. */
export const SQL_CIFRAR = (parametro: string): string =>
  `public.pgp_sym_encrypt(${parametro}::text, current_setting('app.crypto_key'), 'cipher-algo=aes256')`;

/** SQL de `hmac` para el índice ciego del DNI. */
export const SQL_HMAC = (parametro: string): string =>
  `public.hmac(${parametro}::text, current_setting('app.crypto_key'), 'sha256')`;

/**
 * Descifra DNI, email y teléfono de un actor.
 *
 * La causa histórica del fallo («lo del dni y número sigue fallando») no era
 * la falta de datos: `core.actor_datos_personales_descifrar` exige
 * `core.clasificacion_max() >= 3`, que se deriva de `app.rol_codigo`, y
 * `app.crypto_key` no vacío. La API fijaba sólo el rol principal de la sesión,
 * de modo que un usuario con rol principal de nivel 2 (y otro de nivel 3 en su
 * lista) recibía 42501. Aquí se resuelve el rol real (ver
 * `resolverAutoridad`) antes de llamar a la función.
 */
export async function getActorPii(
  client: PoolClient,
  actorRef: string,
  motivo: string,
  roles: readonly string[],
): Promise<ActorPiiConsulta | null> {
  const actorUid = await resolveActorUid(client, actorRef);
  if (!actorUid) return null;

  const finalMotivo = motivo.trim() || DEFAULT_PII_MOTIVO;

  await resolverAutoridad(client, roles, ["pii"]);
  await asegurarClaveCifrado(client);

  // La función lanza `P0002` cuando no hay ficha (o su clasificación supera el
  // nivel de la sesión); no devuelve un conjunto vacío. El savepoint permite
  // capturarlo sin abortar la transacción de la petición.
  await client.query("savepoint pii_descifrar");
  try {
    const result = await client.query<ActorPii>(
      `select dni, email, telefono
         from core.actor_datos_personales_descifrar($1::uuid, $2)`,
      [actorUid, finalMotivo],
    );
    await client.query("release savepoint pii_descifrar");

    const row = result.rows[0];
    if (row) {
      return {
        dni: row.dni ?? null,
        email: row.email ?? null,
        telefono: row.telefono ?? null,
        tieneFicha: true,
      };
    }
  } catch (error) {
    await client.query("rollback to savepoint pii_descifrar");
    await client.query("release savepoint pii_descifrar");
    const codigo = (error as { code?: string }).code;
    if (codigo === "P0002") {
      // Sin ficha PII no es un 404: el actor existe, simplemente no tiene fila.
      return { dni: null, email: null, telefono: null, tieneFicha: false };
    }
    if (codigo === "42501") {
      // La autoridad ya se validó y la clave ya se comprobó: aquí 42501 sólo
      // puede venir de una capa de datos no inicializada.
      throw new ApiError(
        503,
        "La capa de datos personales no está disponible para esta sesión.",
        "PII_NO_DISPONIBLE",
      );
    }
    if (codigo === "22023") {
      throw new ApiError(
        422,
        "El motivo del descifrado es obligatorio.",
        "MOTIVO_REQUERIDO",
      );
    }
    throw error;
  }

  return { dni: null, email: null, telefono: null, tieneFicha: false };
}
