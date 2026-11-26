import type { PoolClient } from "pg";

import { auditChange } from "../audit";
import type { SessionPayload } from "../auth";
import { ApiError } from "../errors";
import type { DbSession } from "../tenant";

/**
 * Administración: usuarios y roles, catálogos, lista blanca de documentos,
 * parámetros globales y bitácora de migraciones.
 *
 * Todas las escrituras viven en una transacción abierta por `withSession` con
 * `rolCodigo = 'administrador'`: las políticas RLS `p18_*` de `core.usuarios`,
 * `core.usuario_roles` y `core.roles` exigen ese código, no el rol primario de
 * la sesión. La auditoría se escribe en la misma transacción.
 */

export const ROL_ADMINISTRADOR = "administrador";

/**
 * 20 MB es el límite absoluto que aplica el servidor de documentos
 * (`MAX_ARCHIVO_BYTES` en `documents.ts`). No vive en
 * `core.documento_lista_blanca`, así que la pantalla lo muestra como dato de
 * sólo lectura: aquí sólo se publica para que la UI no lo repita a mano.
 */
export const LIMITE_SERVIDOR_BYTES = 20 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DNI_RE = /^\d{8,12}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIME_RE = /^[-\w.+]+\/[-\w.+]+$/;
const EXTENSION_RE = /^[a-z0-9]{1,16}$/;
const CLAVE_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

export function esUuidAdmin(valor: string): boolean {
  return UUID.test(valor);
}

/**
 * Traduce la sesión firmada al contexto de base elevado a `administrador`.
 *
 * Se comprueba la pertenencia al rol aquí, antes de abrir la transacción: sin
 * el rol se responde 403 y no se toca la base.
 */
export function contextoAdministrador(
  session: Pick<SessionPayload, "uid" | "roles">,
): DbSession {
  if (!session.roles.includes(ROL_ADMINISTRADOR)) {
    throw new ApiError(
      403,
      "La administración exige el rol administrador.",
      "FORBIDDEN",
    );
  }
  return { usuarioId: session.uid, rolCodigo: ROL_ADMINISTRADOR };
}

/* ── Validaciones compartidas ─────────────────────────────────────────────── */

function aIso(valor: unknown): string | null {
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === "string" && valor) return valor;
  return null;
}

function aNumero(valor: unknown): number {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string" && /^\d+$/.test(valor)) return Number(valor);
  return 0;
}

function leerTexto(
  valor: unknown,
  minimo: number,
  maximo: number,
  etiqueta: string,
): string {
  const texto = typeof valor === "string" ? valor.trim() : "";
  if (texto.length < minimo || texto.length > maximo) {
    throw new ApiError(
      422,
      `${etiqueta} debe tener entre ${minimo} y ${maximo} caracteres.`,
      "INVALID_INPUT",
    );
  }
  return texto;
}

function leerEntero(
  valor: unknown,
  minimo: number,
  maximo: number,
  etiqueta: string,
): number {
  const numero =
    typeof valor === "number"
      ? valor
      : typeof valor === "string" && /^-?\d+$/.test(valor.trim())
        ? Number(valor)
        : Number.NaN;
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new ApiError(
      422,
      `${etiqueta} debe ser un entero entre ${minimo} y ${maximo}.`,
      "INVALID_INPUT",
    );
  }
  return numero;
}

function leerBooleano(valor: unknown, etiqueta: string): boolean {
  if (typeof valor === "boolean") return valor;
  if (valor === "true" || valor === "1") return true;
  if (valor === "false" || valor === "0") return false;
  throw new ApiError(422, `${etiqueta} debe ser verdadero o falso.`, "INVALID_INPUT");
}

/* ── Usuarios ─────────────────────────────────────────────────────────────── */

export type UsuarioAdmin = {
  id: string;
  nombre: string;
  dni: string | null;
  email: string | null;
  cargo: string | null;
  activo: boolean;
  /** Si la cuenta tiene clave local. Nunca se devuelve el hash. */
  tieneClave: boolean;
  /** Códigos de rol vigentes, del más jerárquico al menos. */
  roles: string[];
  rolPrincipal: string | null;
  ultimoAcceso: string | null;
  creadoEn: string | null;
};

export type RolDisponible = {
  codigo: string;
  maxClasificacion: number;
};

export type UsuariosAdminResultado = {
  items: UsuarioAdmin[];
  total: number;
  page: number;
  pageSize: number;
  rolesDisponibles: RolDisponible[];
};

/** Orden de presentación de los roles: administrador primero. */
const ORDEN_ROL_SQL = `case r.codigo
    when 'administrador' then 1
    when 'direccion_oaipcs' then 2
    when 'alta_direccion' then 3
    when 'sectorista' then 4
    when 'servicio_agente' then 5
    when 'analista_cualitativo' then 6
    when 'curador_politica' then 7
    when 'auditor' then 8
    when 'consulta_lectura' then 9
    when 'externo_publico' then 10
    else 99 end`;

const USUARIO_COLUMNAS = `
  u.id::text as id,
  u.nombre,
  u.dni,
  u.email,
  u.cargo,
  u.activo,
  (u.clave_hash is not null) as tiene_clave,
  u.created_at,
  coalesce(ur.roles, '{}'::text[]) as roles,
  ur.rol_principal,
  la.ultimo_acceso`;

