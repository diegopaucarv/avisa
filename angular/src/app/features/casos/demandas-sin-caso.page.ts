import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
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
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { aCaso } from '../../dominio/mapeo';
import type { Caso } from '../../dominio/modelos';
import { BarraSeleccionComponent } from '../../shared/ui/barra-seleccion.component';

import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { salirModal } from '../../shared/ui/modal-salida';
import { OrdenTabla } from '../../shared/ui/orden-tabla';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import { ThOrdenDirective } from '../../shared/ui/th-orden.directive';
import { SeleccionTabla } from '../../shared/ui/seleccion-tabla';
import {
  ESTADOS_DEMANDA,
  aColeccionDemandas,
  claseEstadoDemanda,
  formatearFecha,
  type ColeccionDemandas,
  type Demanda,
  type EstadoDemanda,
} from './demanda-sin-caso.mapeo';

type FiltrosDemandas = {
  q: string;
  estado: string;
  pagina: number;
  tamano: number;
};

const FILTROS_INICIALES: FiltrosDemandas = {
  q: '',
  estado: '',
  pagina: 1,
  tamano: TAMANO_PAGINA,
};

/**
 * Demandas sin caso.
 *
 * Listado paginado en servidor con `sinCaso=true`, búsqueda con debounce y
 * filtro de estado en la URL (`replaceUrl`). La vinculación usa
 * `PATCH /api/v1/demandas/:id` con `casoCode`, la clave que acepta
 * `updateDemanda` (`lib/db/repos/demandas.ts`) para resolver el caso y fijar
 * `caso_id`. Sólo se ofrece a quien puede editar.
 */
