import { HttpClient } from "@angular/common/http";
import { Injectable, computed, inject, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";

import { urlApi } from "../config/entorno";
import { aErrorApi, ErrorApi } from "../http/errores";
import { ApiLogin, ApiSesion, Usuario, aUsuario } from "./sesion.model";

export type EstadoSesion = "iniciando" | "anonimo" | "autenticado";

/**
 * Única fuente de verdad de la sesión.
 *
 * La cookie es httpOnly y firmada: el cliente no puede leerla, así que la
 * hidratación consiste en preguntar a `GET /api/v1/session` antes del primer
 * pintado (`provideAppInitializer`), tal como hace hoy `app/page.tsx`.
 */
@Injectable({ providedIn: "root" })
export class SesionStore {
  private readonly http = inject(HttpClient);

  private readonly _usuario = signal<Usuario | null>(null);
  private readonly _estado = signal<EstadoSesion>("iniciando");

  readonly usuario = this._usuario.asReadonly();
  readonly estado = this._estado.asReadonly();
  readonly autenticado = computed(() => this._estado() === "autenticado");
  readonly restaurada = computed(() => this._estado() !== "iniciando");

  /** Códigos de rol vigentes. Un ADMIN acumula todos. */
  readonly roles = computed(() => this._usuario()?.roles ?? []);

  esRol(codigo: string): boolean {
    return this.roles().includes(codigo);
  }

  /** Restaura la sesión. Un 401 es el caso normal de "nadie ha entrado". */
  async restaurar(): Promise<void> {
    try {
      const datos = await firstValueFrom(
        this.http.get<ApiSesion>(urlApi("/v1/session")),
      );
      this._usuario.set(aUsuario(datos.user));
      this._estado.set("autenticado");
    } catch (fallo) {
      const error = aErrorApi(fallo);
      if (!error.esNoAutorizado) {
        console.warn("No se pudo restaurar la sesión", error.message);
      }
      this._usuario.set(null);
      this._estado.set("anonimo");
    }
  }

  async iniciarSesion(dni: string, password: string): Promise<Usuario> {
    try {
      const datos = await firstValueFrom(
        this.http.post<ApiLogin>(urlApi("/auth/login"), { dni, password }),
      );
      const usuario = aUsuario(datos);
      this._usuario.set(usuario);
      this._estado.set("autenticado");
      return usuario;
    } catch (fallo) {
      throw aErrorApi(fallo, "DNI o clave incorrectos.");
    }
  }

  /** El cierre de sesión local es inmediato; el servidor limpia la cookie. */
  cerrarSesion(): void {
    this._usuario.set(null);
    this._estado.set("anonimo");
    void firstValueFrom(this.http.post(urlApi("/auth/logout"), {}))
      .catch((fallo: unknown) => {
        console.warn("No se pudo cerrar la sesión en el servidor", aErrorApi(fallo).message);
      });
  }

  /** Sólo para pruebas y para el interceptor cuando la cookie ya no vale. */
  limpiar(): void {
    this._usuario.set(null);
    this._estado.set("anonimo");
  }
}

export { ErrorApi };
