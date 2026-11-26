import { Directive, input } from '@angular/core';

import type { ControlOrden } from './orden-tabla';

/**
 * Convierte un `<th>` en cabecera ordenable.
 *
 * Uso: `<th scope="col" [appThOrden]="'codigo'" [orden]="orden">Código</th>`
 *
 * Ciclo de tres estados (asc → desc → sin orden) y `aria-sort` para lectores
 * de pantalla. No debe aplicarse a la columna de selección ni a «Acciones».
 */
@Directive({
  selector: 'th[appThOrden]',
  host: {
    class: 'th-orden',
    tabindex: '0',
    '[attr.aria-sort]': 'ariaSort()',
    '[class.th-orden-asc]': 'indicador() === "asc"',
    '[class.th-orden-desc]': 'indicador() === "desc"',
    '(click)': 'alternar()',
    '(keydown.enter)': 'alternar()',
    '(keydown.space)': 'alternarTeclado($event)',
  },
})
export class ThOrdenDirective {
  readonly appThOrden = input.required<string>();
  readonly orden = input.required<ControlOrden>();

  protected ariaSort(): string {
    return this.orden().ariaSort(this.appThOrden());
  }

  protected indicador(): string {
    return this.orden().indicador(this.appThOrden());
  }

  protected alternar(): void {
    this.orden().alternar(this.appThOrden());
  }

  protected alternarTeclado(evento: Event): void {
    evento.preventDefault();
    this.alternar();
  }
}
