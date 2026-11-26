import type { PoolClient } from "pg";

import { filtroTexto } from "../busqueda";

/**
 * Organizaciones sociales del directorio (`core.organizaciones`).
 *
 * La tabla guarda los datos propios de la organización y toma la identidad del
 * actor colectivo (`actor_uid`): de ahí salen el nombre, el código y el estado
 * activo. El tipo se resuelve contra `core.cat_tipos_organizacion`.
 *
 * `core.organizaciones` tiene RLS forzada con la clasificación del actor, así
 * que la consulta sólo funciona dentro de `withSession`.
 */
const ORGANIZACION_SELECT = `
  o.actor_uid::text as id,
  a.codigo_legado as codigo,
  a.nombre_actual as nombre,
  o.abreviatura,
  t.nombre as tipo,
  o.tipo_organizacion_id as tipo_id,
  nullif(trim(o.ruc), '') as ruc,
  o.razon_social,
  o.numero_integrantes,
  to_char(o.vigencia_desde, 'YYYY-MM-DD') as vigencia_desde,
  to_char(o.vigencia_hasta, 'YYYY-MM-DD') as vigencia_hasta,
  o.estado_ospa,
  o.expediente_ospa,
  o.n_embarcaciones,
  o.n_armadores,
  o.perfil,
  o.direccion,
  to_char(o.fecha_constitucion, 'YYYY-MM-DD') as fecha_constitucion,
  o.inscripcion_sunarp,
  o.fuente_sync,
  o.ultima_sync,
  o.foto_url,
  o.facebook_url,
  rep.nombre_actual as representante,
  a.activo
`;

const ORGANIZACION_FROM = `
  from core.organizaciones o
  join core.actores a on a.actor_uid = o.actor_uid
  left join core.cat_tipos_organizacion t on t.id = o.tipo_organizacion_id
  left join core.actores rep on rep.actor_uid = o.representante_uid
`;

export type OrganizacionListQuery = {
  q?: string;
  tipo?: string;
  /** `true`/`false` en texto; se ignora cualquier otro valor. */
  activo?: string;
  /** `true`/`false` en texto; vigencia calculada con la fecha de hoy. */
  vigente?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
};

export type OrganizacionListItem = {
  id: string;
  codigo: string | null;
  nombre: string;
  abreviatura: string | null;
  tipo: string | null;
  tipoId: number | null;
  ruc: string | null;
  razonSocial: string | null;
  numeroIntegrantes: number | null;
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
  estadoOspa: string | null;
  expedienteOspa: string | null;
  nEmbarcaciones: number | null;
  nArmadores: number | null;
  perfil: string | null;
  direccion: string | null;
  fechaConstitucion: string | null;
  inscripcionSunarp: string | null;
  fuenteSync: string | null;
  ultimaSync: string | null;
  fotoUrl: string | null;
  facebookUrl: string | null;
  /** Nombre del actor que ejerce la representación legal, si es visible. */
  representante: string | null;
  activo: boolean;
};

export type OrganizacionListResult = {
  items: OrganizacionListItem[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
};

const SORTS: Record<string, string> = {
  nombre: "a.nombre_actual asc, o.actor_uid asc",
  reciente:
    "o.ultima_sync desc nulls last, a.nombre_actual asc, o.actor_uid asc",
};

function marcaDeTiempo(valor: unknown): string | null {
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === "string" && valor.trim()) return valor;
  return null;
}

function mapOrganizacion(row: Record<string, unknown>): OrganizacionListItem {
  return {
    id: row.id as string,
    codigo: row.codigo as string | null,
    nombre: row.nombre as string,
    abreviatura: row.abreviatura as string | null,
    tipo: row.tipo as string | null,
    tipoId: row.tipo_id as number | null,
    ruc: row.ruc as string | null,
    razonSocial: row.razon_social as string | null,
    numeroIntegrantes: row.numero_integrantes as number | null,
    vigenciaDesde: row.vigencia_desde as string | null,
    vigenciaHasta: row.vigencia_hasta as string | null,
    estadoOspa: row.estado_ospa as string | null,
    expedienteOspa: row.expediente_ospa as string | null,
    nEmbarcaciones: row.n_embarcaciones as number | null,
    nArmadores: row.n_armadores as number | null,
    perfil: row.perfil as string | null,
    direccion: row.direccion as string | null,
    fechaConstitucion: row.fecha_constitucion as string | null,
    inscripcionSunarp: row.inscripcion_sunarp as string | null,
    fuenteSync: row.fuente_sync as string | null,
    ultimaSync: marcaDeTiempo(row.ultima_sync),
    fotoUrl: row.foto_url as string | null,
    facebookUrl: row.facebook_url as string | null,
    representante: row.representante as string | null,
    activo: row.activo as boolean,
  };
}

/** Acepta las grafías que usan los filtros de la API; cualquier otra se ignora. */
function leerBooleano(valor: string | undefined): boolean | undefined {
  if (!valor) return undefined;
  const limpio = valor.trim().toLowerCase();
  if (["true", "1", "si", "sí"].includes(limpio)) return true;
  if (["false", "0", "no"].includes(limpio)) return false;
  return undefined;
}

export async function listOrganizaciones(
  client: PoolClient,
  query: OrganizacionListQuery,
): Promise<OrganizacionListResult> {
  const params: unknown[] = [];
  const where: string[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const porTexto = filtroTexto(
    [
      "a.nombre_actual",
      "coalesce(a.codigo_legado, '')",
      "coalesce(o.razon_social, '')",
      "coalesce(o.abreviatura, '')",
    ],
    query.q,
    bind,
  );
  if (porTexto) where.push(porTexto);

  const tipo = query.tipo?.trim();
  if (tipo) {
    // El catálogo usa etiquetas con tilde (`ASOCIACIÓN`) y el legado
    // `TIPO_ORG_001`; `core.normalizar_ref` iguala ambas formas.
    const referencia = bind(tipo);
    where.push(
      `(core.normalizar_ref(t.nombre) = core.normalizar_ref(${referencia}) or core.normalizar_ref(coalesce(t.codigo_legado, '')) = core.normalizar_ref(${referencia}))`,
    );
  }

  const activo = leerBooleano(query.activo);
  if (activo !== undefined) where.push(`a.activo = ${bind(activo)}`);

  const hoy = `(o.vigencia_desde is null or o.vigencia_desde <= current_date)
              and (o.vigencia_hasta is null or o.vigencia_hasta >= current_date)`;
  const vigente = leerBooleano(query.vigente);
  if (vigente === true) where.push(`(${hoy})`);
  if (vigente === false) where.push(`not (${hoy})`);

  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 25)));
  const order = SORTS[query.sort ?? "nombre"] ?? SORTS.nombre;

  const sql = `
    select ${ORGANIZACION_SELECT},
           count(*) over()::int as total
    ${ORGANIZACION_FROM}
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by ${order}
    limit ${bind(pageSize)} offset ${bind((page - 1) * pageSize)}
  `;

  const result = await client.query(sql, params);
  const total = (result.rows[0]?.total as number | undefined) ?? 0;

  return {
    items: result.rows.map(mapOrganizacion),
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
  };
}