/**
 * Roles vigentes (hoy) y último acceso correcto. `log_accesos.usuario_id` es
 * nulo en filas históricas, así que sin la condición `resultado = 'OK'` el
 * «último acceso» incluiría intentos fallidos.
 */
const USUARIO_LATERALES = `
  from core.usuarios u
  left join lateral (
    select array_agg(r.codigo order by ${ORDEN_ROL_SQL}) as roles,
           (array_agg(r.codigo order by ${ORDEN_ROL_SQL}))[1] as rol_principal
      from core.usuario_roles xr
      join core.roles r on r.id = xr.rol_id
     where xr.usuario_id = u.id
       and (xr.hasta is null or xr.hasta >= current_date)
  ) ur on true
  left join lateral (
    select max(a.fecha) as ultimo_acceso
      from core.log_accesos a
     where a.usuario_id = u.id
       and a.resultado = 'OK'
  ) la on true`;

const USUARIO_FILTRO = `
  where ($1 = ''
     or strpos(lower(u.nombre), lower($1)) > 0
     or strpos(coalesce(u.dni, ''), $1) > 0
     or strpos(lower(coalesce(u.email, '')), lower($1)) > 0)`;

function mapUsuario(row: Record<string, unknown>): UsuarioAdmin {
  const roles = Array.isArray(row["roles"])
    ? (row["roles"] as unknown[]).filter(
        (valor): valor is string => typeof valor === "string",
      )
    : [];
  return {
    id: String(row["id"]),
    nombre: String(row["nombre"] ?? ""),
    dni: typeof row["dni"] === "string" ? row["dni"] : null,
    email: typeof row["email"] === "string" ? row["email"] : null,
    cargo: typeof row["cargo"] === "string" ? row["cargo"] : null,
    activo: row["activo"] === true,
    tieneClave: row["tiene_clave"] === true,
    roles,
    rolPrincipal:
      typeof row["rol_principal"] === "string" ? row["rol_principal"] : null,
    ultimoAcceso: aIso(row["ultimo_acceso"]),
    creadoEn: aIso(row["created_at"]),
  };
}

async function obtenerUsuario(
  client: PoolClient,
  id: string,
): Promise<UsuarioAdmin> {
  const result = await client.query(
    `select ${USUARIO_COLUMNAS} ${USUARIO_LATERALES} where u.id = $1::uuid`,
    [id],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    throw new ApiError(404, "El usuario no existe.", "NOT_FOUND");
  }
  return mapUsuario(row);
}

async function listarRolesDisponibles(
  client: PoolClient,
): Promise<RolDisponible[]> {
  const result = await client.query<{
    codigo: string;
    max_clasificacion: number;
  }>(
    `select codigo, max_clasificacion from core.roles order by id`,
  );
  return result.rows.map((row) => ({
    codigo: row.codigo,
    maxClasificacion: aNumero(row.max_clasificacion),
  }));
}

export async function listarUsuarios(
  client: PoolClient,
  query: { q?: string; page?: number; pageSize?: number } = {},
): Promise<UsuariosAdminResultado> {
  const q = (query.q ?? "").trim();
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 25)));
  const offset = (page - 1) * pageSize;

  const [filas, total, rolesDisponibles] = await Promise.all([
    client.query(
      `select ${USUARIO_COLUMNAS} ${USUARIO_LATERALES} ${USUARIO_FILTRO}
        order by u.activo desc, u.nombre
        limit $2 offset $3`,
      [q, pageSize, offset],
    ),
    client.query<{ n: number }>(
      `select count(*)::int as n from core.usuarios u ${USUARIO_FILTRO}`,
      [q],
    ),
    listarRolesDisponibles(client),
  ]);

  return {
    items: filas.rows.map((row) => mapUsuario(row as Record<string, unknown>)),
    total: aNumero(total.rows[0]?.n),
    page,
    pageSize,
    rolesDisponibles,
  };
}

export type NuevoUsuario = {
  nombre: string;
  dni: string;
  email?: string | null;
  cargo?: string | null;
  clave: string;
  rolCodigo: string;
};

/**
 * Alta de usuario con clave bcrypt local.
 *
 * La clave se hashea en la base con `public.crypt`/`gen_salt` (pgcrypto, coste
 * 10): nunca viaja en claro al registro de auditoría ni se devuelve. DNI y
 * correo se prevalidan contra sus índices únicos para dar un 409 claro.
 */
