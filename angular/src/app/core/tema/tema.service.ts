/**
 * Aplicación del tema y la densidad a la raíz del documento.
 *
 * `PreferenciasService` es la **fuente de verdad** (señal + persistencia en el
 * servidor). Este servicio sólo traduce esa señal al DOM que ya estilizan las
 * hojas del proyecto:
 *
 *  · `data-theme="dark"` / `"light"` en `<html>` — lo que usan
 *    `styles/theme-dark.generated.css` y `theme-dark-overrides.css`.
 *  · `data-theme-preference="light|dark|system"` — la preferencia declarada con
 *    los mismos valores que entiende el bootstrap de `index.html`, para que
 *    ambos coincidan al depurar.
 *  · `data-density="compacta"` en `<html>` — el atributo que ya estiliza
 *    `styles/global.css`; además se marca la clase `densidad-compacta` /
 *    `densidad-comoda` como gancho explícito.
 *
 * También mantiene el espejo legado `avisa-theme` / `avisa-density` en
 * `localStorage`, porque el script previo al primer pintado de `index.html`
 * todavía lo lee. `auto` se espeja como `system` para conservar el seguimiento
 * del sistema entre recargas. Así se evita el destello sin tocar ese archivo.
 *
 * Nada de esto ocurre en SSR: sin DOM, los métodos no hacen nada.
 */

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

import {
  PreferenciasService,
  type DensidadPreferida,
  type TemaPreferido,
} from '../http/preferencias.service';

/** Tema que termina viéndose en pantalla (sin `auto`). */
export type TemaEfectivo = 'claro' | 'oscuro';

/** Claves que lee el bootstrap de `src/index.html` antes de arrancar Angular. */
const CLAVE_LEGADA_TEMA = 'avisa-theme';
const CLAVE_LEGADA_DENSIDAD = 'avisa-density';

const CONSULTA_SISTEMA = '(prefers-color-scheme: dark)';

@Injectable({ providedIn: 'root' })
export class TemaService {
  private readonly plataforma = inject(PLATFORM_ID);
  private readonly preferencias = inject(PreferenciasService);
  private readonly destruccion = inject(DestroyRef);

  /** Preferencia del sistema, releída cuando cambia `prefers-color-scheme`. */
  private readonly sistemaOscuro = signal(this.prefiereOscuroElSistema());

  /** Preferencia guardada: `claro`, `oscuro` o `auto`. */
  readonly preferencia = computed<TemaPreferido>(() => this.preferencias.temaPreferido());

  /** Tema realmente aplicado; `auto` se resuelve contra el sistema. */
  readonly temaEfectivo = computed<TemaEfectivo>(() => {
    const preferencia = this.preferencia();
    if (preferencia === 'auto') return this.sistemaOscuro() ? 'oscuro' : 'claro';
    return preferencia;
  });

  readonly esOscuro = computed(() => this.temaEfectivo() === 'oscuro');

  /** Densidad guardada: `comoda` o `compacta`. */
  readonly densidad = computed<DensidadPreferida>(() => this.preferencias.densidadPreferida());

  constructor() {
    // Un único efecto aplica ambos valores. Reacciona a la preferencia, a la
    // densidad y al cambio del sistema, sin que ninguna pantalla duplique la
    // lógica de `data-theme`.
    effect(() => {
      const tema = this.temaEfectivo();
      const densidad = this.densidad();
      this.aplicar(tema, densidad, this.preferencia());
    });

    if (!isPlatformBrowser(this.plataforma)) return;

    const consulta =
      typeof window.matchMedia === 'function' ? window.matchMedia(CONSULTA_SISTEMA) : null;
    if (consulta) {
      const alCambiar = (evento: MediaQueryListEvent) => this.sistemaOscuro.set(evento.matches);
      consulta.addEventListener('change', alCambiar);
      this.destruccion.onDestroy(() => consulta.removeEventListener('change', alCambiar));
    }

    // Hidrata desde el servidor; es idempotente y no rechaza.
    void this.preferencias.cargar();
  }

  /** Fija el tema y lo persiste en el servidor (optimista). */
  async fijarTema(tema: TemaPreferido): Promise<void> {
    await this.preferencias.fijar('tema', tema);
  }

  /** Fija la densidad y la persiste en el servidor (optimista). */
  async fijarDensidad(densidad: DensidadPreferida): Promise<void> {
    await this.preferencias.fijar('densidad', densidad);
  }

  /**
   * Alterna claro ↔ oscuro y devuelve la preferencia aplicada.
   *
   * `auto` no se alterna: se parte del tema efectivo y se fija uno explícito
   * —lo contrario de lo que se ve—. El guardado es optimista, así que el
   * llamador puede usar el valor devuelto de inmediato. Un fallo del servidor
   * hace que `PreferenciasService` revierta la señal y el tema vuelva atrás;
   * aquí se silencia el rechazo para no dejar una promesa suelta.
   */
  alternar(): TemaPreferido {
    const siguiente: TemaPreferido = this.temaEfectivo() === 'oscuro' ? 'claro' : 'oscuro';
    void this.fijarTema(siguiente).catch(() => undefined);
    return siguiente;
  }

  /**
   * Aplica el tema vigente sin esperar al primer ciclo de detección.
   *
   * Lo llama el inicializador de `app.config.ts` para que la raíz quede
   * marcada antes de pintar y el servicio exista aunque nadie visite
   * Preferencias. No persiste nada: sólo traduce la señal al DOM.
   */
  aplicarActual(): void {
    this.aplicar(this.temaEfectivo(), this.densidad(), this.preferencia());
  }

  /** Aplica el tema a la raíz sin persistir; lo usa el efecto y las pruebas. */
  aplicar(tema: TemaEfectivo, densidad: DensidadPreferida, preferencia: TemaPreferido): void {
    if (!isPlatformBrowser(this.plataforma) || typeof document === 'undefined') return;

    const raiz = document.documentElement;
    raiz.dataset['theme'] = tema === 'oscuro' ? 'dark' : 'light';
    // El bootstrap de `index.html` sólo entiende light|dark|system.
    const preferenciaLegada =
      preferencia === 'auto' ? 'system' : preferencia === 'claro' ? 'light' : 'dark';
    raiz.dataset['themePreference'] = preferenciaLegada;
    raiz.style.colorScheme = tema === 'oscuro' ? 'dark' : 'light';

    if (densidad === 'compacta') {
      raiz.dataset['density'] = 'compacta';
    } else {
      delete raiz.dataset['density'];
    }
    raiz.classList.toggle('densidad-compacta', densidad === 'compacta');
    raiz.classList.toggle('densidad-comoda', densidad === 'comoda');

    try {
      window.localStorage.setItem(CLAVE_LEGADA_TEMA, preferenciaLegada);
      window.localStorage.setItem(CLAVE_LEGADA_DENSIDAD, densidad);
    } catch {
      // Modo privado o cuota llena: el espejo es opcional y no debe romper la UI.
    }
  }

  private prefiereOscuroElSistema(): boolean {
    if (!isPlatformBrowser(this.plataforma)) return false;
    try {
      return typeof window.matchMedia === 'function' && window.matchMedia(CONSULTA_SISTEMA).matches;
    } catch {
      return false;
    }
  }
}
