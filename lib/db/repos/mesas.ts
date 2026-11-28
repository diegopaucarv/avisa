import type { PoolClient } from "pg";
import { filtroTexto } from "../busqueda";

/**
 * Mesas de diálogo (`core.mesas_dialogo`) y su caso espejo.
 *
 * Una mesa se relaciona con la base de casos por `mesas_dialogo.caso_id`, que
 * añade la migración 81. Mientras esa migración no se haya aplicado, las
 * consultas que tocan `caso_id` fallarían con 42703 (columna inexistente); la
 * detección se hace una vez por proceso con `information_schema` y la lectura se
 * degrada a ceros y `casoCodigo = null` en lugar de romper la pantalla.
 */

/** Alias de fila tal como la entrega `pg` (columnas ya en camelCase). */
type MesaFila = {
  id: string;
  codigo: string;
  titulo: string;
  tipoInstrumento: string | null;
  naturaleza: string | null;
  estadoVigencia: string | null;
  ambito: string | null;
  ambitoDetalle?: string | null;
  esNacional?: boolean | null;
  fechaInstalacion: string | null;
  fechaFinVigencia: string | null;
  miembros: number;
  compromisos: number;
  compromisosCumplidos: number;
  casoCodigo: string | null;
  total?: number;
};

type MesaDetalleFila = MesaFila & {
  objetivo: string | null;
  baseLegal: string | null;
  fechaNorma: string | null;
  rolProduce: string | null;
  linkEvidencia: string | null;
  docDesignacion: string | null;
  origenDato: string | null;
  casoId: string | null;
  casoTitulo: string | null;
  casoEstado: string | null;
};

type IntegranteFila = {
  id: string;
  rol: string;
  nombre: string | null;
  docDesignacion: string | null;
  desde: string | null;
  hasta: string | null;
};

type CompromisoFila = {
  id: string;
  codigo: string;
  titulo: string;
  estado: string | null;
  area: string | null;
  fechaLimite: string | null;
  mesaCodigo: string | null;
  mesaTitulo: string | null;
  hitosTotal: number;
  hitosCumplidos: number;
  proximoHito: MesaHito | null;
  hitos?: MesaHito[] | null;
  total?: number;
};

type ResumenFila = {
  mesas: number;
  vigentes: number;
  porVencer: number;
  vencidas: number;
  miembros: number;
  compromisos: number;
};

export type MesaListQuery = {
  q?: string;
  vigencia?: string;
  naturaleza?: string;
  page?: number;
  pageSize?: number;
};

export type MesaResumen = {
  mesas: number;
  vigentes: number;
  porVencer: number;
  vencidas: number;
  miembros: number;
  compromisos: number;
};

export type MesaListItem = {
  id: string;
  codigo: string;
  titulo: string;
  tipoInstrumento: string | null;
  naturaleza: string | null;
  estadoVigencia: string | null;
  /** Ámbito para mostrar: «Nacional» si `esNacional`, si no el texto crudo. */
  ambito: string | null;
  /** Texto crudo de `ambito_departamento`, aunque se muestre «Nacional». */
  ambitoDetalle: string | null;
  /** Mesa de alcance nacional (más de tres regiones o ámbito declarado). */
  esNacional: boolean;
  fechaInstalacion: string | null;
  fechaFinVigencia: string | null;
  miembros: number;
  compromisos: number;
  compromisosCumplidos: number;
  casoCodigo: string | null;
};

export type MesaListResult = {
  items: MesaListItem[];
  total: number;
  page: number;
  pageSize: number;
  resumen: MesaResumen;
};

export type MesaFicha = MesaListItem & {
  objetivo: string | null;
  baseLegal: string | null;
  fechaNorma: string | null;
  rolProduce: string | null;
  linkEvidencia: string | null;
  docDesignacion: string | null;
  origenDato: string | null;
};

export type MesaIntegrante = {
  id: string;
  rol: string;
  nombre: string | null;
  docDesignacion: string | null;
  desde: string | null;
  hasta: string | null;
};

export type MesaHito = {
  codigo: string | null;
  descripcion: string | null;
  estado: string | null;
  fecha: string | null;
};

