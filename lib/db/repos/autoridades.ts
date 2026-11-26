import type { PoolClient } from "pg";

import { filtroTexto } from "../busqueda";

/**
 * Directorio · «Autoridades y agentes» (solo lectura).
 *
 * POR QUÉ EXISTE
 *   La pantalla `/directorio/autoridades` separa a las autoridades y a los
 *   agentes del sector del listado general de actores. La base no tiene una
 *   columna «autoridad»: el único eje disponible y verificable es
 *   `core.cat_tipos_actor.nombre = 'Actor público'` (personas), que hoy
 *   contiene a los funcionarios y servidores de PRODUCE y de sus organismos
 *   adscritos. No hay alcaldes, gobernadores ni prefectos registrados como
 *   actores: si algún día se cargan, entrarán con su propio tipo de actor.
 *
 *   El reparto «autoridad» / «agente» se deriva del cargo registrado
 *   (`core.actores.cargo_actual`), con la expresión declarada en
 *   `PATRON_AUTORIDAD`. La institución se deriva del dominio del correo de
 *   contacto (`core.actores.email_contacto`), porque `core.organizaciones` no
 *   tiene filas para PRODUCE ni sus organismos y los 108 actores públicos no
 *   tienen organización ancla ni membresía. Ambas derivaciones están
 *   declaradas en `CRITERIO_AUTORIDADES` y la SPA las muestra en pantalla.
 *
 * REGLAS
 *   * Nunca se inventan datos: lo que no está en la base se devuelve `null` y
 *     la UI lo pinta «sin dato».
 *   * El listado no descifra PII: el DNI y el teléfono salen sólo por
 *     `GET /api/v1/autoridades/:id/pii`, con motivo auditado y permiso.
 *   * `core.casos_actores` se une por `actor_id` (no por `actor_uid`).
 */

/** Reparto derivado del cargo. No es un catálogo de la base. */
export type AutoridadTipo = "autoridad" | "agente";

export type InstitucionCatalogo = {
  readonly sigla: string;
  readonly nombre: string;
  readonly dominios: readonly string[];
};

/**
 * Instituciones del sector reconocidas por el dominio del correo de contacto.
 *
 * Sólo aparecen las entidades que hoy tienen actores públicos con correo
 * institucional. Un dominio desconocido queda `null` (la UI pinta «sin dato»)
 * en vez de adivinar la entidad: el dominio es la única evidencia disponible.
 */
export const INSTITUCIONES: readonly InstitucionCatalogo[] = [
  {
    sigla: "PRODUCE",
    nombre: "Ministerio de la Producción",
    dominios: ["produce.gob.pe"],
  },
  {
    sigla: "PROINNOVATE",
    nombre:
      "Programa Nacional de Innovación para la Competitividad y Productividad",
    dominios: ["proinnovate.gob.pe"],
  },
  {
    sigla: "A COMER PESCADO",
    nombre: "Programa Nacional A Comer Pescado",
    dominios: ["acomerpescado.gob.pe"],
  },
  {
    sigla: "FONDEPES",
    nombre: "Fondo Nacional de Desarrollo Pesquero",
    dominios: ["fondepes.gob.pe"],
  },
  {
    sigla: "ITP",
    nombre: "Instituto Tecnológico de la Producción",
    dominios: ["itp.gob.pe"],
  },
  {
    sigla: "INACAL",
    nombre: "Instituto Nacional de Calidad",
    dominios: ["inacal.gob.pe"],
  },
  {
    sigla: "SANIPES",
    nombre: "Organismo Nacional de Sanidad Pesquera",
    dominios: ["sanipes.gob.pe"],
  },
  {
    sigla: "IMARPE",
    nombre: "Instituto del Mar del Perú",
    dominios: ["imarpe.gob.pe"],
  },
];

const INSTITUCION_POR_SIGLA = new Map(
  INSTITUCIONES.map((institucion) => [
    institucion.sigla.toLocaleLowerCase("es-PE"),
    institucion,
  ]),
);

/** Criterio aplicado, tal como se declara en la pantalla. */
export const CRITERIO_AUTORIDADES = {
  universo:
    "Personas registradas como «Actor público»: funcionarios y servidores del sector PRODUCE y de sus organismos adscritos.",
  tipo: "Se considera «autoridad» a quien tiene cargo de dirección, jefatura, presidencia, secretaría técnica o general, procuraduría, titularidad del despacho, coordinación ejecutiva, ejecución coactiva o viceministerio; el resto se muestra como «agente».",
  institucion:
    "La institución se deriva del dominio del correo de contacto (por ejemplo, produce.gob.pe → PRODUCE). No es un campo del modelo.",
  territorio:
    "La región se toma de la jurisdicción declarada en el padrón de actores cuando existe (extensionistas de PRODUCE, migración 63); el distrito y las provincias no se registran en el modelo, así que la columna se muestra como «sin dato» en el resto del universo.",
  casos:
    "Los casos vinculados se leen de core.casos_actores; cuando no hay vínculos se indica «sin casos vinculados».",
} as const;

