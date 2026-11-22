/**
 * Formato de fechas compartido por la SPA.
 *
 * Se evita un pipe de Angular para no depender del locale del navegador: el
 * formato del proyecto es siempre `dd/mm/aaaa` (y `dd/mm/aaaa hh:mm` para los
 * instantes de anulación). Vive en `shared/` para que casos, compromisos y
 * documentos usen la misma regla.
 */

/**
 * Fecha de presentación `DD/MM/YYYY` sin depender del locale ni de `Date`.
 *
 * Acepta `YYYY-MM-DD` (las columnas del backend se emiten con
 * `to_char(..., 'YYYY-MM-DD')`), ISO completo (`2026-10-31T00:00:00.000Z`) y el
 * formato legado `DD/MM/YYYY` (que se devuelve en el mismo orden). Nunca se
 * construye un `Date` para una fecha sin hora: así el día no se desplaza por
 * zona horaria.
 */
export function formatearFecha(valor: string | null | undefined): string {
  if (!valor) return '—';

  const texto = valor.trim();
  if (!texto) return '—';

  // Formato legado `D/M/YYYY` o `DD/MM/YYYY`: ya viene en orden de presentación.
  const barras = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(texto);
  if (barras) {
    const dia = barras[1].padStart(2, '0');
    const mes = barras[2].padStart(2, '0');
    return `${dia}/${mes}/${barras[3]}`;
  }

  // `YYYY-MM-DD` o ISO: se corta la parte de la hora sin pasar por `Date`.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (!iso) return valor;

  return `${iso[3]}/${iso[2]}/${iso[1]}`;
}

/**
 * `2026-11-22T09:07:00.776Z` → `22/11/2026 04:07` (hora local del navegador).
 * La anulación es un timestamp: no se rotula con ningún estado de catálogo.
 */
export function formatearFechaHora(valor: string | null | undefined): string {
  if (!valor) return '—';

  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return valor;

  const dia = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const hora = String(fecha.getHours()).padStart(2, '0');
  const minuto = String(fecha.getMinutes()).padStart(2, '0');
  return `${dia}/${mes}/${fecha.getFullYear()} ${hora}:${minuto}`;
}
