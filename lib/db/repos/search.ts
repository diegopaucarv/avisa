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
const SEARCH_UNION = `
  select 1 as ord, 'case'::text as type, 'cases'::text as view,
         c.id::text as id,
         c.codigo_caso as code,
         c.nombre_caso as title,
         replace(ec.codigo, '_', ' ') as subtitle
    from core.casos c
    left join core.cat_estados_caso ec on ec.id = c.estado_id
   where c.codigo_caso ilike $1
      or c.nombre_caso ilike $1
      or coalesce(c.resumen_ejecutivo, '') ilike $1
  union all
  select 2, 'alert'::text, 'alerts'::text,
         al.id::text,
         al.codigo_alerta,
         al.titulo,
         na.nombre
    from core.alertas_tempranas al
    left join core.cat_niveles_alerta na on na.id = al.nivel_alerta_id
   where al.codigo_alerta ilike $1
      or al.titulo ilike $1
  union all
  select 3, 'document'::text, 'documents'::text,
         d.id::text,
         d.codigo,
         d.titulo,
         coalesce(td.nombre, d.estado)
    from core.documentos d
    left join core.cat_tipos_documento td on td.id = d.tipo_id
   where d.codigo ilike $1
      or d.titulo ilike $1
  union all
  select 4, 'actor'::text, 'directory'::text,
         a.actor_uid::text,
         a.codigo_legado,
         a.nombre_actual,
         coalesce(rg.nombre, nullif(a.cargo_actual, ''))
    from core.actores a
    left join core.regiones rg on rg.id = a.region_id
   where a.nombre_actual ilike $1
      or coalesce(a.abreviatura, '') ilike $1
  union all
  select 5, 'commitment'::text, 'commitments'::text,
         cmp.id::text,
         cmp.codigo_compromiso,
         cmp.accion_compromiso,
         replace(ec.codigo, '_', ' ')
    from core.compromisos cmp
    left join core.cat_estados_compromiso ec on ec.id = cmp.estado_id
   where cmp.codigo_compromiso ilike $1
      or cmp.accion_compromiso ilike $1
  union all
  select 6, 'demanda'::text, 'cases'::text,
         dm.id::text,
         dm.codigo_legado,
         coalesce(dm.descripcion_demanda, ''),
         replace(dm.estado_atencion, '_', ' ')
    from core.demandas dm
   where dm.descripcion_demanda ilike $1
`;

const SEARCH_PAGE_SQL = `
  select m.type,
         m.view,
         m.id,
         m.code,
         m.title,
         m.subtitle,
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
