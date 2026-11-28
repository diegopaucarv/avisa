/**
 * Formato de fecha único de la SPA: `02NOV2025`.
 *
 * Día a dos dígitos, mes abreviado a tres letras en mayúsculas y año a cuatro
 * dígitos. Es el formato de todas las vistas (listados, fichas, cronologías y
 * mensajes de WhatsApp):
 * - `formatearFecha` → `02NOV2025`.
 * - `formatearFechaHora` añade la hora → `02NOV2025 16:00`, en hora de Lima.
 * `formatearFechaCorta` y `formatearFechaCompacta` son alias del mismo
 * formateador; se conservan para no tocar las llamadas existentes.
 *
 * No se usa `Intl` para abreviar el mes ni para descomponer un día suelto: `es-PE`
 * abrevia setiembre como «sept.» y, si se construyera un `Date` con
 * `2026-11-05`, el navegador lo leería como medianoche UTC y en Lima seguiría
 * siendo el día anterior. La hora sí se traduce con `partesEnZona`, que es el
 * único punto del proyecto que conoce la zona `America/Lima`.
 */

import { partesEnZona } from '../core/fecha/zona-horaria';

const MESES = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'set',
  'oct',
  'nov',
  'dic',
] as const;

function dosDigitos(valor: number): string {
  return String(valor).padStart(2, '0');
}

/**
 * Descompone una fecha en `[año, mes, día]` numéricos.
 *
 * Acepta `YYYY-MM-DD` (las columnas del backend se emiten con
 * `to_char(..., 'YYYY-MM-DD')`), ISO completo (`2026-10-31T00:00:00.000Z`) y el
 * formato legado `DD/MM/YYYY`. Devuelve `null` si no se reconoce.
 */
export function partesFecha(valor: string | null | undefined): [number, number, number] | null {
  if (!valor) return null;

  const texto = valor.trim();
  if (!texto) return null;

  const barras = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(texto);
  if (barras) {
    return [Number(barras[3]), Number(barras[2]), Number(barras[1])];
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(texto);
  if (!iso) return null;

  return [Number(iso[1]), Number(iso[2]), Number(iso[3])];
}

/** `2026-11-05` → `05NOV2026`; sin fecha → `—`. */
export function formatearFecha(valor: string | null | undefined): string {
  const partes = partesFecha(valor);
  if (!partes) return '—';

  const [anio, mes, dia] = partes;
  const nombreMes = MESES[mes - 1];
  if (!nombreMes) return '—';

  return `${dosDigitos(dia)}${nombreMes.toUpperCase()}${anio}`;
}

/** Alias de `formatearFecha` conservado por compatibilidad. */
export const formatearFechaCompacta = formatearFecha;

/** Alias de `formatearFecha` conservado por compatibilidad. */
export const formatearFechaCorta = formatearFecha;

/**
 * `2026-11-22T09:07:00.776Z` → `22NOV2026 04:07` (hora de Lima).
 * La anulación es un timestamp: no se rotula con ningún estado de catálogo.
 */
export function formatearFechaHora(valor: string | null | undefined): string {
  if (!valor) return '—';

  const instante = new Date(valor);
  if (Number.isNaN(instante.getTime())) {
    const partes = partesFecha(valor);
    if (!partes) return valor;
    const [anio, mes, dia] = partes;
    const nombreMes = MESES[mes - 1];
    return nombreMes ? `${dosDigitos(dia)}${nombreMes.toUpperCase()}${anio}` : valor;
  }

  // Un día suelto no tiene hora: se pinta solo la fecha para no inventar 00:00.
  const partes = partesEnZona(instante);
  const diaIso = `${partes.anio}-${dosDigitos(partes.mes)}-${dosDigitos(partes.dia)}`;
  return `${formatearFecha(diaIso)} ${dosDigitos(partes.hora)}:${dosDigitos(partes.minuto)}`;
}
