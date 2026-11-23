import type { PoolClient } from "pg";

/**
 * Buscador territorial del alta: distritos del catálogo INEI y **lugares
 * operativos** que no son distrito.
 *
 * Matarani es el caso que lo motivó: no existe como distrito —es puerto del
 * distrito de Islay (`040704`)— y el alta debe poder registrarlo sin
 * convertirlo en un distrito inventado. Por eso la búsqueda devuelve dos
 * colecciones separadas y el payload del caso guarda `distritoPrincipalId` o
 * `lugarId`, nunca «el distrito más parecido».
 *
 * `core.distritos`, `core.provincias`, `core.regiones` y `territorio.lugares`
 * no tienen RLS; la consulta pasa igualmente por `withSession` para no abrir
 * una vía de acceso distinta al pool.
 *
 * La comparación usa `core.normalizar_ref`: quita tildes, mayúsculas, espacios,
 * guiones y guiones bajos. Así «nuñoa», «Nunoa» y «NUÑOA» encuentran lo mismo, y
 * `san juan` sigue encontrando `San Juan Bautista`.
 */

export const TERRITORIO_LIMITE_POR_DEFECTO = 20;
export const TERRITORIO_LIMITE_MAX = 50;
/** Una sola letra devolvería casi los 1 891 distritos. */
export const TERRITORIO_Q_MIN = 2;

export type TerritorioQuery = {
  q?: string;
  limite?: number;
};

export type DistritoTerritorio = {
  id: number;
  ubigeo: string;
  nombre: string;
  provincia: string;
  region: string;
  /** «Distrito · Provincia · Región»: desambigua los 15 «Santa Rosa». */
  ruta: string;
};

export type LugarTerritorio = {
  id: string;
  nombre: string;
  /** `territorio.cat_tipos_lugar.codigo`: `puerto`, `caleta`, `desembarcadero_artesanal`… */
  tipo: string;
  distrito: string;
  provincia: string;
  region: string;
  /** «Lugar · Distrito · Región», con el tipo como distintivo aparte. */
  ruta: string;
};

export type TerritorioResult = {
  q: string;
  /** `false` cuando la consulta es más corta que `TERRITORIO_Q_MIN`. */
  aplicada: boolean;
  distritos: DistritoTerritorio[];
  lugares: LugarTerritorio[];
};

function rutaDistrito(
  distrito: string,
  provincia: string,
  region: string,
): string {
  return `${distrito} · ${provincia} · ${region}`;
}

function rutaLugar(lugar: string, distrito: string, region: string): string {
  return `${lugar} · ${distrito} · ${region}`;
}

function limiteDe(valor: number | undefined): number {
  if (valor === undefined || !Number.isFinite(valor)) {
    return TERRITORIO_LIMITE_POR_DEFECTO;
  }
  const entero = Math.trunc(valor);
  if (entero < 1) return 1;
  return Math.min(TERRITORIO_LIMITE_MAX, entero);
}

export async function buscarTerritorio(
  client: PoolClient,
  query: TerritorioQuery,
): Promise<TerritorioResult> {
  const crudo = (query.q ?? "").trim();
  const limite = limiteDe(query.limite);

  if (crudo.length < TERRITORIO_Q_MIN) {
    return { q: crudo, aplicada: false, distritos: [], lugares: [] };
  }

  // El ubigeo se busca por prefijo sólo si lo tecleado son dígitos; así «04»
  // lista los distritos de Arequipa y «0407» los de Islay. Cuando no es
  // numérico se usa un patrón vacío, que no coincide con ningún `char(6)`, en
  // vez de `null`: un parámetro nulo sin tipo deja a Postgres sin poder
  // inferirlo y la consulta falla en el parseo.
  const porUbigeo = /^\d{1,6}$/.test(crudo) ? `${crudo}%` : "";
  const contiene = `%${crudo}%`;
  const empieza = `${crudo}%`;

  const distritos = await client.query<{
    id: number;
    ubigeo: string;
    nombre: string;
    provincia: string;
    region: string;
  }>(
    `select d.id,
            d.ubigeo,
            d.nombre,
            p.nombre as provincia,
            r.nombre as region
       from core.distritos d
       join core.provincias p on p.id = d.provincia_id
       join core.regiones r on r.id = p.region_id
      where core.normalizar_ref(d.nombre) like core.normalizar_ref($1)
         or core.normalizar_ref(p.nombre) like core.normalizar_ref($1)
         or core.normalizar_ref(r.nombre) like core.normalizar_ref($1)
         or d.ubigeo like $2
      order by (core.normalizar_ref(d.nombre) like core.normalizar_ref($3)) desc,
               d.nombre asc,
               p.nombre asc
      limit $4`,
    [contiene, porUbigeo, empieza, limite],
  );

  const lugares = await client.query<{
    id: string;
    nombre: string;
    tipo: string;
    distrito: string;
    provincia: string;
    region: string;
  }>(
    `select l.id::text as id,
            l.nombre,
            t.codigo as tipo,
            d.nombre as distrito,
            p.nombre as provincia,
            r.nombre as region
       from territorio.lugares l
       join territorio.cat_tipos_lugar t on t.id = l.tipo_id
       join core.distritos d on d.id = l.distrito_id
       join core.provincias p on p.id = d.provincia_id
       join core.regiones r on r.id = p.region_id
      where l.operativo
        and (core.normalizar_ref(l.nombre) like core.normalizar_ref($1)
             or core.normalizar_ref(d.nombre) like core.normalizar_ref($1)
             or core.normalizar_ref(p.nombre) like core.normalizar_ref($1)
             or core.normalizar_ref(r.nombre) like core.normalizar_ref($1))
      order by (core.normalizar_ref(l.nombre) like core.normalizar_ref($2)) desc,
               l.nombre asc
      limit $3`,
    [contiene, empieza, limite],
  );

  return {
    q: crudo,
    aplicada: true,
    distritos: distritos.rows.map((row) => ({
      id: Number(row.id),
      ubigeo: row.ubigeo,
      nombre: row.nombre,
      provincia: row.provincia,
      region: row.region,
      ruta: rutaDistrito(row.nombre, row.provincia, row.region),
    })),
    lugares: lugares.rows.map((row) => ({
      id: row.id,
      nombre: row.nombre,
      tipo: row.tipo,
      distrito: row.distrito,
      provincia: row.provincia,
      region: row.region,
      ruta: rutaLugar(row.nombre, row.distrito, row.region),
    })),
  };
}

/** Etiqueta legible del tipo de lugar, para la interfaz. */
const ETIQUETAS_TIPO: Record<string, string> = {
  terminal_pesquero: "terminal pesquero",
  desembarcadero_artesanal: "desembarcadero",
  planta_procesadora: "planta procesadora",
  caleta: "caleta",
  cite: "CITE",
  estacion_hidrica: "estación hidráulica",
  camara_frio: "cámara de frío",
  piscigranja: "piscigranja",
  nec: "NEC",
  puerto: "puerto",
  localidad: "localidad",
};

/**
 * Traduce `cat_tipos_lugar.codigo` a texto. El catálogo no tiene columna de
 * nombre, así que el vocabulario vive aquí; un código nuevo cae al `codigo`
 * crudo en vez de esconderse, para que se note que falta traducirlo.
 */
export function etiquetaTipoLugar(codigo: string): string {
  return ETIQUETAS_TIPO[codigo] ?? codigo.replace(/_/g, " ");
}
