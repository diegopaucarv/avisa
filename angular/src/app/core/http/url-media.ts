import { ENTORNO } from '../config/entorno';

/**
 * Resuelve la URL servible de un medio contra la base de la API.
 *
 * El servidor entrega rutas relativas (`/api/v1/media/<id>/contenido`). Si la
 * SPA se sirve desde otro origen que la API —`apiBase` absoluto, por ejemplo
 * `https://api.example.com`— la ruta relativa resolvería contra el host de la
 * SPA y la imagen no cargaría. Aquí se antepone el origen de la API.
 *
 * Reglas:
 *   · URL absolutas (`http:`, `https:`), `data:` y `blob:` se dejan intactas.
 *   · Protocolo-relativas (`//host/...`) también.
 *   · Si `apiBase` es relativo (`/api`), la ruta se conserva: el navegador ya la
 *     resuelve contra el origen de la SPA, que es el de la API en ese despliegue.
 *
 * Es una función pura: `apiBase` se puede inyectar para probarla sin tocar el
 * entorno global.
 */
export function resolverUrlMedia(
  cruda: string | null | undefined,
  apiBase: string = ENTORNO.apiBase,
): string {
  const url = (cruda ?? '').trim();
  if (!url) return '';

  // Cualquier URL con esquema es absoluta (http:, https:, data:, blob:, …).
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  // Protocolo-relativa: conserva el host explícito.
  if (url.startsWith('//')) return url;

  // Ruta relativa al origen. Sólo se antepone la base cuando ésta es absoluta.
  if (!url.startsWith('/')) return url;
  if (!/^https?:\/\//i.test(apiBase)) return url;

  try {
    return new URL(url, apiBase).toString();
  } catch {
    return url;
  }
}