export type AutoridadCriterio = typeof CRITERIO_AUTORIDADES;

/**
 * Cargos que cuentan como autoridad. La expresión es la misma que se probó
 * contra la base: 102 autoridades y 27 agentes al corte del 2026-11-25
 * (los 21 cargos «Extensionista» del padrón de PRODUCE caen en «agente»).
 * Desde la migración 64 se suman los 9 sectoristas activos de la OAIPCS con
 * `cargo_actual = 'Sectorista'`, que también caen en «agente».
 */
const PATRON_AUTORIDAD =
  "%(director|directora|jefe|jefa|president|secretari|procurador|titular|coordinador|ejecutor|viceministro)%";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `case` que traduce el dominio del correo a la sigla de la institución. Se
 * construye desde `INSTITUCIONES`, así que agregar una entidad es tocar sólo
 * esa lista. No interpola entrada del usuario.
 */
function casoInstitucion(columna: string): string {
  const ramas = INSTITUCIONES.flatMap((institucion) =>
    institucion.dominios.map(
      (dominio) => `      when '${dominio}' then '${institucion.sigla}'`,
    ),
  ).join("\n");

  return `case ${columna}
${ramas}
      else null
    end`;
}

/**
 * Universo de la pantalla, ya clasificado.
 *
 * `base` proyecta columnas crudas y deriva el tipo por cargo; `clasificado`
 * agrega la institución. Ambas CTE se comparten entre el listado y las facetas
 * para que no existan dos definiciones del mismo criterio.
 */
const BASE_CTE = `
  with base as (
    select
      a.actor_uid::text as id,
      a.nombre_actual as nombre,
      nullif(btrim(a.cargo_actual), '') as cargo,
      nullif(btrim(a.email_contacto), '') as email,
      split_part(lower(coalesce(a.email_contacto, '')), '@', 2) as dominio,
      nullif(btrim(a.nivel_gobierno), '') as nivel_gobierno,
      nullif(btrim(a.perfil_descripcion), '') as perfil,
      nullif(btrim(a.abreviatura), '') as abreviatura,
      a.nivel_clasificacion as clasificacion,
      a.activo,
      a.es_validado_humano as validado,
      rg.nombre as region,
      d.nombre as distrito,
      case
        when lower(coalesce(a.cargo_actual, '')) similar to '${PATRON_AUTORIDAD}'
          then 'autoridad'
        else 'agente'
      end as tipo
    from core.actores a
    join core.cat_tipos_actor ta on ta.id = a.tipo_actor_id
    left join core.regiones rg on rg.id = a.region_id
    left join core.distritos d on d.id = a.distrito_id
    where ta.nombre = 'Actor público'
      and a.naturaleza = 'persona'
  ),
  clasificado as (
    select b.*, ${casoInstitucion("b.dominio")} as institucion
    from base b
  )
`;

const PROYECCION = `
  c.id,
  c.nombre,
  c.cargo,
  c.email,
  c.tipo,
  c.institucion,
  c.region,
  c.distrito,
  c.nivel_gobierno,
  c.perfil,
  c.abreviatura,
  c.clasificacion,
  c.validado,
  c.activo
`;

export type AutoridadListQuery = {
  q?: string;
  tipo?: string;
  institucion?: string;
  region?: string;
  page?: number;
  pageSize?: number;
};

export type AutoridadListItem = {
  id: string;
  nombre: string;
  cargo: string | null;
  /** Correo de contacto institucional (`email_contacto`); no es la PII cifrada. */
  email: string | null;
  tipo: AutoridadTipo;
  /** Sigla derivada del dominio del correo; `null` = sin dato. */
  institucion: string | null;
  /** Nombre largo de la institución, para la ficha. */
  institucionNombre: string | null;
  region: string | null;
  distrito: string | null;
  nivelGobierno: string | null;
  perfil: string | null;
  abreviatura: string | null;
  clasificacion: number;
  validado: boolean;
  activo: boolean;
};

export type AutoridadFaceta = {
  valor: string;
  etiqueta: string;
  conteo: number;
};

