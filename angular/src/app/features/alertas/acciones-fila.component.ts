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

/** Acciones que puede disparar el menú de una fila. */
export type IdAccionAlerta =
  | 'aprobar'
  | 'solicitar-modificacion'
  | 'enviar-revision'
  | 'remitir'
  | 'devolver-elaboracion'
  | 'modificar'
  | 'whatsapp'
  | 'archivar'
  | 'archivar-flujo';

/** Acción ya rotulada; `seccion` agrupa el menú con su encabezado. */
export type AccionMenu = {
  id: IdAccionAlerta;
  etiqueta: string;
  seccion?: string;
};

type GrupoMenu = { titulo: string | null; acciones: AccionMenu[] };

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
      width: 28px;
      height: 28px;
      padding: 0;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      transition:
        background-color 0.12s ease,
        color 0.12s ease;
    }

    .acciones-boton:hover {
      background: var(--canvas);
      color: var(--ink);
    }

    .acciones-boton:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: 1px;
    }

    .acciones-boton[aria-expanded='true'] {
      background: var(--blue-pale);
      color: var(--blue);
    }

    .acciones-boton:disabled {
      opacity: 0.45;
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
      margin: 4px 0 3px;
      padding: 0 10px;
      color: #8b97a1;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
  `,
})
export class AccionesFilaComponent {
  readonly acciones = input<readonly AccionMenu[]>([]);
  readonly puedeAnular = input(false);
  /** Código o título de la alerta; sólo se usa en las etiquetas accesibles. */
  readonly codigo = input('');
  readonly ocupado = input(false);

  readonly accion = output<IdAccionAlerta>();
  readonly anular = output<void>();

  private readonly disparador = viewChild<ElementRef<HTMLButtonElement>>('disparador');
  private readonly anfitrion = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destruccion = inject(DestroyRef);

  readonly posicion = signal<UbicacionMenu | null>(null);
  readonly abierto = computed(() => this.posicion() !== null);
  readonly hayAcciones = computed(() => this.acciones().length > 0 || this.puedeAnular());

  /** Acciones agrupadas por sección, en el orden en que llegan. */
  readonly grupos = computed<readonly GrupoMenu[]>(() => {
    const grupos: GrupoMenu[] = [];
    for (const accion of this.acciones()) {
      const titulo = accion.seccion ?? null;
      const ultimo = grupos[grupos.length - 1];
      if (ultimo && ultimo.titulo === titulo) {
        ultimo.acciones.push(accion);
      } else {
        grupos.push({ titulo, acciones: [accion] });
      }
    }
    return grupos;
  });

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

  elegir(id: IdAccionAlerta, evento: MouseEvent): void {
    evento.stopPropagation();
    this.cerrar(true);
    this.accion.emit(id);
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
    const ancho = Math.min(248, window.innerWidth - margen * 2);
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
    const secciones = this.grupos().filter((grupo) => grupo.titulo !== null).length;
    // «Anular» se pinta dentro del último grupo, no como acción suelta: cuenta
    // como una acción más y no suma separador propio.
    const anular = this.puedeAnular() ? 1 : 0;
    return 12 + secciones * 22 + (this.acciones().length + anular) * 33;
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
