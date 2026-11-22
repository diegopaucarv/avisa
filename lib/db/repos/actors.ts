import type { PoolClient } from "pg";
import { DEFAULT_PII_MOTIVO, getActorPii, type ActorPii } from "./pii";

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
  a.perfil_descripcion
`;

const ACTOR_FROM = `
  from core.actores a
  left join core.cat_tipos_actor ta on ta.id = a.tipo_actor_id
  left join core.cat_roles_actor ra on ra.id = a.rol_actor_id
  left join core.cat_perfiles_actor pf on pf.id = a.perfil_id
  left join core.regiones rg on rg.id = a.region_id
  left join core.distritos d on d.id = a.distrito_id
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
  };
}

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
      `(a.nombre_actual ilike ${like} or coalesce(a.abreviatura, '') ilike ${like} or coalesce(a.cargo_actual, '') ilike ${like})`,
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
    items: result.rows.map(mapActor),
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
  };
}

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

export type ActorDetail = {
  actor: ActorListItem;
  casos: ActorCase[];
  organizacion: ActorOrganization | null;
  pii: ActorPii | null;
  /** Motivo corto y sin datos sensibles cuando el descifrado falla. */
  piiError: string | null;
  generatedAt: string;
};

/** Traduce el fallo de descifrado sin exponer SQL, PII ni credenciales. */
function piiFailureMessage(error: unknown): string {
  switch ((error as { code?: string } | undefined)?.code) {
    case "42501":
      return "No se pudo descifrar: falta la clave de cifrado o el nivel de acceso.";
    case "22023":
      return "No se pudo descifrar: motivo no indicado.";
    case "P0002":
      return "El actor no tiene datos personales accesibles.";
    case "42883":
    case "42P01":
      return "La capa de datos personales no está inicializada.";
    default:
      return "No se pudieron descifrar los datos personales.";
  }
}

export async function getActorById(
  client: PoolClient,
  uid: string,
): Promise<ActorDetail | null> {
  // El identificador llega como texto: se acepta el UUID o el código legado.
  const result = await client.query(
    `select ${ACTOR_SELECT}
     ${ACTOR_FROM}
     where a.actor_uid::text = $1 or a.codigo_legado = $1`,
    [uid],
  );

  const row = result.rows[0];
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

  // Los datos personales exigen clave y nivel de acceso que el detalle no puede
  // asumir: si el descifrado falla, el detalle sigue siendo útil. El savepoint
  // evita que el error deje la transacción abortada y se pierdan casos/org.
  let pii: ActorPii | null = null;
  let piiError: string | null = null;
  await client.query("savepoint actor_pii");
  try {
    pii = await getActorPii(client, actor.id, DEFAULT_PII_MOTIVO);
    await client.query("release savepoint actor_pii");
  } catch (error) {
    try {
      await client.query("rollback to savepoint actor_pii");
    } catch {
      // Conexión inutilizable: el commit posterior la descarta y jsonError traduce.
    }
    piiError = piiFailureMessage(error);
  }

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
    generatedAt: new Date().toISOString(),
  };
}
