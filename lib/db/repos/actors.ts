import type { PoolClient } from "pg";
import { ApiError } from "../errors";
import { auditChange } from "../audit";
import {
  NIVEL_PII,
  SQL_CIFRAR,
  SQL_HMAC,
  asegurarClaveCifrado,
  resolverAutoridad,
  type ActorPii,
  type AutoridadRol,
  type RequisitoAutoridad,
} from "./pii";

/**
 * Contexto de escritura. `roles` es la lista completa de la sesión; la base sólo
 * tiene un `app.rol_codigo`, así que `resolverAutoridad` elige el rol real que
 * cubre todos los requisitos y lo fija en la transacción.
 */
export type ActorScope = {
  usuarioId: string;
  rolCodigo: string;
  roles?: readonly string[];
};

function rolesDe(scope: ActorScope): string[] {
  const lista = scope.roles?.length ? [...scope.roles] : [scope.rolCodigo];
  return lista.filter(
    (rol): rol is string => typeof rol === "string" && rol.trim() !== "",
  );
}

const ACTOR_SELECT = `
  a.actor_uid::text as id,
  a.nombre_actual as nombre,
  a.abreviatura,
  a.naturaleza,
  ta.nombre as tipo,
  ra.nombre as funcion,
  pf.nombre as posicionamiento,
  a.cargo_actual as cargo,
  replace(a.nivel_gobierno, '_', ' ') as nivel_gobierno,
  a.categoria,
  a.email_contacto as email,
  rg.nombre as region,
  d.nombre as distrito,
  oa.nombre_actual as organizacion_ancla,
  a.organizacion_ancla_uid::text as organizacion_ancla_uid,
  a.activo,
  a.es_validado_humano as validado,
  a.nivel_clasificacion as clasificacion,
  a.origen_dato as origen,
  a.codigo_legado as codigo,
  a.perfil_descripcion,
  a.nivel_identificacion_id,
  ni.codigo as nivel_identificacion,
  o.expediente_ospa,
  o.estado_ospa,
  o.vigencia_desde,
  o.vigencia_hasta,
  o.ruc
`;

const ACTOR_FROM = `
  from core.actores a
  left join core.cat_tipos_actor ta on ta.id = a.tipo_actor_id
  left join core.cat_roles_actor ra on ra.id = a.rol_actor_id
  left join core.cat_perfiles_actor pf on pf.id = a.perfil_id
  left join core.regiones rg on rg.id = a.region_id
  left join core.distritos d on d.id = a.distrito_id
  left join core.cat_nivel_identificacion ni on ni.id = a.nivel_identificacion_id
  left join core.organizaciones o on o.actor_uid = a.actor_uid
  left join core.actores oa on oa.actor_uid = a.organizacion_ancla_uid
`;

export type ActorListQuery = {
  q?: string;
  naturaleza?: string;
  tipo?: string;
  region?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
};

export type ActorListItem = {
  id: string;
  nombre: string;
  abreviatura: string | null;
  naturaleza: string;
  tipo: string | null;
  funcion: string | null;
  posicionamiento: string | null;
  cargo: string | null;
  nivelGobierno: string | null;
  categoria: string | null;
  email: string | null;
  region: string | null;
  distrito: string | null;
  organizacionAncla: string | null;
  organizacionAnclaUid: string | null;
  activo: boolean;
  validado: boolean;
  clasificacion: number;
  origen: string | null;
  codigo: string | null;
  perfilDescripcion: string | null;
  /** `core.cat_nivel_identificacion.codigo`; permite distinguir DNI de «sin doc». */
  nivelIdentificacion: string | null;
  /** Sólo organizaciones: identificación OSPA capturada, no validada contra padrón. */
  expedienteOspa: string | null;
  estadoOspa: string | null;
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
  ruc: string | null;
};

export type ActorListResult = {
  items: ActorListItem[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
};

const SORTS: Record<string, string> = {
  name: "a.nombre_actual asc, a.actor_uid asc",
  recent: "a.updated_at desc, a.nombre_actual asc, a.actor_uid asc",
};

/** `Date`, ISO con hora o `YYYY-MM-DD` → `YYYY-MM-DD`; cualquier otro valor → `null`. */
function fechaISO(valor: unknown): string | null {
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime())
      ? null
      : valor.toISOString().slice(0, 10);
  }
  if (typeof valor === "string" && valor.trim()) {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(valor.trim());
    return match ? match[1] : null;
  }
  return null;
}