export async function crearUsuario(
  client: PoolClient,
  ctx: DbSession,
  input: NuevoUsuario,
): Promise<UsuarioAdmin> {
  const nombre = leerTexto(input.nombre, 3, 120, "El nombre");
  if (!/^\d{8,12}$/.test(input.dni.trim())) {
    throw new ApiError(
      422,
      "El DNI debe tener entre 8 y 12 dígitos.",
      "INVALID_INPUT",
    );
  }
  const dni = input.dni.trim();
  const vacio = (valor: string | null | undefined): string | null => {
    const texto = typeof valor === "string" ? valor.trim() : "";
    return texto ? texto : null;
  };
  const email = vacio(input.email);
  const cargo = vacio(input.cargo);

  if (email && !EMAIL_RE.test(email)) {
    throw new ApiError(422, "El correo no tiene un formato válido.", "INVALID_INPUT");
  }
  if (email && email.length > 160) {
    throw new ApiError(422, "El correo supera los 160 caracteres.", "INVALID_INPUT");
  }
  if (cargo && cargo.length > 120) {
    throw new ApiError(422, "El cargo supera los 120 caracteres.", "INVALID_INPUT");
  }
  if (typeof input.clave !== "string" || input.clave.length < 8 || input.clave.length > 128) {
    throw new ApiError(
      422,
      "La clave debe tener entre 8 y 128 caracteres.",
      "INVALID_INPUT",
    );
  }

  const rolCodigo = (input.rolCodigo ?? "").trim();
  const rol = await client.query<{ id: number }>(
    `select id from core.roles where codigo = $1`,
    [rolCodigo],
  );
  const rolId = rol.rows[0]?.id;
  if (rolId === undefined) {
    throw new ApiError(422, "El rol indicado no existe.", "ROL_INVALIDO");
  }

  const duplicados = await client.query<{ dni_dup: boolean; email_dup: boolean }>(
    `select
       exists(select 1 from core.usuarios where dni = $1) as dni_dup,
       ($2::text is not null and exists(select 1 from core.usuarios where email = $2)) as email_dup`,
    [dni, email],
  );
  if (duplicados.rows[0]?.dni_dup) {
    throw new ApiError(409, "Ya existe un usuario con ese DNI.", "DNI_DUPLICADO");
  }
  if (duplicados.rows[0]?.email_dup) {
    throw new ApiError(409, "Ya existe un usuario con ese correo.", "EMAIL_DUPLICADO");
  }

  let id: string;
  try {
    const insert = await client.query<{ id: string }>(
      `insert into core.usuarios (nombre, dni, email, cargo, activo, clave_hash)
       values ($1, $2, $3, $4, true, public.crypt($5, public.gen_salt('bf', 10)))
       returning id::text as id`,
      [nombre, dni, email, cargo, input.clave],
    );
    id = insert.rows[0]?.id ?? "";
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new ApiError(409, "Ya existe un usuario con ese DNI o correo.", "DUPLICADO");
    }
    throw error;
  }

  await client.query(
    `insert into core.usuario_roles (usuario_id, rol_id, desde)
     values ($1::uuid, $2, current_date)
     on conflict (usuario_id, rol_id, desde) do update set hasta = null`,
    [id, rolId],
  );

  await auditChange(client, {
    tabla: "core.usuarios",
    registroId: id,
    accion: "INSERT",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    despues: { nombre, rol: rolCodigo },
  });

  return obtenerUsuario(client, id);
}

/**
 * Activa o desactiva una cuenta. No se permite desactivar la propia cuenta:
 * el administrador perdería el acceso en el siguiente inicio de sesión.
 */
export async function cambiarEstadoUsuario(
  client: PoolClient,
  ctx: DbSession,
  id: string,
  activo: boolean,
): Promise<UsuarioAdmin> {
  if (!esUuidAdmin(id)) {
    throw new ApiError(404, "El usuario no existe.", "NOT_FOUND");
  }
  if (id === ctx.usuarioId && !activo) {
    throw new ApiError(
      422,
      "No puede desactivar su propia cuenta.",
      "AUTO_DESACTIVACION",
    );
  }

  const update = await client.query<{ activo: boolean }>(
    `update core.usuarios set activo = $1 where id = $2::uuid returning activo`,
    [activo, id],
  );
  if (update.rowCount === 0) {
    throw new ApiError(404, "El usuario no existe.", "NOT_FOUND");
  }

  await auditChange(client, {
    tabla: "core.usuarios",
    registroId: id,
    accion: "UPDATE",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    antes: { activo: !activo },
    despues: { activo },
  });

  return obtenerUsuario(client, id);
}

/**
 * Reemplaza los roles vigentes por uno solo.
 *
 * Cierra con `hasta` las asignaciones vigentes de otros roles y deja abierta la
 * del rol pedido. No borra historial: `core.usuario_roles` es histórico por
 * `desde`/`hasta`.
 */
export async function cambiarRolUsuario(
  client: PoolClient,
  ctx: DbSession,
  id: string,
  rolCodigo: string,
): Promise<UsuarioAdmin> {
  if (!esUuidAdmin(id)) {
    throw new ApiError(404, "El usuario no existe.", "NOT_FOUND");
  }
  const rol = await client.query<{ id: number }>(
    `select id from core.roles where codigo = $1`,
    [rolCodigo],
  );
  const rolId = rol.rows[0]?.id;
  if (rolId === undefined) {
    throw new ApiError(422, "El rol indicado no existe.", "ROL_INVALIDO");
  }

  const existe = await client.query(`select 1 from core.usuarios where id = $1::uuid`, [id]);
  if (existe.rowCount === 0) {
    throw new ApiError(404, "El usuario no existe.", "NOT_FOUND");
  }

  await client.query(
    `update core.usuario_roles
        set hasta = current_date - 1
      where usuario_id = $1::uuid
        and rol_id <> $2
        and (hasta is null or hasta >= current_date)`,
    [id, rolId],
  );

  await client.query(
    `insert into core.usuario_roles (usuario_id, rol_id, desde)
     select $1::uuid, $2, current_date
      where not exists (
        select 1 from core.usuario_roles
         where usuario_id = $1::uuid
           and rol_id = $2
           and (hasta is null or hasta >= current_date))
     on conflict (usuario_id, rol_id, desde) do update set hasta = null`,
    [id, rolId],
  );

  await auditChange(client, {
    tabla: "core.usuario_roles",
    registroId: id,
    accion: "UPDATE",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    despues: { rol: rolCodigo },
  });

  return obtenerUsuario(client, id);
}

