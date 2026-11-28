import { Injectable, computed, signal } from '@angular/core';

import type { DestinatarioMensaje } from '../../shared/ui/mensaje-panel.component';

/**
 * Destinatarios del panel «Enviar mensaje» del directorio.
 *
 * Vive en la raíz (`providedIn: 'root'`) por la misma razón que
 * `ListaAsistenciaService`: la selección es de la sesión y no debe perderse al
 * navegar entre actores, organizaciones y autoridades. No se persiste en
 * `localStorage`; se reinicia con la aplicación.
 */
@Injectable({ providedIn: 'root' })
export class EnviarMensajeService {
  private readonly _destinatarios = signal<DestinatarioMensaje[]>([]);
  readonly destinatarios = this._destinatarios.asReadonly();

  readonly total = computed(() => this._destinatarios().length);

  /** Fija la lista completa; es lo que emite el panel al añadir o quitar. */
  reemplazar(lista: readonly DestinatarioMensaje[]): void {
    this._destinatarios.set([...lista]);
  }

  /**
   * Siembra con la selección de la tabla sólo si el cajón está vacío: una
   * lista que ya trae destinatarios de otra vista no se pisa al abrir.
   */
  sembrar(lista: readonly DestinatarioMensaje[]): void {
    if (this._destinatarios().length > 0 || lista.length === 0) return;
    this._destinatarios.set([...lista]);
  }

  vaciar(): void {
    this._destinatarios.set([]);
  }
}
