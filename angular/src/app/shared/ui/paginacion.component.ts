import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";

import { IconoComponent } from "./icono.component";

/**
 * Paginación de servidor.
 *
 * No conoce datos: recibe el total que reporta la API y emite la página pedida.
 * El tamaño de página se elige aquí y también sube al contenedor.
 */
@Component({
  selector: "app-paginacion",
  imports: [IconoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="pagination" aria-label="Paginación">
      <button
        type="button"
        class="button-secondary"
        [disabled]="pagina() <= 1"
        (click)="ir(pagina() - 1)"
      >
        <app-icono nombre="chevron-izquierda" [tamano]="14" />
        Anterior
      </button>

      <span aria-live="polite">
        Página {{ pagina() }} de {{ paginas() }}
        @if (total() > 0) {
          <span class="pagination-total">· {{ desde() }}–{{ hasta() }} de {{ total() }}</span>
        }
      </span>

      <label class="pagination-size">
        Filas
        <select
          [value]="tamano()"
          aria-label="Filas por página"
          (change)="cambiarTamano($event)"
        >
          @for (opcion of tamanos; track opcion) {
            <option [value]="opcion">{{ opcion }}</option>
          }
        </select>
      </label>

      <button
        type="button"
        class="button-secondary"
        [disabled]="pagina() >= paginas()"
        (click)="ir(pagina() + 1)"
      >
        Siguiente
        <app-icono nombre="chevron-derecha" [tamano]="14" />
      </button>
    </nav>
  `,
  styles: `
    .pagination-total {
      margin-left: 6px;
    }
    .pagination-size {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
  `,
})
export class PaginacionComponent {
  readonly pagina = input.required<number>();
  readonly tamano = input.required<number>();
  readonly total = input.required<number>();

  readonly paginaCambia = output<number>();
  readonly tamanoCambia = output<number>();

  readonly tamanos = [25, 50, 100];

  readonly paginas = computed(() =>
    Math.max(1, Math.ceil(this.total() / Math.max(1, this.tamano()))),
  );

  readonly desde = computed(() =>
    this.total() === 0 ? 0 : (this.pagina() - 1) * this.tamano() + 1,
  );

  readonly hasta = computed(() =>
    Math.min(this.pagina() * this.tamano(), this.total()),
  );

  ir(destino: number): void {
    const limite = Math.min(Math.max(1, destino), this.paginas());
    if (limite !== this.pagina()) this.paginaCambia.emit(limite);
  }

  cambiarTamano(evento: Event): void {
    const valor = Number((evento.target as HTMLSelectElement).value);
    if (Number.isFinite(valor) && valor > 0) this.tamanoCambia.emit(valor);
  }
}