/* ── Catálogos ────────────────────────────────────────────────────────────── */

export type CampoCatalogo =
  | "etiqueta"
  | "orden"
  | "activo"
  | "maxClasificacion"
  | "puedeCrear"
  | "puedeEditar"
  | "puedeEliminar";

export type ValorCatalogo = {
  id: number;
  etiqueta: string;
  codigo: string | null;
  orden: number | null;
  activo: boolean | null;
  /** Filas que referencian este valor. Si es > 0 no se puede borrar. */
  uso: number;
  maxClasificacion: number | null;
  puedeCrear: boolean | null;
  puedeEditar: boolean | null;
  puedeEliminar: boolean | null;
};

export type CatalogoAdmin = {
  codigo: CatalogoCodigo;
  etiqueta: string;
  descripcion: string;
  editable: boolean;
  /** Motivo por el que el catálogo es de sólo lectura; `null` si es editable. */
  motivoSoloLectura: string | null;
  permiteEliminar: boolean;
  campos: CampoCatalogo[];
  totalUso: number;
  valores: ValorCatalogo[];
};

export type CatalogoCodigo =
  | "niveles_conflicto"
  | "niveles_riesgo"
  | "estados_caso"
  | "tipos_actor"
  | "roles_actor"
  | "roles";

export const CATALOGO_CODIGOS: readonly CatalogoCodigo[] = [
  "niveles_conflicto",
  "niveles_riesgo",
  "estados_caso",
  "tipos_actor",
  "roles_actor",
  "roles",
];

export function esCatalogoCodigo(valor: string): valor is CatalogoCodigo {
  return (CATALOGO_CODIGOS as readonly string[]).includes(valor);
}

/** Nombre físico de la tabla de cada catálogo (lista blanca para el SQL). */
const TABLA_CATALOGO: Record<CatalogoCodigo, string> = {
  niveles_conflicto: "core.cat_niveles_conflicto",
  niveles_riesgo: "core.cat_niveles_riesgo",
  estados_caso: "core.cat_estados_caso",
  tipos_actor: "core.cat_tipos_actor",
  roles_actor: "core.cat_roles_actor",
  roles: "core.roles",
};

type MetaCatalogo = {
  etiqueta: string;
  descripcion: string;
  editable: boolean;
  motivoSoloLectura: string | null;
  permiteEliminar: boolean;
  campos: CampoCatalogo[];
};

const META_CATALOGO: Record<CatalogoCodigo, MetaCatalogo> = {
  niveles_conflicto: {
    etiqueta: "Niveles de conflictividad",
    descripcion:
      "Diferencia, Controversia, Conflicto social y Crisis social. Su cambio es normativo.",
    editable: false,
    motivoSoloLectura:
      "Sólo se modifica con el procedimiento normativo core.aplicar_cambio_normativo; la tabla rechaza la escritura directa.",
    permiteEliminar: false,
    campos: [],
  },
  niveles_riesgo: {
    etiqueta: "Niveles de riesgo",
    descripcion: "Bajo, Moderado y Alto. Se edita el orden de presentación.",
    editable: true,
    motivoSoloLectura: null,
    permiteEliminar: true,
    campos: ["orden"],
  },
  estados_caso: {
    etiqueta: "Estados del caso",
    descripcion:
      "Abierto, Resuelto y Archivado. «Activo» marca los estados que cuentan como caso abierto.",
    editable: true,
    motivoSoloLectura: null,
    permiteEliminar: true,
    campos: ["activo"],
  },
  tipos_actor: {
    etiqueta: "Tipos de actor",
    descripcion: "Clasificación del actor en el directorio.",
    editable: true,
    motivoSoloLectura: null,
    permiteEliminar: true,
    campos: ["etiqueta"],
  },
  roles_actor: {
    etiqueta: "Roles del actor",
    descripcion: "Papel del actor en el caso: principal, secundario, tercero.",
    editable: true,
    motivoSoloLectura: null,
    permiteEliminar: true,
    campos: ["etiqueta"],
  },
  roles: {
    etiqueta: "Roles del sistema",
    descripcion:
      "Capacidades y clasificación máxima de cada rol. Sostienen las políticas de acceso por fila.",
    editable: true,
    motivoSoloLectura: null,
    permiteEliminar: false,
    campos: ["maxClasificacion", "puedeCrear", "puedeEditar", "puedeEliminar"],
  },
};

type FilaCatalogo = Record<string, unknown>;

