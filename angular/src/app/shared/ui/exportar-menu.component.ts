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

import { descargarExportacion, type FormatoExportacion } from '../../core/http/descargas';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { IconoComponent } from './icono.component';

/**
 * Botón «Exportar» con menú JSON / Excel / PDF.
 *
 * Recibe la entidad lógica, un `id` opcional para exportar sólo ese registro y
 * un mapa opcional de parámetros de consulta con los filtros, la búsqueda y el
 * orden vigentes: se anexan a la URL para que el archivo respete lo que la
 * pantalla muestra. Además ofrece el respaldo de la base completa
 * (`entidad=base`), que se exporta sin filtros y con los mismos tres formatos.
 * No conoce la API: delega en `descargarExportacion`, que se encarga de la
 * cookie de sesión y del nombre que propone el servidor.
 *
 * Las salidas visibles dependen del perfil (`CapacidadesService.formatosExportacion`,
 * item 107): el sectorista en campo sólo ve Excel y PDF. Un componente puede
 * recortarlas todavía más pasando `formatos`.
 */
@Component({
  selector: 'app-exportar-menu',
  imports: [IconoComponent],
  templateUrl: './exportar-menu.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'cerrar()',
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
    }

    .menu {
      position: absolute;
      z-index: 30;
      top: calc(100% + 4px);
      right: 0;
      min-width: 210px;
      padding: 4px;
      border: 1px solid #dce3e8;
      border-radius: 10px;
      background: #fff;
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
      color: #1a2b3e;
      font: 600 11px/1.3 var(--font-body, inherit);
      text-align: left;
      cursor: pointer;
    }

    .menu button:hover,
    .menu button:focus-visible {
      background: #f5f7f8;
      outline: none;
    }

    .menu small {
      color: #7b8896;
      font-size: 9px;
      font-weight: 400;
    }

    .menu-titulo {
      margin: 2px 0 3px;
      padding: 0 10px;
      color: #8b97a1;
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .menu-separador {
      height: 1px;
      margin: 5px 6px;
      background: #e8edf1;
    }
  `,
})
export class ExportarMenuComponent {
  readonly entidad = input.required<string>();
  readonly id = input<string | null>(null);
  /** Exporta sólo estos registros; tiene prioridad sobre la vista completa. */
  readonly ids = input<readonly string[] | null>(null);
  readonly etiqueta = input('Exportar');
  /** Filtros vigentes de la vista; se omiten al exportar la base completa. */
  readonly consulta = input<Record<string, string> | null>(null);
  /** Recorte explícito de salidas; por defecto manda la regla del perfil. */
  readonly formatos = input<readonly FormatoExportacion[] | null>(null);

  /** Mensaje legible para la pantalla que contiene el botón. */
  readonly fallo = output<string>();

  readonly abierto = signal(false);
  readonly descargando = signal<FormatoExportacion | null>(null);

  private readonly capacidades = inject(CapacidadesService);

  private readonly permitidos = computed(
    () => this.formatos() ?? this.capacidades.formatosExportacion(),
  );

  /** «vista» o «selección», para el encabezado y las etiquetas del menú. */
  readonly alcance = computed(() => (this.ids()?.length ? 'selección' : 'vista'));

  permite(formato: FormatoExportacion): boolean {
    return this.permitidos().includes(formato);
  }

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

  async descargar(formato: FormatoExportacion, entidad: string = this.entidad()): Promise<void> {
    if (this.descargando()) return;

    this.cerrar();
    this.descargando.set(formato);

    try {
      await descargarExportacion({
        entidad,
        formato,
        // El `id`, los `ids` y los filtros sólo aplican a una entidad suelta,
        // nunca al respaldo completo.
        id: entidad === 'base' ? null : this.id(),
        ids: entidad === 'base' ? null : this.ids(),
        consulta: entidad === 'base' ? null : this.consulta(),
      });
    } catch (error) {
      this.fallo.emit(
        error instanceof Error ? error.message : 'No se pudo generar la exportación.',
      );
    } finally {
      this.descargando.set(null);
    }
  }
}