export type MesaCompromiso = {
  id: string;
  codigo: string;
  titulo: string;
  estado: string | null;
  area: string | null;
  fechaLimite: string | null;
  mesaCodigo: string | null;
  mesaTitulo: string | null;
  hitosTotal: number;
  hitosCumplidos: number;
  proximoHito: MesaHito | null;
  /** Sólo en el detalle de la mesa; el listado lo omite para no inflar el sobre. */
  hitos?: MesaHito[];
};

export type MesaCaso = {
  codigo: string;
  estado: string | null;
  titulo: string | null;
};

export type MesaDetalle = {
  mesa: MesaFicha;
  caso: MesaCaso | null;
  integrantes: MesaIntegrante[];
  compromisos: MesaCompromiso[];
};

/**
 * `mesas_dialogo.caso_id` existe desde la migración 81.
 *
 * Sólo se recuerda el resultado positivo: una vez creada la columna no vuelve a
 * desaparecer, así que memorizar `true` evita consultar `information_schema` en
 * cada petición. El negativo no se guarda, de modo que un proceso que arrancó
 * antes de aplicar la migración se entera en la petición siguiente sin reiniciar.
 */
let vinculoCache: boolean | null = null;

export async function hayVinculoMesas(client: PoolClient): Promise<boolean> {
  if (vinculoCache === true) return true;
  const result = await client.query<{ existe: boolean }>(
    `select exists (
       select 1 from information_schema.columns
        where table_schema = 'core' and table_name = 'mesas_dialogo'
          and column_name = 'caso_id'
     ) as existe`,
  );
  const existe = result.rows[0]?.existe === true;
  if (existe) vinculoCache = true;
  return existe;
}

/**
 * `mesas_dialogo.es_nacional` llega con la migración 89. Mismo criterio que
 * `hayVinculoMesas`: sólo se memoriza el positivo y, contra una base sin la
 * columna, la lectura se degrada a `false` en vez de romper la pantalla.
 */
let nacionalCache: boolean | null = null;

export async function hayEsNacional(client: PoolClient): Promise<boolean> {
  if (nacionalCache === true) return true;
  const result = await client.query<{ existe: boolean }>(
    `select exists (
       select 1 from information_schema.columns
        where table_schema = 'core' and table_name = 'mesas_dialogo'
          and column_name = 'es_nacional'
     ) as existe`,
  );
  const existe = result.rows[0]?.existe === true;
  if (existe) nacionalCache = true;
  return existe;
}

/** `replace(codigo,'_',' ')`: la UI muestra el estado legible del catálogo. */
const HITOS_TOTAL = `(select count(*)::int
           from core.hitos_compromiso h
          where h.compromiso_id = cmp.id and h.anulado_en is null)`;

const HITOS_CUMPLIDOS = `(select count(*)::int
           from core.hitos_compromiso h
           join core.cat_estados_hito eh on eh.id = h.estado_id
          where h.compromiso_id = cmp.id and h.anulado_en is null
            and eh.codigo = 'Cumplido')`;

/** Primer hito con fecha y no terminal; mismo criterio que `commitments.ts`. */
const PROXIMO_HITO = `(
  select json_build_object(
           'codigo', h.codigo_hito,
           'descripcion', h.descripcion_hito,
           'estado', replace(eh.codigo, '_', ' '),
           'fecha', to_char(h.fecha_vencimiento, 'YYYY-MM-DD')
         )
    from core.hitos_compromiso h
    left join core.cat_estados_hito eh on eh.id = h.estado_id
   where h.compromiso_id = cmp.id and h.anulado_en is null
     and h.fecha_vencimiento is not null
     and coalesce(eh.es_terminal, false) = false
   order by h.fecha_vencimiento, h.codigo_hito
   limit 1
)`;

const HITOS_JSON = `coalesce((
  select json_agg(json_build_object(
           'codigo', h.codigo_hito,
           'descripcion', h.descripcion_hito,
           'estado', replace(eh.codigo, '_', ' '),
           'fecha', to_char(h.fecha_vencimiento, 'YYYY-MM-DD')
         ) order by h.fecha_vencimiento nulls last, h.codigo_hito)
    from core.hitos_compromiso h
    left join core.cat_estados_hito eh on eh.id = h.estado_id
   where h.compromiso_id = cmp.id and h.anulado_en is null
), '[]'::json)`;

