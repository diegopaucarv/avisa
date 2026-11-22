import { HttpErrorResponse, HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { catchError, throwError } from "rxjs";

import { SesionStore } from "./sesion.store";

/**
 * Marca las peticiones a la API y degrada la sesión ante un 401.
 *
 * `withCredentials` ya está configurado en `provideHttpClient`, pero se fuerza
 * aquí para que un cambio en la configuración global no rompa la cookie.
 */
export const sesionInterceptor: HttpInterceptorFn = (peticion, siguiente) => {
  const sesion = inject(SesionStore);

  if (!peticion.url.startsWith("/api") && !peticion.url.startsWith("http")) {
    return siguiente(peticion);
  }

  return siguiente(peticion.clone({ withCredentials: true })).pipe(
    catchError((fallo: unknown) => {
      if (fallo instanceof HttpErrorResponse && fallo.status === 401) {
        // La cookie caducó o se revocó: la UI debe volver al acceso.
        sesion.limpiar();
      }
      return throwError(() => fallo);
    }),
  );
};