export type AutoridadFacets = {
  tipos: AutoridadFaceta[];
  instituciones: AutoridadFaceta[];
  regiones: AutoridadFaceta[];
};

export type AutoridadListResult = {
  items: AutoridadListItem[];
  total: number;
  page: number;
  pageSize: number;
  facets: AutoridadFacets;
  criterio: AutoridadCriterio;
  generatedAt: string;
};

export type AutoridadCaso = {
  codigo: string;
  nombre: string;
  estado: string | null;
  nivelInfluencia: number | null;
  posicion: string | null;
};

export type AutoridadDetalle = {
  autoridad: AutoridadListItem;
  casos: AutoridadCaso[];
  criterio: AutoridadCriterio;
  generatedAt: string;
};

const ETIQUETA_TIPO: Record<AutoridadTipo, string> = {
  autoridad: "Autoridad",
  agente: "Agente",
};

function normalizarTipo(valor: string | undefined): AutoridadTipo | null {
  const limpio = (valor ?? "").trim().toLowerCase();
  if (limpio === "autoridad" || limpio === "agente") return limpio;
  return null;
}

function nombreInstitucion(sigla: string | null): string | null {
  if (!sigla) return null;
  return (
    INSTITUCION_POR_SIGLA.get(sigla.toLocaleLowerCase("es-PE"))?.nombre ?? null
  );
}

function mapAutoridad(row: Record<string, unknown>): AutoridadListItem {
  const tipo: AutoridadTipo =
    row["tipo"] === "autoridad" ? "autoridad" : "agente";
  const institucion = (row["institucion"] as string | null) ?? null;
  const clasificacion = row["clasificacion"];

  return {
    id: row["id"] as string,
    nombre: row["nombre"] as string,
    cargo: (row["cargo"] as string | null) ?? null,
    email: (row["email"] as string | null) ?? null,
    tipo,
    institucion,
    institucionNombre: nombreInstitucion(institucion),
    region: (row["region"] as string | null) ?? null,
    distrito: (row["distrito"] as string | null) ?? null,
    nivelGobierno: (row["nivel_gobierno"] as string | null) ?? null,
    perfil: (row["perfil"] as string | null) ?? null,
    abreviatura: (row["abreviatura"] as string | null) ?? null,
    clasificacion:
      typeof clasificacion === "number" && Number.isFinite(clasificacion)
        ? clasificacion
        : 1,
    validado: row["validado"] === true,
    activo: row["activo"] !== false,
  };
}

/**
 * Facetas para los selectores. Se calculan sobre el universo completo (sin los
 * filtros de la consulta) para que el usuario pueda cambiar de institución o
 * de región sin perder las opciones disponibles.
 */
async function listFacets(client: PoolClient): Promise<AutoridadFacets> {
  const result = await client.query<{
    tipo: string;
    institucion: string | null;
    region: string | null;
    n: number;
  }>(`${BASE_CTE}
    select c.tipo, c.institucion, c.region, count(*)::int as n
      from clasificado c
     group by 1, 2, 3`);

  const tipos = new Map<AutoridadTipo, number>();
  const instituciones = new Map<string, number>();
  const regiones = new Map<string, number>();
  let sinInstitucion = 0;
  let sinRegion = 0;

  for (const row of result.rows) {
    const tipo: AutoridadTipo =
      row.tipo === "autoridad" ? "autoridad" : "agente";
    tipos.set(tipo, (tipos.get(tipo) ?? 0) + row.n);

    if (row.institucion) {
      instituciones.set(
        row.institucion,
        (instituciones.get(row.institucion) ?? 0) + row.n,
      );
    } else {
      sinInstitucion += row.n;
    }

    if (row.region) {
      regiones.set(row.region, (regiones.get(row.region) ?? 0) + row.n);
    } else {
      sinRegion += row.n;
    }
  }

  const ordenTipos: AutoridadTipo[] = ["autoridad", "agente"];
  const facetasInstitucion: AutoridadFaceta[] = [...instituciones.entries()]
    .map(([valor, conteo]) => ({ valor, etiqueta: valor, conteo }))
    .sort(
      (a, b) =>
        b.conteo - a.conteo || a.etiqueta.localeCompare(b.etiqueta, "es"),
    );
  if (sinInstitucion > 0) {
    facetasInstitucion.push({
      valor: "sin_dato",
      etiqueta: "Sin dato",
      conteo: sinInstitucion,
    });
  }

  const facetasRegion: AutoridadFaceta[] = [...regiones.entries()]
    .map(([valor, conteo]) => ({ valor, etiqueta: valor, conteo }))
    .sort(
      (a, b) =>
        b.conteo - a.conteo || a.etiqueta.localeCompare(b.etiqueta, "es"),
    );
  if (sinRegion > 0) {
    facetasRegion.push({
      valor: "sin_dato",
      etiqueta: "Sin dato",
      conteo: sinRegion,
    });
  }

  return {
    tipos: ordenTipos
      .filter((tipo) => (tipos.get(tipo) ?? 0) > 0)
      .map((tipo) => ({
        valor: tipo,
        etiqueta: ETIQUETA_TIPO[tipo],
        conteo: tipos.get(tipo) ?? 0,
      })),
    instituciones: facetasInstitucion,
    regiones: facetasRegion,
  };
}

