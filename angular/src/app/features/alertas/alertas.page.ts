import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
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
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import { AlertaPanelComponent } from './alerta-panel.component';
import {
  ESTADOS_ALERTA,
  OPCIONES_NIVEL,
  ORDENES_ALERTA,
  PRIORIDADES_ALERTA,
  aAlerta,
  aDetalleAlerta,
  claseEstado as claseEstadoDe,
  clavePrioridad as clavePrioridadDe,
  formatearPlazo as formatearPlazoDe,
  type Alerta,
  type DetalleAlerta,
  type PatchAlerta,
} from './alerta.mapeo';

type FiltrosAlertas = {
  q: string;
  prioridad: string;
  nivel: string;
  estado: string;
  orden: string;
  pagina: number;
  tamano: number;
};

const FILTROS_INICIALES: FiltrosAlertas = {
  q: '',
  prioridad: '',
  nivel: '',
  estado: '',
  orden: 'recent',
  pagina: 1,
  tamano: TAMANO_PAGINA,
};

/**
 * Alertas tempranas (RED-RADAR PRODUCE).
 *
 * Listado con paginación de servidor y filtros en la URL (`replaceUrl`). Al
 * pulsar una fila no se navega: se abre `AlertaPanelComponent` como panel
 * lateral, que concentra la ficha, el recorrido de cinco pasos y la edición.
 *
 * Los filtros se envían tal como los acepta `GET /api/v1/alerts`: `q`,
 * `prioridad` (`cat_prioridades_alerta.codigo`), `nivel`
 * (`cat_niveles_alerta.codigo_legado`, es decir `NA-00x`), `estado` (sólo los
 * cuatro valores que el repositorio reconoce) y `sort`.
 */
