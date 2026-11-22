import type { PoolClient } from "pg";

export type SearchResultType =
  | "case"
  | "alert"
  | "document"
  | "actor"
  | "commitment"
  | "demanda";

export type SearchView =
  | "cases"
  | "alerts"
  | "documents"
  | "directory"
  | "commitments";

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
  generatedAt: string;
};

const DEFAULT_LIMIT = 5;

// Cada fuente se busca por separado para no encadenar joins pesados.
// El subtítulo es un dato corto del propio registro o de un catálogo pequeño.
const CASES_SQL = `
  select c.id::text as id,
         c.codigo_caso as code,
         c.nombre_caso as title,
         replace(ec.codigo, '_', ' ') as subtitle
    from core.casos c
    left join core.cat_estados_caso ec on ec.id = c.estado_id
   where c.codigo_caso ilike $1
      or c.nombre_caso ilike $1
      or coalesce(c.resumen_ejecutivo, '') ilike $1
   order by c.codigo_caso
   limit $2
`;

const ALERTS_SQL = `
  select al.id::text as id,
         al.codigo_alerta as code,
         al.titulo as title,
         na.nombre as subtitle
    from core.alertas_tempranas al
    left join core.cat_niveles_alerta na on na.id = al.nivel_alerta_id
   where al.codigo_alerta ilike $1
      or al.titulo ilike $1
   order by al.codigo_alerta
   limit $2
`;

const DOCUMENTS_SQL = `
  select d.id::text as id,
         d.codigo as code,
         d.titulo as title,
         coalesce(td.nombre, d.estado) as subtitle
    from core.documentos d
    left join core.cat_tipos_documento td on td.id = d.tipo_id
   where d.codigo ilike $1
      or d.titulo ilike $1
   order by d.codigo
   limit $2
`;

const ACTORS_SQL = `
  select a.actor_uid::text as id,
         a.codigo_legado as code,
         a.nombre_actual as title,
         coalesce(rg.nombre, nullif(a.cargo_actual, '')) as subtitle
    from core.actores a
    left join core.regiones rg on rg.id = a.region_id
   where a.nombre_actual ilike $1
      or coalesce(a.abreviatura, '') ilike $1
   order by a.nombre_actual
   limit $2
`;

const COMMITMENTS_SQL = `
  select cmp.id::text as id,
         cmp.codigo_compromiso as code,
         cmp.accion_compromiso as title,
         replace(ec.codigo, '_', ' ') as subtitle
    from core.compromisos cmp
    left join core.cat_estados_compromiso ec on ec.id = cmp.estado_id
   where cmp.codigo_compromiso ilike $1
      or cmp.accion_compromiso ilike $1
   order by cmp.codigo_compromiso
   limit $2
`;

const DEMANDAS_SQL = `
  select dm.id::text as id,
         dm.codigo_legado as code,
         coalesce(dm.descripcion_demanda, '') as title,
         replace(dm.estado_atencion, '_', ' ') as subtitle
    from core.demandas dm
   where dm.descripcion_demanda ilike $1
   order by dm.descripcion_demanda
   limit $2
`;

function mapRows(
  rows: Record<string, unknown>[],
  type: SearchResultType,
  view: SearchView,
): SearchResult[] {
  return rows.map((row) => ({
    type,
    view,
    id: row.id as string,
    code: row.code as string | null,
    title: row.title as string,
    subtitle: row.subtitle as string | null,
  }));
}

export async function searchAll(
  client: PoolClient,
  term: string,
  limitPerType = DEFAULT_LIMIT,
): Promise<SearchResponse> {
  const query = term.trim();
  const limit = Math.min(10, Math.max(1, Math.trunc(limitPerType)));

  if (query.length < 2) {
    return { query, results: [], generatedAt: new Date().toISOString() };
  }

  const params = [`%${query}%`, limit];

  const [cases, alerts, documents, actors, commitments, demandas] =
    await Promise.all([
      client.query(CASES_SQL, params),
      client.query(ALERTS_SQL, params),
      client.query(DOCUMENTS_SQL, params),
      client.query(ACTORS_SQL, params),
      client.query(COMMITMENTS_SQL, params),
      client.query(DEMANDAS_SQL, params),
    ]);

  return {
    query,
    results: [
      ...mapRows(cases.rows, "case", "cases"),
      ...mapRows(alerts.rows, "alert", "alerts"),
      ...mapRows(documents.rows, "document", "documents"),
      ...mapRows(actors.rows, "actor", "directory"),
      ...mapRows(commitments.rows, "commitment", "commitments"),
      ...mapRows(demandas.rows, "demanda", "cases"),
    ],
    generatedAt: new Date().toISOString(),
  };
}