function valorBase(fila: FilaCatalogo): ValorCatalogo {
  return {
    id: aNumero(fila["id"]),
    etiqueta: String(fila["etiqueta"] ?? ""),
    codigo: typeof fila["codigo"] === "string" ? fila["codigo"] : null,
    orden: typeof fila["orden"] === "number" ? fila["orden"] : null,
    activo: typeof fila["activo"] === "boolean" ? fila["activo"] : null,
    uso: aNumero(fila["uso"]),
    maxClasificacion:
      typeof fila["max_clasificacion"] === "number"
        ? fila["max_clasificacion"]
        : null,
    puedeCrear: typeof fila["puede_crear"] === "boolean" ? fila["puede_crear"] : null,
    puedeEditar:
      typeof fila["puede_editar"] === "boolean" ? fila["puede_editar"] : null,
    puedeEliminar:
      typeof fila["puede_eliminar"] === "boolean" ? fila["puede_eliminar"] : null,
  };
}

const SQL_CATALOGO: Record<CatalogoCodigo, string> = {
  niveles_conflicto: `
    select n.id, n.codigo, n.nombre as etiqueta, n.orden,
           (select count(*)::int from core.casos c where c.nivel_conflicto_id = n.id)
         + (select count(*)::int from core.caso_estado_historial h where h.nivel_conflicto_id = n.id)
           as uso
      from core.cat_niveles_conflicto n
     order by n.orden, n.id`,
  niveles_riesgo: `
    select r.id, r.codigo, r.codigo as etiqueta, r.orden,
           (select count(*)::int from core.casos c
             where c.nivel_riesgo_id = r.id or c.nivel_riesgo_inicial_id = r.id)
         + (select count(*)::int from core.caso_estado_historial h where h.nivel_riesgo_id = r.id)
           as uso
      from core.cat_niveles_riesgo r
     order by r.orden, r.id`,
  estados_caso: `
    select e.id, e.codigo, e.codigo as etiqueta, e.es_activo as activo,
           (select count(*)::int from core.casos c where c.estado_id = e.id)
         + (select count(*)::int from core.caso_estado_historial h where h.estado_id = e.id)
           as uso
      from core.cat_estados_caso e
     order by e.id`,
  tipos_actor: `
    select t.id, t.codigo_legado as codigo, t.nombre as etiqueta,
           (select count(*)::int from core.actores a where a.tipo_actor_id = t.id) as uso
      from core.cat_tipos_actor t
     order by t.nombre`,
  roles_actor: `
    select t.id, t.codigo_legado as codigo, t.nombre as etiqueta,
           (select count(*)::int from core.actores a where a.rol_actor_id = t.id) as uso
      from core.cat_roles_actor t
     order by t.nombre`,
  roles: `
    select r.id, r.codigo, r.codigo as etiqueta,
           r.max_clasificacion, r.puede_crear, r.puede_editar, r.puede_eliminar,
           (select count(*)::int from core.usuario_roles ur
             where ur.rol_id = r.id
               and (ur.hasta is null or ur.hasta >= current_date)) as uso
      from core.roles r
     order by r.id`,
};

async function cargarCatalogo(
  client: PoolClient,
  codigo: CatalogoCodigo,
): Promise<CatalogoAdmin> {
  const meta = META_CATALOGO[codigo];
  const result = await client.query(SQL_CATALOGO[codigo]);
  const valores = result.rows.map((row) =>
    valorBase(row as FilaCatalogo),
  );
  return {
    codigo,
    etiqueta: meta.etiqueta,
    descripcion: meta.descripcion,
    editable: meta.editable,
    motivoSoloLectura: meta.motivoSoloLectura,
    permiteEliminar: meta.permiteEliminar,
    campos: meta.campos,
    totalUso: valores.reduce((suma, valor) => suma + valor.uso, 0),
    valores,
  };
}

export async function listarCatalogos(
  client: PoolClient,
): Promise<CatalogoAdmin[]> {
  return Promise.all(CATALOGO_CODIGOS.map((codigo) => cargarCatalogo(client, codigo)));
}