/**
 * Listado paginado con búsqueda por nombre, cargo o correo, y filtros por tipo,
 * institución y región. `institucion=sin_dato` y `region=sin_dato` filtran las
 * filas sin ese dato, para que la opción del selector tenga efecto.
 */
export async function listAutoridades(
  client: PoolClient,
  query: AutoridadListQuery,
): Promise<AutoridadListResult> {
  const params: unknown[] = [];
  const where: string[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const porTexto = filtroTexto(
    ["c.nombre", "coalesce(c.cargo, '')", "coalesce(c.email, '')"],
    query.q,
    bind,
  );
  if (porTexto) where.push(porTexto);

  const tipo = normalizarTipo(query.tipo);
  if (tipo) where.push(`c.tipo = ${bind(tipo)}`);

  const institucion = query.institucion?.trim();
  if (institucion) {
    if (institucion.toLowerCase() === "sin_dato") {
      where.push("c.institucion is null");
    } else {
      where.push(`c.institucion = ${bind(institucion)}`);
    }
  }

  const region = query.region?.trim();
  if (region) {
    if (region.toLowerCase() === "sin_dato") {
      where.push("c.region is null");
    } else {
      where.push(`c.region = ${bind(region)}`);
    }
  }

  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 25)));

  const sql = `${BASE_CTE}
    select ${PROYECCION},
           count(*) over()::int as total
      from clasificado c
      ${where.length ? `where ${where.join(" and ")}` : ""}
     order by case c.tipo when 'autoridad' then 0 else 1 end,
              c.nombre asc,
              c.id asc
     limit ${bind(pageSize)} offset ${bind((page - 1) * pageSize)}`;

  const result = await client.query(sql, params);
  const total = (result.rows[0]?.["total"] as number | undefined) ?? 0;
  const facets = await listFacets(client);

  return {
    items: result.rows.map((row) => mapAutoridad(row)),
    total,
    page,
    pageSize,
    facets,
    criterio: CRITERIO_AUTORIDADES,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Ficha de una autoridad/agente con sus casos vinculados.
 *
 * El identificador público es siempre el UUID (`actor_uid`); el código legado
 * no forma parte de este contrato. Se valida antes de tocar `::uuid` para no
 * provocar 22P02 con texto arbitrario.
 */
export async function getAutoridad(
  client: PoolClient,
  ref: string,
): Promise<AutoridadDetalle | null> {
  const limpio = ref.trim();
  if (!UUID_RE.test(limpio)) return null;

  const result = await client.query(
    `${BASE_CTE}
      select ${PROYECCION}
        from clasificado c
       where c.id = $1`,
    [limpio],
  );

  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  // `core.casos_actores` usa `actor_id`; el resto de columnas del caso se leen
  // igual que en la ficha general del actor.
  const casos = await client.query<{
    codigo: string;
    nombre: string;
    estado: string | null;
    nivel_influencia: number | null;
    posicion: string | null;
  }>(
    `select c.codigo_caso as codigo,
            c.nombre_caso as nombre,
            replace(ec.codigo, '_', ' ') as estado,
            ca.nivel_influencia,
            ca.posicion
       from core.casos_actores ca
       join core.casos c on c.id = ca.caso_id
       left join core.cat_estados_caso ec on ec.id = c.estado_id
      where ca.actor_id = $1::uuid
      order by c.codigo_caso`,
    [limpio],
  );

  return {
    autoridad: mapAutoridad(row),
    casos: casos.rows.map((caso) => ({
      codigo: caso.codigo,
      nombre: caso.nombre,
      estado: caso.estado,
      nivelInfluencia: caso.nivel_influencia,
      posicion: caso.posicion,
    })),
    criterio: CRITERIO_AUTORIDADES,
    generatedAt: new Date().toISOString(),
  };
}
