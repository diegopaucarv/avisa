/**
 * Fecha del calendario local del dispositivo en `AAAA-MM-DD`.
 *
 * `toISOString()` pasa por UTC: en Lima (UTC−5) cualquier hora desde las 19:00
 * devuelve el día siguiente, así que un padrón abierto de noche quedaba fechado
 * mañana. La fecha del padrón es la que ve el usuario en su calendario, por eso
 * se arma con los getters locales (`getFullYear`, `getMonth`, `getDate`).
 *
 * No se usa `Intl`: el proyecto evita formatear fechas de negocio con él, y
 * aquí el único requisito es el formato ISO de `<input type="date">`.
 */
export function fechaLocalIso(ahora: Date = new Date()): string {
  const anio = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const dia = String(ahora.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}
