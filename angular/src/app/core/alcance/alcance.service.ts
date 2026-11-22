import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';

import { ALCANCES } from '../../dominio/mapeo';
import type { Alcance } from '../../dominio/modelos';

/**
 * Ámbito geográfico predeterminado (item 28, clave `avisa-alcance`).
 *
 * `auto` significa «el ámbito que entregue la sesión»: la pantalla no impone un
 * alcance propio. Un valor concreto lo consume la lista de Casos como filtro
 * predeterminado. No es un permiso: el recorte real de datos lo aplica la RLS
 * con el ámbito de la sesión; esto sólo decide qué muestra la interfaz.
 */
export type AlcancePreferido = Alcance | 'auto';

/** Misma clave que lee la lista de Casos y que guarda Preferencias. */
const CLAVE = 'avisa-alcance';

export function esAlcance(valor: unknown): valor is Alcance {
  return typeof valor === 'string' && (ALCANCES as readonly string[]).includes(valor);
}

/**
 * Estado compartido de la preferencia de ámbito.
 *
 * Preferencias escribe con `fijar` y el shell lo lee con `preferido`, así que el
 * chip de la cabecera cambia en el mismo instante en que se guarda, sin recargar
 * ni volver a leer `localStorage`. La lista de Casos sigue leyendo la clave
 * directamente al resolver sus parámetros: ambos leen el mismo valor.
 */
@Injectable({ providedIn: 'root' })
export class AlcanceService {
  private readonly plataforma = inject(PLATFORM_ID);
  private readonly guardado = signal<AlcancePreferido>(this.leer());

  readonly preferido = this.guardado.asReadonly();
  readonly esAuto = computed(() => this.guardado() === 'auto');

  fijar(valor: AlcancePreferido): void {
    this.guardado.set(valor);
    if (!isPlatformBrowser(this.plataforma)) return;
    try {
      window.localStorage.setItem(CLAVE, valor);
    } catch {
      // Modo privado o política del navegador: la preferencia no persiste y la
      // interfaz sigue funcionando con el valor en memoria.
    }
  }

  private leer(): AlcancePreferido {
    if (!isPlatformBrowser(this.plataforma)) return 'auto';
    try {
      const valor = window.localStorage.getItem(CLAVE);
      return esAlcance(valor) ? valor : 'auto';
    } catch {
      return 'auto';
    }
  }
}