@Component({
  selector: 'app-demandas-sin-caso',
  imports: [
    IconoComponent,
    PaginacionComponent,
    BarraSeleccionComponent,
    ExportarMenuComponent,
    ThOrdenDirective,
  ],
  templateUrl: './demandas-sin-caso.page.html',
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

    .celda-descripcion {
      min-width: 220px;
      max-width: 320px;
      white-space: normal;
      line-height: 1.5;
    }

    .celda-fecha {
      white-space: nowrap;
    }

    .fecha-origen {
      margin-left: 4px;
      color: #a0aab3;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.3px;
      text-transform: uppercase;
    }

    .sin-dato {
      color: #a0aab3;
    }

    .boton-vincular {
      min-height: 26px;
      padding: 3px 8px;
      font-size: 12px;
      white-space: nowrap;
    }

    .aviso-vinculo {
      margin: 0;
      padding: 9px 12px;
      border: 1px solid #dfe9e2;
      border-radius: 7px;
      background: #f1f7f3;
      color: #416b52;
      font-size: 12.5px;
      line-height: 1.5;
    }

    .drawer-error {
      margin: 0;
      color: #a84f49;
      font-size: 13px;
      line-height: 1.5;
    }

    .drawer-num {
      margin: 0;
      color: #7b8896;
      font-size: 12.5px;
    }

    .caso-lista {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .caso-opcion {
      width: 100%;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      padding: 9px 10px;
      border: 1px solid #e4eaf0;
      border-radius: 7px;
      background: #fff;
      text-align: left;
    }

    .caso-opcion:hover:not(:disabled) {
      border-color: #c4d3e2;
      background: #fafcfe;
    }

    .caso-opcion:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .caso-opcion-copia {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .caso-opcion-codigo {
      color: #33465a;
      font-size: 12.5px;
      font-weight: 700;
    }

    .caso-opcion-titulo {
      color: #7b8896;
      font-size: 12px;
      line-height: 1.45;
    }

    .micro-label {
      margin: 0 0 4px;
      color: #8a98a5;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.9px;
      text-transform: uppercase;
    }

    @media (max-width: 760px) {
      .view-body {
        padding: 18px 16px 40px;
      }
    }
  `,
})
export class DemandasSinCasoPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly destruccion = inject(DestroyRef);
  readonly capacidades = inject(CapacidadesService);

  readonly estados = ESTADOS_DEMANDA as readonly EstadoDemanda[];

  readonly puedeVincular = computed(() => this.capacidades.puedeEditar());

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({
        q: params.get('q') ?? '',
        estado: params.get('estado') ?? '',
        pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
        tamano: Math.max(1, Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA),
      })),
    ),
    { initialValue: FILTROS_INICIALES },
  );

  readonly filtros = computed(() => this.parametros());

  private readonly listado = consulta<ColeccionDemandas>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/demandas'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        q: filtros.q,
        estado: filtros.estado,
        sinCaso: 'true',
        sort: 'recent',
      });
    },
    esquema: aColeccionDemandas,
  });

  readonly demandas = computed(() => this.listado.valor()?.elementos ?? []);
  readonly total = computed(() => this.listado.valor()?.total ?? 0);

  /**
   * Filtros de la exportación. `sinCaso=true` no viaja en la URL de la vista
   * (es la condición de la pantalla), así que se declara aquí: sin él, el
   * archivo exportaba las 325 demandas en vez de las que se están viendo.
   */
  readonly filtrosExportacion = computed<Record<string, string>>(() => {
    const filtros = this.filtros();
    const consulta: Record<string, string> = { sinCaso: 'true', sort: 'recent' };
    if (filtros.q) consulta['q'] = filtros.q;
    if (filtros.estado) consulta['estado'] = filtros.estado;
    return consulta;
  });
  readonly estado = this.listado.estado;
  readonly error = this.listado.error;

  /* ------------------------------------------------------------------ *
   * Panel de vinculación
   * ------------------------------------------------------------------ */

  readonly demandaElegida = signal<Demanda | null>(null);
  readonly guardando = signal(false);
  readonly errorVinculo = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  /** Selección de la tabla (página visible) para exportar o anular en lote. */
  readonly seleccion = new SeleccionTabla();

  /** Orden local de la página visible. */
  readonly orden = new OrdenTabla<Demanda>();

  private readonly accesores: Record<string, (demanda: Demanda) => unknown> = {
    descripcion: (demanda) => demanda.descripcion,
    estado: (demanda) => demanda.estado,
    fecha: (demanda) => demanda.fechaHecho ?? demanda.fechaRegistro,
    mujeres: (demanda) => demanda.afectaMujeres,
  };

  readonly filasVisibles = computed(() => this.orden.ordenar(this.demandas(), this.accesores));

  idsVisibles(): string[] {
    return this.demandas()
      .map((demanda) => demanda.id)
      .filter((id): id is string => !!id);
  }

  private readonly busquedaCaso = signal('');

  /** Página del buscador de casos; también se pagina en servidor. */
  readonly paginaCasos = signal(1);
  readonly tamanoCasos = signal(TAMANO_PAGINA);

  private readonly casosEncontrados = consulta<Coleccion<Caso>>({
    fuente: () => {
      if (!this.demandaElegida()) return null;
      return urlConParametros(urlApi('/v1/cases'), {
        ...paramsDePagina({
          pagina: this.paginaCasos(),
          tamano: this.tamanoCasos(),
        }),
        q: this.busquedaCaso(),
        sort: 'recent',
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aCaso) };
    },
  });

  readonly casos = computed(() => this.casosEncontrados.valor()?.elementos ?? []);
  readonly totalCasos = computed(() => this.casosEncontrados.valor()?.total ?? 0);
  readonly estadoCasos = this.casosEncontrados.estado;
  readonly errorCasos = this.casosEncontrados.error;

  private temporizador?: ReturnType<typeof setTimeout>;
  private temporizadorCaso?: ReturnType<typeof setTimeout>;
  private readonly vinculoScrim = viewChild<ElementRef<HTMLElement>>('vinculoScrim');

  constructor() {
    this.destruccion.onDestroy(() => {
      clearTimeout(this.temporizador);
      clearTimeout(this.temporizadorCaso);
    });

    // Escape cierra la vinculación sólo si está abierta: la página vive siempre
    // montada, así que la señal de estado es la que manda.
    const alEscape = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return;
      if (!this.demandaElegida()) return;
      evento.preventDefault();
      this.cerrarVinculo();
    };
    document.addEventListener('keydown', alEscape);
    this.destruccion.onDestroy(() => document.removeEventListener('keydown', alEscape));
  }

  /* ------------------------------------------------------------------ *
   * Filtros de la URL
   * ------------------------------------------------------------------ */

  buscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      void this.actualizar({ q: valor, pagina: 1 });
    }, 300);
  }

  cambiarEstado(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ estado: valor, pagina: 1 });
  }

  cambiarPagina(pagina: number): void {
    void this.actualizar({ pagina });
  }

  cambiarTamano(tamano: number): void {
    void this.actualizar({ tamano, pagina: 1 });
  }

  limpiar(): void {
    clearTimeout(this.temporizador);
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {},
      replaceUrl: true,
    });
  }

  recargar(): void {
    this.listado.recargar();
  }

  alAnularLote(cantidad: number): void {
    this.seleccion.limpiar();
    this.aviso.set(cantidad === 1 ? '1 registro anulado.' : `${cantidad} registros anulados.`);
    this.recargar();
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  /* ------------------------------------------------------------------ *
   * Vinculación
   * ------------------------------------------------------------------ */

  abrirVinculo(demanda: Demanda): void {
    if (!this.puedeVincular()) return;
    this.errorVinculo.set(null);
    this.aviso.set(null);
    this.busquedaCaso.set('');
    this.paginaCasos.set(1);
    this.demandaElegida.set(demanda);
  }

  cerrarVinculo(): void {
    // La animación de salida se espera aquí; los datos siguen intactos.
    const scrim = this.vinculoScrim()?.nativeElement;
    salirModal(scrim, () => {
      clearTimeout(this.temporizadorCaso);
      this.demandaElegida.set(null);
      this.paginaCasos.set(1);
      this.errorVinculo.set(null);
    });
  }

  /** El clic fuera cierra; arrastrar dentro del contenido no. */
  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrarVinculo();
  }

  buscarCaso(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizadorCaso);
    this.temporizadorCaso = setTimeout(() => {
      this.paginaCasos.set(1);
      this.busquedaCaso.set(valor);
    }, 300);
  }

  cambiarPaginaCasos(pagina: number): void {
    this.paginaCasos.set(Math.max(1, pagina));
  }

  cambiarTamanoCasos(tamano: number): void {
    if (tamano <= 0) return;
    this.tamanoCasos.set(tamano);
    this.paginaCasos.set(1);
  }

  vincular(caso: Caso): void {
    const demanda = this.demandaElegida();
    if (!demanda || !caso.codigo) return;

    if (!this.puedeVincular()) {
      this.errorVinculo.set('Su rol no permite vincular demandas.');
      return;
    }

    this.guardando.set(true);
    this.errorVinculo.set(null);

    this.http
      .patch<unknown>(urlApi(`/v1/demandas/${encodeURIComponent(demanda.id)}`), {
        casoCode: caso.codigo,
      })
      .subscribe({
        next: () => {
          this.guardando.set(false);
          this.demandaElegida.set(null);
          this.aviso.set(`Demanda vinculada al caso ${caso.codigo}.`);
          // La fila vinculada sale del filtro: si estábamos en una página
          // posterior a la primera, volver a ella deja el listado vacío.
          if (this.filtros().pagina > 1) {
            void this.actualizar({ pagina: 1 });
          } else {
            this.listado.recargar();
          }
        },
        error: (fallo: unknown) => {
          this.guardando.set(false);
          this.errorVinculo.set(this.mensajeDeError(fallo));
        },
      });
  }

  /* ------------------------------------------------------------------ *
   * Helpers de plantilla
   * ------------------------------------------------------------------ */

  claseEstado(estado: EstadoDemanda): string {
    return claseEstadoDemanda(estado);
  }

  fecha(valor: string | null | undefined): string {
    return formatearFecha(valor);
  }

  private mensajeDeError(fallo: unknown): string {
    const error = aErrorApi(fallo);
    if (error.esProhibido) return 'Su rol no permite vincular demandas.';
    return error.message;
  }

  private actualizar(cambios: Partial<FiltrosDemandas>): void {
    const siguiente = { ...this.parametros(), ...cambios };

    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        q: siguiente.q || null,
        estado: siguiente.estado || null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
