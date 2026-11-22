import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";

import { SesionStore } from "./sesion.store";

/** Bloquea el área privada y recuerda a dónde se quería entrar. */
export const sesionGuard: CanActivateFn = async (_ruta, estado) => {
  const sesion = inject(SesionStore);
  const router = inject(Router);

  if (!sesion.restaurada()) {
    await sesion.restaurar();
  }

  if (sesion.autenticado()) return true;

  return router.createUrlTree(["/acceso"], {
    queryParams: { volver: estado.url || "/" },
  });
};

/** El login no tiene sentido con sesión abierta. */
export const visitanteGuard: CanActivateFn = () => {
  const sesion = inject(SesionStore);
  const router = inject(Router);

  return sesion.autenticado() ? router.createUrlTree(["/"]) : true;
};
