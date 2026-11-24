import type { PoolClient } from "pg";

/**
 * Locales y sedes de reunión (`core.locales`).
 *
 * La tabla no tiene RLS ni clasificación: son datos operativos de dónde se
 * reúne un espacio de diálogo (Guía §8.2.5 y Anexo 16, columna «Lugar»). Aun
 * así la consulta pasa por `withSession` como el resto de la API para no abrir
 * una vía de acceso distinta al pool.
 *
 * `contacto_celular` y `contacto_email` son datos de contacto operativo del
 * local, no PII de actores; la pantalla los oculta a quien no puede ver PII.
 */
const LOCAL_SELECT = `
  l.id::text as id,
  l.codigo,
  l.nombre,
  l.distrito_id,
  d.nombre as distrito,
  p.nombre as provincia,
  rg.nombre as region,
  l.direccion,
  l.ubicacion_ref,
  l.aforo,
  l.ingresos,
  l.tiene_proyector,
  l.tiene_equipos_computo,
  l.tiene_audio_micro,
  l.contacto_nombre,
  l.contacto_celular,
  l.contacto_email,
  l.recomendacion,
  l.foto_url,
  l.activo
`;

const LOCAL_FROM = `
  from core.locales l
  left join core.distritos d on d.id = l.distrito_id
  left join core.provincias p on p.id = d.provincia_id
  left join core.regiones rg on rg.id = p.region_id
`;

export type LocalListQuery = {
  q?: string;
  /** `true`/`false` en texto; se ignora cualquier otro valor. */
  activo?: string;
  /**
   * `core.distritos.id` exacto. Desde `migration/48_locales_distritos.sql` los
   * 27 locales tienen `distrito_id`, así que el filtro devuelve filas. La UI no
   * lo ofrece por falta de control, no de dato: `locales.page.ts` filtra por
   * texto y disponibilidad.
   */
  distritoId?: string;
  page?: number;
  pageSize?: number;
};

/**
 * Fila de `core.local_responsables`: la relación 1→N que sustituye a las
 * columnas `contacto_*` del local. El contacto heredado se conserva abajo.
 */
export type ResponsableLocal = {
  id: string;
  nombre: string | null;
  correo: string | null;
  telefono: string | null;
};

export type LocalListItem = {
  id: string;
  codigo: string;
  nombre: string;
  distritoId: number | null;
  /**
   * Distrito, provincia y región se resuelven por la cadena local → distrito →
   * provincia → región; `null` si el local no tiene distrito asignado.
   */
  distrito: string | null;
  provincia: string | null;
  region: string | null;
  direccion: string | null;
  ubicacionRef: string | null;
  aforo: number | null;
  ingresos: string | null;
  tieneProyector: boolean | null;
  tieneEquiposComputo: boolean | null;
  tieneAudioMicro: boolean | null;
  /** Responsables relacionados (`core.local_responsables`); vacío si no hay. */
  responsables: ResponsableLocal[];
  /** Primer responsable aplanado; cae al contacto heredado si no hay. */
  responsable: string | null;
  correo: string | null;
  telefono: string | null;
  /** Contacto heredado: se conserva para no perder lo que la API ya exponía. */
  contactoNombre: string | null;
  contactoCelular: string | null;
  contactoEmail: string | null;
  recomendacion: string | null;
  fotoUrl: string | null;
  activo: boolean;
};

export type LocalListResult = {
  items: LocalListItem[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
};

function mapLocal(
  row: Record<string, unknown>,
  responsables: ResponsableLocal[] = [],
): LocalListItem {
  const principal = responsables[0];
  const contactoNombre = row.contacto_nombre as string | null;
  const contactoCelular = row.contacto_celular as string | null;
  const contactoEmail = row.contacto_email as string | null;

  return {
    id: row.id as string,
    codigo: row.codigo as string,
    nombre: row.nombre as string,
    distritoId: row.distrito_id as number | null,
    distrito: row.distrito as string | null,
    provincia: row.provincia as string | null,
    region: row.region as string | null,
    direccion: row.direccion as string | null,
    ubicacionRef: row.ubicacion_ref as string | null,
    aforo: row.aforo as number | null,
    ingresos: row.ingresos as string | null,
    tieneProyector: row.tiene_proyector as boolean | null,
    tieneEquiposComputo: row.tiene_equipos_computo as boolean | null,
    tieneAudioMicro: row.tiene_audio_micro as boolean | null,
    responsables,
    responsable: principal?.nombre ?? contactoNombre,
    correo: principal?.correo ?? contactoEmail,
    telefono: principal?.telefono ?? contactoCelular,
    contactoNombre,
    contactoCelular,
    contactoEmail,
    recomendacion: row.recomendacion as string | null,
    fotoUrl: row.foto_url as string | null,
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

export async function listLocales(
  client: PoolClient,
  query: LocalListQuery,
): Promise<LocalListResult> {
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
      `(core.normalizar_ref(l.nombre) like core.normalizar_ref(${like}) or core.normalizar_ref(l.codigo) like core.normalizar_ref(${like}) or core.normalizar_ref(coalesce(l.direccion, '')) like core.normalizar_ref(${like}) or core.normalizar_ref(coalesce(d.nombre, '')) like core.normalizar_ref(${like}))`,
    );
  }

  const activo = leerBooleano(query.activo);
  if (activo !== undefined) where.push(`l.activo = ${bind(activo)}`);

  const distritoId = query.distritoId?.trim();
  if (distritoId) {
    const id = Number(distritoId);
    if (Number.isInteger(id) && id > 0)
      where.push(`l.distrito_id = ${bind(id)}`);
  }

  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 25)));

  const sql = `
    select ${LOCAL_SELECT},
           count(*) over()::int as total
    ${LOCAL_FROM}
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by l.nombre asc, l.id asc
    limit ${bind(pageSize)} offset ${bind((page - 1) * pageSize)}
  `;

  const result = await client.query(sql, params);
  const total = (result.rows[0]?.total as number | undefined) ?? 0;

  const ids = result.rows.map((row) => row.id as string);
  const responsablesPorLocal = new Map<string, ResponsableLocal[]>();

  if (ids.length > 0) {
    const responsables = await client.query(
      `
        select local_id::text as local_id,
               id::text as id,
               nombre,
               correo,
               telefono
          from core.local_responsables
         where local_id = any($1::uuid[])
         order by created_at asc
      `,
      [ids],
    );

    for (const fila of responsables.rows) {
      const localId = fila.local_id as string;
      const lista = responsablesPorLocal.get(localId) ?? [];
      lista.push({
        id: fila.id as string,
        nombre: fila.nombre as string | null,
        correo: fila.correo as string | null,
        telefono: fila.telefono as string | null,
      });
      responsablesPorLocal.set(localId, lista);
    }
  }

  return {
    items: result.rows.map((row) =>
      mapLocal(row, responsablesPorLocal.get(row.id as string) ?? []),
    ),
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
  };
}
