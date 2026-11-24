import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { urlApi } from '../config/entorno';
import { ZONA_HORARIA, esZonaHorariaValida } from '../fecha/zona-horaria';
import { TAMANO_PAGINA } from './coleccion';
import { aErrorApi } from './errores';

/**
 * Preferencias del usuario, persistidas en el servidor.
 *
 * La verdad vive en `core.usuario_preferencia` (`GET`/`PATCH
 * /api/v1/preferences`). Aquí se guarda una copia en memoria —una señal— para
 * que todas las listas lean el mismo valor sin repetir peticiones; la copia se
 * hidrata además desde `localStorage` al arrancar, de modo que la primera
 * pintura ya use el tamaño de página y el tema guardados en vez de los valores
 * por defecto (eso es lo que evita el parpadeo).
 *
 * `localStorage` es sólo espejo: el servidor manda. Si el espejo está podrido,
 * se ignora.
 *
 * Ningún método de lectura lanza: `tamanoPagina()` siempre devuelve un número
 * usable aunque la API no responda.
 */

export type TemaPreferido = 'claro' | 'oscuro' | 'auto';
export type DensidadPreferida = 'comoda' | 'compacta';
export type ValoresPreferencia = Readonly<Record<string, unknown>>;

/** Claves con nombre fijo que valida la API (el resto son `columnas<Entidad>`). */
export const CLAVES_PREFERENCIA = ['tamanoPagina', 'tema', 'densidad', 'zonaHoraria'] as const;

export type ClavePreferenciaFija = (typeof CLAVES_PREFERENCIA)[number];

export const TAMANO_PAGINA_MIN = 1;
export const TAMANO_PAGINA_MAX = 100;

const CLAVE_ESPEJO = 'avisa-preferencias';

type RespuestaPreferencias = {
  preferencias?: unknown;
  actualizadoEn?: unknown;
};

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function normalizar(bruto: unknown): Record<string, unknown> {
  if (!esRegistro(bruto)) return {};
  const limpio: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(bruto)) {
    if (valor !== undefined) limpio[clave] = valor;
  }
  return limpio;
}

function leerEspejo(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  try {
    const bruto = window.localStorage.getItem(CLAVE_ESPEJO);
    if (!bruto) return {};
    return normalizar(JSON.parse(bruto) as unknown);
  } catch {
    return {};
  }
}

function guardarEspejo(valores: ValoresPreferencia): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CLAVE_ESPEJO, JSON.stringify(valores));
  } catch {
    // Modo privado o cuota llena: el espejo es opcional, el servidor manda.
  }
}

/** `casos` → `columnasCasos`; `alertas-tempranas` → `columnasAlertasTempranas`. */
export function claveColumnas(entidad: string): string {
  const partes = entidad
    .split(/[^A-Za-z0-9]+/)
    .filter((parte) => parte.length > 0)
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1));
  return `columnas${partes.join('')}`;
}

@Injectable({ providedIn: 'root' })
export class PreferenciasService {
  private readonly http = inject(HttpClient);

  private readonly _valores = signal<ValoresPreferencia>(leerEspejo());
  private readonly _cargadas = signal(false);
  private readonly _cargando = signal(false);
  private readonly _error = signal<string | null>(null);

  private enVuelo: Promise<void> | null = null;

  readonly valores = this._valores.asReadonly();
  readonly cargadas = this._cargadas.asReadonly();
  readonly cargando = this._cargando.asReadonly();
  readonly error = this._error.asReadonly();

  /** Forma reactiva de `tamanoPagina()`, para plantillas. */
  readonly tamanoPaginaPreferido = computed(() => this.tamanoPagina());

  /**
   * Filas por página del usuario. El defecto se declara por llamada porque
   * algunas listas (por ejemplo, el registro de reportes) usan otro.
   */
  tamanoPagina(defecto: number = TAMANO_PAGINA): number {
    const valor = this._valores()['tamanoPagina'];
    if (typeof valor === 'number' && Number.isFinite(valor)) {
      const truncado = Math.trunc(valor);
      if (truncado >= TAMANO_PAGINA_MIN && truncado <= TAMANO_PAGINA_MAX) {
        return truncado;
      }
    }
    if (typeof valor === 'string' && /^\d{1,3}$/.test(valor.trim())) {
      const numero = Number(valor.trim());
      if (numero >= TAMANO_PAGINA_MIN && numero <= TAMANO_PAGINA_MAX) {
        return numero;
      }
    }
    return defecto;
  }

