import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import {
  TAMANO_PAGINA,
  normalizarColeccion,
  paramsDePagina,
  urlConParametros,
  type Coleccion,
} from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import { aLocalDirectorio, type LocalDirectorio } from './local.mapeo';

type FiltrosLocales = {
  q: string;
  activo: string;
  pagina: number;
  tamano: number;
};

const FILTROS_INICIALES: FiltrosLocales = {
  q: '',
  activo: '',
  pagina: 1,
  tamano: TAMANO_PAGINA,
};

/**
 * Directorio · Locales.
 *
 * Sedes donde se reúnen los espacios de diálogo (Guía §8.2.5 y Anexo 16,
 * columna «Lugar»). Listado paginado en servidor (`GET /api/v1/locales`) con
 * búsqueda y filtro de estado activo, en la URL con `replaceUrl`.
 *
 * La ficha muestra dirección, referencia de ubicación y recomendación. El
 * contacto del local —dato operativo, no PII de actores— sólo se muestra a los
 * roles con `puedeVerPii()`.
 */
@Component({
  selector: 'app-locales',
  imports: [IconoComponent, PaginacionComponent, ExportarMenuComponent],
  templateUrl: './locales.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    .view-body {
      display: flex;
      flex-direction: column;
      gap: 14px;
      width: 100%;
      max-width: 1420px;
      margin: 0 auto;
      padding: 27px 34px 50px;
      box-sizing: border-box;
    }

    .view-head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .view-head h1 {
      margin: 0;
      color: #1a2b3e;
      font: 700 22px/1.3 var(--font-display);
      letter-spacing: -0.65px;
    }

    .view-subtitle {
      max-width: 760px;
      margin: 6px 0 0;
      color: #7b8896;
      font-size: 11px;
      line-height: 1.6;
    }

    .local-nombre {
      display: block;
      width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font-family: inherit;
      text-align: left;
      cursor: pointer;
    }

    .local-actualizando {
      margin: 0;
      color: #8d99a6;
      font-size: 9.5px;
    }

    .drawer {
      width: min(560px, 100%);
    }

    .ficha-cabecera {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    .ficha-etiqueta {
      margin: 0;
      color: #8a98a5;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.7px;
      text-transform: uppercase;
    }

    .drawer-head h2 {
      margin: 0;
      color: #1c2a38;
      font: 700 16px/1.35 var(--font-display);
      overflow-wrap: anywhere;
    }

    .ficha-badges {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
    }

    .ficha-chip {
      background: #f0f3f5;
      color: #657684;
    }

    .ficha-activo {
      background: #edf4ef;
      color: #557a64;
    }

    .ficha-inactivo {
      background: #fff3e5;
      color: #a6732d;
    }

    .ficha-seccion {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .ficha-seccion h3 {
      margin: 0;
      color: #33475b;
      font: 700 11px var(--font-display);
    }

    .ficha-datos {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px 16px;
      margin: 0;
    }

    .ficha-datos > div {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .ficha-datos dt {
      color: #97a1aa;
      font-size: 8.5px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .ficha-datos dd {
      margin: 0;
      color: #465a6c;
      font-size: 10.5px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .ficha-recomendacion {
      margin: 0;
      color: #52677a;
      font-size: 11px;
      line-height: 1.65;
      white-space: pre-line;
    }

    .ficha-vacio {
      margin: 0;
      color: #a0aab3;
      font-size: 10.5px;
      font-style: italic;
    }

    .ficha-nota {
      margin: 0;
      color: #8d99a6;
      font-size: 10px;
      line-height: 1.5;
    }

    @media (max-width: 720px) {
      .view-body {
        padding: 18px 16px 40px;
      }
    }
  `,
})
export class LocalesPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destruccion = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly capacidades = inject(CapacidadesService);

  /** El contacto del local sólo se pinta si el rol puede ver datos personales. */
  readonly puedeVerPii = this.capacidades.puedeVerPii;

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({
        q: params.get('q') ?? '',
        activo: params.get('activo') ?? '',
        pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
        tamano: Math.min(
          100,
          Math.max(1, Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA),
        ),
      })),
    ),
    { initialValue: FILTROS_INICIALES },
  );

  readonly filtros = computed(() => this.parametros());

  private readonly listado = consulta<Coleccion<LocalDirectorio>>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/locales'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        q: filtros.q,
        activo: filtros.activo,
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aLocalDirectorio) };
    },
  });

  readonly locales = computed(() => this.listado.valor()?.elementos ?? []);
  readonly total = computed(() => this.listado.valor()?.total ?? 0);
  readonly estado = this.listado.estado;
  readonly error = this.listado.error;

  /** Local cuya ficha está abierta en el panel lateral. */
  readonly seleccionado = signal<LocalDirectorio | null>(null);

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** Elemento que tenía el foco al abrir, para devolvérselo al cerrar. */
  private focoPrevio: HTMLElement | null = null;

  private temporizadorBusqueda?: ReturnType<typeof setTimeout>;

  constructor() {
    this.destruccion.onDestroy(() => clearTimeout(this.temporizadorBusqueda));

    if (typeof document !== 'undefined') {
      const alEscape = (evento: KeyboardEvent): void => {
        if (evento.key !== 'Escape' || !this.seleccionado()) return;
        evento.preventDefault();
        this.cerrarPanel();
      };
      document.addEventListener('keydown', alEscape);
      this.destruccion.onDestroy(() => document.removeEventListener('keydown', alEscape));
    }
  }

  abrir(local: LocalDirectorio): void {
    const estabaCerrado = this.seleccionado() === null;
    if (estabaCerrado && typeof document !== 'undefined') {
      const activo = document.activeElement;
      this.focoPrevio = activo instanceof HTMLElement ? activo : null;
    }

    this.seleccionado.set(local);
    afterNextRender(() => this.panel()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  cerrarPanel(): void {
    if (this.seleccionado() === null) return;

    this.seleccionado.set(null);
    const previo = this.focoPrevio;
    this.focoPrevio = null;
    afterNextRender(() => previo?.focus(), { injector: this.injector });
  }

  buscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizadorBusqueda);
    this.temporizadorBusqueda = setTimeout(() => {
      void this.actualizar({ q: valor, pagina: 1 });
    }, 300);
  }

  cambiarActivo(evento: Event): void {
    void this.actualizar({ activo: (evento.target as HTMLSelectElement).value, pagina: 1 });
  }

  cambiarPagina(pagina: number): void {
    void this.actualizar({ pagina });
  }

  cambiarTamano(tamano: number): void {
    void this.actualizar({ tamano, pagina: 1 });
  }

  limpiar(): void {
    clearTimeout(this.temporizadorBusqueda);
    this.cerrarPanel();
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {},
      replaceUrl: true,
    });
  }

  recargar(): void {
    this.listado.recargar();
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  /** Booleano anulable → «Sí»/«No»/«—», sin afirmar lo que la base no dice. */
  siNo(valor: boolean | null): string {
    if (valor === null) return '—';
    return valor ? 'Sí' : 'No';
  }

  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrarPanel();
  }

  alTecla(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFoco(evento);
  }

  /** El panel es modal: Tab y Shift+Tab ciclan dentro de él. */
  private atraparFoco(evento: KeyboardEvent): void {
    const panel = this.panel()?.nativeElement;
    if (!panel) return;

    const enfocables = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    );

    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    if (!primero || !ultimo) return;

    const activo = typeof document === 'undefined' ? null : document.activeElement;

    if (!evento.shiftKey && activo === ultimo) {
      evento.preventDefault();
      primero.focus();
      return;
    }

    if (evento.shiftKey && (activo === primero || !panel.contains(activo))) {
      evento.preventDefault();
      ultimo.focus();
    }
  }

  private actualizar(cambios: Partial<FiltrosLocales>): void {
    const siguiente = { ...this.parametros(), ...cambios };

    this.cerrarPanel();

    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        q: siguiente.q || null,
        activo: siguiente.activo || null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
