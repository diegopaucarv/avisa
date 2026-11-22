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
`;

export type LocalListQuery = {
  q?: string;
  /** `true`/`false` en texto; se ignora cualquier otro valor. */
  activo?: string;
  page?: number;
  pageSize?: number;
};

export type LocalListItem = {
  id: string;
  codigo: string;
  nombre: string;
  distritoId: number | null;
  /** Nombre del distrito resuelto por la clave ajena; `null` si no tiene. */
  distrito: string | null;
  direccion: string | null;
  ubicacionRef: string | null;
  aforo: number | null;
  ingresos: string | null;
  tieneProyector: boolean | null;
  tieneEquiposComputo: boolean | null;
  tieneAudioMicro: boolean | null;
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

function mapLocal(row: Record<string, unknown>): LocalListItem {
  return {
    id: row.id as string,
    codigo: row.codigo as string,
    nombre: row.nombre as string,
    distritoId: row.distrito_id as number | null,
    distrito: row.distrito as string | null,
    direccion: row.direccion as string | null,
    ubicacionRef: row.ubicacion_ref as string | null,
    aforo: row.aforo as number | null,
    ingresos: row.ingresos as string | null,
    tieneProyector: row.tiene_proyector as boolean | null,
    tieneEquiposComputo: row.tiene_equipos_computo as boolean | null,
    tieneAudioMicro: row.tiene_audio_micro as boolean | null,
    contactoNombre: row.contacto_nombre as string | null,
    contactoCelular: row.contacto_celular as string | null,
    contactoEmail: row.contacto_email as string | null,
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
      `(l.nombre ilike ${like} or l.codigo ilike ${like} or coalesce(l.direccion, '') ilike ${like} or coalesce(d.nombre, '') ilike ${like})`,
    );
  }

  const activo = leerBooleano(query.activo);
  if (activo !== undefined) where.push(`l.activo = ${bind(activo)}`);

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

  return {
    items: result.rows.map(mapLocal),
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
  };
}
