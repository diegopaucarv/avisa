import { isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';

import { SesionStore } from './sesion.store';

/** Minutos de inactividad antes de cerrar la sesión. */
export const MINUTOS_INACTIVIDAD = 30;

/** Segundos finales en los que se muestra la cuenta regresiva. */
export const SEGUNDOS_AVISO = 60;

/** Duración total de la inactividad, en milisegundos. */
export const MS_INACTIVIDAD = MINUTOS_INACTIVIDAD * 60_000;

/** Resolución del reloj interno: un chequeo por segundo es suficiente. */
const MS_TICK = 1_000;

/** Ventana mínima entre dos reinicios por actividad (throttling). */
const MS_THROTTLE = 1_000;

/** Nombre del canal que sincroniza la actividad entre pestañas. */
const CANAL_INACTIVIDAD = 'avisa-inactividad';

/** Eventos que reinician el contador; los que aceptan `passive: true` van aparte. */
const EVENTOS_PASIVOS = ['pointerdown', 'wheel', 'touchstart', 'mousemove'] as const;

type MensajeInactividad = { tipo: 'actividad' } | { tipo: 'expirada' };

/**
 * Segundos hasta el cierre, redondeados hacia arriba.
 *
 * Es una función pura a propósito: las pruebas y el servicio comparten el mismo
 * cálculo, sin depender de temporizadores reales.
 */
export function segundosHastaCaducar(
  transcurridoMs: number,
  duracionMs: number = MS_INACTIVIDAD,
): number {
  const restante = duracionMs - Math.max(0, transcurridoMs);
  return restante <= 0 ? 0 : Math.ceil(restante / 1_000);
}

/** `true` cuando la cuenta regresiva debe mostrarse (último minuto). */
export function enVentanaDeAviso(segundos: number): boolean {
  return segundos > 0 && segundos <= SEGUNDOS_AVISO;
}

/**
 * Valor que publica la señal `segundosRestantes`: los segundos del aviso cuando
 * se está en el último minuto y `0` fuera de él.
 */
export function segundosDeAviso(
  transcurridoMs: number,
  duracionMs: number = MS_INACTIVIDAD,
): number {
  const segundos = segundosHastaCaducar(transcurridoMs, duracionMs);
  return enVentanaDeAviso(segundos) ? segundos : 0;
}

/** `true` cuando la inactividad alcanzó la duración configurada. */
export function inactividadAgotada(
  transcurridoMs: number,
  duracionMs: number = MS_INACTIVIDAD,
): boolean {
  return transcurridoMs >= duracionMs;
}

/**
 * Cierre de sesión por inactividad.
 *
 * La cookie del servidor caduca a las 8 h; esto añade el corte local de 30 min
 * sin actividad. El aviso sólo aparece en el último minuto, para no interrumpir
 * el trabajo hasta que la sesión está a punto de caer.
 *
 * La actividad se escucha en `window` y `document` con un throttling de un
 * segundo. Sólo se arma cuando `SesionStore.autenticado()` es cierto; al pasar a
 * anónimo se desmontan listeners e intervalos para no dejar trabajos vivos.
 *
 * Las pestañas se sincronizan por `BroadcastChannel`: la actividad de una
 * reinicia a las demás y una expiración cierra la sesión en todas. La pestaña
 * que queda en segundo plano no puede así cerrar la sesión de la que se está
 * usando.
 */
@Injectable({ providedIn: 'root' })
export class InactividadService {
  private readonly sesion = inject(SesionStore);
  private readonly router = inject(Router);
  private readonly destruccion = inject(DestroyRef);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));

  private duracionMs: number = MS_INACTIVIDAD;
  private ultimaActividad = 0;
  private ultimoEvento = 0;
  private intervalo: ReturnType<typeof setInterval> | null = null;
  private armado = false;
  private escuchando = false;
  private canal: BroadcastChannel | null = null;

  private readonly _segundosRestantes = signal(0);
  private readonly _activo = signal(false);

  /** Cuenta regresiva del aviso; `0` cuando no hay aviso en pantalla. */
  readonly segundosRestantes = this._segundosRestantes.asReadonly();

  /** `true` cuando queda un minuto o menos para el cierre automático. */
  readonly avisando = computed(() => this._activo() && this._segundosRestantes() > 0);

  constructor() {
    if (this.esNavegador && typeof BroadcastChannel !== 'undefined') {
      const canal = new BroadcastChannel(CANAL_INACTIVIDAD);
      canal.addEventListener('message', this.alMensajeCanal);
      this.canal = canal;
    }

    // La sesión puede hidratarse antes del primer pintado (provideAppInitializer)
    // o cambiar después (login, cierre, 401): el efecto arma y desarma solo.
    effect(() => {
      if (!this.esNavegador) return;
      if (this.sesion.autenticado()) this.armar();
      else this.detener();
    });

    this.destruccion.onDestroy(() => {
      this.detener();
      this.canal?.close();
    });
  }

  /**
   * Reinicia el contador y oculta el aviso. La llama el aviso al pulsar
   * «Seguir en sesión»; también se usa internamente tras cualquier actividad.
   */
  seguirEnSesion(): void {
    this.registrarActividad(true);
  }

  /**
   * Ajusta la duración en milisegundos. Pensado para pruebas y depuración: el
   * valor de producción es `MS_INACTIVIDAD` (30 minutos).
   */
  configurar(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.duracionMs = ms;
    if (this.armado) {
      this.registrarActividad(true);
    } else {
      this._segundosRestantes.set(0);
    }
  }

  private armar(): void {
    if (!this.esNavegador || this.armado) return;

    this.armado = true;
    this.ultimaActividad = Date.now();
    this.ultimoEvento = 0;
    this._activo.set(true);
    this._segundosRestantes.set(0);
    this.conectarEscuchas();
    this.intervalo = setInterval(() => this.tick(), MS_TICK);
    this.anunciar({ tipo: 'actividad' });
  }

  private detener(): void {
    this.desconectarEscuchas();
    if (this.intervalo !== null) {
      clearInterval(this.intervalo);
      this.intervalo = null;
    }
    this.armado = false;
    this._activo.set(false);
    this._segundosRestantes.set(0);
  }

  private tick(): void {
    if (!this.armado || !this.sesion.autenticado()) return;

    const transcurrido = Date.now() - this.ultimaActividad;
    if (inactividadAgotada(transcurrido, this.duracionMs)) {
      this.expirar();
      return;
    }

    // Fuera del último minuto la señal no cambia: evitar escrituras (y ciclos
    // de detección) durante los 29 minutos previos al aviso.
    const valor = segundosDeAviso(transcurrido, this.duracionMs);
    if (valor !== this._segundosRestantes()) this._segundosRestantes.set(valor);
  }

  private expirar(notificar = true): void {
    if (!this.armado) return;

    if (notificar) this.anunciar({ tipo: 'expirada' });
    this.detener();
    this.sesion.cerrarSesion();
    void this.router.navigate(['/acceso'], { queryParams: { motivo: 'inactividad' } });
  }

  private registrarActividad(forzar = false, desdeCanal = false): void {
    if (!this.armado) return;

    // El throttling evita reiniciar el contador en cada píxel de `mousemove`.
    const ahora = Date.now();
    if (!forzar && ahora - this.ultimoEvento < MS_THROTTLE) return;

    this.ultimoEvento = ahora;
    this.ultimaActividad = ahora;
    if (this._segundosRestantes() !== 0) this._segundosRestantes.set(0);
    if (!desdeCanal) this.anunciar({ tipo: 'actividad' });
  }

  private conectarEscuchas(): void {
    if (this.escuchando) return;
    this.escuchando = true;

    for (const tipo of EVENTOS_PASIVOS) {
      window.addEventListener(tipo, this.alInteractuar, { passive: true });
    }
    window.addEventListener('keydown', this.alInteractuar);
    window.addEventListener('focus', this.alInteractuar);
    document.addEventListener('visibilitychange', this.alVisibilidad);
  }

  private desconectarEscuchas(): void {
    if (!this.escuchando) return;
    this.escuchando = false;

    for (const tipo of EVENTOS_PASIVOS) {
      window.removeEventListener(tipo, this.alInteractuar);
    }
    window.removeEventListener('keydown', this.alInteractuar);
    window.removeEventListener('focus', this.alInteractuar);
    document.removeEventListener('visibilitychange', this.alVisibilidad);
  }

  private readonly alInteractuar = (): void => {
    this.registrarActividad();
  };

  /** Volver a la pestaña cuenta como actividad; ocultarla no reinicia el contador. */
  private readonly alVisibilidad = (): void => {
    if (!document.hidden) this.registrarActividad(true);
  };

  private readonly alMensajeCanal = (evento: MessageEvent<unknown>): void => {
    if (!this.armado) return;

    const mensaje = evento.data as MensajeInactividad | null;
    if (!mensaje) return;

    if (mensaje.tipo === 'actividad') {
      this.registrarActividad(true, true);
    } else if (mensaje.tipo === 'expirada') {
      this.expirar(false);
    }
  };

  private anunciar(mensaje: MensajeInactividad): void {
    if (!this.canal) return;
    try {
      this.canal.postMessage(mensaje);
    } catch {
      // El canal pudo cerrarse durante el desmontaje: no hay nada que hacer.
    }
  }
}