function mapMesa(row: MesaFila): MesaListItem {
  return {
    id: row.id,
    codigo: row.codigo,
    titulo: row.titulo,
    tipoInstrumento: row.tipoInstrumento,
    naturaleza: row.naturaleza,
    estadoVigencia: row.estadoVigencia,
    ambito: row.ambito,
    ambitoDetalle: row.ambitoDetalle ?? row.ambito ?? null,
    esNacional: row.esNacional === true,
    fechaInstalacion: row.fechaInstalacion,
    fechaFinVigencia: row.fechaFinVigencia,
    miembros: Number(row.miembros ?? 0),
    compromisos: Number(row.compromisos ?? 0),
    compromisosCumplidos: Number(row.compromisosCumplidos ?? 0),
    casoCodigo: row.casoCodigo ?? null,
  };
}

function mapCompromiso(
  row: CompromisoFila,
  incluirHitos: boolean,
): MesaCompromiso {
  const compromiso: MesaCompromiso = {
    id: row.id,
    codigo: row.codigo,
    titulo: row.titulo,
    estado: row.estado,
    area: row.area,
    fechaLimite: row.fechaLimite,
    mesaCodigo: row.mesaCodigo ?? null,
    mesaTitulo: row.mesaTitulo ?? null,
    hitosTotal: Number(row.hitosTotal ?? 0),
    hitosCumplidos: Number(row.hitosCumplidos ?? 0),
    proximoHito: row.proximoHito ?? null,
  };
  if (incluirHitos) compromiso.hitos = row.hitos ?? [];
  return compromiso;
}

/** Cifras de la franja de indicadores: siempre globales, sin filtros. */
async function resumenMesas(
  client: PoolClient,
  vinculo: boolean,
): Promise<MesaResumen> {
  const compromisosSql = vinculo
    ? `(select count(*)::int
          from core.compromisos c
          join core.mesas_dialogo m2 on m2.caso_id = c.caso_id
         where c.anulado_en is null)`
    : `0`;

  const result = await client.query<ResumenFila>(`
    select (count(*))::int as mesas,
           (count(*) filter (
              where core.normalizar_ref(m.estado_vigencia) = core.normalizar_ref('Vigente')
            ))::int as vigentes,
           (count(*) filter (
              where core.normalizar_ref(m.estado_vigencia) = core.normalizar_ref('Por vencer')
            ))::int as "porVencer",
           (count(*) filter (
              where core.normalizar_ref(m.estado_vigencia) = core.normalizar_ref('Vencido')
            ))::int as vencidas,
           (select count(*)::int from core.mesa_miembros) as miembros,
           ${compromisosSql} as compromisos
      from core.mesas_dialogo m
  `);

  const row = result.rows[0];
  return {
    mesas: Number(row?.mesas ?? 0),
    vigentes: Number(row?.vigentes ?? 0),
    porVencer: Number(row?.porVencer ?? 0),
    vencidas: Number(row?.vencidas ?? 0),
    miembros: Number(row?.miembros ?? 0),
    compromisos: Number(row?.compromisos ?? 0),
  };
}

