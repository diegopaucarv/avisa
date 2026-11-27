import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';

/** Clave de `localStorage`; el guion bajo el prefijo común `avisa-` la delata. */
const CLAVE = 'avisa-acciones-con-texto';

/**
 * Preferencia global «mostrar texto en los botones de acción».
 *
 * Es una sola señal compartida por todos los listados: al cambiarla, cada
 * `app-boton-accion` con etiqueta decide en el acto si pinta el icono o el
 * texto, sin recargar la vista. Se guarda en `localStorage` porque la API no
 * valida esta clave; el valor por defecto es el icono.
 */
@Injectable({ providedIn: 'root' })
export class AccionesPreferenciaService {
  private readonly plataforma = inject(PLATFORM_ID);

  private readonly texto = signal(this.leer());
  readonly conTexto = this.texto.asReadonly();

  fijar(valor: boolean): void {
    if (this.texto() === valor) return;
    this.texto.set(valor);
    this.persistir(valor);
  }

  alternar(): void {
    this.fijar(!this.texto());
  }

  private leer(): boolean {
    if (!isPlatformBrowser(this.plataforma)) return false;
    try {
      return window.localStorage.getItem(CLAVE) === '1';
    } catch {
      return false;
    }
  }

  private persistir(valor: boolean): void {
    if (!isPlatformBrowser(this.plataforma)) return;
    try {
      window.localStorage.setItem(CLAVE, valor ? '1' : '0');
    } catch {
      // Un navegador que niega el almacenamiento no rompe la vista: la
      // preferencia vive sólo en memoria durante esta sesión.
    }
  }
}
