import type { PoolClient } from "pg";

export type SearchResultType =
  "case" | "alert" | "document" | "actor" | "commitment" | "demanda";

export type SearchView =
  "cases" | "alerts" | "documents" | "directory" | "commitments";

export type SearchResult = {
  type: SearchResultType;
  view: SearchView;
  id: string;
  code: string | null;
  title: string;
  subtitle: string | null;
  /** Región del registro; `null` si el modelo no la tiene o no se conoce. */
  region: string | null;
};

export type SearchResponse = {
  query: string;
  results: SearchResult[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
};

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

// Cada fuente se busca por separado para no encadenar joins pesados.
// El subtítulo es un dato corto del propio registro o de un catálogo pequeño.
// `ord` conserva el agrupado por tipo que el cliente veía antes de paginar.
//
// La región es la misma que publica la ficha del caso: las regiones de
// `core.caso_regiones` (la principal primero) y, si no hay, la región
// principal del caso. Alerta, compromiso, documento y demanda no tienen
// región propia: se hereda la del caso al que pertenecen. `null` cuando no
// hay caso asociado o el caso no tiene región conocida.
const REGION_DEL_CASO = `
    left join core.regiones rp on rp.id = c.region_principal_id
    left join lateral (
      select rg.nombre
        from core.caso_regiones cr
        join core.regiones rg on rg.id = cr.region_id
       where cr.caso_id = c.id
       order by cr.es_principal desc, rg.nombre
       limit 1
    ) reg on true`;

const SEARCH_UNION = `
  select 1 as ord, 'case'::text as type, 'cases'::text as view,
         c.id::text as id,
         c.codigo_caso as code,
         c.nombre_caso as title,
         replace(ec.codigo, '_', ' ') as subtitle,
         coalesce(reg.nombre, rp.nombre) as region
    from core.casos c
    left join core.cat_estados_caso ec on ec.id = c.estado_id
${REGION_DEL_CASO}
   where core.normalizar_ref(c.codigo_caso) like core.normalizar_ref($1)
      or core.normalizar_ref(c.nombre_caso) like core.normalizar_ref($1)
      or core.normalizar_ref(coalesce(c.resumen_ejecutivo, '')) like core.normalizar_ref($1)
  union all
  select 2, 'alert'::text, 'alerts'::text,
         al.id::text,
         al.codigo_alerta,
         al.titulo,
         na.nombre,
         coalesce(reg.nombre, rp.nombre)
    from core.alertas_tempranas al
    left join core.cat_niveles_alerta na on na.id = al.nivel_alerta_id
    left join core.casos c on c.id = al.caso_id
${REGION_DEL_CASO}
   where core.normalizar_ref(al.codigo_alerta) like core.normalizar_ref($1)
      or core.normalizar_ref(al.titulo) like core.normalizar_ref($1)
  union all
  select 3, 'document'::text, 'documents'::text,
         d.id::text,
         d.codigo,
         d.titulo,
         coalesce(td.nombre, d.estado),
         coalesce(reg.nombre, rp.nombre)
    from core.documentos d
    left join core.cat_tipos_documento td on td.id = d.tipo_id
    left join core.casos c on c.id = d.caso_id
${REGION_DEL_CASO}
   where core.normalizar_ref(d.codigo) like core.normalizar_ref($1)
      or core.normalizar_ref(d.titulo) like core.normalizar_ref($1)
  union all
  select 4, 'actor'::text, 'directory'::text,
         a.actor_uid::text,
         a.codigo_legado,
         a.nombre_actual,
         coalesce(rg.nombre, nullif(a.cargo_actual, '')),
         rg.nombre
    from core.actores a
    left join core.regiones rg on rg.id = a.region_id
   where core.normalizar_ref(a.nombre_actual) like core.normalizar_ref($1)
      or core.normalizar_ref(coalesce(a.abreviatura, '')) like core.normalizar_ref($1)
  union all
  select 5, 'commitment'::text, 'commitments'::text,
         cmp.id::text,
         cmp.codigo_compromiso,
         cmp.accion_compromiso,
         replace(ec.codigo, '_', ' '),
         coalesce(reg.nombre, rp.nombre)
    from core.compromisos cmp
    left join core.cat_estados_compromiso ec on ec.id = cmp.estado_id
    left join core.casos c on c.id = cmp.caso_id
${REGION_DEL_CASO}
   where core.normalizar_ref(cmp.codigo_compromiso) like core.normalizar_ref($1)
      or core.normalizar_ref(cmp.accion_compromiso) like core.normalizar_ref($1)
  union all
  select 6, 'demanda'::text, 'cases'::text,
         dm.id::text,
         dm.codigo_legado,
         coalesce(dm.descripcion_demanda, ''),
         replace(dm.estado_atencion, '_', ' '),
         coalesce(reg.nombre, rp.nombre)
    from core.demandas dm
    left join core.casos c on c.id = dm.caso_id
${REGION_DEL_CASO}
   where core.normalizar_ref(dm.descripcion_demanda) like core.normalizar_ref($1)
`;

const SEARCH_PAGE_SQL = `
  select m.type,
         m.view,
         m.id,
         m.code,
         m.title,
         m.subtitle,
         m.region,
         count(*) over()::int as total
    from (${SEARCH_UNION}) m
   order by m.ord, m.code nulls last, m.id
   limit $2 offset $3
`;

function mapRows(rows: Record<string, unknown>[]): SearchResult[] {
  return rows.map((row) => ({
    type: row.type as SearchResultType,
    view: row.view as SearchView,
    id: row.id as string,
    code: row.code as string | null,
    title: row.title as string,
    subtitle: row.subtitle as string | null,
    region: row.region as string | null,
  }));
}

export async function searchAll(
  client: PoolClient,
  term: string,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<SearchResponse> {
  const query = term.trim();
  const pagina = Math.max(1, Math.trunc(page));
  const tamano = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(pageSize)));

  if (query.length < 2) {
    return {
      query,
      results: [],
      total: 0,
      page: pagina,
      pageSize: tamano,
      generatedAt: new Date().toISOString(),
    };
  }

  const result = await client.query(SEARCH_PAGE_SQL, [
    `%${query}%`,
    tamano,
    (pagina - 1) * tamano,
  ]);
  const total = (result.rows[0]?.total as number | undefined) ?? 0;

  return {
    query,
    results: mapRows(result.rows),
    total,
    page: pagina,
    pageSize: tamano,
    generatedAt: new Date().toISOString(),
  };
}
