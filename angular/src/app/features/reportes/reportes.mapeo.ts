/**
 * Registro de reportes (Anexo N° 17) → dominio.
 *
 * Único punto donde se traduce el sobre de `GET /api/v1/reportes` al
 * vocabulario de la pantalla. Las claves españolas van primero en cada lectura,
 * igual que en el resto de mapeos, de modo que un rename del backend no obligue
 * a tocar la vista.
 *
 * La vista `analytics.vw_anexo_17_registro_reportes` ya consolida los cinco
 * tipos documentales de reporte y las alertas tempranas; aquí no se fabrica nada
 * que la base no entregue.
 */

import { esRegistro, texto } from '../../dominio/mapeo';
import { formatearFechaCompacta, partesFecha } from '../../shared/formato-fecha';

export type Reporte = {
  /** Nombre del tipo en `core.cat_tipos_documento` (o «Alerta Temprana»). */
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
  conclusionesRecomendaciones: string | null;
};

/**
 * Tipos que publica la vista. El valor es el `tipo` literal que devuelve la
 * vista (nombre del catálogo `core.cat_tipos_documento`), de modo que el filtro
 * coincide exactamente con la base. La etiqueta es la forma corta que se
 * muestra en el desplegable.
 */
export const TIPOS_REPORTE: readonly { valor: string; etiqueta: string }[] = [
  { valor: 'Alerta Temprana', etiqueta: 'Alerta Temprana' },
  { valor: 'Reporte Rápido (RR)', etiqueta: 'Reporte rápido' },
  { valor: 'Clima Social General', etiqueta: 'Clima social general' },
  { valor: 'Clima Social Focalizado', etiqueta: 'Clima social focalizado' },
  { valor: 'Reporte de Actividad', etiqueta: 'Reporte de actividad' },
  {
    valor: 'Informe/Reporte institucional (POI, Willaqniki, bimestral…)',
    etiqueta: 'Informe oficial',
  },
];

/** Fila de `items[]` del sobre paginado. */
export function aReporte(bruto: unknown): Reporte {
  const registro = esRegistro(bruto) ? bruto : {};

  return {
    tipo: texto(registro, ['tipo']),
    codigoReporte: texto(registro, ['codigoReporte', 'codigo_reporte']),
    codigoCaso: texto(registro, ['codigoCaso', 'codigo_caso']),
    responsable: texto(registro, ['responsable']),
    fecha: texto(registro, ['fecha']),
    region: texto(registro, ['region', 'región']),
    ubicacion: texto(registro, ['ubicacion', 'ubicación']),
    titulo: texto(registro, ['titulo', 'título']),
    resumenEjecutivo: texto(registro, ['resumenEjecutivo', 'resumen_ejecutivo']),
    conclusionesRecomendaciones: texto(registro, [
      'conclusionesRecomendaciones',
      'conclusiones_recomendaciones',
    ]),
  };
}

/** `YYYY-MM-DD` → `02NOV2025`; cualquier otra forma se muestra tal cual. */
export function formatearFecha(valor: string | null | undefined): string {
  if (!valor) return '—';
  return partesFecha(valor) ? formatearFechaCompacta(valor) : valor;
}
