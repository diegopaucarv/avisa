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
  viewChild,
} from '@angular/core';

import { IconoComponent } from '../../shared/ui/icono.component';

/** Acción de flujo ya rotulada para la tabla. */
export type AccionFila = { paso: number; etiqueta: string };

type UbicacionMenu = { top: number; left: number; ancho: number };

/**
 * Menú de acciones de una fila del listado de alertas.
 *
 * El menú se pinta con `position: fixed` y coordenadas calculadas desde el
 * botón disparador: así no lo recorta el `overflow-x` de `.table-wrap` ni
 * depende de los estilos de la celda. Los eventos locales detienen la
 * propagación para no abrir el panel lateral de la fila.
 */
@Component({
  selector: 'app-acciones-fila',
  imports: [IconoComponent],
  templateUrl: './acciones-fila.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: inline-block;
    }

    .acciones-boton {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      padding: 0;
      border: 1px solid #dce3e8;
      border-radius: 7px;
      background: #fff;
      color: #526577;
      cursor: pointer;
    }

    .acciones-boton:hover {
      background: #f5f7f8;
    }

    .acciones-boton:focus-visible {
      outline: 2px solid #5b8fd6;
      outline-offset: 1px;
    }

    .acciones-boton[aria-expanded='true'] {
      border-color: #c9d8ea;
      background: #eef3fa;
      color: #4a6b93;
    }

    .acciones-boton:disabled {
      opacity: 0.55;
      cursor: progress;
    }

    .menu-acciones {
      position: fixed;
      z-index: 90;
      display: flex;
      flex-direction: column;
      padding: 4px;
      border: 1px solid #dce3e8;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 10px 30px rgb(26 43 62 / 14%);
      max-height: calc(100vh - 16px);
      overflow-y: auto;
    }

    .menu-acciones button {
      display: flex;
      align-items: center;
      width: 100%;
      padding: 8px 10px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: #1a2b3e;
      font: 600 13px/1.3 var(--font-body, inherit);
      text-align: left;
      cursor: pointer;
    }

    .menu-acciones button:hover,
    .menu-acciones button:focus-visible {
      background: #f5f7f8;
      outline: none;
    }

    .menu-acciones .menu-anular {
      color: #a34c45;
    }

    .menu-acciones .menu-anular:hover,
    .menu-acciones .menu-anular:focus-visible {
      background: #fbf0ef;
    }

    .menu-titulo {
      margin: 2px 0 3px;
      padding: 0 10px;
      color: #8b97a1;
      font-size: 12px;
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
export class AccionesFilaComponent {
  readonly acciones = input<readonly AccionFila[]>([]);
  readonly puedeAnular = input(false);
  /** Código o título de la alerta; sólo se usa en las etiquetas accesibles. */
  readonly codigo = input('');
  readonly ocupado = input(false);

  readonly accion = output<number>();
  readonly anular = output<void>();

  private readonly disparador = viewChild<ElementRef<HTMLButtonElement>>('disparador');
  private readonly anfitrion = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destruccion = inject(DestroyRef);

  readonly posicion = signal<UbicacionMenu | null>(null);
  readonly abierto = computed(() => this.posicion() !== null);
  readonly hayAcciones = computed(() => this.acciones().length > 0 || this.puedeAnular());

  private readonly cerrarFuera = (evento: MouseEvent): void => {
    const destino = evento.target as Node | null;
    if (!destino || !this.anfitrion.nativeElement.contains(destino)) this.cerrar();
  };

  private readonly alTecla = (evento: KeyboardEvent): void => {
    if (evento.key !== 'Escape') return;
    evento.stopPropagation();
    this.cerrar(true);
  };

  private readonly alDesplazar = (): void => this.cerrar();

  constructor() {
    this.destruccion.onDestroy(() => this.escuchar(false));
  }

  alternar(evento: MouseEvent): void {
    evento.stopPropagation();
    if (this.ocupado()) return;
    if (this.abierto()) {
      this.cerrar(true);
      return;
    }
    this.abrir();
  }

  elegir(paso: number, evento: MouseEvent): void {
    evento.stopPropagation();
    this.cerrar(true);
    this.accion.emit(paso);
  }

  pedirAnular(evento: MouseEvent): void {
    evento.stopPropagation();
    this.cerrar(true);
    this.anular.emit();
  }

  private abrir(): void {
    const boton = this.disparador()?.nativeElement;
    if (!boton) return;

    const margen = 8;
    const rect = boton.getBoundingClientRect();
    const ancho = Math.min(232, window.innerWidth - margen * 2);
    const izquierda = Math.max(
      margen,
      Math.min(rect.right - ancho, window.innerWidth - ancho - margen),
    );
    const alto = this.altoEstimado();

    let arriba = rect.bottom + 4;
    if (arriba + alto > window.innerHeight - margen) {
      arriba = Math.max(margen, rect.top - alto - 4);
    }

    this.posicion.set({ top: arriba, left: izquierda, ancho });
    this.escuchar(true);
  }

  private cerrar(enfocar = false): void {
    if (!this.abierto()) return;
    this.escuchar(false);
    this.posicion.set(null);
    if (enfocar) this.disparador()?.nativeElement.focus();
  }

  private altoEstimado(): number {
    const filas = this.acciones().length;
    const anular = this.puedeAnular() ? 1 : 0;
    const separador = filas > 0 && anular > 0 ? 1 : 0;
    return 12 + (filas > 0 ? 22 : 0) + filas * 33 + separador * 11 + anular * 33;
  }

  private escuchar(activo: boolean): void {
    if (activo) {
      document.addEventListener('click', this.cerrarFuera);
      document.addEventListener('keydown', this.alTecla);
      document.addEventListener('scroll', this.alDesplazar, true);
      window.addEventListener('resize', this.alDesplazar);
      return;
    }

    document.removeEventListener('click', this.cerrarFuera);
    document.removeEventListener('keydown', this.alTecla);
    document.removeEventListener('scroll', this.alDesplazar, true);
    window.removeEventListener('resize', this.alDesplazar);
  }
}
