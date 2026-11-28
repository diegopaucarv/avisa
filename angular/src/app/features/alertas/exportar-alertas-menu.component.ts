import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { IconoComponent } from '../../shared/ui/icono.component';

import { descargarAlertas, type FormatoAlertas } from './exportar-alertas';

/**
 * Botón «Exportar todo» del listado de alertas.
 *
 * Descarga el listado completo con los filtros vigentes a través de
 * `GET /api/v1/export/alertas`, en CSV y —si el perfil puede descargar hojas de
 * cálculo— también en XLSX. No es el menú de la barra de selección: aquél
 * exporta lo marcado con el endpoint genérico; éste vuelca la vista entera.
 *
 * El botón se oculta cuando el perfil no puede exportar tablas, con el mismo
 * criterio que el resto de exportaciones (`CapacidadesService.formatosExportacion`).
 */
@Component({
  selector: 'app-exportar-alertas-menu',
  imports: [IconoComponent],
  templateUrl: './exportar-alertas-menu.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'cerrar()',
    '[style.display]': "puedeExportar() ? 'inline-block' : 'none'",
  },
  styles: `
    :host {
      display: inline-block;
      position: relative;
    }

    .exportar {
      position: relative;
    }

    .exportar-boton {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 36px;
      padding: 0 12px;
      border-radius: 8px;
      font-weight: 600;
    }

    .menu {
      position: absolute;
      z-index: 30;
      top: calc(100% + 4px);
      right: 0;
      min-width: 220px;
      padding: 4px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--paper, #fff);
      box-shadow: 0 10px 30px rgb(26 43 62 / 14%);
    }

    .menu button {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      width: 100%;
      padding: 8px 10px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: var(--ink);
      font: 600 14.5px/1.3 var(--font-body, inherit);
      text-align: left;
      cursor: pointer;
    }

    .menu button:hover,
    .menu button:focus-visible {
      background: var(--canvas);
      outline: none;
    }

    .menu small {
      color: var(--muted);
      font-size: 14px;
      font-weight: 400;
    }

    .menu-titulo {
      margin: 2px 0 3px;
      padding: 0 10px;
      color: var(--muted);
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
  `,
})
export class ExportarAlertasMenuComponent {
  /** Filtros vigentes de la vista; se anexan a la descarga. */
  readonly consulta = input<Record<string, string> | null>(null);
  readonly etiqueta = input('Exportar todo');

  /** Mensaje legible para la pantalla que contiene el botón. */
  readonly fallo = output<string>();

  readonly abierto = signal(false);
  readonly descargando = signal<FormatoAlertas | null>(null);

  private readonly capacidades = inject(CapacidadesService);

  /**
   * CSV y XLSX son la misma tabla en distinto contenedor, así que se rigen por
   * la salida «Excel» del perfil: el sectorista la tiene; un perfil sin
   * exportaciones tabulares no ve el botón.
   */
  readonly puedeExportar = computed(() =>
    this.capacidades.formatosExportacion().includes('excel'),
  );

  private readonly elemento = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destruccion = inject(DestroyRef);

  constructor() {
    const cerrarFuera = (evento: MouseEvent): void => {
      const destino = evento.target as Node | null;
      if (this.abierto() && destino && !this.elemento.nativeElement.contains(destino)) {
        this.abierto.set(false);
      }
    };

    document.addEventListener('click', cerrarFuera);
    this.destruccion.onDestroy(() => document.removeEventListener('click', cerrarFuera));
  }

  alternar(): void {
    if (this.descargando()) return;
    this.abierto.update((valor) => !valor);
  }

  cerrar(): void {
    this.abierto.set(false);
  }

  async descargar(formato: FormatoAlertas): Promise<void> {
    if (this.descargando()) return;

    this.cerrar();
    this.descargando.set(formato);

    try {
      await descargarAlertas(formato, this.consulta());
    } catch (error) {
      this.fallo.emit(
        error instanceof Error ? error.message : 'No se pudo generar la exportación.',
      );
    } finally {
      this.descargando.set(null);
    }
  }
}