@Component({
  selector: 'app-alertas',
  imports: [IconoComponent, PaginacionComponent, AlertaPanelComponent, ExportarMenuComponent],
  templateUrl: './alertas.page.html',
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

    .alerta-titulo {
      min-width: 240px;
      white-space: normal;
    }

    .alerta-caso strong,
    .alerta-caso small {
      display: block;
    }

    .alerta-caso strong {
      color: #465a6c;
      font-size: 9px;
      font-weight: 600;
    }

    .alerta-caso small {
      margin-top: 3px;
      color: #99a3aa;
      font-size: 8px;
    }

    .alerta-sin-caso {
      color: #a0aab3;
      font-style: italic;
    }

    .alerta-grave {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      margin-left: 6px;
      padding: 2px 6px;
      border-radius: 10px;
      background: #f9ecea;
      color: #a84f49;
      font-size: 8px;
      font-weight: 700;
    }

    .alerta-prioridad--critica {
      background: #f9ecea;
      color: #a84f49;
    }
    .alerta-prioridad--urgente {
      background: #fff3e5;
      color: #a6732d;
    }
    .alerta-prioridad--temprana {
      background: #eef3fa;
      color: #4a6b93;
    }
    .alerta-prioridad--seguimiento {
      background: #f0f3f5;
      color: #657684;
    }
    .alerta-prioridad--sin-prioridad {
      background: #f6f7f8;
      color: #8b97a1;
    }

    .alerta-plazo {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: #657684;
      white-space: nowrap;
    }

    .alerta-plazo--sin {
      color: #a0aab3;
    }

    .data-table .table-link {
      cursor: pointer;
      font-family: inherit;
      text-align: left;
    }

    .alerta-actualizando {
      margin: 0;
      color: #8d99a6;
      font-size: 9.5px;
    }

    @media (max-width: 720px) {
      .view-body {
        padding: 18px 16px 40px;
      }
    }
  `,
})
export class AlertasPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly destruccion = inject(DestroyRef);
  private readonly capacidades = inject(CapacidadesService);

  readonly prioridades = PRIORIDADES_ALERTA;
  readonly niveles = OPCIONES_NIVEL;
  readonly estados = ESTADOS_ALERTA;
  readonly ordenes = ORDENES_ALERTA;

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({
        q: params.get('q') ?? '',
        prioridad: params.get('prioridad') ?? '',
        nivel: params.get('nivel') ?? '',
        estado: params.get('estado') ?? '',
        orden: params.get('orden') ?? 'recent',
        pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
        tamano: Math.max(1, Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA),
      })),
    ),
    { initialValue: FILTROS_INICIALES },
  );

  readonly filtros = computed(() => this.parametros());

  private readonly listado = consulta<Coleccion<Alerta>>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/alerts'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        q: filtros.q,
        prioridad: filtros.prioridad,
        nivel: filtros.nivel,
        estado: filtros.estado,
        sort: filtros.orden,
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aAlerta) };
    },
  });

  readonly alertas = computed(() => this.listado.valor()?.elementos ?? []);
  readonly total = computed(() => this.listado.valor()?.total ?? 0);
  readonly estadoListado = this.listado.estado;
  readonly errorListado = this.listado.error;

  /** Alerta abierta en el panel; `null` cierra el panel. */
  readonly alertaAbierta = signal<Alerta | null>(null);

  /** Identificador de la fila abierta; se usa para resaltarla en la tabla. */
  readonly seleccionadaId = signal<string | null>(null);

  private readonly detalle = consulta<DetalleAlerta>({
    fuente: () => {
      const id = this.seleccionadaId();
      return id ? urlApi(`/v1/alerts/${encodeURIComponent(id)}`) : null;
    },
    esquema: aDetalleAlerta,
  });

  /**
   * Mientras el detalle carga se pinta la fila ya conocida del listado: el
   * panel nunca aparece vacío y, cuando llega `GET /:id`, se enriquece con las
   * demandas. El detalle sólo se usa si corresponde a la alerta abierta, para
   * no enseñar datos de una fila anterior al cambiar de selección.
   */
  private readonly detalleVigente = computed(() => {
    const abierta = this.alertaAbierta();
    const detalle = this.detalle.valor();
    if (!abierta || !detalle) return null;
    return detalle.alerta.id === abierta.id ? detalle : null;
  });

  readonly alertaPanel = computed(() => this.detalleVigente()?.alerta ?? this.alertaAbierta());
  readonly demandasPanel = computed(() => this.detalleVigente()?.demandas ?? []);
  readonly cargandoDetalle = computed(
    () => this.detalle.estado() === 'cargando' && this.detalleVigente() === null,
  );
  readonly errorDetalle = this.detalle.error;

  readonly guardando = signal(false);
  readonly errorGuardado = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  readonly puedeModificarAbierta = computed(() => {
    const alerta = this.alertaPanel();
    return alerta ? this.capacidades.puedeModificar(alerta.clasificacion) : false;
  });

  private temporizador?: ReturnType<typeof setTimeout>;

  constructor() {
    this.destruccion.onDestroy(() => clearTimeout(this.temporizador));
  }

  formatearPlazo(horas: number | null): string {
    return formatearPlazoDe(horas);
  }

  claseEstado(estado: string): string {
    return claseEstadoDe(estado);
  }

  clavePrioridad(prioridad: Alerta['prioridad']): string {
    return clavePrioridadDe(prioridad);
  }

  abrir(alerta: Alerta): void {
    if (!alerta.id) return;
    this.errorGuardado.set(null);
    this.aviso.set(null);
    this.alertaAbierta.set(alerta);
    this.seleccionadaId.set(alerta.id);
  }

  cerrarPanel(): void {
    this.seleccionadaId.set(null);
    this.alertaAbierta.set(null);
    this.errorGuardado.set(null);
    this.aviso.set(null);
  }

  recargarListado(): void {
    this.listado.recargar();
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  recargarDetalle(): void {
    this.detalle.recargar();
  }

  guardar(cambios: PatchAlerta): void {
    const alerta = this.alertaPanel();
    if (!alerta) return;
    if (!this.puedeModificarAbierta()) {
      this.errorGuardado.set('Su rol no permite modificar esta alerta.');
      return;
    }

    const cuerpo: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor !== undefined) cuerpo[clave] = valor;
    }

    if (Object.keys(cuerpo).length === 0) {
      this.errorGuardado.set('No hay cambios que guardar.');
      return;
    }

    this.enviar(alerta.id, cuerpo);
  }

  accionFlujo(paso: number): void {
    const alerta = this.alertaPanel();
    if (!alerta) return;
    if (!this.puedeModificarAbierta()) {
      this.errorGuardado.set('Su rol no permite modificar esta alerta.');
      return;
    }
    this.enviar(alerta.id, { pasoActual: paso });
  }

  buscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      void this.actualizar({ q: valor, pagina: 1 });
    }, 300);
  }

  cambiarPrioridad(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ prioridad: valor, pagina: 1 });
  }

  cambiarNivel(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ nivel: valor, pagina: 1 });
  }

  cambiarEstado(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ estado: valor, pagina: 1 });
  }

  cambiarOrden(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ orden: valor, pagina: 1 });
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
    });
  }

  private enviar(id: string, cuerpo: Record<string, unknown>): void {
    this.guardando.set(true);
    this.errorGuardado.set(null);
    this.aviso.set(null);

    this.http.patch<unknown>(urlApi(`/v1/alerts/${encodeURIComponent(id)}`), cuerpo).subscribe({
      next: () => {
        this.guardando.set(false);
        this.aviso.set('Cambios guardados.');
        this.listado.recargar();
        this.detalle.recargar();
      },
      error: (fallo: unknown) => {
        this.guardando.set(false);
        this.errorGuardado.set(this.mensajeDeError(fallo));
      },
    });
  }

  private mensajeDeError(fallo: unknown): string {
    const error = aErrorApi(fallo);

    if (error.estado === 409 && error.codigo === 'ALERT_VISIBILITY') {
      return 'La alerta ya está publicada y no cumple el control de visibilidad (G21): falta la validación previa o la aprobación definitiva de la Dirección. No se guardó ningún cambio.';
    }

    if (error.esProhibido) return 'Su rol no permite modificar esta alerta.';

    return error.message;
  }

  private actualizar(cambios: Partial<FiltrosAlertas>): void {
    const siguiente = { ...this.parametros(), ...cambios };

    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        q: siguiente.q || null,
        prioridad: siguiente.prioridad || null,
        nivel: siguiente.nivel || null,
        estado: siguiente.estado || null,
        orden: siguiente.orden !== 'recent' ? siguiente.orden : null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