export async function actualizarValorCatalogo(
  client: PoolClient,
  ctx: DbSession,
  codigo: string,
  id: number,
  cambios: Record<string, unknown>,
): Promise<CatalogoAdmin> {
  if (!esCatalogoCodigo(codigo)) {
    throw new ApiError(404, "El catálogo no existe.", "NOT_FOUND");
  }
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(404, "El valor no existe.", "NOT_FOUND");
  }
  if (codigo === "niveles_conflicto") {
    throw new ApiError(
      409,
      "Los niveles de conflictividad sólo cambian por el procedimiento normativo.",
      "CATALOGO_NORMATIVO",
    );
  }

  const antes = await cargarCatalogo(client, codigo);
  const previo = antes.valores.find((valor) => valor.id === id);
  if (!previo) {
    throw new ApiError(404, "El valor no existe.", "NOT_FOUND");
  }
  if (!antes.editable) {
    throw new ApiError(
      409,
      antes.motivoSoloLectura ?? "Este catálogo es de sólo lectura.",
      "CATALOGO_SOLO_LECTURA",
    );
  }

  const tabla = TABLA_CATALOGO[codigo];
  switch (codigo) {
    case "niveles_riesgo": {
      const orden = leerEntero(cambios["orden"], 0, 32767, "El orden");
      await client.query(`update ${tabla} set orden = $1 where id = $2`, [orden, id]);
      break;
    }
    case "estados_caso": {
      const activo = leerBooleano(cambios["activo"], "El estado");
      await client.query(`update ${tabla} set es_activo = $1 where id = $2`, [
        activo,
        id,
      ]);
      break;
    }
    case "tipos_actor": {
      const nombre = leerTexto(cambios["etiqueta"], 2, 80, "El nombre");
      await client.query(`update ${tabla} set nombre = $1 where id = $2`, [
        nombre,
        id,
      ]);
      break;
    }
    case "roles_actor": {
      const nombre = leerTexto(cambios["etiqueta"], 2, 80, "El nombre");
      await client.query(`update ${tabla} set nombre = $1 where id = $2`, [
        nombre,
        id,
      ]);
      break;
    }
    case "roles": {
      const maxClasificacion = leerEntero(
        cambios["maxClasificacion"],
        1,
        3,
        "La clasificación máxima",
      );
      const puedeCrear = leerBooleano(cambios["puedeCrear"], "«puede crear»");
      const puedeEditar = leerBooleano(cambios["puedeEditar"], "«puede editar»");
      const puedeEliminar = leerBooleano(
        cambios["puedeEliminar"],
        "«puede eliminar»",
      );
      if (puedeEliminar && !puedeEditar) {
        throw new ApiError(
          422,
          "Un rol no puede eliminar sin poder editar.",
          "CAPACIDAD_INVALIDA",
        );
      }
      await client.query(
        `update ${tabla}
            set max_clasificacion = $1,
                puede_crear = $2,
                puede_editar = $3,
                puede_eliminar = $4
          where id = $5`,
        [maxClasificacion, puedeCrear, puedeEditar, puedeEliminar, id],
      );
      break;
    }
    default:
      throw new ApiError(
        409,
        "Este catálogo es de sólo lectura.",
        "CATALOGO_SOLO_LECTURA",
      );
  }

  await auditChange(client, {
    tabla,
    registroId: String(id),
    accion: "UPDATE",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    antes: { ...previo },
    despues: { ...cambios },
  });

  return cargarCatalogo(client, codigo);
}

export async function eliminarValorCatalogo(
  client: PoolClient,
  ctx: DbSession,
  codigo: string,
  id: number,
): Promise<CatalogoAdmin> {
  if (!esCatalogoCodigo(codigo)) {
    throw new ApiError(404, "El catálogo no existe.", "NOT_FOUND");
  }
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(404, "El valor no existe.", "NOT_FOUND");
  }
  if (codigo === "niveles_conflicto") {
    throw new ApiError(
      409,
      "Los niveles de conflictividad sólo cambian por el procedimiento normativo.",
      "CATALOGO_NORMATIVO",
    );
  }

  const antes = await cargarCatalogo(client, codigo);
  const previo = antes.valores.find((valor) => valor.id === id);
  if (!previo) {
    throw new ApiError(404, "El valor no existe.", "NOT_FOUND");
  }
  if (!antes.permiteEliminar) {
    throw new ApiError(
      409,
      "Este catálogo no permite eliminar valores desde la interfaz.",
      "CATALOGO_PROTEGIDO",
    );
  }
  if (previo.uso > 0) {
    throw new ApiError(
      409,
      `No se puede eliminar «${previo.etiqueta}»: lo usan ${previo.uso} registros.`,
      "CATALOGO_EN_USO",
    );
  }

  const tabla = TABLA_CATALOGO[codigo];
  await client.query(`delete from ${tabla} where id = $1`, [id]);

  await auditChange(client, {
    tabla,
    registroId: String(id),
    accion: "DELETE",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    antes: { ...previo },
  });

  return cargarCatalogo(client, codigo);
}

/* ── Lista blanca de documentos ───────────────────────────────────────────── */

export type ListaBlancaItem = {
  mime: string;
  extension: string | null;
  activo: boolean;
  nota: string | null;
  /** Documentos y adjuntos guardados con este MIME. */
  uso: number;
};

const LISTA_BLANCA_SELECT = `
  select l.mime, l.extension, l.activo, l.nota,
         (select count(*)::int from core.documentos d where d.mime = l.mime)
       + (select count(*)::int from core.adjunto a where a.mime = l.mime) as uso
    from core.documento_lista_blanca l`;

function mapListaBlanca(row: Record<string, unknown>): ListaBlancaItem {
  return {
    mime: String(row["mime"] ?? ""),
    extension:
      typeof row["extension"] === "string" ? row["extension"] : null,
    activo: row["activo"] === true,
    nota: typeof row["nota"] === "string" ? row["nota"] : null,
    uso: aNumero(row["uso"]),
  };
}

export async function listarListaBlanca(
  client: PoolClient,
): Promise<ListaBlancaItem[]> {
  const result = await client.query(`${LISTA_BLANCA_SELECT} order by l.mime`);
  return result.rows.map((row) => mapListaBlanca(row as Record<string, unknown>));
}

async function obtenerListaBlanca(
  client: PoolClient,
  mime: string,
): Promise<ListaBlancaItem> {
  const result = await client.query(`${LISTA_BLANCA_SELECT} where l.mime = $1`, [
    mime,
  ]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    throw new ApiError(404, "El tipo de archivo no está en la lista blanca.", "NOT_FOUND");
  }
  return mapListaBlanca(row);
}

