/**
 * Configuración de runtime. Se lee de `public/env.js` si existe, de modo que el
 * mismo build puede apuntar a otro backend sin recompilar.
 */
export type Entorno = {
  apiBase: string;
  version: string;
};

declare global {
  interface Window {
    AVISA_ENTORNO?: {
      apiBase?: string;
      version?: string;
    };
  }
}

function leerEntorno(): Entorno {
  const porDefecto: Entorno = { apiBase: "/api", version: "0.1.0" };

  if (typeof window === "undefined") return porDefecto;
  const bruto = window.AVISA_ENTORNO;
  if (!bruto) return porDefecto;

  return {
    apiBase:
      typeof bruto.apiBase === "string" && bruto.apiBase
        ? bruto.apiBase
        : porDefecto.apiBase,
    version:
      typeof bruto.version === "string" && bruto.version
        ? bruto.version
        : porDefecto.version,
  };
}

export const ENTORNO: Entorno = leerEntorno();

/** Une la base de la API con una ruta relativa (`/v1/casos`). */
export function urlApi(ruta: string): string {
  const base = ENTORNO.apiBase.endsWith("/")
    ? ENTORNO.apiBase.slice(0, -1)
    : ENTORNO.apiBase;
  return ruta.startsWith("/") ? `${base}${ruta}` : `${base}/${ruta}`;
}