function mapActor(row: Record<string, unknown>): ActorListItem {
  return {
    id: row.id as string,
    nombre: row.nombre as string,
    abreviatura: row.abreviatura as string | null,
    naturaleza: row.naturaleza as string,
    tipo: row.tipo as string | null,
    funcion: row.funcion as string | null,
    posicionamiento: row.posicionamiento as string | null,
    cargo: row.cargo as string | null,
    nivelGobierno: row.nivel_gobierno as string | null,
    categoria: row.categoria as string | null,
    email: row.email as string | null,
    region: row.region as string | null,
    distrito: row.distrito as string | null,
    organizacionAncla: row.organizacion_ancla as string | null,
    organizacionAnclaUid: row.organizacion_ancla_uid as string | null,
    activo: row.activo as boolean,
    validado: row.validado as boolean,
    clasificacion: row.clasificacion as number,
    origen: row.origen as string | null,
    codigo: row.codigo as string | null,
    perfilDescripcion: row.perfil_descripcion as string | null,
    nivelIdentificacion: (row.nivel_identificacion as string | null) ?? null,
    expedienteOspa: (row.expediente_ospa as string | null) ?? null,
    estadoOspa: (row.estado_ospa as string | null) ?? null,
    vigenciaDesde: fechaISO(row.vigencia_desde),
    vigenciaHasta: fechaISO(row.vigencia_hasta),
    ruc: (row.ruc as string | null) ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Validación de entrada                                              */
/* ------------------------------------------------------------------ */

type Json = Record<string, unknown>;

const DNI_RE = /^\d{8}$/;
const RUC_RE = /^\d{11}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEFONO_RE = /^[0-9+()\s.-]{6,50}$/;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

const NIVELES_GOBIERNO = new Set([
  "Nacional",
  "Regional",
  "Local",
  "Empresa",
  "Sociedad_Civil",
]);

const NATURALEZAS = new Set(["persona", "organizacion"]);

function tiene(input: Json, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

/**
 * Lee un campo de texto. Devuelve `undefined` si la clave no vino (para no
 * tocar la columna), `null` si vino vacía y el campo lo admite, y el texto ya
 * recortado en cualquier otro caso.
 */
function leerTexto(
  input: Json,
  key: string,
  max: number,
  etiqueta: string,
  obligatorio = false,
): string | null | undefined {
  if (!tiene(input, key)) {
    if (obligatorio) {
      throw new ApiError(422, `${etiqueta} es obligatorio.`, "FIELD_REQUIRED");
    }
    return undefined;
  }
  const valor = input[key];
  if (valor === null || valor === undefined) {
    if (obligatorio) {
      throw new ApiError(422, `${etiqueta} es obligatorio.`, "FIELD_REQUIRED");
    }
    return null;
  }
  if (typeof valor !== "string") {
    throw new ApiError(422, `${etiqueta} debe ser texto.`, "FIELD_INVALID");
  }
  const limpio = valor.trim();
  if (!limpio) {
    if (obligatorio) {
      throw new ApiError(422, `${etiqueta} es obligatorio.`, "FIELD_REQUIRED");
    }
    return null;
  }
  if (limpio.length > max) {
    throw new ApiError(
      422,
      `${etiqueta} no puede superar ${max} caracteres.`,
      "FIELD_INVALID",
    );
  }
  return limpio;
}

function leerFecha(
  input: Json,
  key: string,
  etiqueta: string,
): string | null | undefined {
  const valor = leerTexto(input, key, 10, etiqueta);
  if (valor === undefined || valor === null) return valor;
  if (!FECHA_RE.test(valor) || Number.isNaN(Date.parse(valor))) {
    throw new ApiError(
      422,
      `${etiqueta} debe tener el formato aaaa-mm-dd.`,
      "FECHA_INVALIDA",
    );
  }
  return valor;
}

function validarDni(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== "string") {
    throw new ApiError(422, "El DNI debe ser texto.", "DNI_INVALIDO");
  }
  const limpio = valor.trim();
  if (!limpio) return null;
  if (!DNI_RE.test(limpio)) {
    throw new ApiError(
      422,
      "El DNI debe tener exactamente 8 dígitos.",
      "DNI_INVALIDO",
    );
  }
  return limpio;
}

function validarRuc(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== "string") {
    throw new ApiError(422, "El RUC debe ser texto.", "RUC_INVALIDO");
  }
  const limpio = valor.trim();
  if (!limpio) return null;
  if (!RUC_RE.test(limpio)) {
    throw new ApiError(
      422,
      "El RUC debe tener exactamente 11 dígitos.",
      "RUC_INVALIDO",
    );
  }
  return limpio;
}

function validarEmail(valor: string | null): string | null {
  if (!valor) return null;
  if (!EMAIL_RE.test(valor)) {
    throw new ApiError(
      422,
      "El correo no tiene un formato válido.",
      "EMAIL_INVALIDO",
    );
  }
  return valor;
}

function validarTelefono(valor: string | null): string | null {
  if (!valor) return null;
  if (!TELEFONO_RE.test(valor)) {
    throw new ApiError(
      422,
      "El teléfono sólo admite números, espacios y los signos + ( ) . -.",
      "TELEFONO_INVALIDO",
    );
  }
  return valor;
}

/** `Sociedad Civil` y `Sociedad_Civil` se guardan como `Sociedad_Civil`. */
function normalizarNivelGobierno(
  valor: string | null | undefined,
): string | null | undefined {
  if (valor === undefined || valor === null) return valor;
  const canonico = valor.trim().replace(/\s+/g, "_");
  if (!NIVELES_GOBIERNO.has(canonico)) {
    throw new ApiError(
      422,
      "El nivel de gobierno no está en el catálogo.",
      "CATALOG_VALUE_INVALID",
    );
  }
  return canonico;
}

/* ------------------------------------------------------------------ */
/* Catálogos                                                          */
/* ------------------------------------------------------------------ */

async function idDeTipoActor(
  client: PoolClient,
  nombre: string,
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `select id from core.cat_tipos_actor
      where core.normalizar_ref(nombre) = core.normalizar_ref($1)
      order by id limit 1`,
    [nombre],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) {
    throw new ApiError(
      422,
      "El tipo de actor no está en el catálogo.",
      "CATALOG_VALUE_INVALID",
    );
  }
  return id;
}

async function idDeFuncion(
  client: PoolClient,
  nombre: string,
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `select id from core.cat_roles_actor
      where core.normalizar_ref(replace(nombre, '_', ' ')) = core.normalizar_ref($1)
      order by id limit 1`,
    [nombre],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) {
    throw new ApiError(
      422,
      "La función no está en el catálogo.",
      "CATALOG_VALUE_INVALID",
    );
  }
  return id;
}

async function idDePerfil(
  client: PoolClient,
  nombre: string,
): Promise<number | null> {
  const result = await client.query<{ id: number }>(
    `select id from core.cat_perfiles_actor
      where core.normalizar_ref(nombre) = core.normalizar_ref($1)
      limit 1`,
    [nombre],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) {
    throw new ApiError(
      422,
      "El posicionamiento no está en el catálogo.",
      "CATALOG_VALUE_INVALID",
    );
  }
  return id;
}

async function idDeRegion(client: PoolClient, nombre: string): Promise<number> {
  const result = await client.query<{ id: number }>(
    `select id from core.regiones
      where core.normalizar_ref(nombre) = core.normalizar_ref($1)
      limit 1`,
    [nombre],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) {
    throw new ApiError(
      422,
      "La región no está en el catálogo.",
      "CATALOG_VALUE_INVALID",
    );
  }
  return id;
}

/* ------------------------------------------------------------------ */
/* Autoridad                                                          */
/* ------------------------------------------------------------------ */

async function autorizar(
  client: PoolClient,
  scope: ActorScope,
  requisitos: readonly RequisitoAutoridad[],
): Promise<AutoridadRol> {
  return resolverAutoridad(client, rolesDe(scope), requisitos);
}

/**
 * En el alta el fallo de PII significa «su rol no puede registrar datos
 * personales», no «no puede verlos». Se reescribe el mensaje sin cambiar el
 * código para que la UI siga distinguiendo un 403 de un 503.
 */