function normalizarMime(valor: unknown): string {
  const mime = typeof valor === "string" ? valor.trim().toLowerCase() : "";
  if (mime.length < 3 || mime.length > 120 || !MIME_RE.test(mime)) {
    throw new ApiError(
      422,
      "El MIME debe tener la forma «tipo/subtipo» (por ejemplo application/pdf).",
      "MIME_INVALIDO",
    );
  }
  return mime;
}

function normalizarExtension(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const texto = typeof valor === "string" ? valor.trim().toLowerCase().replace(/^\./, "") : "";
  if (!EXTENSION_RE.test(texto)) {
    throw new ApiError(
      422,
      "La extensión debe tener hasta 16 caracteres alfanuméricos, sin punto.",
      "EXTENSION_INVALIDA",
    );
  }
  return texto;
}

function normalizarNota(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== "string") {
    throw new ApiError(422, "La nota debe ser texto.", "INVALID_INPUT");
  }
  const texto = valor.trim();
  if (texto.length > 500) {
    throw new ApiError(422, "La nota supera los 500 caracteres.", "INVALID_INPUT");
  }
  return texto || null;
}

export type NuevaListaBlanca = {
  mime: string;
  extension?: string | null;
  activo?: boolean;
  nota?: string | null;
};

export async function crearListaBlanca(
  client: PoolClient,
  ctx: DbSession,
  input: NuevaListaBlanca,
): Promise<ListaBlancaItem> {
  const mime = normalizarMime(input.mime);
  const extension = normalizarExtension(input.extension);
  const activo = input.activo === undefined ? true : leerBooleano(input.activo, "«activo»");
  const nota = normalizarNota(input.nota);

  try {
    await client.query(
      `insert into core.documento_lista_blanca (mime, extension, activo, nota)
       values ($1, $2, $3, $4)`,
      [mime, extension, activo, nota],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new ApiError(409, "Ese MIME ya está en la lista blanca.", "DUPLICADO");
    }
    throw error;
  }

  await auditChange(client, {
    tabla: "core.documento_lista_blanca",
    registroId: mime,
    accion: "INSERT",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    despues: { mime, extension, activo },
  });

  return obtenerListaBlanca(client, mime);
}

export type CambiosListaBlanca = {
  extension?: string | null;
  activo?: boolean;
  nota?: string | null;
};

export async function actualizarListaBlanca(
  client: PoolClient,
  ctx: DbSession,
  mime: string,
  cambios: CambiosListaBlanca,
): Promise<ListaBlancaItem> {
  const previo = await obtenerListaBlanca(client, mime);
  const extension =
    cambios.extension === undefined
      ? previo.extension
      : normalizarExtension(cambios.extension);
  const activo =
    cambios.activo === undefined
      ? previo.activo
      : leerBooleano(cambios.activo, "«activo»");
  const nota =
    cambios.nota === undefined ? previo.nota : normalizarNota(cambios.nota);

  await client.query(
    `update core.documento_lista_blanca
        set extension = $2, activo = $3, nota = $4
      where mime = $1`,
    [mime, extension, activo, nota],
  );

  await auditChange(client, {
    tabla: "core.documento_lista_blanca",
    registroId: mime,
    accion: "UPDATE",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    antes: { extension: previo.extension, activo: previo.activo, nota: previo.nota },
    despues: { extension, activo, nota },
  });

  return obtenerListaBlanca(client, mime);
}

export async function eliminarListaBlanca(
  client: PoolClient,
  ctx: DbSession,
  mime: string,
): Promise<ListaBlancaItem> {
  const previo = await obtenerListaBlanca(client, mime);
  if (previo.uso > 0) {
    throw new ApiError(
      409,
      `No se puede quitar «${mime}»: lo usan ${previo.uso} archivos. Desactívelo en su lugar.`,
      "LISTA_BLANCA_EN_USO",
    );
  }

  await client.query(`delete from core.documento_lista_blanca where mime = $1`, [
    mime,
  ]);

  await auditChange(client, {
    tabla: "core.documento_lista_blanca",
    registroId: mime,
    accion: "DELETE",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    antes: { mime },
  });

  return previo;
}

/* ── Configuración ────────────────────────────────────────────────────────── */

export type ConfiguracionItem = {
  clave: string;
  /** Valor JSON tal como está guardado (`jsonb`). */
  valor: unknown;
  descripcion: string | null;
  actualizadoEn: string | null;
  actualizadoPor: string | null;
  actualizadoPorNombre: string | null;
};

const CONFIGURACION_SELECT = `
  select c.clave, c.valor, c.descripcion, c.updated_at,
         c.updated_by::text as updated_by,
         u.nombre as actualizado_por_nombre
    from core.configuracion c
    left join core.usuarios u on u.id = c.updated_by`;

function mapConfiguracion(row: Record<string, unknown>): ConfiguracionItem {
  return {
    clave: String(row["clave"] ?? ""),
    valor: row["valor"] ?? null,
    descripcion:
      typeof row["descripcion"] === "string" ? row["descripcion"] : null,
    actualizadoEn: aIso(row["updated_at"]),
    actualizadoPor:
      typeof row["updated_by"] === "string" ? row["updated_by"] : null,
    actualizadoPorNombre:
      typeof row["actualizado_por_nombre"] === "string"
        ? row["actualizado_por_nombre"]
        : null,
  };
}

