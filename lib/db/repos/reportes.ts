import type { PoolClient } from "pg";

/**
 * Registro de reportes (Anexo N° 17 de la Guía de Prevención y Gestión de
 * Conflictos Sociales).
 *
 * La pantalla es de **sólo lectura**: el alta de un reporte se hace desde las
 * pantallas de Documentos o Alertas, y aquí se consulta la vista
 * `analytics.vw_anexo_17_registro_reportes`, que ya consolida los cinco tipos
 * documentales de reporte y las alertas tempranas.
 *
 * La vista se apoya en las tablas base (`core.documentos`,
 * `core.alertas_tempranas`, `core.casos`), que tienen RLS forzada. Desde la
 * migración 23 la vista es `security_invoker`, así que las filas que devuelve
 * quedan acotadas por el contexto de sesión que fija `withSession`
 * (`app.rol_codigo`). Este repositorio no repite ese filtro por región ni por
 * clasificación: lo aplica la base.
 */

export type ReporteListQuery = {
  /** `analytics.vw_anexo_17_registro_reportes.tipo` (nombre del catálogo). */
  tipo?: string;
  region?: string;
  /** `YYYY-MM-DD`, inclusive. */
  desde?: string;
  /** `YYYY-MM-DD`, inclusive. */
  hasta?: string;
  /** Busca en título, código de reporte y código de caso. */
  q?: string;
  page?: number;
  pageSize?: number;
};

export type ReporteListItem = {
  tipo: string | null;
  codigoReporte: string | null;
  codigoCaso: string | null;
  responsable: string | null;
  /** `YYYY-MM-DD`. */
  fecha: string | null;
  region: string | null;
  ubicacion: string | null;
  titulo: string | null;
  resumenEjecutivo: string | null;
  contenido: string | null;
  conclusionesRecomendaciones: string | null;
};

export type ReporteListResult = {
  items: ReporteListItem[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function mapReporte(row: Record<string, unknown>): ReporteListItem {
  return {
    tipo: row.tipo as string | null,
    codigoReporte: row.codigo_reporte as string | null,
    codigoCaso: row.codigo_caso as string | null,
    responsable: row.responsable as string | null,
    fecha: row.fecha as string | null,
    region: row.region as string | null,
    ubicacion: row.ubicacion as string | null,
    titulo: row.titulo as string | null,
    resumenEjecutivo: row.resumen_ejecutivo as string | null,
    contenido: row.contenido as string | null,
    conclusionesRecomendaciones:
      row.conclusiones_recomendaciones as string | null,
  };
}

export async function listReportes(
  client: PoolClient,
  query: ReporteListQuery,
): Promise<ReporteListResult> {
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
      `(r.titulo ilike ${like} or r.codigo_reporte ilike ${like} or r.codigo_caso ilike ${like})`,
    );
  }
  if (query.tipo?.trim()) where.push(`r.tipo = ${bind(query.tipo.trim())}`);
  if (query.region?.trim()) {
    where.push(`r.region = ${bind(query.region.trim())}`);
  }

  // Las fechas se validan antes de castear: un valor libre haría fallar el
  // `::date` dentro de la consulta y convertiría un filtro mal escrito en un
  // 500. Un rango mal formado simplemente no se aplica.
  const desde = query.desde?.trim();
  if (desde && ISO_DATE.test(desde)) where.push(`r.fecha >= ${bind(desde)}::date`);
  const hasta = query.hasta?.trim();
  if (hasta && ISO_DATE.test(hasta)) where.push(`r.fecha <= ${bind(hasta)}::date`);

  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 25)));

  const sql = `
    select r.tipo,
           r.codigo_reporte,
           r.codigo_caso,
           r.responsable,
           to_char(r.fecha, 'YYYY-MM-DD') as fecha,
           r.region,
           r.ubicacion,
           r.titulo,
           r.resumen_ejecutivo,
           r.contenido,
           r.conclusiones_recomendaciones,
           count(*) over()::int as total
      from analytics.vw_anexo_17_registro_reportes r
      ${where.length ? `where ${where.join(" and ")}` : ""}
     order by r.fecha desc nulls last, r.codigo_reporte
     limit ${bind(pageSize)} offset ${bind((page - 1) * pageSize)}
  `;

  const result = await client.query(sql, params);
  const total = result.rows[0]?.total ?? 0;

  return {
    items: result.rows.map(mapReporte),
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
  };
}
