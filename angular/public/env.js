// Configuración de despliegue de la SPA. Se sirve como archivo estático (no se
// compila) para poder apuntar la API a otro origen sin recompilar la consola.
// `angular/src/app/core/config/entorno.ts` lo lee como `window.AVISA_ENTORNO`.
window.AVISA_ENTORNO = {
  apiBase: "/api",
  version: "0.1.0",
};