async function autorizarAlta(
  client: PoolClient,
  scope: ActorScope,
  requisitos: readonly RequisitoAutoridad[],
): Promise<AutoridadRol> {
  try {
    return await autorizar(client, scope, requisitos);
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.code === "PII_NO_AUTORIZADO" ||
        error.code === "PII_ROL_DESCONOCIDO")
    ) {
      throw new ApiError(
        403,
        "Su rol no permite registrar datos personales (DNI, teléfono o correo).",
        error.code,
      );
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Lectura                                                            */
/* ------------------------------------------------------------------ */

async function leerActor(
  client: PoolClient,
  ref: string,
): Promise<ActorListItem> {
  const result = await client.query(
    `select ${ACTOR_SELECT} ${ACTOR_FROM}
      where a.actor_uid::text = $1 or a.codigo_legado = $1`,
    [ref],
  );
  const fila = result.rows[0] as Record<string, unknown> | undefined;
  if (!fila) throw new ApiError(404, "El actor no existe.", "NOT_FOUND");
  return mapActor(fila);
}

/* ------------------------------------------------------------------ */
/* Alta                                                               */
/* ------------------------------------------------------------------ */

/**
 * Crea un actor (persona u organización) con identificación opcional, membresía
 * OSPA y contacto opcional.
 *
 * La fila de `core.actores` siempre queda con `nivel_clasificacion` por defecto
 * (2). El DNI, el teléfono y —en personas— el correo viven cifrados en
 * `core.actor_datos_personales` con nivel 3 y `base_legal` declarada; nunca se
 * rellena la columna en claro. En organizaciones el correo es el contacto
 * institucional público (`core.actores.email_contacto`).
 */
export async function createActor(
  client: PoolClient,
  scope: ActorScope,
  input: Json,
): Promise<ActorListItem> {
  // `obligatorio` garantiza un texto no vacío; el cast sólo refleja eso.
  const naturaleza = leerTexto(
    input,
    "naturaleza",
    12,
    "La naturaleza",
    true,
  ) as string;
  if (!NATURALEZAS.has(naturaleza)) {
    throw new ApiError(
      422,
      "La naturaleza debe ser persona u organización.",
      "CATALOG_VALUE_INVALID",
    );
  }
  const nombre = leerTexto(input, "nombre", 255, "El nombre", true) as string;
  const abreviatura =
    leerTexto(input, "abreviatura", 150, "La abreviatura") ?? null;
  const cargo = leerTexto(input, "cargo", 150, "El cargo") ?? null;
  const categoria = leerTexto(input, "categoria", 40, "La categoría") ?? null;
  const perfilDescripcion =
    leerTexto(input, "perfilDescripcion", 5000, "La descripción del perfil") ??
    null;
  const tipoNombre =
    leerTexto(input, "tipo", 100, "El tipo de actor") ?? "Actor social";
  const funcionNombre =
    leerTexto(input, "funcion", 100, "La función") ?? "No determinado";
  const posicionamiento = leerTexto(
    input,
    "posicionamiento",
    100,
    "El posicionamiento",
  );
  const nivelGobierno = normalizarNivelGobierno(
    leerTexto(input, "nivelGobierno", 15, "El nivel de gobierno"),
  );
  const regionNombre = leerTexto(input, "region", 120, "La región");

  const dni = validarDni(tiene(input, "dni") ? input.dni : null);
  let ruc = validarRuc(tiene(input, "ruc") ? input.ruc : null);
  const email = validarEmail(
    leerTexto(input, "email", 254, "El correo") ?? null,
  );
  const telefono = validarTelefono(
    leerTexto(input, "telefono", 50, "El teléfono") ?? null,
  );
  const baseLegal =
    leerTexto(input, "baseLegal", 100, "La base legal") ?? "LEGADO_AVISA_2026";

  const expedienteOspa = leerTexto(
    input,
    "expedienteOspa",
    50,
    "El expediente OSPA",
  );
  const estadoOspa = leerTexto(input, "estadoOspa", 50, "El estado OSPA");
  const vigenciaDesde = leerFecha(input, "vigenciaDesde", "La vigencia desde");
  const vigenciaHasta = leerFecha(input, "vigenciaHasta", "La vigencia hasta");

  const organizacionRef = leerTexto(
    input,
    "organizacionUid",
    64,
    "La organización",
  );
  const membresiaCargo = leerTexto(
    input,
    "membresiaCargo",
    100,
    "El cargo en la organización",
  );
  const membresiaDesde = leerFecha(
    input,
    "membresiaDesde",
    "La vigencia de la membresía",
  );

  if (dni && naturaleza !== "persona") {
    throw new ApiError(
      422,
      "El DNI sólo aplica a personas. Para una organización use el RUC.",
      "DNI_SOLO_PERSONA",
    );
  }
  if (ruc && naturaleza !== "organizacion") {
    throw new ApiError(
      422,
      "El RUC sólo aplica a organizaciones.",
      "RUC_SOLO_ORGANIZACION",
    );
  }

  const tieneOspa =
    (expedienteOspa !== undefined && expedienteOspa !== null) ||
    (estadoOspa !== undefined && estadoOspa !== null) ||
    (vigenciaDesde !== undefined && vigenciaDesde !== null) ||
    (vigenciaHasta !== undefined && vigenciaHasta !== null);
  if (tieneOspa && naturaleza !== "organizacion") {
    throw new ApiError(
      422,
      "El expediente OSPA sólo aplica a organizaciones.",
      "OSPA_SOLO_ORGANIZACION",
    );
  }
  if (vigenciaDesde && vigenciaHasta && vigenciaHasta < vigenciaDesde) {
    throw new ApiError(
      422,
      "La vigencia OSPA no puede terminar antes de empezar.",
      "VIGENCIA_INVALIDA",
    );
  }
  if (organizacionRef && naturaleza !== "persona") {
    throw new ApiError(
      422,
      "La membresía sólo aplica a personas.",
      "MEMBRESIA_SOLO_PERSONA",
    );
  }

  if (naturaleza === "organizacion") ruc = ruc ?? null;

  // El correo de una persona es PII; el de una organización es contacto público.
  const correoPii = naturaleza === "persona" ? email : null;
  const requierePii = Boolean(dni || telefono || correoPii);

  const requisitos: RequisitoAutoridad[] = requierePii
    ? ["crear", "pii"]
    : ["crear"];
  const autoridad = await autorizarAlta(client, scope, requisitos);

  const tipoId = await idDeTipoActor(client, tipoNombre);
  const funcionId = await idDeFuncion(client, funcionNombre);
  const perfilId = posicionamiento
    ? await idDePerfil(client, posicionamiento)
    : null;
  const regionId = regionNombre ? await idDeRegion(client, regionNombre) : null;

  // Membresía: se resuelve antes del alta para poder fijar el ancla institucional.
  let organizacionId: string | null = null;
  if (naturaleza === "persona" && organizacionRef) {
    const org = await client.query<{ id: string; naturaleza: string }>(
      `select actor_uid::text as id, naturaleza
         from core.actores
        where actor_uid::text = $1 or codigo_legado = $1
        limit 1`,
      [organizacionRef],
    );
    const fila = org.rows[0];
    if (!fila) {
      throw new ApiError(
        422,
        "La organización indicada no existe en el directorio.",
        "ORGANIZACION_NO_EXISTE",
      );
    }
    if (fila.naturaleza !== "organizacion") {
      throw new ApiError(
        422,
        "El actor indicado no es una organización.",
        "ORGANIZACION_INVALIDA",
      );
    }
    organizacionId = fila.id;
  }

  const nivelIdentificacion = dni ? 1 : ruc ? 2 : 3;

  const insert = await client.query<{ id: string }>(
    `insert into core.actores
       (nombre_actual, abreviatura, naturaleza, tipo_actor_id, rol_actor_id,
        perfil_id, cargo_actual, nivel_gobierno, categoria, perfil_descripcion,
        region_id, nivel_identificacion_id, organizacion_ancla_uid,
        email_contacto, origen_dato)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'MANUAL')
     returning actor_uid::text as id`,
    [
      nombre,
      abreviatura,
      naturaleza,
      tipoId,
      funcionId,
      perfilId,
      cargo,
      nivelGobierno ?? null,
      categoria,
      perfilDescripcion,
      regionId,
      nivelIdentificacion,
      organizacionId,
      naturaleza === "organizacion" ? email : null,
    ],
  );
  const actorId = insert.rows[0]?.id;
  if (!actorId) {
    throw new ApiError(503, "No se pudo crear el actor.", "ALTA_FALLIDA");
  }

  if (naturaleza === "organizacion") {
    await client.query(
      `insert into core.organizaciones
         (actor_uid, razon_social, ruc, expediente_ospa, estado_ospa,
          vigencia_desde, vigencia_hasta)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        actorId,
        nombre,
        ruc,
        expedienteOspa ?? null,
        estadoOspa ?? null,
        vigenciaDesde ?? null,
        vigenciaHasta ?? null,
      ],
    );
  }

  if (organizacionId) {
    await client.query(
      `insert into core.actor_membresia
         (persona_uid, organizacion_uid, cargo, valid_from)
       values ($1, $2, $3, $4)`,
      [
        actorId,
        organizacionId,
        membresiaCargo ?? null,
        membresiaDesde ?? new Date().toISOString().slice(0, 10),
      ],
    );
  }

  if (requierePii) {
    await asegurarClaveCifrado(client);
    // `pgp_sym_encrypt(NULL, …)` no es fiablemente estricto; el CASE lo hace explícito.
    await client.query(
      `insert into core.actor_datos_personales
         (actor_uid, nivel_clasificacion, base_legal, dni_cifrado, dni_hmac,
          email_cifrado, telefono_cifrado, updated_at)
       values ($1, 3, $2,
               case when $3::text is null then null else ${SQL_CIFRAR("$3")} end,
               case when $3::text is null then null else ${SQL_HMAC("$3")} end,
               case when $4::text is null then null else ${SQL_CIFRAR("$4")} end,
               case when $5::text is null then null else ${SQL_CIFRAR("$5")} end,
               now())`,
      [actorId, baseLegal, dni, correoPii, telefono],
    );
  }

  await auditChange(client, {
    tabla: "core.actores",
    registroId: actorId,
    accion: "INSERT",
    usuarioId: scope.usuarioId,
    rolCodigo: autoridad.codigo,
    despues: {
      nombre_actual: nombre,
      naturaleza,
      tipo: tipoNombre,
      funcion: funcionNombre,
      cargo,
      nivel_gobierno: nivelGobierno ?? null,
      region: regionNombre ?? null,
      nivel_identificacion: nivelIdentificacion,
      organizacion_ancla: organizacionId,
      pii: requierePii ? "cifrado" : null,
    },
  });

  return leerActor(client, actorId);
}

/* ------------------------------------------------------------------ */
/* Edición                                                            */
/* ------------------------------------------------------------------ */

const ACTOR_UPDATE_FIELDS = new Set([
  "nombre",
  "abreviatura",
  "naturaleza",
  "tipo",
  "funcion",
  "posicionamiento",
  "cargo",
  "nivelGobierno",
  "categoria",
  "perfilDescripcion",
  "region",
  "activo",
  "dni",
  "ruc",
  "expedienteOspa",
  "estadoOspa",
  "vigenciaDesde",
  "vigenciaHasta",
]);

/**
 * Actualiza atributos públicos y, con autorización PII, el DNI cifrado; con
 * autorización de edición, los campos OSPA de la organización.
 *
 * Ya no exige que haya un campo público: un cambio que sólo toca DNI u OSPA es
 * válido y se audita en su propia tabla.
 */
export async function updateActor(
  client: PoolClient,
  scope: ActorScope,
  uid: string,
  input: Json,
): Promise<ActorListItem> {
  const claves = Object.keys(input);
  const desconocidos = claves.filter((key) => !ACTOR_UPDATE_FIELDS.has(key));
  if (desconocidos.length) {
    throw new ApiError(
      422,
      `Campo no editable: ${desconocidos[0]}.`,
      "FIELD_NOT_EDITABLE",
    );
  }
  if (!claves.length) {
    throw new ApiError(
      422,
      "Indique al menos un campo para actualizar.",
      "EMPTY_UPDATE",
    );
  }

  const pidePii = tiene(input, "dni");
  const autoridad = await autorizar(
    client,
    scope,
    pidePii ? ["editar", "pii"] : ["editar"],
  );

  const antesResult = await client.query(
    `select a.actor_uid::text as id, a.nombre_actual, a.abreviatura, a.naturaleza,
            a.cargo_actual, a.nivel_gobierno, a.categoria, a.perfil_descripcion,
            a.activo, a.tipo_actor_id, a.rol_actor_id, a.perfil_id, a.region_id,
            a.nivel_identificacion_id,
            ta.nombre as tipo, ra.nombre as funcion, pf.nombre as posicionamiento,
            (o.actor_uid is not null) as tiene_org,
            o.ruc, o.expediente_ospa, o.estado_ospa,
            o.vigencia_desde, o.vigencia_hasta,
            (adp.dni_cifrado is not null) as tiene_dni
       from core.actores a
       left join core.cat_tipos_actor ta on ta.id = a.tipo_actor_id
       left join core.cat_roles_actor ra on ra.id = a.rol_actor_id
       left join core.cat_perfiles_actor pf on pf.id = a.perfil_id
       left join core.organizaciones o on o.actor_uid = a.actor_uid
       left join core.actor_datos_personales adp on adp.actor_uid = a.actor_uid
      where a.actor_uid::text = $1 or a.codigo_legado = $1
      limit 1`,
    [uid],
  );
  const antes = antesResult.rows[0] as Record<string, unknown> | undefined;
  if (!antes) throw new ApiError(404, "El actor no existe.", "NOT_FOUND");
  const actorId = antes.id as string;

  const values: unknown[] = [];
  const sets: string[] = [];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const auditKeys: Array<[string, string]> = [];
  const set = (column: string, key: string, value: unknown): void => {
    sets.push(`${column} = ${bind(value)}`);
    auditKeys.push([key, column]);
  };

  const nombre = leerTexto(input, "nombre", 255, "El nombre", true);
  if (nombre !== undefined) set("nombre_actual", "nombre_actual", nombre);
  const abreviatura = leerTexto(input, "abreviatura", 150, "La abreviatura");
  if (abreviatura !== undefined) set("abreviatura", "abreviatura", abreviatura);
  const naturaleza = leerTexto(input, "naturaleza", 12, "La naturaleza", true);
  if (naturaleza !== undefined) {
    if (naturaleza === null || !NATURALEZAS.has(naturaleza)) {
      throw new ApiError(
        422,
        "La naturaleza no está en el catálogo.",
        "CATALOG_VALUE_INVALID",
      );
    }
    set("naturaleza", "naturaleza", naturaleza);
  }
  const cargo = leerTexto(input, "cargo", 150, "El cargo");
  if (cargo !== undefined) set("cargo_actual", "cargo_actual", cargo);
  const nivelGobierno = normalizarNivelGobierno(
    leerTexto(input, "nivelGobierno", 15, "El nivel de gobierno"),
  );
  if (nivelGobierno !== undefined) {
    set("nivel_gobierno", "nivel_gobierno", nivelGobierno);
  }
  const categoria = leerTexto(input, "categoria", 40, "La categoría");
  if (categoria !== undefined) set("categoria", "categoria", categoria);
  const perfil = leerTexto(
    input,
    "perfilDescripcion",
    5000,
    "La descripción del perfil",
  );
  if (perfil !== undefined) {
    set("perfil_descripcion", "perfil_descripcion", perfil);
  }
  if (tiene(input, "activo")) {
    if (typeof input.activo !== "boolean") {
      throw new ApiError(
        422,
        "El estado activo debe ser booleano.",
        "FIELD_INVALID",
      );
    }
    set("activo", "activo", input.activo);
  }
  if (tiene(input, "region")) {
    const region = leerTexto(input, "region", 120, "La región");
    const regionId = region ? await idDeRegion(client, region) : null;
    set("region_id", "region_id", regionId);
  }

  const tipo = leerTexto(input, "tipo", 100, "El tipo de actor", true);
  const funcion = leerTexto(input, "funcion", 100, "La función", true);
  const posicionamiento = leerTexto(
    input,
    "posicionamiento",
    100,
    "El posicionamiento",
  );
  if (
    tipo !== undefined ||
    funcion !== undefined ||
    posicionamiento !== undefined
  ) {
    if (tipo !== undefined) {
      set(
        "tipo_actor_id",
        "tipo_actor_id",
        await idDeTipoActor(client, tipo ?? ""),
      );
    }
    if (funcion !== undefined) {
      set(
        "rol_actor_id",
        "rol_actor_id",
        await idDeFuncion(client, funcion ?? ""),
      );
    }
    if (posicionamiento !== undefined) {
      const perfilId = posicionamiento
        ? await idDePerfil(client, posicionamiento)
        : null;
      set("perfil_id", "perfil_id", perfilId);
    }
  }

  // Identificación: DNI y RUC deciden el `nivel_identificacion_id` vigente.
  const dniSolicitado = tiene(input, "dni") ? validarDni(input.dni) : undefined;
  const rucSolicitado = tiene(input, "ruc") ? validarRuc(input.ruc) : undefined;
  const cambiaIdentificacion =
    dniSolicitado !== undefined || rucSolicitado !== undefined;

  let nivelFinal: number | null = null;
  if (cambiaIdentificacion) {
    const rucFinal =
      rucSolicitado !== undefined
        ? rucSolicitado
        : ((antes.ruc as string | null) ?? null);
    const tieneDniFinal =
      dniSolicitado !== undefined
        ? dniSolicitado !== null
        : Boolean(antes.tiene_dni);
    nivelFinal = tieneDniFinal ? 1 : rucFinal ? 2 : 3;
    if (nivelFinal !== antes.nivel_identificacion_id) {
      set("nivel_identificacion_id", "nivel_identificacion_id", nivelFinal);
    }
    if (rucSolicitado !== undefined && antes.naturaleza !== "organizacion") {
      throw new ApiError(
        422,
        "El RUC sólo aplica a organizaciones.",
        "RUC_SOLO_ORGANIZACION",
      );
    }
  }

  let after: Record<string, unknown> | null = null;
  if (sets.length) {
    sets.push(`updated_by = ${bind(scope.usuarioId)}`);
    const idParam = bind(actorId);
    const actualizado = await client.query(
      `update core.actores a
          set ${sets.join(", ")}
        where a.actor_uid::text = ${idParam}
        returning a.actor_uid::text as id, a.nombre_actual, a.abreviatura,
                  a.naturaleza, a.tipo_actor_id, a.rol_actor_id, a.perfil_id,
                  a.cargo_actual, a.nivel_gobierno, a.categoria, a.region_id,
                  a.perfil_descripcion, a.activo, a.nivel_identificacion_id`,
      values,
    );
    after =
      (actualizado.rows[0] as Record<string, unknown> | undefined) ?? null;
    if (!after) {
      throw new ApiError(
        404,
        "El actor no existe o no puede editarse.",
        "NOT_FOUND",
      );
    }

    const auditBefore: Record<string, unknown> = {};
    const auditAfter: Record<string, unknown> = {};
    for (const [key, column] of auditKeys) {
      auditBefore[key] = antes[column];
      auditAfter[key] = after[column];
    }
    await auditChange(client, {
      tabla: "core.actores",
      registroId: actorId,
      accion: "UPDATE",
      usuarioId: scope.usuarioId,
      rolCodigo: autoridad.codigo,
      antes: auditBefore,
      despues: auditAfter,
    });
  }

  if (dniSolicitado !== undefined) {
    if (dniSolicitado !== null) {
      await asegurarClaveCifrado(client);
      await client.query(
        `insert into core.actor_datos_personales
           (actor_uid, nivel_clasificacion, base_legal, dni_cifrado, dni_hmac, updated_at)
         values ($1, 3, $2, ${SQL_CIFRAR("$3")}, ${SQL_HMAC("$3")}, now())
         on conflict (actor_uid) do update
           set dni_cifrado = excluded.dni_cifrado,
               dni_hmac = excluded.dni_hmac,
               nivel_clasificacion = 3,
               updated_at = now()`,
        [actorId, "LEGADO_AVISA_2026", dniSolicitado],
      );
    } else {
      await client.query(
        `update core.actor_datos_personales
            set dni_cifrado = null, dni_hmac = null, updated_at = now()
          where actor_uid = $1`,
        [actorId],
      );
    }
    // La auditoría nunca guarda el número: sólo el hecho y su representación.
    await auditChange(client, {
      tabla: "core.actor_datos_personales",
      registroId: actorId,
      accion: "UPDATE",
      usuarioId: scope.usuarioId,
      rolCodigo: autoridad.codigo,
      antes: { dni: antes.tiene_dni ? "cifrado" : null },
      despues: { dni: dniSolicitado !== null ? "cifrado" : null },
    });
  }

  const tieneOspa =
    tiene(input, "expedienteOspa") ||
    tiene(input, "estadoOspa") ||
    tiene(input, "vigenciaDesde") ||
    tiene(input, "vigenciaHasta") ||
    rucSolicitado !== undefined;

  if (tieneOspa) {
    if (antes.naturaleza !== "organizacion") {
      throw new ApiError(
        422,
        "Los datos OSPA y el RUC sólo aplican a organizaciones.",
        "OSPA_SOLO_ORGANIZACION",
      );
    }

    const expediente = leerTexto(
      input,
      "expedienteOspa",
      50,
      "El expediente OSPA",
    );
    const estado = leerTexto(input, "estadoOspa", 50, "El estado OSPA");
    const desde = leerFecha(input, "vigenciaDesde", "La vigencia desde");
    const hasta = leerFecha(input, "vigenciaHasta", "La vigencia hasta");

    const desdeFinal =
      desde !== undefined ? desde : fechaISO(antes.vigencia_desde);
    const hastaFinal =
      hasta !== undefined ? hasta : fechaISO(antes.vigencia_hasta);
    if (desdeFinal && hastaFinal && hastaFinal < desdeFinal) {
      throw new ApiError(
        422,
        "La vigencia OSPA no puede terminar antes de empezar.",
        "VIGENCIA_INVALIDA",
      );
    }

    const ospaValues: unknown[] = [];
    const ospaSets: string[] = [];
    const ospaBind = (value: unknown): string => {
      ospaValues.push(value);
      return `$${ospaValues.length}`;
    };
    const put = (column: string, value: unknown): void => {
      ospaSets.push(`${column} = ${ospaBind(value)}`);
    };

    if (expediente !== undefined) put("expediente_ospa", expediente);
    if (estado !== undefined) put("estado_ospa", estado);
    if (desde !== undefined) put("vigencia_desde", desde);
    if (hasta !== undefined) put("vigencia_hasta", hasta);
    if (rucSolicitado !== undefined) put("ruc", rucSolicitado);

    if (antes.tiene_org) {
      if (ospaSets.length) {
        const where = ospaBind(actorId);
        await client.query(
          `update core.organizaciones set ${ospaSets.join(", ")}
            where actor_uid::text = ${where}`,
          ospaValues,
        );
      }
    } else {
      const valores: unknown[] = [actorId, antes.nombre_actual as string];
      const columnas = ["actor_uid", "razon_social"];
      const marcadores = ["$1", "$2"];
      if (expediente !== undefined && expediente !== null) {
        valores.push(expediente);
        columnas.push("expediente_ospa");
        marcadores.push(`$${valores.length}`);
      }
      if (estado !== undefined && estado !== null) {
        valores.push(estado);
        columnas.push("estado_ospa");
        marcadores.push(`$${valores.length}`);
      }
      if (desde !== undefined && desde !== null) {
        valores.push(desde);
        columnas.push("vigencia_desde");
        marcadores.push(`$${valores.length}`);
      }
      if (hasta !== undefined && hasta !== null) {
        valores.push(hasta);
        columnas.push("vigencia_hasta");
        marcadores.push(`$${valores.length}`);
      }
      if (rucSolicitado) {
        valores.push(rucSolicitado);
        columnas.push("ruc");
        marcadores.push(`$${valores.length}`);
      }
      await client.query(
        `insert into core.organizaciones (${columnas.join(", ")})
         values (${marcadores.join(", ")})`,
        valores,
      );
    }

    await auditChange(client, {
      tabla: "core.organizaciones",
      registroId: actorId,
      accion: antes.tiene_org ? "UPDATE" : "INSERT",
      usuarioId: scope.usuarioId,
      rolCodigo: autoridad.codigo,
      antes: antes.tiene_org
        ? {
            expediente_ospa: antes.expediente_ospa ?? null,
            estado_ospa: antes.estado_ospa ?? null,
            vigencia_desde: fechaISO(antes.vigencia_desde),
            vigencia_hasta: fechaISO(antes.vigencia_hasta),
            ruc: antes.ruc ?? null,
          }
        : null,
      despues: {
        expediente_ospa: expediente !== undefined ? expediente : undefined,
        estado_ospa: estado !== undefined ? estado : undefined,
        vigencia_desde: desde,
        vigencia_hasta: hasta,
        ruc: rucSolicitado,
      },
    });
  }

  return leerActor(client, actorId);
}

/* ------------------------------------------------------------------ */
/* Baja lógica y restauración                                         */
/* ------------------------------------------------------------------ */

const MOTIVO_MINIMO = 10;

function validarMotivo(motivo: string): string {
  const limpio = (motivo ?? "").trim();
  if (limpio.length < MOTIVO_MINIMO) {
    throw new ApiError(
      422,
      `El motivo debe tener al menos ${MOTIVO_MINIMO} caracteres.`,
      "MOTIVO_REQUERIDO",
    );
  }
  return limpio;
}

async function cambiarActivo(
  client: PoolClient,
  scope: ActorScope,
  uid: string,
  activo: boolean,
  motivo: string,
): Promise<ActorListItem> {
  const autoridad = await autorizar(client, scope, ["editar"]);

  const actual = await client.query<{ id: string; activo: boolean }>(
    `select actor_uid::text as id, activo
       from core.actores
      where actor_uid::text = $1 or codigo_legado = $1
      limit 1`,
    [uid],
  );
  const fila = actual.rows[0];
  if (!fila) throw new ApiError(404, "El actor no existe.", "NOT_FOUND");

  if (fila.activo !== activo) {
    await client.query(
      `update core.actores
          set activo = $2, updated_by = $3
        where actor_uid::text = $1`,
      [fila.id, activo, scope.usuarioId],
    );
  }

  await auditChange(client, {
    tabla: "core.actores",
    registroId: fila.id,
    accion: "UPDATE",
    usuarioId: scope.usuarioId,
    rolCodigo: autoridad.codigo,
    antes: { activo: fila.activo },
    despues: { activo, motivo },
  });

  return leerActor(client, fila.id);
}

/** Baja lógica: `core.actores.activo = false`. El registro y sus vínculos se conservan. */
export async function bajaActor(
  client: PoolClient,
  scope: ActorScope,
  uid: string,
  motivo: string,
): Promise<ActorListItem> {
  return cambiarActivo(client, scope, uid, false, validarMotivo(motivo));
}

/** Restaura un actor dado de baja lógica. */
export async function restaurarActor(
  client: PoolClient,
  scope: ActorScope,
  uid: string,
): Promise<ActorListItem> {
  return cambiarActivo(
    client,
    scope,
    uid,
    true,
    "Restauración de la baja lógica",
  );
}

/* ------------------------------------------------------------------ */
/* Fusión                                                             */
/* ------------------------------------------------------------------ */

export type FusionResumen = {
  origenId: string;
  destinoId: string;
  reasignados: {
    casos: number;
    demandas: number;
    alertas: number;
    documentos: number;
    membresias: number;
  };
  /** `actor_fusion` si la tabla existe; `auditoria` si sólo quedó en `audit.cambios`. */
  registroFusion: "actor_fusion" | "auditoria";
};

/**
 * Fusiona dos actores: reasigna los vínculos del origen al destino y deja el
 * origen inactivo (nunca se borra).
 *
 * La RLS de las tablas puente exige `puede_crear` para reinsertar y
 * `puede_eliminar` para borrar las filas antiguas, además de nivel ≥ 3 para el
 * `delete`; sólo `sectorista` y `administrador` cumplen las tres condiciones.
 * El repositorio lo comprueba antes de escribir para devolver 403 y no un fallo
 * de política a medio camino.
 *
 * `core.actor_fusion` todavía no está migrada en esta base: si no existe, la
 * operación continúa y el detalle queda en `audit.cambios`.
 */
export async function fusionarActor(
  client: PoolClient,
  scope: ActorScope,
  origenRef: string,
  destinoRef: string,
  motivo: string,
): Promise<FusionResumen> {
  const motivoLimpio = validarMotivo(motivo);

  const autoridad = await autorizar(client, scope, [
    "crear",
    "editar",
    "eliminar",
  ]);
  if (autoridad.maxClasificacion < NIVEL_PII) {
    throw new ApiError(
      403,
      "La fusión exige nivel de acceso 3 para reasignar los vínculos.",
      "SIN_NIVEL_FUSION",
    );
  }

  const origen = await leerActor(client, origenRef);
  const destino = await leerActor(client, destinoRef);
  if (origen.id === destino.id) {
    throw new ApiError(
      422,
      "El origen y el destino de la fusión deben ser actores distintos.",
      "FUSION_MISMO_ACTOR",
    );
  }

  const reasignados = {
    casos: 0,
    demandas: 0,
    alertas: 0,
    documentos: 0,
    membresias: 0,
  };

  // Cada puente: copiar al destino lo que aún no exista y borrar lo del origen.
  const puentes: Array<{
    tabla: string;
    columna: string;
    clave: string;
    extra: string[];
    campo: keyof FusionResumen["reasignados"];
  }> = [
    {
      tabla: "core.casos_actores",
      columna: "actor_id",
      clave: "caso_id",
      extra: ["nivel_influencia", "posicion"],
      campo: "casos",
    },
    {
      tabla: "core.demandas_actores",
      columna: "actor_id",
      clave: "demanda_id",
      extra: ["rol_en_demanda"],
      campo: "demandas",
    },
    {
      tabla: "core.alertas_actores",
      columna: "actor_id",
      clave: "alerta_id",
      extra: [],
      campo: "alertas",
    },
    {
      tabla: "core.documento_actores",
      columna: "actor_uid",
      clave: "documento_id",
      extra: ["rol", "es_principal"],
      campo: "documentos",
    },
  ];

  for (const puente of puentes) {
    const columnas = [puente.clave, puente.columna, ...puente.extra];
    const seleccion = [
      puente.clave,
      "$2",
      ...puente.extra.map((columna) => `t.${columna}`),
    ];
    await client.query(
      `insert into ${puente.tabla} (${columnas.join(", ")})
       select ${seleccion.join(", ")}
         from ${puente.tabla} t
        where t.${puente.columna} = $1::uuid
       on conflict (${puente.clave}, ${puente.columna}) do nothing`,
      [origen.id, destino.id],
    );
    const borrado = await client.query(
      `delete from ${puente.tabla} where ${puente.columna} = $1::uuid`,
      [origen.id],
    );
    reasignados[puente.campo] = borrado.rowCount ?? 0;
  }

  // Membresías: sólo se transfieren cuando la naturaleza coincide; en un cruce
  // persona↔organización el vínculo se quedaría apuntando a un actor inválido.
  if (origen.naturaleza === destino.naturaleza) {
    const esPersona = origen.naturaleza === "persona";
    const columna = esPersona ? "persona_uid" : "organizacion_uid";
    const otra = esPersona ? "organizacion_uid" : "persona_uid";
    await client.query(
      `insert into core.actor_membresia
              (${columna}, ${otra}, cargo, valid_from, valid_to)
       select $2::uuid, m.${otra}, m.cargo, m.valid_from, m.valid_to
         from core.actor_membresia m
        where m.${columna} = $1::uuid
          and m.${otra} <> $2::uuid
          and not exists (
            select 1 from core.actor_membresia d
             where d.${columna} = $2::uuid and d.${otra} = m.${otra})`,
      [origen.id, destino.id],
    );
    const borradoMembresia = await client.query(
      `delete from core.actor_membresia where ${columna} = $1::uuid`,
      [origen.id],
    );
    reasignados.membresias = borradoMembresia.rowCount ?? 0;
  }

  // Registro de la fusión. La tabla puede no existir todavía: se comprueba sin
  // provocar un error y se aísla el INSERT en un savepoint por si su forma real
  // difiere de la migración propuesta.
  let registroFusion: FusionResumen["registroFusion"] = "auditoria";
  const existeFusion = await client.query<{ existe: boolean }>(
    `select to_regclass('core.actor_fusion') is not null as existe`,
  );
  if (existeFusion.rows[0]?.existe) {
    await client.query("savepoint actor_fusion");
    try {
      await client.query(
        `insert into core.actor_fusion
           (actor_origen_id, actor_destino_id, detalle, fusionado_por)
         values ($1::uuid, $2::uuid, $3::jsonb, $4::uuid)`,
        [
          origen.id,
          destino.id,
          JSON.stringify({ motivo: motivoLimpio, reasignados }),
          scope.usuarioId,
        ],
      );
      await client.query("release savepoint actor_fusion");
      registroFusion = "actor_fusion";
    } catch {
      await client.query("rollback to savepoint actor_fusion");
      await client.query("release savepoint actor_fusion");
      registroFusion = "auditoria";
    }
  }

  await client.query(
    `update core.actores
        set activo = false, updated_by = $2
      where actor_uid::text = $1`,
    [origen.id, scope.usuarioId],
  );

  await auditChange(client, {
    tabla: "core.actores",
    registroId: origen.id,
    accion: "UPDATE",
    usuarioId: scope.usuarioId,
    rolCodigo: autoridad.codigo,
    antes: { activo: origen.activo },
    despues: {
      activo: false,
      fusionado_con: destino.id,
      motivo: motivoLimpio,
      reasignados,
      registro_fusion: registroFusion,
    },
  });

  return {
    origenId: origen.id,
    destinoId: destino.id,
    reasignados,
    registroFusion,
  };
}

/* ------------------------------------------------------------------ */
/* Listado                                                            */
/* ------------------------------------------------------------------ */

export async function listActors(
  client: PoolClient,
  query: ActorListQuery,
): Promise<ActorListResult> {
  const params: unknown[] = [];
  const where: string[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const search = query.q?.trim();
  if (search) {
    const like = bind(`%${search}%`);
    where.push(
      `(core.normalizar_ref(a.nombre_actual) like core.normalizar_ref(${like}) or core.normalizar_ref(coalesce(a.abreviatura, '')) like core.normalizar_ref(${like}) or core.normalizar_ref(coalesce(a.cargo_actual, '')) like core.normalizar_ref(${like}))`,
    );
  }
  if (query.naturaleza) where.push(`a.naturaleza = ${bind(query.naturaleza)}`);
  if (query.tipo) where.push(`ta.nombre = ${bind(query.tipo)}`);
  if (query.region) where.push(`rg.nombre = ${bind(query.region)}`);

  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 25)));
  const order = SORTS[query.sort ?? "name"] ?? SORTS.name;

  const sql = `
    select ${ACTOR_SELECT},
           count(*) over()::int as total
    ${ACTOR_FROM}
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by ${order}
    limit ${bind(pageSize)} offset ${bind((page - 1) * pageSize)}
  `;

  const result = await client.query(sql, params);
  const total = (result.rows[0]?.total as number | undefined) ?? 0;

  return {
    items: result.rows.map((row) => mapActor(row as Record<string, unknown>)),
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Detalle                                                            */
/* ------------------------------------------------------------------ */

export type ActorCase = {
  code: string;
  title: string;
  estado: string | null;
  nivelInfluencia: number | null;
  posicion: string | null;
};

export type ActorOrganization = {
  id: string;
  nombre: string;
};

/**
 * Estado del bloque de datos personales. La UI debe distinguir «no autorizado»
 * de «sin ficha»: son causas distintas y hoy se mostraban igual.
 */
export type PiiEstado =
  | "listo"
  | "sin_ficha"
  | "no_autorizado"
  | "no_disponible"
  | "error"
  /**
   * El detalle no descifra datos personales: la PII se pide aparte a
   * `/v1/actors/:uid/pii` con un motivo explícito, que queda auditado.
   */
  | "no_solicitado";

export type ActorDetail = {
  actor: ActorListItem;
  casos: ActorCase[];
  organizacion: ActorOrganization | null;
  pii: ActorPii | null;
  /** Motivo corto y sin datos sensibles cuando el descifrado falla. */
  piiError: string | null;
  piiEstado: PiiEstado;
  generatedAt: string;
};

/**
 * Detalle de la ficha: actor, casos y organización. **No** descifra PII.
 *
 * El DNI, el correo y el teléfono se piden aparte por
 * `GET /api/v1/actors/:uid/pii` con un motivo explícito que la base audita; así
 * abrir una ficha no registra un acceso a datos personales que nadie pidió.
 */
export async function getActorById(
  client: PoolClient,
  uid: string,
  roles: readonly string[] = [],
): Promise<ActorDetail | null> {
  // El identificador llega como texto: se acepta el UUID o el código legado.
  const result = await client.query(
    `select ${ACTOR_SELECT}
     ${ACTOR_FROM}
     where a.actor_uid::text = $1 or a.codigo_legado = $1`,
    [uid],
  );

  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const actor = mapActor(row);

  const casos = await client.query(
    `select c.codigo_caso as code,
            c.nombre_caso as title,
            replace(ec.codigo, '_', ' ') as estado,
            ca.nivel_influencia,
            ca.posicion
       from core.casos_actores ca
       join core.casos c on c.id = ca.caso_id
       left join core.cat_estados_caso ec on ec.id = c.estado_id
      where ca.actor_id = $1
      order by c.codigo_caso`,
    [actor.id],
  );

  const organizacion: ActorOrganization | null =
    actor.organizacionAnclaUid && actor.organizacionAncla
      ? { id: actor.organizacionAnclaUid, nombre: actor.organizacionAncla }
      : null;

  // El detalle no descifra datos personales. Abrir una ficha no debe registrar
  // un acceso a PII que nadie pidió: el DNI, el correo y el teléfono salen
  // aparte, por `/v1/actors/:uid/pii` y con un motivo explícito auditado.
  const pii: ActorPii | null = null;
  const piiError: string | null = null;
  const piiEstado: PiiEstado = roles.length ? "no_solicitado" : "no_autorizado";

  return {
    actor,
    casos: casos.rows.map((c) => ({
      code: c.code as string,
      title: c.title as string,
      estado: c.estado as string | null,
      nivelInfluencia: c.nivel_influencia as number | null,
      posicion: c.posicion as string | null,
    })),
    organizacion,
    pii,
    piiError,
    piiEstado,
    generatedAt: new Date().toISOString(),
  };
}
