/**
 * Archivo: tipos compartidos entre la página y el panel lateral.
 *
 * Las cinco entidades tienen columnas de anulación distintas, pero la tabla y el
 * panel las muestran igual. `FilaArchivo` es esa forma común: cada pestaña
 * adapta su propio mapeo (`*.mapeo.ts`) a estos campos, sin inventar datos que
 * el listado no devuelva.
 */

export type PestanaArchivo = 'casos' | 'alertas' | 'demandas' | 'documentos' | 'compromisos';

export type FilaArchivo = {
  /** Identificador de la fila (uuid). */
  id: string;
  /** Clave del endpoint de restauración: el código del caso, `id` para el resto. */
  clave: string;
  /** Identificador visible (código de caso, alerta, documento, compromiso). */
  codigo: string | null;
  /** Título o acción; el texto con el que el usuario reconoce el registro. */
  titulo: string | null;
  /** Resumen o descripción breve para la ficha del panel. */
  descripcion: string | null;
  casoCodigo: string | null;
  casoTitulo: string | null;
  motivo: string | null;
  /** ISO de la anulación lógica. */
  anuladoEn: string | null;
  /** Usuario que anuló (id). */
  anuladoPor: string | null;
  /** Nombre legible de quien anuló, si el listado lo resuelve. */
  anuladoPorNombre: string | null;
  /** Lote de anulación al que pertenece la fila. */
  anulacionId: string | null;
  clasificacion: number;
};