export async function listarConfiguracion(
  client: PoolClient,
): Promise<ConfiguracionItem[]> {
  const result = await client.query(`${CONFIGURACION_SELECT} order by c.clave`);
  return result.rows.map((row) => mapConfiguracion(row as Record<string, unknown>));
}

async function obtenerConfiguracion(
  client: PoolClient,
  clave: string,
): Promise<ConfiguracionItem> {
  const result = await client.query(`${CONFIGURACION_SELECT} where c.clave = $1`, [
    clave,
  ]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    throw new ApiError(404, "El parámetro no existe.", "NOT_FOUND");
  }
  return mapConfiguracion(row);
}

export async function guardarConfiguracion(
  client: PoolClient,
  ctx: DbSession,
  clave: string,
  input: { valor: unknown; descripcion?: string | null },
): Promise<ConfiguracionItem> {
  const claveLimpia = typeof clave === "string" ? clave.trim() : "";
  if (claveLimpia.length < 1 || claveLimpia.length > 80 || !CLAVE_RE.test(claveLimpia)) {
    throw new ApiError(
      422,
      "La clave debe tener hasta 80 caracteres y empezar por letra o número.",
      "CLAVE_INVALIDA",
    );
  }

  // El valor llega como texto JSON y se valida aquí; se guarda como `jsonb`.
  let valorCrudo: unknown;
  if (typeof input.valor === "string") {
    try {
      valorCrudo = JSON.parse(input.valor);
    } catch {
      throw new ApiError(
        422,
        "El valor debe ser JSON válido. Para texto, use comillas: \"texto\".",
        "VALOR_INVALIDO",
      );
    }
  } else {
    valorCrudo = input.valor;
  }

  let descripcion: string | null = null;
  if (input.descripcion !== undefined && input.descripcion !== null) {
    if (typeof input.descripcion !== "string") {
      throw new ApiError(422, "La descripción debe ser texto.", "INVALID_INPUT");
    }
    const texto = input.descripcion.trim();
    if (texto.length > 500) {
      throw new ApiError(422, "La descripción supera los 500 caracteres.", "INVALID_INPUT");
    }
    descripcion = texto || null;
  }

  await client.query(
    `insert into core.configuracion (clave, valor, descripcion, updated_at, updated_by)
     values ($1, $2::jsonb, $3, now(), $4::uuid)
     on conflict (clave) do update
        set valor = excluded.valor,
            descripcion = excluded.descripcion,
            updated_at = now(),
            updated_by = excluded.updated_by`,
    [claveLimpia, JSON.stringify(valorCrudo ?? null), descripcion, ctx.usuarioId],
  );

  // Auditoría sin el valor: un parámetro puede contener un secreto.
  await auditChange(client, {
    tabla: "core.configuracion",
    registroId: claveLimpia,
    accion: "UPDATE",
    usuarioId: ctx.usuarioId,
    rolCodigo: ctx.rolCodigo,
    despues: { clave: claveLimpia, descripcion },
  });

  return obtenerConfiguracion(client, claveLimpia);
}

/* ── Migraciones ──────────────────────────────────────────────────────────── */

export type MigracionItem = {
  clave: string;
  aplicadaEn: string | null;
};

export async function listarMigraciones(
  client: PoolClient,
): Promise<MigracionItem[]> {
  const result = await client.query<{ clave: string; aplicada_en: unknown }>(
    `select clave, aplicada_en from core.migracion_log order by aplicada_en desc, clave`,
  );
  return result.rows.map((row) => ({
    clave: row.clave,
    aplicadaEn: aIso(row.aplicada_en),
  }));
}

/* ── Resumen para las tarjetas ────────────────────────────────────────────── */

export type ResumenAdmin = {
  usuarios: { total: number; activos: number };
  roles: { total: number };
  listaBlanca: { total: number; activos: number };
  configuracion: { total: number };
  migraciones: { total: number; ultima: string | null };
};

export async function resumenAdmin(client: PoolClient): Promise<ResumenAdmin> {
  const result = await client.query<Record<string, unknown>>(
    `select
        (select count(*)::int from core.usuarios) as usuarios_total,
        (select count(*)::int from core.usuarios where activo) as usuarios_activos,
        (select count(*)::int from core.roles) as roles_total,
        (select count(*)::int from core.documento_lista_blanca) as lb_total,
        (select count(*)::int from core.documento_lista_blanca where activo) as lb_activos,
        (select count(*)::int from core.configuracion) as cfg_total,
        (select count(*)::int from core.migracion_log) as mig_total,
        (select max(aplicada_en) from core.migracion_log) as mig_ultima`,
  );
  const row = (result.rows[0] ?? {}) as Record<string, unknown>;
  return {
    usuarios: {
      total: aNumero(row["usuarios_total"]),
      activos: aNumero(row["usuarios_activos"]),
    },
    roles: { total: aNumero(row["roles_total"]) },
    listaBlanca: {
      total: aNumero(row["lb_total"]),
      activos: aNumero(row["lb_activos"]),
    },
    configuracion: { total: aNumero(row["cfg_total"]) },
    migraciones: {
      total: aNumero(row["mig_total"]),
      ultima: aIso(row["mig_ultima"]),
    },
  };
}