  temaPreferido(): TemaPreferido {
    const valor = this._valores()['tema'];
    if (valor === 'oscuro' || valor === 'dark') return 'oscuro';
    if (valor === 'auto' || valor === 'sistema' || valor === 'system') return 'auto';
    if (valor === 'claro' || valor === 'light') return 'claro';
    return 'auto';
  }

  densidadPreferida(): DensidadPreferida {
    return this._valores()['densidad'] === 'compacta' ? 'compacta' : 'comoda';
  }

  zonaHoraria(): string {
    const valor = this._valores()['zonaHoraria'];
    return typeof valor === 'string' && esZonaHorariaValida(valor) ? valor : ZONA_HORARIA;
  }

  /** Columnas declaradas de una entidad (`columnasCasos`, …); `null` si no hay. */
  columnas(entidad: string): unknown {
    const valor = this._valores()[claveColumnas(entidad)];
    return valor === undefined ? null : valor;
  }

  /**
   * Trae las preferencias del servidor una sola vez. Es idempotente y nunca
   * rechaza: si falla, deja el espejo y anota el mensaje en `error()`.
   */
  async cargar(forzar = false): Promise<void> {
    if (!forzar) {
      if (this._cargadas()) return;
      if (this.enVuelo) return this.enVuelo;
    }

    const peticion = this.solicitar();
    this.enVuelo = peticion;
    return peticion;
  }

  /** Guarda una preferencia. Optimista: la UI cambia antes de la respuesta. */
  async fijar(clave: string, valor: unknown): Promise<void> {
    return this.fijarVarias({ [clave]: valor });
  }

  /**
   * Guarda varias claves en un solo `PATCH`. Un valor `null` (o `undefined`)
   * borra la fila y devuelve esa clave a su defecto.
   */
  async fijarVarias(cambios: Record<string, unknown>): Promise<void> {
    const previos = this._valores();
    const optimista: Record<string, unknown> = { ...previos };

    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor === null || valor === undefined) {
        delete optimista[clave];
      } else {
        optimista[clave] = valor;
      }
    }

    this._valores.set(optimista);
    guardarEspejo(optimista);

    try {
      const respuesta = await firstValueFrom(
        this.http.patch<RespuestaPreferencias>(urlApi('/v1/preferences'), {
          preferencias: cambios,
        }),
      );
      const valores = normalizar(respuesta?.preferencias);
      this._valores.set(valores);
      this._cargadas.set(true);
      this._error.set(null);
      guardarEspejo(valores);
    } catch (fallo) {
      this._valores.set(previos);
      guardarEspejo(previos);
      const error = aErrorApi(fallo);
      this._error.set(error.message);
      throw error;
    }
  }

  /** Vuelve una clave a su defecto (borra la fila en el servidor). */
  async restablecer(clave: string): Promise<void> {
    return this.fijar(clave, null);
  }

  private async solicitar(): Promise<void> {
    this._cargando.set(true);
    try {
      const respuesta = await firstValueFrom(
        this.http.get<RespuestaPreferencias>(urlApi('/v1/preferences')),
      );
      const valores = normalizar(respuesta?.preferencias);
      this._valores.set(valores);
      this._error.set(null);
      guardarEspejo(valores);
    } catch (fallo) {
      const error = aErrorApi(fallo);
      // Un 401 es «no hay sesión»: no es un fallo que merezca un aviso.
      if (!error.esNoAutorizado) {
        this._error.set(error.message);
        console.warn('No se pudieron cargar las preferencias', error.message);
      }
    } finally {
      this._cargadas.set(true);
      this._cargando.set(false);
      this.enVuelo = null;
    }
  }
}
