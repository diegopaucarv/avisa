import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { AnulacionLoteService, type EntidadAnulableLote } from '../../core/http/anulacion-lote';
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { AnularPanelComponent, type ResultadoAnulacion } from './anular-panel.component';
import { ExportarMenuComponent } from './exportar-menu.component';
import { IconoComponent } from './icono.component';

/** Nombre legible de cada entidad, para el título del panel. */
const NOMBRES: Record<EntidadAnulableLote, string> = {
  alertas: 'las alertas',
  casos: 'los casos',
  compromisos: 'los compromisos',
  documentos: 'los documentos',
  demandas: 'las demandas',
};

/**
 * Barra de acciones sobre la selección de una tabla.
 *
 * Se pinta debajo del subtítulo de la vista. Muestra el contador de filas
 * marcadas, el botón de anulación en lote (sólo si la entidad es anulable, el
 * rol anula y hay algo marcado) y el menú de exportación, que pasa a exportar
 * únicamente la selección cuando existe.
 *
 * No conoce la pantalla que la contiene: emite `anulado` para que ésta limpie
 * la selección y recargue, y `fallo` para que muestre el error de descarga.
 */
@Component({
  selector: 'app-barra-seleccion',
  imports: [AnularPanelComponent, ExportarMenuComponent, IconoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="barra" role="group" aria-label="Acciones sobre la selección">
      @if (cantidad() > 0) {
        <span class="barra-cuenta" aria-live="polite">
          {{ cantidad() }} {{ cantidad() === 1 ? 'seleccionado' : 'seleccionados' }}
        </span>
      }

      @if (puedeEliminar()) {
        <button type="button" class="button-danger" (click)="abrir()">
          <app-icono nombre="papelera" [tamano]="14" />
          Eliminar ({{ cantidad() }})
        </button>
      }

      <app-exportar-menu
        [entidad]="entidad()"
        [consulta]="consulta()"
        [ids]="idsSeleccionados()"
        [etiqueta]="etiquetaExportar()"
        (fallo)="fallo.emit($event)"
      />
    </div>

    @if (abierto()) {
      <app-anular-panel
        modo="anular"
        [entidad]="etiquetaEntidad()"
        [codigo]="etiquetaCantidad()"
        [cascada]="cascada()"
        [detalleCascada]="detalleCascada()"
        [enviando]="enviando()"
        [errorEnvio]="error()"
        (cerrar)="cerrar()"
        (hecho)="confirmar($event)"
      />
    }
  `,
  styles: `
    :host {
      display: contents;
    }

    .barra {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      margin-left: auto;
    }

    .barra-cuenta {
      color: #7b8896;
      font-size: 12.5px;
      font-weight: 600;
      white-space: nowrap;
    }

    .button-danger {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
  `,
})
export class BarraSeleccionComponent {
  /** Entidad lógica que entiende `GET /api/v1/export`. */
  readonly entidad = input.required<string>();
  /** Entidad anulable; `null` deja la barra sin acción de borrado. */
  readonly anulable = input<EntidadAnulableLote | null>(null);
  readonly consulta = input<Record<string, string> | null>(null);
  readonly cantidad = input(0);
  readonly idsSeleccionados = input<readonly string[]>([]);
  /** Un caso arrastra sus dependencias al anularse. */
  readonly cascada = input(false);
  readonly detalleCascada = input('sus registros dependientes');

  /** Registros anulados; la pantalla recarga y limpia la selección. */
  readonly anulado = output<number>();
  /** Mensaje legible si la exportación falla. */
  readonly fallo = output<string>();

  private readonly capacidades = inject(CapacidadesService);
  private readonly anulacion = inject(AnulacionLoteService);

  readonly abierto = signal(false);
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);

  readonly puedeEliminar = computed(
    () => this.anulable() !== null && this.capacidades.puedeEliminar() && this.cantidad() > 0,
  );

  readonly etiquetaExportar = computed(() =>
    this.cantidad() > 0 ? `Exportar (${this.cantidad()})` : 'Exportar',
  );

  /** «1 registro» / «N registros», para la cabecera del panel. */
  readonly etiquetaCantidad = computed(() =>
    this.cantidad() === 1 ? '1 registro' : `${this.cantidad()} registros`,
  );

  readonly etiquetaEntidad = computed(() => {
    const entidad = this.anulable();
    return entidad ? NOMBRES[entidad] : 'los registros';
  });

  abrir(): void {
    if (!this.puedeEliminar()) return;
    this.error.set(null);
    this.abierto.set(true);
  }

  cerrar(): void {
    if (this.enviando()) return;
    this.abierto.set(false);
  }

  confirmar(resultado: ResultadoAnulacion): void {
    const entidad = this.anulable();
    const motivo = (resultado.motivo ?? '').trim();
    const ids = this.idsSeleccionados();

    if (!entidad || resultado.modo !== 'anular' || !motivo || ids.length === 0 || this.enviando()) {
      return;
    }

    this.enviando.set(true);
    this.error.set(null);

    this.anulacion.anular(entidad, ids, motivo).subscribe({
      next: (res) => {
        this.enviando.set(false);
        this.abierto.set(false);
        this.anulado.emit(res.anulados ?? ids.length);
      },
      error: (fallo: unknown) => {
        this.enviando.set(false);
        this.error.set(aErrorApi(fallo).message);
      },
    });
  }
}