export async function listMesas(
  client: PoolClient,
  filtros: MesaListQuery = {},
): Promise<MesaListResult> {
  const vinculo = await hayVinculoMesas(client);
  const nacional = await hayEsNacional(client);

  const params: unknown[] = [];
  const where: string[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const porTexto = filtroTexto(
    ["m.codigo", "m.titulo", "m.ambito_departamento"],
    filtros.q,
    bind,
  );
  if (porTexto) where.push(porTexto);
  if (filtros.vigencia) {
    where.push(
      `core.normalizar_ref(m.estado_vigencia) = core.normalizar_ref(${bind(filtros.vigencia)})`,
    );
  }
  if (filtros.naturaleza) {
    where.push(
      `core.normalizar_ref(m.naturaleza) = core.normalizar_ref(${bind(filtros.naturaleza)})`,
    );
  }

  const page = Math.max(1, Math.trunc(filtros.page ?? 1));
  const pageSize = Math.min(
    100,
    Math.max(1, Math.trunc(filtros.pageSize ?? 25)),
  );

  // Sin el vínculo (migración 81 pendiente) no hay caso al que unir compromisos.
  const compromisosSql = vinculo
    ? `(select count(*)::int
          from core.compromisos c
         where c.caso_id = m.caso_id and c.anulado_en is null)`
    : `0`;
  const cumplidosSql = vinculo
    ? `(select count(*)::int
          from core.compromisos c
          join core.cat_estados_compromiso ec on ec.id = c.estado_id
         where c.caso_id = m.caso_id and c.anulado_en is null
           and ec.codigo = 'Cumplido')`
    : `0`;
  const casoCodigoSql = vinculo
    ? `(select c.codigo_caso from core.casos c where c.id = m.caso_id)`
    : `null::text`;

  // Con la columna de la migración 89 la mesa nacional se muestra como
  // «Nacional» y conserva el texto crudo en `ambitoDetalle`; sin ella, ambos
  // campos caen al texto de siempre para no romper una base sin migrar.
  const ambitoSql = nacional
    ? `case when m.es_nacional then 'Nacional' else m.ambito_departamento end as ambito`
    : `m.ambito_departamento as ambito`;
  const esNacionalSql = nacional
    ? `m.es_nacional as "esNacional"`
    : `false as "esNacional"`;

  const sql = `
    select m.id,
           m.codigo,
           m.titulo,
           m.tipo_instrumento as "tipoInstrumento",
           m.naturaleza,
           m.estado_vigencia as "estadoVigencia",
           ${ambitoSql},
           m.ambito_departamento as "ambitoDetalle",
           ${esNacionalSql},
           to_char(m.fecha_instalacion, 'YYYY-MM-DD') as "fechaInstalacion",
           to_char(m.fecha_fin_vigencia, 'YYYY-MM-DD') as "fechaFinVigencia",
           (select count(*)::int
              from core.mesa_miembros mm
             where mm.mesa_id = m.id) as miembros,
           ${compromisosSql} as compromisos,
           ${cumplidosSql} as "compromisosCumplidos",
           ${casoCodigoSql} as "casoCodigo",
           count(*) over()::int as total
      from core.mesas_dialogo m
      ${where.length ? `where ${where.join(" and ")}` : ""}
     order by m.codigo asc
     limit ${bind(pageSize)} offset ${bind((page - 1) * pageSize)}
  `;

  const result = await client.query<MesaFila>(sql, params);
  const resumen = await resumenMesas(client, vinculo);

  return {
    items: result.rows.map(mapMesa),
    total: result.rows[0]?.total ?? 0,
    page,
    pageSize,
    resumen,
  };
}

async function compromisosDeCaso(
  client: PoolClient,
  casoId: string,
  mesaCodigo: string,
  mesaTitulo: string,
): Promise<MesaCompromiso[]> {
  const result = await client.query<CompromisoFila>(
    `select cmp.id,
            cmp.codigo_compromiso as codigo,
            cmp.accion_compromiso as titulo,
            replace(ec.codigo, '_', ' ') as estado,
            uo.siglas as area,
            to_char(cmp.fecha_vencimiento, 'YYYY-MM-DD') as "fechaLimite",
            ${HITOS_TOTAL} as "hitosTotal",
            ${HITOS_CUMPLIDOS} as "hitosCumplidos",
            ${PROXIMO_HITO} as "proximoHito",
            ${HITOS_JSON} as hitos
       from core.compromisos cmp
       left join core.cat_estados_compromiso ec on ec.id = cmp.estado_id
       left join core.cat_unidades_organicas uo on uo.id = cmp.unidad_responsable_id
      where cmp.caso_id = $1
        and cmp.anulado_en is null
      order by cmp.fecha_inicio desc nulls last, cmp.codigo_compromiso`,
    [casoId],
  );

  return result.rows.map((row) => ({
    ...mapCompromiso(row, true),
    mesaCodigo,
    mesaTitulo,
  }));
}

export async function getMesaDetalle(
  client: PoolClient,
  codigo: string,
): Promise<MesaDetalle | null> {
  const vinculo = await hayVinculoMesas(client);
  const nacional = await hayEsNacional(client);

  const ambitoSql = nacional
    ? `case when m.es_nacional then 'Nacional' else m.ambito_departamento end as ambito`
    : `m.ambito_departamento as ambito`;
  const esNacionalSql = nacional
    ? `m.es_nacional as "esNacional"`
    : `false as "esNacional"`;

  const camposCaso = vinculo
    ? `m.caso_id as "casoId",
       c.codigo_caso as "casoCodigo",
       c.nombre_caso as "casoTitulo",
       replace(ec2.codigo, '_', ' ') as "casoEstado"`
    : `null::uuid as "casoId",
       null::text as "casoCodigo",
       null::text as "casoTitulo",
       null::text as "casoEstado"`;

  const contadoresCaso = vinculo
    ? `(select count(*)::int
          from core.compromisos c
         where c.caso_id = m.caso_id and c.anulado_en is null) as compromisos,
       (select count(*)::int
          from core.compromisos c
          join core.cat_estados_compromiso ec on ec.id = c.estado_id
         where c.caso_id = m.caso_id and c.anulado_en is null
           and ec.codigo = 'Cumplido') as "compromisosCumplidos"`
    : `0 as compromisos, 0 as "compromisosCumplidos"`;

  const joinsCaso = vinculo
    ? `left join core.casos c on c.id = m.caso_id
       left join core.cat_estados_caso ec2 on ec2.id = c.estado_id`
    : "";

  const result = await client.query<MesaDetalleFila>(
    `select m.id,
            m.codigo,
            m.titulo,
            m.tipo_instrumento as "tipoInstrumento",
            m.naturaleza,
            m.estado_vigencia as "estadoVigencia",
            ${ambitoSql},
            m.ambito_departamento as "ambitoDetalle",
            ${esNacionalSql},
            to_char(m.fecha_instalacion, 'YYYY-MM-DD') as "fechaInstalacion",
            to_char(m.fecha_fin_vigencia, 'YYYY-MM-DD') as "fechaFinVigencia",
            m.objetivo,
            m.base_legal as "baseLegal",
            to_char(m.fecha_norma, 'YYYY-MM-DD') as "fechaNorma",
            m.rol_produce as "rolProduce",
            m.link_evidencia as "linkEvidencia",
            m.doc_designacion as "docDesignacion",
            m.origen_dato as "origenDato",
            (select count(*)::int
               from core.mesa_miembros mm
              where mm.mesa_id = m.id) as miembros,
            ${contadoresCaso},
            ${camposCaso}
       from core.mesas_dialogo m
       ${joinsCaso}
      where core.normalizar_ref(m.codigo) = core.normalizar_ref($1)`,
    [codigo],
  );

  const row = result.rows[0];
  if (!row) return null;

  const integrantesResult = await client.query<IntegranteFila>(
    `select mm.id,
            mm.rol,
            coalesce(mm.nombre_texto, act.nombre_actual) as nombre,
            mm.doc_designacion as "docDesignacion",
            to_char(mm.valid_from, 'YYYY-MM-DD') as desde,
            to_char(mm.valid_to, 'YYYY-MM-DD') as hasta
       from core.mesa_miembros mm
       left join core.actores act on act.actor_uid = mm.actor_uid
      where mm.mesa_id = $1
      order by case mm.rol
                 when 'Presidente' then 1
                 when 'Secretario_tecnico' then 2
                 when 'Titular' then 3
                 when 'Alterno' then 4
                 else 5
               end,
               coalesce(mm.nombre_texto, act.nombre_actual)`,
    [row.id],
  );

  const compromisos =
    vinculo && row.casoId
      ? await compromisosDeCaso(client, row.casoId, row.codigo, row.titulo)
      : [];

  const caso: MesaCaso | null =
    row.casoCodigo !== null
      ? {
          codigo: row.casoCodigo,
          estado: row.casoEstado,
          titulo: row.casoTitulo,
        }
      : null;

  return {
    mesa: {
      ...mapMesa(row),
      objetivo: row.objetivo,
      baseLegal: row.baseLegal,
      fechaNorma: row.fechaNorma,
      rolProduce: row.rolProduce,
      linkEvidencia: row.linkEvidencia,
      docDesignacion: row.docDesignacion,
      origenDato: row.origenDato,
    },
    caso,
    integrantes: integrantesResult.rows,
    compromisos,
  };
}
