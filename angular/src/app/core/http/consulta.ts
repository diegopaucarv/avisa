import { HttpClient } from "@angular/common/http";
import { Signal, effect, inject, signal } from "@angular/core";
import { Subscription } from "rxjs";

import { aErrorApi, ErrorApi } from "./errores";

export type EstadoConsulta = "inactivo" | "cargando" | "listo" | "error";

export type Consulta<T> = {
  valor: Signal<T | undefined>;
  estado: Signal<EstadoConsulta>;
  error: Signal<ErrorApi | null>;
  recargar: () => void;
};

/**
 * Lectura reactiva ligada a una URL derivada de señales (filtros, página, ruta).
 *
 * Fachada deliberada: ningún componente importa `httpResource` ni `resource`.
 * Así un cambio de API de Angular se toca en un solo archivo. Se usa
 * `HttpClient` por dentro para conservar el comportamiento ya verificado
 * (credenciales de sesión, cancelación al cambiar de parámetros).
 *
 * Debe invocarse en contexto de inyección (inicializador de campo o constructor).
 */
export function consulta<T>(opciones: {
  fuente: () => string | null;
  esquema: (valor: unknown) => T;
  /** Evita relanzar si la URL no cambió. Por defecto, sí. */
  mantener?: boolean;
}): Consulta<T> {
  const http = inject(HttpClient);

  const valor = signal<T | undefined>(undefined);
  const estado = signal<EstadoConsulta>("inactivo");
  const error = signal<ErrorApi | null>(null);

  let urlVigente: string | null = null;
  let suscripcion: Subscription | null = null;
  let turno = 0;

  const ejecutar = (): void => {
    const url = opciones.fuente();

    if (!url) {
      urlVigente = null;
      suscripcion?.unsubscribe();
      valor.set(undefined);
      estado.set("inactivo");
      return;
    }

    if (url === urlVigente) return;

    const anterior = urlVigente;
    urlVigente = url;
    const turnoActual = ++turno;

    suscripcion?.unsubscribe();
    estado.set("cargando");
    error.set(null);

    suscripcion = http.get<unknown>(url).subscribe({
      next: (bruto) => {
        if (turnoActual !== turno) return;
        valor.set(opciones.esquema(bruto));
        estado.set("listo");
      },
      error: (fallo: unknown) => {
        if (turnoActual !== turno) return;
        error.set(aErrorApi(fallo));
        estado.set("error");
        // Se permite reintentar la misma URL tras un fallo.
        if (urlVigente === url && anterior !== url) urlVigente = anterior;
      },
    });
  };

  effect(ejecutar);

  return {
    valor: valor.asReadonly(),
    estado: estado.asReadonly(),
    error: error.asReadonly(),
    recargar: () => {
      urlVigente = null;
      ejecutar();
    },
  };
}
