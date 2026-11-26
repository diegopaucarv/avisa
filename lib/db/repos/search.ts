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
  /** Provincia derivada del distrito del registro; `null` si no hay distrito. */
  provincia: string | null;
  /** Distrito del registro (propio o el principal del caso); `null` si falta. */
  distrito: string | null;
  /** Ubigeo INEI de 6 dígitos del distrito; `null` si no hay distrito. */
  ubigeo: string | null;
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
//
// El territorio (`provincia`, `distrito`, `ubigeo`) sigue la misma regla: el
// distrito propio del registro cuando el modelo lo tiene (alerta y actor) y,
// si no, el distrito principal del caso. La provincia y la región que faltan se
// derivan de la jerarquía `distrito → provincia → región`: es el territorio
// real del registro, no una estimación. La SPA lo muestra en la ficha que se
// abre desde la búsqueda; nunca se inventa un valor faltante.
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

/** Distrito principal del caso, su provincia y la región de esa provincia. */
const DISTRITO_DEL_CASO = `
    left join core.distritos cd on cd.id = c.distrito_principal_id
    left join core.provincias cpv on cpv.id = cd.provincia_id
    left join core.regiones cpr on cpr.id = cpv.region_id`;

const SEARCH_UNION = `
  select 1 as ord, 'case'::text as type, 'cases'::text as view,
         c.id::text as id,
         c.codigo_caso as code,
         c.nombre_caso as title,
         replace(ec.codigo, '_', ' ') as subtitle,
         coalesce(reg.nombre, rp.nombre, cpr.nombre) as region,
         cpv.nombre as provincia,
         cd.nombre as distrito,
         cd.ubigeo::text as ubigeo
    from core.casos c
    left join core.cat_estados_caso ec on ec.id = c.estado_id
${DISTRITO_DEL_CASO}
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
         coalesce(ar.nombre, apr.nombre, reg.nombre, rp.nombre),
         coalesce(ap.nombre, apv.nombre, cpv.nombre),
         coalesce(ad.nombre, cd.nombre),
         coalesce(ad.ubigeo, cd.ubigeo)::text
    from core.alertas_tempranas al
    left join core.cat_niveles_alerta na on na.id = al.nivel_alerta_id
    left join core.casos c on c.id = al.caso_id
    left join core.regiones ar on ar.id = al.region_id
    left join core.provincias ap on ap.id = al.provincia_id
    left join core.distritos ad on ad.id = al.distrito_id
    left join core.provincias apv on apv.id = ad.provincia_id
    left join core.regiones apr on apr.id = apv.region_id
${DISTRITO_DEL_CASO}
${REGION_DEL_CASO}
   where core.normalizar_ref(al.codigo_alerta) like core.normalizar_ref($1)
      or core.normalizar_ref(al.titulo) like core.normalizar_ref($1)
  union all
  select 3, 'document'::text, 'documents'::text,
         d.id::text,
         d.codigo,
         d.titulo,
         coalesce(td.nombre, d.estado),
         coalesce(reg.nombre, rp.nombre, cpr.nombre),
         cpv.nombre,
         cd.nombre,
         cd.ubigeo::text
    from core.documentos d
    left join core.cat_tipos_documento td on td.id = d.tipo_id
    left join core.casos c on c.id = d.caso_id
${DISTRITO_DEL_CASO}
${REGION_DEL_CASO}
   where core.normalizar_ref(d.codigo) like core.normalizar_ref($1)
      or core.normalizar_ref(d.titulo) like core.normalizar_ref($1)
  union all
  select 4, 'actor'::text, 'directory'::text,
         a.actor_uid::text,
         a.codigo_legado,
         a.nombre_actual,
         coalesce(rg.nombre, nullif(a.cargo_actual, '')),
         coalesce(rg.nombre, pr.nombre),
         pd.nombre,
         d.nombre,
         d.ubigeo::text
    from core.actores a
    left join core.regiones rg on rg.id = a.region_id
    left join core.distritos d on d.id = a.distrito_id
    left join core.provincias pd on pd.id = d.provincia_id
    left join core.regiones pr on pr.id = pd.region_id
   where core.normalizar_ref(a.nombre_actual) like core.normalizar_ref($1)
      or core.normalizar_ref(coalesce(a.abreviatura, '')) like core.normalizar_ref($1)
  union all
  select 5, 'commitment'::text, 'commitments'::text,
         cmp.id::text,
         cmp.codigo_compromiso,
         cmp.accion_compromiso,
         replace(ec.codigo, '_', ' '),
         coalesce(reg.nombre, rp.nombre, cpr.nombre),
         cpv.nombre,
         cd.nombre,
         cd.ubigeo::text
    from core.compromisos cmp
    left join core.cat_estados_compromiso ec on ec.id = cmp.estado_id
    left join core.casos c on c.id = cmp.caso_id
${DISTRITO_DEL_CASO}
${REGION_DEL_CASO}
   where core.normalizar_ref(cmp.codigo_compromiso) like core.normalizar_ref($1)
      or core.normalizar_ref(cmp.accion_compromiso) like core.normalizar_ref($1)
  union all
  select 6, 'demanda'::text, 'cases'::text,
         dm.id::text,
         dm.codigo_legado,
         coalesce(dm.descripcion_demanda, ''),
         replace(dm.estado_atencion, '_', ' '),
         coalesce(reg.nombre, rp.nombre, cpr.nombre),
         cpv.nombre,
         cd.nombre,
         cd.ubigeo::text
    from core.demandas dm
    left join core.casos c on c.id = dm.caso_id
${DISTRITO_DEL_CASO}
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
         m.provincia,
         m.distrito,
         m.ubigeo,
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
    provincia: row.provincia as string | null,
    distrito: row.distrito as string | null,
    ubigeo: row.ubigeo as string | null,
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

/** Fila del desglose de casos vigentes por subsector. */
export type SubsectorResumen = {
  /** `core.cat_subsectores.nombre`; «Sin subsector» si el caso no lo declara. */
  subsector: string;
  total: number;
  alto: number;
  /** Casos del nivel intermedio del catálogo (hoy «Medio»; «Moderado» si la 53 no corrió). */
  medio: number;
  bajo: number;
  /** Código real del nivel intermedio que devolvió la base; `null` si no hay catálogo. */
  codigoMedio: string | null;
};

export type SubsectoresResponse = {
  subsectores: SubsectorResumen[];
  totalCasos: number;
  generatedAt: string;
};

/**
 * Totales de casos vigentes agrupados por subsector y nivel de riesgo.
 *
 * La API de casos no admite `subsector` (sólo `prioridad`, `riesgo`, `region`,
 * …), así que este corte se agrega aquí y no se puede reproducir con
 * `GET /api/v1/cases`.
 *
 * El rótulo del nivel intermedio se devuelve como `codigoMedio` —el código real
 * que existe en `core.cat_niveles_riesgo`— para que la UI no fije «Medio» ni
 * «Moderado» a mano: la migración 53 renombra «Moderado» → «Medio» y una base
 * sin migrar sigue en «Moderado».
 */
const SUBSECTORES_SQL = `
  select coalesce(s.nombre, 'Sin subsector') as subsector,
         count(*)::int as total,
         count(*) filter (where nr.codigo = 'Alto')::int as alto,
         count(*) filter (
           where nr.codigo in ('Medio', 'Moderado', 'Intermedio')
         )::int as medio,
         count(*) filter (where nr.codigo = 'Bajo')::int as bajo
    from core.casos c
    left join core.cat_subsectores s on s.id = c.subsector_id
    left join core.cat_niveles_riesgo nr on nr.id = c.nivel_riesgo_id
   where c.anulado_en is null
   group by coalesce(s.nombre, 'Sin subsector')
   order by count(*) desc, 1
`;

/** Código del nivel intermedio presente en el catálogo (`Medio` o `Moderado`). */
async function codigoRiesgoIntermedio(
  client: PoolClient,
): Promise<string | null> {
  const result = await client.query(
    `select codigo
       from core.cat_niveles_riesgo
      where codigo in ('Medio', 'Moderado', 'Intermedio')
      order by case codigo
                 when 'Medio' then 0
                 when 'Moderado' then 1
                 else 2
               end
      limit 1`,
  );
  return (result.rows[0]?.codigo as string | undefined) ?? null;
}

export async function resumenCasosPorSubsector(
  client: PoolClient,
): Promise<SubsectoresResponse> {
  const [filas, codigoMedio] = await Promise.all([
    client.query(SUBSECTORES_SQL),
    codigoRiesgoIntermedio(client),
  ]);

  const subsectores: SubsectorResumen[] = filas.rows.map((row) => ({
    subsector: row.subsector as string,
    total: row.total as number,
    alto: row.alto as number,
    medio: row.medio as number,
    bajo: row.bajo as number,
    codigoMedio,
  }));

  return {
    subsectores,
    totalCasos: subsectores.reduce((suma, fila) => suma + fila.total, 0),
    generatedAt: new Date().toISOString(),
  };
}
