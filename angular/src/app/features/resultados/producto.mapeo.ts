/**
 * Flujo de aprobación de los «productos del diálogo» (D5).
 *
 * Mismo vocabulario que `features/alertas/alerta.mapeo.ts`: etapas, acciones
 * legales por paso y las clases de estado de `global.css`. El estado se guarda
 * en `core.documentos.estado` (texto libre, `varchar(40)` sin CHECK), así que
 * los pasos tercero y cuarto usan los literales «Aprobado» y «Remitido».
 *
 * La idea es que la pantalla no tenga que conocer transiciones: pide
 * `etapaDeFlujo(paso)` para pintar el indicador y `accionesDeFlujo(paso)` para
 * saber qué botones ofrecer. Así el flujo se prueba sin backend.
 */

export type EtapaProducto = {
  paso: number;
  nombre: string;
  estado: string;
  responsable: string;
};

/**
 * Los cuatro pasos del flujo de productos del diálogo.
 *
 * El primero agrupa los estados de elaboración que ya existen en documentos
 * (`Cargado`, `En análisis`, `Extraído`); el resto tiene un único literal para
 * que la transición sea inequívoca y se pueda auditar con el `PATCH` de
 * documentos.
 */
const ETAPAS_PRODUCTO: readonly EtapaProducto[] = [
  { paso: 1, nombre: 'Elaboración', estado: 'Cargado', responsable: 'Sectorista' },
  { paso: 2, nombre: 'Validación', estado: 'Validado', responsable: 'Sectorista' },
  {
    paso: 3,
    nombre: 'Aprobación',
    estado: 'Aprobado',
    responsable: 'Dirección OAIPCS',
  },
  { paso: 4, nombre: 'Remitido', estado: 'Remitido', responsable: 'Servicio de agente' },
];

/** Catálogo de etapas en orden, para el indicador de la ficha y del listado. */
export const etapasProducto = ETAPAS_PRODUCTO;

export function etapaDeFlujo(paso: number): EtapaProducto | null {
  return ETAPAS_PRODUCTO.find((etapa) => etapa.paso === paso) ?? null;
}

/** Estado de `core.documentos.estado` que corresponde a un paso. */
export function estadoDePaso(paso: number): string | null {
  return etapaDeFlujo(paso)?.estado ?? null;
}

export type AccionFlujo = {
  paso: number;
  /** Literal que viaja en el `PATCH` para dejar el producto en ese paso. */
  estado: string;
  etiqueta: string;
  detalle: string;
  responsable: string;
};

/** Paso 3: la aprobación definitiva de la Dirección OAIPCS. */
export const PASO_APROBACION_DEFINITIVA = 3;

/**
 * Transiciones legales desde cada paso:
 *
 * 1 Elaboración → 2 Validación.
 * 2 → 3 Aprobación definitiva, o devolución a 1.
 * 3 → 4 Remitido, o devolución a 2.
 * 4 → ninguna: un producto remitido se corrige con una nueva versión.
 */
const ACCIONES_POR_PASO: Readonly<Record<number, readonly AccionFlujo[]>> = {
  1: [
    {
      paso: 2,
      estado: 'Validado',
      etiqueta: 'Enviar a validación',
      detalle: 'Registra la revisión previa del producto.',
      responsable: 'Sectorista',
    },
  ],
  2: [
    {
      paso: 3,
      estado: 'Aprobado',
      etiqueta: 'Enviar a aprobación definitiva',
      detalle: 'Solicita el acto de la Dirección de la OAIPCS.',
      responsable: 'Dirección OAIPCS',
    },
    {
      paso: 1,
      estado: 'Cargado',
      etiqueta: 'Devolver a elaboración',
      detalle: 'El producto no sustenta la validación; se conserva la historia.',
      responsable: 'Sectorista',
    },
  ],
  3: [
    {
      paso: 4,
      estado: 'Remitido',
      etiqueta: 'Ordenar remisión',
      detalle: 'El servicio registra el envío a los destinatarios.',
      responsable: 'Servicio de agente',
    },
    {
      paso: 2,
      estado: 'Validado',
      etiqueta: 'Devolver a validación',
      detalle: 'La Dirección pide corrección antes de aprobar.',
      responsable: 'Dirección OAIPCS',
    },
  ],
  4: [],
};

export function accionesDeFlujo(paso: number): readonly AccionFlujo[] {
  return ACCIONES_POR_PASO[paso] ?? [];
}

/** Forma mínima que necesita el flujo; la cumple `Documento`. */
export type ProductoFlujo = {
  estado: string | null;
  validado: boolean;
};

function claveEstado(estado: string | null | undefined): string {
  return (estado ?? '').trim().toLowerCase();
}

/**
 * Paso actual del producto.
 *
 * `es_validado_humano` es un indicador aparte del estado y no lo reescribe la
 * API; si está encendido, se interpreta como validación aunque `estado` siga
 * en el literal de elaboración. Los estados de OCR («En análisis»/«Extraído»)
 * pertenecen al paso 1 porque no son pasos del flujo de aprobación.
 */
export function pasoDeProducto(producto: ProductoFlujo): number {
  const estado = claveEstado(producto.estado);
  if (estado === 'remitido') return 4;
  if (estado === 'aprobado') return 3;
  if (estado === 'validado' || producto.validado) return 2;
  return 1;
}

export function etapaDeProducto(producto: ProductoFlujo): EtapaProducto | null {
  return etapaDeFlujo(pasoDeProducto(producto));
}

/**
 * Colores equivalentes a los de alertas: aprobado/remitido en verde,
 * rechazado en gris y el resto en ámbar («pendiente de un paso humano»).
 */
export function claseEstadoProducto(estado: string | null | undefined): string {
  const clave = claveEstado(estado);
  if (clave === 'aprobado' || clave === 'remitido') return 'state-approved';
  if (clave === 'rechazado') return 'state-dismissed';
  return 'state-pending';
}

/** Etiqueta legible; el listado ya trae `estadoUi`, esto es para la ficha. */
export function etiquetaEstadoProducto(estado: string | null | undefined): string {
  const limpio = (estado ?? '').trim();
  return limpio === '' ? 'Cargado' : limpio;
}
