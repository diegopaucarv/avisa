import { Injectable, signal } from '@angular/core';

import type { DestinatarioMensaje } from '../../shared/ui/mensaje-panel.component';

/**
 * Destinatarios del panel «Enviar mensaje» del directorio.
 *
 * Vive en la raíz (`providedIn: 'root'`) por la misma razón que
 * `ListaAsistenciaService`: la selección es de la sesión y no debe perderse al
 * navegar entre actores, organizaciones y autoridades. No se persiste en
 * `localStorage`; se reinicia con la aplicación.
 *
 * Hay dos estados: mientras nadie edite el cajón, los destinatarios son la
 * selección de la tabla que propone cada vista (`destinatariosCon`), así el
 * contador del botón flotante responde al instante a las casillas marcadas. En
 * cuanto se añade o quita uno en el panel (`reemplazar`), manda la lista
 * guardada y la selección deja de pisarla.
 */
@Injectable({ providedIn: 'root' })
export class EnviarMensajeService {
  private readonly _destinatarios = signal<DestinatarioMensaje[]>([]);

  /** Lista fijada desde el panel; vacía = sigue la selección de la vista. */
  readonly destinatarios = this._destinatarios.asReadonly();

  /**
   * Destinatarios efectivos. `semilla` es la selección de la tabla de la vista
   * actual; sólo se usa mientras el usuario no haya editado el cajón.
   */
  destinatariosCon(semilla: readonly DestinatarioMensaje[]): DestinatarioMensaje[] {
    const fijados = this._destinatarios();
    return fijados.length > 0 ? fijados : [...semilla];
  }

  /** Fija la lista completa; es lo que emite el panel al añadir o quitar. */
  reemplazar(lista: readonly DestinatarioMensaje[]): void {
    this._destinatarios.set([...lista]);
  }

  /** Olvida la lista editada: se vuelve a seguir la selección de la vista. */
  vaciar(): void {
    this._destinatarios.set([]);
  }
}
