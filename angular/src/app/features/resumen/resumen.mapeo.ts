/**
 * Resumen operativo: lectura de los agregados reales, las etapas de la portada
 * y los rangos de vencimiento que comparten Resumen y Bandeja.
 *
 * No existe un endpoint de tablero. Los indicadores se calculan con el `total`
 * de los listados ya existentes, pedidos con `tamano=1` para no traer filas.
 * Aquí viven cuatro piezas: el orden de las etapas (Prevención · Gestión ·
 * Seguimiento), la marca de sincronización más reciente de un listado, extraer
 * el total del sobre paginado y construir los rangos de
 * `vencimiento_desde`/`vencimiento_hasta` (ya vencido y por vencer) que el
 * servidor aplica sobre el vencimiento efectivo.
 */

import { normalizarColeccion } from '../../core/http/coleccion';
import { esRegistro } from '../../dominio/mapeo';

/**
 * Etapas del resumen operativo, en el orden de la Guía. El orden de la
 * pantalla vive aquí y no en la plantilla: se recorre esta lista para dibujar
 * los bloques y para numerarlos.
 */
export type EtapaClave = 'prevencion' | 'gestion' | 'seguimiento';

export type EtapaResumen = {
  clave: EtapaClave;
  titulo: string;
  numero: number;
};

export const ETAPAS_RESUMEN: readonly EtapaResumen[] = [
  { clave: 'prevencion', titulo: 'Prevención', numero: 1 },
  { clave: 'gestion', titulo: 'Gestión', numero: 2 },
  { clave: 'seguimiento', titulo: 'Seguimiento', numero: 3 },
];

const CAMPOS_MARCA = ['updatedAt', 'updated_at', 'createdAt', 'created_at'] as const;

/**
 * Marca de fila más reciente de un listado de la API.
 *
 * Sólo se aceptan las marcas de fila que la API publica (`updatedAt`/
 * `createdAt` y sus grafías en snake_case). Una fecha de evento (por ejemplo el
 * `fecha_reporte` de una alerta) no es una marca de sincronización y por eso no
 * se lee aquí. Si la colección no expone ninguna marca —o viene vacía— devuelve
 * `null`: la vista escribe «sin dato» en vez de completar con la fecha de hoy.
 */
export function aMarcaMasReciente(bruto: unknown): string | null {
  const elementos = normalizarColeccion<unknown>(bruto).elementos;
  let masReciente: { marca: string; ms: number } | null = null;

  for (const elemento of elementos) {
    if (!esRegistro(elemento)) continue;

    for (const campo of CAMPOS_MARCA) {
      const marca = elemento[campo];
      if (typeof marca !== 'string') continue;

      const ms = Date.parse(marca.trim());
      if (Number.isNaN(ms)) continue;

      if (masReciente === null || ms > masReciente.ms) {
        masReciente = { marca: marca.trim(), ms };
      }
    }
  }

  return masReciente?.marca ?? null;
}

/** `total` del sobre paginado (`{items,total,...}`), sin construir filas. */
export function aTotal(bruto: unknown): number {
  return normalizarColeccion<unknown>(bruto).total;
}

/**
 * `sinCasoTotal` del sobre de `GET /api/v1/demandas`.
 *
 * El listado se pide con `sinCaso=true`, así que si el sobre todavía no trae la
 * clave, `total` es el mismo número: no se inventa una cifra distinta.
 */
export function aSinCasoTotal(bruto: unknown): number {
  if (esRegistro(bruto)) {
    const valor = bruto['sinCasoTotal'];
    if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  }
  return aTotal(bruto);
}

/**
 * Agregado de compromisos (`GET /api/v1/commitments/resumen`).
 *
 * El plazo de un compromiso vive en sus hitos, no en el compromiso: por eso el
 * sobre separa el total de filas de las que tienen vencimiento calculable. No
 * se deriva ninguna tasa; el consumidor decide cómo publicar el reparto.
 */
export type ResumenCompromisos = {
  compromisos: number;
  hitos: number;
  hitosConFecha: number;
  hitosCumplidos: number;
  hitosCumplidosConFecha: number;
  compromisosConPlazo: number;
  generadoAt: string | null;
};

const CAMPOS_RESUMEN_COMPROMISOS = [
  'compromisos',
  'hitos',
  'hitosConFecha',
  'hitosCumplidos',
  'hitosCumplidosConFecha',
  'compromisosConPlazo',
] as const;

/**
 * Normaliza el sobre de `/commitments/resumen`. Devuelve `null` si el cuerpo no
 * cumple el contrato: la vista lo trata como «No disponible», en vez de rellenar
 * con ceros un dato que la API no entregó.
 */
export function aResumenCompromisos(bruto: unknown): ResumenCompromisos | null {
  if (!esRegistro(bruto)) return null;

  const leido: Partial<ResumenCompromisos> = {};
  for (const campo of CAMPOS_RESUMEN_COMPROMISOS) {
    const valor = bruto[campo];
    if (typeof valor !== 'number' || !Number.isFinite(valor)) return null;
    leido[campo] = valor;
  }

  const generadoAt = bruto['generatedAt'];

  return {
    compromisos: leido.compromisos as number,
    hitos: leido.hitos as number,
    hitosConFecha: leido.hitosConFecha as number,
    hitosCumplidos: leido.hitosCumplidos as number,
    hitosCumplidosConFecha: leido.hitosCumplidosConFecha as number,
    compromisosConPlazo: leido.compromisosConPlazo as number,
    generadoAt: typeof generadoAt === 'string' ? generadoAt : null,
  };
}

/** Horizonte de «por vencer»: hoy y los próximos 30 días, ambos inclusive. */
export const HORIZONTE_POR_VENCER_DIAS = 30;

/** `YYYY-MM-DD` de una fecha en hora local, sin pasar por `toISOString`. */
function isoLocal(fecha: Date): string {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

/** Suma días de calendario a una fecha `YYYY-MM-DD` (aritmética en UTC). */
function sumarDias(iso: string, dias: number): string {
  const [anio, mes, dia] = iso.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia + dias));
  const resultadoAnio = fecha.getUTCFullYear();
  const resultadoMes = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  const resultadoDia = String(fecha.getUTCDate()).padStart(2, '0');
  return `${resultadoAnio}-${resultadoMes}-${resultadoDia}`;
}

/**
 * Límite superior de lo ya vencido: ayer. Se envía como `vencimiento_hasta`
 * sin `desde`, de modo que abarca todo lo anterior a hoy.
 *
 * `situacionDe` marca como `due-vencido` exactamente lo que vence antes de hoy,
 * así que el recuento del servidor y la etiqueta de cada fila coinciden.
 */
export function rangoVencidos(hoy: Date = new Date()): { hasta: string } {
  return { hasta: sumarDias(isoLocal(hoy), -1) };
}

/**
 * Rango inclusivo para `GET /api/v1/commitments` que acota «por vencer» a hoy
 * y los próximos `dias` días.
 *
 * El servidor compara el rango contra el vencimiento efectivo (fecha manual y,
 * si falta, la del próximo hito no terminal) y ordena por esa misma fecha de
 * forma ascendente, así que el `total` del sobre es el recuento exacto y la
 * primera página trae los vencimientos más próximos.
 */
export function rangoPorVencer(
  hoy: Date = new Date(),
  dias: number = HORIZONTE_POR_VENCER_DIAS,
): { desde: string; hasta: string } {
  const desde = isoLocal(hoy);
  return { desde, hasta: sumarDias(desde, dias) };
}
