import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import {
  TAMANO_PAGINA,
  normalizarColeccion,
  parametrosConValor,
  paramsDePagina,
  urlConParametros,
  type Coleccion,
} from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { formatearFechaCorta } from '../../dominio/mapeo';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import {
  AnularPanelComponent,
  type ResultadoAnulacion,
} from '../../shared/ui/anular-panel.component';
import { BarraSeleccionComponent } from '../../shared/ui/barra-seleccion.component';

import { IconoComponent } from '../../shared/ui/icono.component';
import { OrdenTabla } from '../../shared/ui/orden-tabla';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import { SeleccionTabla } from '../../shared/ui/seleccion-tabla';
import { ThOrdenDirective } from '../../shared/ui/th-orden.directive';
import {
  TerritorioBuscadorComponent,
  type OpcionTerritorio,
} from '../../shared/ui/territorio-buscador.component';
import { AccionesFilaComponent, type AccionFila } from './acciones-fila.component';
import { AlertaPanelComponent } from './alerta-panel.component';
import {
  ESTADOS_ALERTA,
  OPCIONES_NIVEL,
  ORDENES_ALERTA,
  PASO_APROBACION_DEFINITIVA,
  PRIORIDADES_ALERTA,
  aAlerta,
  aDetalleAlerta,
  aPrioridadesAlerta,
  accionesDeFlujo,
  clavePrioridad as clavePrioridadDe,
  etapaDeFlujo,
  etiquetaPrioridadConPlazo,
  formatearPlazo as formatearPlazoDe,
  type AccionFlujo,
  type Alerta,
  type AltaAlerta,
  type DetalleAlerta,
  type OpcionPrioridadAlerta,
  type PatchAlerta,
} from './alerta.mapeo';

type FiltrosAlertas = {
  q: string;
  prioridad: string;
  nivel: string;
  estado: string;
  /** `true` sólo sin caso asignado; `false`, sólo con caso. */
  sinCaso: string;
  orden: string;
  pagina: number;
  tamano: number;
  /** Sólo llega por URL; no hay control visible. Filtra el listado y presiembra el alta. */
  caso: string;
  /**
   * `core.distritos.id` exacto. No hay `<select>`: lo fija el buscador
   * territorial, que garantiza un id del catálogo INEI y no un nombre libre.
   */
  distritoId: string;
  /** Sólo para pintar la etiqueta del filtro restaurado desde la URL. */
  distritoNombre: string;
};

const FILTROS_INICIALES: FiltrosAlertas = {
  q: '',
  prioridad: '',
  nivel: '',
  estado: '',
  sinCaso: '',
  orden: 'recent',
  pagina: 1,
  tamano: TAMANO_PAGINA,
  caso: '',
  distritoId: '',
  distritoNombre: '',
};

/** `total` del sobre paginado sin construir las filas (consultas de indicadores). */
function totalDe(bruto: unknown): number {
  return normalizarColeccion<unknown>(bruto).total;
}

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
 * cuatro valores que el repositorio reconoce), `sort` y `caso` (código de caso,
 * sin control visible: llega por URL y también presiembra el alta).
 */
@Component({
  selector: 'app-alertas',
  imports: [
    IconoComponent,
    PaginacionComponent,
    AccionesFilaComponent,
    AlertaPanelComponent,
    AnularPanelComponent,
    BarraSeleccionComponent,
    ThOrdenDirective,
    TerritorioBuscadorComponent,
    RouterLink,
  ],
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
      font-size: 12px;
      font-weight: 600;
    }

    .alerta-caso small {
      margin-top: 3px;
      color: #99a3aa;
      font-size: 12px;
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
      font-size: 12px;
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
      font-size: 12px;
    }

    .aviso-ok {
      color: #2f6f52;
      font-size: 13.5px;
    }

    .celda-anular {
      white-space: nowrap;
      text-align: right;
    }

    .data-table tr.row-aviso-ok td {
      background: #f1f8f3;
    }

    .data-table tr.row-aviso-error td {
      background: #fdf2f1;
    }

    .tabla-nota {
      margin: 0 0 8px;
      color: #8d99a6;
      font-size: 12px;
    }

    /* El buscador territorial entra en la barra como un filtro más. */
    .territorio-filtro {
      width: 220px;
      min-width: 0;
    }

    .col-codigo {
      width: 100px;
    }
    .col-caso {
      width: 170px;
    }
    .col-prioridad {
      width: 160px;
    }
    .col-riesgo {
      width: 96px;
    }
    .col-fecha {
      width: 120px;
    }
    .col-estado {
      width: 120px;
    }
    .col-acciones {
      width: 92px;
    }

    /* Sólo «Atendida» en verde; el resto en ámbar o azul (item 106). */
    .estado-alerta--atendida {
      background: #edf6f0;
      color: #2f6f52;
    }

    .estado-alerta--aprobada,
    .estado-alerta--validada,
    .estado-alerta--revision,
    .estado-alerta--pendiente {
      background: #fff4e6;
      color: #9d702e;
    }

    .estado-alerta--revision {
      background: #eef3fa;
      color: #4a6b93;
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
  private readonly registroSolicitado = toSignal(
    this.ruta.queryParamMap.pipe(map((params) => params.get('registrar'))),
    { initialValue: null },
  );
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
        sinCaso: params.get('sinCaso') ?? '',
        orden: params.get('orden') ?? 'recent',
        pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
        tamano: Math.max(1, Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA),
        caso: params.get('caso') ?? '',
        distritoId: params.get('distritoId') ?? '',
        distritoNombre: params.get('distritoNombre') ?? '',
      })),
    ),
    { initialValue: FILTROS_INICIALES },
  );

  readonly filtros = computed(() => this.parametros());

  /** Etiqueta del filtro territorial restaurado desde la URL, si lo hay. */
  readonly distritoFiltroInicial = computed(() => {
    const filtros = this.filtros();
    if (!filtros.distritoId) return null;
    return {
      id: Number(filtros.distritoId),
      nombre: filtros.distritoNombre || `Distrito ${filtros.distritoId}`,
    };
  });

  /**
   * Filtros, búsqueda y orden vigentes, con los nombres que acepta
   * `GET /api/v1/alerts`. La exportación los reenvía para respetar la vista.
   */
  readonly filtrosExportacion = computed(() => {
    const filtros = this.filtros();
    return parametrosConValor({
      q: filtros.q,
      prioridad: filtros.prioridad,
      nivel: filtros.nivel,
      estado: filtros.estado,
      sinCaso: filtros.sinCaso,
      sort: filtros.orden,
      caso: filtros.caso,
      distritoId: filtros.distritoId,
    });
  });

  private readonly listado = consulta<Coleccion<Alerta>>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/alerts'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        q: filtros.q,
        prioridad: filtros.prioridad,
        nivel: filtros.nivel,
        estado: filtros.estado,
        sinCaso: filtros.sinCaso,
        sort: filtros.orden,
        caso: filtros.caso,
        distritoId: filtros.distritoId,
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

  /**
   * Indicadores de la pantalla (item 112). Son totales del servidor, no de la
   * página visible: cada tarjeta cuenta el mismo recorte de filtros con un
   * `estado` o `sinCaso` adicional, y se lee `total` con `pageSize=1`.
   */
  private contar(extra: Record<string, string>) {
    return consulta<number>({
      fuente: () => {
        const filtros = this.parametros();
        return urlConParametros(urlApi('/v1/alerts'), {
          ...paramsDePagina({ pagina: 1, tamano: 1 }),
          q: filtros.q,
          prioridad: filtros.prioridad,
          nivel: filtros.nivel,
          estado: filtros.estado,
          sort: filtros.orden,
          caso: filtros.caso,
          sinCaso: filtros.sinCaso,
          distritoId: filtros.distritoId,
          ...extra,
        });
      },
      esquema: totalDe,
    });
  }

  private readonly atendidasRec = this.contar({ estado: 'Atendida' });
  private readonly pendientesRec = this.contar({ estado: 'Pendiente de revisión' });
  private readonly sinCasoRec = this.contar({ sinCaso: 'true' });

  readonly atendidas = computed(() => this.atendidasRec.valor() ?? null);
  readonly pendientes = computed(() => this.pendientesRec.valor() ?? null);
  readonly sinCasoTotales = computed(() => this.sinCasoRec.valor() ?? null);

  /** Alerta abierta en el panel; `null` cierra el panel. */
  readonly alertaAbierta = signal<Alerta | null>(null);

  /** `true` mientras el panel muestra el formulario de alta. */
  readonly altaAbierta = signal(false);

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
   * panel nunca aparece vacío y, cuando llega `GET /:id`, se enriquece con los
   * datos completos. El detalle sólo se usa si corresponde a la alerta abierta,
   * para no enseñar datos de una fila anterior al cambiar de selección.
   */
  private readonly detalleVigente = computed(() => {
    const abierta = this.alertaAbierta();
    const detalle = this.detalle.valor();
    if (!abierta || !detalle) return null;
    return detalle.alerta.id === abierta.id ? detalle : null;
  });

  readonly alertaPanel = computed(() => this.detalleVigente()?.alerta ?? this.alertaAbierta());
  readonly cargandoDetalle = computed(
    () => this.detalle.estado() === 'cargando' && this.detalleVigente() === null,
  );
  readonly errorDetalle = this.detalle.error;

  /**
   * Prioridades del alta desde `GET /api/v1/catalogs` (`catalogs.prioridadesAlerta`).
   * Se pide sólo al abrir el alta: el listado no necesita tráfico adicional.
   */
  private readonly catalogoPrioridades = consulta<readonly OpcionPrioridadAlerta[]>({
    fuente: () => (this.altaAbierta() ? urlApi('/v1/catalogs') : null),
    esquema: aPrioridadesAlerta,
  });

  readonly prioridadesCatalogo = computed(() => this.catalogoPrioridades.valor() ?? []);
  readonly errorPrioridades = this.catalogoPrioridades.error;
  readonly cargandoPrioridades = computed(() => {
    const estado = this.catalogoPrioridades.estado();
    return estado === 'inactivo' || estado === 'cargando';
  });

  /** Código de caso con el que se presiembra el alta, si la URL trae `caso`. */
  readonly casoInicial = computed(() => this.filtros().caso);

  /** El panel se abre para editar una alerta o para registrar una nueva. */
  readonly panelAbierto = computed(() => this.altaAbierta() || this.alertaPanel() !== null);

  /** Registrar exige el permiso global de escritura; editar, además, la clasificación. */
  readonly puedePanel = computed(() =>
    this.altaAbierta() ? this.capacidades.puedeEditar() : this.puedeModificarAbierta(),
  );

  readonly guardando = signal(false);
  readonly errorGuardado = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  /**
   * Paso al que se puede volver tras un cambio de paso exitoso (item 23). Vive
   * sólo en memoria: se pierde al cerrar el panel o al recargar la página.
   */
  readonly pasoDeshacer = signal<number | null>(null);

  /** Confirmación del alta en el listado (el panel se cierra al guardar). */
  readonly avisoAlta = signal<string | null>(null);

  /** Feedback de las acciones por fila; vive en el listado, no en el panel. */
  readonly avisoFila = signal<{ id: string; texto: string; tipo: 'ok' | 'error' } | null>(null);
  readonly enviandoFila = signal<string | null>(null);

  /** Aprobación disparada desde una fila que espera confirmación explícita (item 23). */
  readonly aprobacionFila = signal<{ alerta: Alerta; paso: number } | null>(null);

  /**
   * Paso al que puede volver una fila tras un cambio de flujo exitoso. Sólo
   * guarda lo necesario: la alerta puede haber salido de la página visible al
   * recargar el listado. Vive en memoria y no promete persistencia.
   */
  readonly deshacerFila = signal<{ id: string; pasoPrevio: number; codigo: string } | null>(null);

  /** «Deshacer» sólo se ofrece si la fila sigue visible y el rol puede editarla. */
  readonly puedeDeshacerFila = computed(() => {
    const pendiente = this.deshacerFila();
    if (!pendiente) return false;
    const alerta = this.alertas().find((fila) => fila.id === pendiente.id);
    return alerta ? this.capacidades.puedeModificar(alerta.clasificacion) : false;
  });

  /** Alerta que se está anulando en el panel compartido. */
  readonly alertaAnulacion = signal<Alerta | null>(null);
  readonly enviandoAnulacion = signal(false);
  readonly errorAnulacion = signal<string | null>(null);
  readonly avisoAnulacion = signal<string | null>(null);

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  readonly puedeModificarAbierta = computed(() => {
    const alerta = this.alertaPanel();
    return alerta ? this.capacidades.puedeModificar(alerta.clasificacion) : false;
  });

  /** Botón de alta: basta el permiso global de escritura. */
  readonly puedeRegistrar = this.capacidades.puedeEditar;

  /** Selección de la tabla (página visible) para exportar o anular en lote. */
  readonly seleccion = new SeleccionTabla();

  /** Orden local de la página visible. */
  readonly orden = new OrdenTabla<Alerta>();

  private readonly accesoresAlerta: Record<string, (alerta: Alerta) => unknown> = {
    codigo: (alerta) => alerta.codigo,
    titulo: (alerta) => alerta.titulo,
    caso: (alerta) => alerta.casoCodigo,
    prioridad: (alerta) => alerta.prioridad,
    riesgo: (alerta) => alerta.nivel,
    fecha: (alerta) => alerta.fechaReporte,
    estado: (alerta) => alerta.estado,
  };

  readonly filasVisibles = computed(() => this.orden.ordenar(this.alertas(), this.accesoresAlerta));

  idsVisibles(): string[] {
    return this.alertas()
      .map((alerta) => alerta.id)
      .filter((id): id is string => !!id);
  }

  private temporizador?: ReturnType<typeof setTimeout>;

  constructor() {
    this.destruccion.onDestroy(() => clearTimeout(this.temporizador));
    effect(() => {
      if (this.registroSolicitado() !== 'alerta') return;
      this.abrirAlta();
      void this.router.navigate([], {
        relativeTo: this.ruta,
        queryParams: { registrar: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });
  }

  formatearPlazo(horas: number | null): string {
    return formatearPlazoDe(horas);
  }

  /** Prioridad con su plazo entre paréntesis (item 106). */
  etiquetaPrioridad(prioridad: Alerta['prioridad']): string {
    return etiquetaPrioridadConPlazo(prioridad);
  }

  /** Fecha de reporte en «18 nov 2026», sin el punto que añade `es-PE`. */
  fechaReporte(valor: string | null): string {
    return formatearFechaCorta(valor);
  }

  /**
   * Clases de estado propias de la tabla: «Atendida» en verde y ningún otro
   * estado en verde (item 106).
   */
  claseEstado(estado: string): string {
    switch (estado) {
      case 'Atendida':
        return 'estado-alerta--atendida';
      case 'Aprobada':
        return 'estado-alerta--aprobada';
      case 'Validada':
        return 'estado-alerta--validada';
      case 'En revisión':
        return 'estado-alerta--revision';
      default:
        return 'estado-alerta--pendiente';
    }
  }

  clavePrioridad(prioridad: Alerta['prioridad']): string {
    return clavePrioridadDe(prioridad);
  }

  /** Rótulo de la acción en la tabla; el flujo del panel conserva el suyo. */
  etiquetaAccion(accion: AccionFlujo): string {
    switch (accion.etiqueta) {
      case 'Enviar a aprobación definitiva':
        return 'Aprobar';
      case 'Devolver a validación previa':
        return 'Solicitar modificación';
      default:
        return accion.etiqueta;
    }
  }

  /** Acciones de flujo de la fila, ya rotuladas para el listado. */
  accionesFila(alerta: Alerta): readonly AccionFila[] {
    if (!this.capacidades.puedeModificar(alerta.clasificacion)) return [];
    return accionesDeFlujo(alerta.pasoActual).map((accion) => ({
      paso: accion.paso,
      etiqueta: this.etiquetaAccion(accion),
    }));
  }

  /** Clase de resaltado de la fila que acaba de recibir una acción. */
  claseAvisoFila(alerta: Alerta): string {
    const aviso = this.avisoFila();
    if (!aviso || aviso.id !== alerta.id) return '';
    return aviso.tipo === 'ok' ? 'row-aviso-ok' : 'row-aviso-error';
  }

  abrir(alerta: Alerta): void {
    if (!alerta.id) return;
    this.altaAbierta.set(false);
    this.errorGuardado.set(null);
    this.aviso.set(null);
    this.pasoDeshacer.set(null);
    this.aprobacionFila.set(null);
    this.deshacerFila.set(null);
    this.alertaAbierta.set(alerta);
    this.seleccionadaId.set(alerta.id);
  }

  /** Abre el alta (panel con `alerta === null`). */
  abrirAlta(): void {
    if (!this.capacidades.puedeEditar()) return;
    this.errorGuardado.set(null);
    this.aviso.set(null);
    this.pasoDeshacer.set(null);
    this.aprobacionFila.set(null);
    this.deshacerFila.set(null);
    this.avisoAlta.set(null);
    this.alertaAbierta.set(null);
    this.seleccionadaId.set(null);
    this.altaAbierta.set(true);
  }

  /** Las alertas se anulan con el privilegio de anulación y sobre su clasificación. */
  puedeAnular(alerta: Alerta): boolean {
    return (
      this.capacidades.puedeEliminar() && this.capacidades.puedeModificar(alerta.clasificacion)
    );
  }

  /**
   * Cambia de paso desde la fila. La aprobación definitiva no se envía aquí:
   * queda pendiente de confirmación explícita (item 23), igual que en el panel.
   */
  accionFila(alerta: Alerta, paso: number): void {
    if (!alerta.id || this.enviandoFila()) return;

    if (!this.capacidades.puedeModificar(alerta.clasificacion)) {
      this.avisoFila.set({
        id: alerta.id,
        texto: 'Su rol no permite modificar esta alerta.',
        tipo: 'error',
      });
      return;
    }

    // Cualquier acción nueva descarta el deshacer y la confirmación anteriores.
    this.deshacerFila.set(null);

    if (paso === PASO_APROBACION_DEFINITIVA) {
      this.avisoFila.set(null);
      this.aprobacionFila.set({ alerta, paso });
      return;
    }

    this.aprobacionFila.set(null);
    this.enviarAccionFila(alerta, paso, alerta.pasoActual);
  }

  /** La confirmación de la fila ejecuta el mismo PATCH que `accionFila`. */
  confirmarAprobacionFila(): void {
    const pendiente = this.aprobacionFila();
    if (!pendiente || this.enviandoFila()) return;

    const { alerta, paso } = pendiente;
    this.aprobacionFila.set(null);
    if (!alerta.id) return;

    if (!this.capacidades.puedeModificar(alerta.clasificacion)) {
      this.avisoFila.set({
        id: alerta.id,
        texto: 'Su rol no permite modificar esta alerta.',
        tipo: 'error',
      });
      return;
    }

    this.deshacerFila.set(null);
    this.enviarAccionFila(alerta, paso, alerta.pasoActual);
  }

  cancelarAprobacionFila(): void {
    this.aprobacionFila.set(null);
  }

  /**
   * Deshace el último cambio de flujo de la fila. Es otro PATCH con
   * `pasoActual`; recarga el listado y, si la alerta está abierta, el detalle.
   */
  deshacerAccionFila(): void {
    const pendiente = this.deshacerFila();
    if (!pendiente || this.enviandoFila() || !this.puedeDeshacerFila()) return;

    const alerta = this.alertas().find((fila) => fila.id === pendiente.id);
    if (!alerta) {
      this.deshacerFila.set(null);
      return;
    }

    this.deshacerFila.set(null);
    this.aprobacionFila.set(null);
    this.enviandoFila.set(alerta.id);
    this.avisoFila.set(null);

    this.patchAlerta(alerta.id, { pasoActual: pendiente.pasoPrevio }).subscribe({
      next: () => {
        this.enviandoFila.set(null);
        const etapa = etapaDeFlujo(pendiente.pasoPrevio);
        const destino = etapa
          ? `paso ${pendiente.pasoPrevio} · ${etapa.nombre}`
          : `paso ${pendiente.pasoPrevio}`;
        this.avisoFila.set({
          id: alerta.id,
          texto: `${pendiente.codigo}: restaurado a ${destino}.`,
          tipo: 'ok',
        });
        this.listado.recargar();
        if (this.seleccionadaId() === alerta.id) this.detalle.recargar();
      },
      error: (fallo: unknown) => {
        this.enviandoFila.set(null);
        this.avisoFila.set({ id: alerta.id, texto: this.mensajeDeError(fallo), tipo: 'error' });
      },
    });
  }

  /** PATCH común de las acciones de flujo de la fila. */
  private enviarAccionFila(alerta: Alerta, paso: number, pasoPrevio: number): void {
    this.enviandoFila.set(alerta.id);
    this.avisoFila.set(null);

    this.patchAlerta(alerta.id, { pasoActual: paso }).subscribe({
      next: () => {
        this.enviandoFila.set(null);
        const etapa = etapaDeFlujo(paso);
        const codigo = alerta.codigo || alerta.titulo || 'La alerta';
        const destino = etapa ? `paso ${paso} · ${etapa.nombre}` : `paso ${paso}`;
        this.avisoFila.set({
          id: alerta.id,
          texto: `${codigo}: ${destino}. Puede deshacer este cambio de paso.`,
          tipo: 'ok',
        });
        this.deshacerFila.set({ id: alerta.id, pasoPrevio, codigo });
        this.listado.recargar();
        if (this.seleccionadaId() === alerta.id) this.detalle.recargar();
      },
      error: (fallo: unknown) => {
        this.enviandoFila.set(null);
        this.avisoFila.set({ id: alerta.id, texto: this.mensajeDeError(fallo), tipo: 'error' });
      },
    });
  }

  abrirAnulacion(alerta: Alerta): void {
    if (!alerta.id || !this.puedeAnular(alerta)) return;
    this.aprobacionFila.set(null);
    this.deshacerFila.set(null);
    this.errorAnulacion.set(null);
    this.avisoAnulacion.set(null);
    this.alertaAnulacion.set(alerta);
  }

  cerrarAnulacion(): void {
    this.alertaAnulacion.set(null);
    this.errorAnulacion.set(null);
  }

  /**
   * `DELETE /api/v1/alerts/{id}` con `{ motivo }`: es la anulación lógica. La
   * regla de producto y cualquier rechazo del backend se muestran tal cual;
   * la UI no inventa restricciones que el servidor no aplique.
   */
  confirmarAnulacion(resultado: ResultadoAnulacion): void {
    const alerta = this.alertaAnulacion();
    if (!alerta || resultado.modo !== 'anular') return;

    const motivo = (resultado.motivo ?? '').trim();
    if (!motivo) return;

    this.enviandoAnulacion.set(true);
    this.errorAnulacion.set(null);

    this.http
      .delete<unknown>(urlApi(`/v1/alerts/${encodeURIComponent(alerta.id)}`), {
        body: { motivo },
      })
      .subscribe({
        next: () => {
          this.enviandoAnulacion.set(false);
          this.alertaAnulacion.set(null);
          if (this.alertaAbierta()?.id === alerta.id) this.cerrarPanel();
          this.pasoDeshacer.set(null);
          this.aprobacionFila.set(null);
          this.deshacerFila.set(null);
          this.avisoAnulacion.set(
            `Alerta ${alerta.codigo || 'seleccionada'} anulada. Puede restaurarse desde el Archivo.`,
          );
          this.listado.recargar();
        },
        error: (fallo: unknown) => {
          this.enviandoAnulacion.set(false);
          this.errorAnulacion.set(aErrorApi(fallo).message);
        },
      });
  }

  cerrarPanel(): void {
    this.altaAbierta.set(false);
    this.seleccionadaId.set(null);
    this.alertaAbierta.set(null);
    this.errorGuardado.set(null);
    this.aviso.set(null);
    this.pasoDeshacer.set(null);
  }

  recargarListado(): void {
    this.aprobacionFila.set(null);
    this.deshacerFila.set(null);
    this.listado.recargar();
  }

  alAnularLote(cantidad: number): void {
    this.seleccion.limpiar();
    this.pasoDeshacer.set(null);
    this.aprobacionFila.set(null);
    this.deshacerFila.set(null);
    this.avisoAnulacion.set(
      cantidad === 1
        ? '1 registro anulado. Puede restaurarse desde el Archivo.'
        : `${cantidad} registros anulados. Pueden restaurarse desde el Archivo.`,
    );
    this.recargarListado();
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

  /**
   * `POST /api/v1/alerts` (alta). Al guardar se cierra el panel, se recarga el
   * listado y se deja un aviso con `role="status"`. En error, el panel sigue
   * abierto y muestra `aErrorApi(fallo).message`.
   */
  /**
   * Aviso del alta. Si la alerta quedó en un distrito distinto del caso, se
   * declara aquí: el formulario no puede preguntarlo antes de guardar porque no
   * conoce el distrito del caso, y la alerta pudo heredarlo o elegirlo a mano.
   */
  private mensajeAlta(respuesta: unknown): string {
    const { alerta } = aDetalleAlerta(respuesta);
    if (alerta.distritoCoincideConCaso === false) {
      return `Alerta ${alerta.codigo} registrada. El distrito de la alerta (${alerta.distrito}) no coincide con el del caso (${alerta.casoDistrito}): revise la vinculación.`;
    }
    if (alerta.distrito) {
      return `Alerta ${alerta.codigo} registrada en ${alerta.distrito}.`;
    }
    return 'Alerta registrada. El listado se actualizó.';
  }

  registrarAlerta(cuerpo: AltaAlerta): void {
    if (!this.capacidades.puedeEditar()) {
      this.errorGuardado.set('Su rol no permite registrar alertas.');
      return;
    }

    this.guardando.set(true);
    this.errorGuardado.set(null);
    this.aviso.set(null);
    this.avisoAlta.set(null);

    this.http.post<unknown>(urlApi('/v1/alerts'), cuerpo).subscribe({
      next: (respuesta) => {
        this.guardando.set(false);
        this.altaAbierta.set(false);
        this.errorGuardado.set(null);
        this.listado.recargar();
        this.avisoAlta.set(this.mensajeAlta(respuesta));
      },
      error: (fallo: unknown) => {
        this.guardando.set(false);
        this.errorGuardado.set(aErrorApi(fallo).message);
      },
    });
  }

  accionFlujo(paso: number): void {
    const alerta = this.alertaPanel();
    if (!alerta) return;
    if (!this.puedeModificarAbierta()) {
      this.errorGuardado.set('Su rol no permite modificar esta alerta.');
      return;
    }
    // Se recuerda el paso de origen para ofrecer «Deshacer» si el PATCH va bien.
    this.enviar(alerta.id, { pasoActual: paso }, alerta.pasoActual);
  }

  /**
   * Vuelve al paso anterior tras un cambio exitoso. Es otro PATCH con
   * `pasoActual`; no toca contenido ni promete persistencia del deshacer.
   */
  deshacerPaso(): void {
    const alerta = this.alertaPanel();
    const anterior = this.pasoDeshacer();
    if (!alerta || anterior === null || this.guardando()) return;
    if (!this.puedeModificarAbierta()) {
      this.errorGuardado.set('Su rol no permite modificar esta alerta.');
      return;
    }

    this.guardando.set(true);
    this.errorGuardado.set(null);
    this.aviso.set(null);
    this.pasoDeshacer.set(null);
    this.aprobacionFila.set(null);
    this.deshacerFila.set(null);

    this.http
      .patch<unknown>(urlApi(`/v1/alerts/${encodeURIComponent(alerta.id)}`), {
        pasoActual: anterior,
      })
      .subscribe({
        next: () => {
          this.guardando.set(false);
          const etapa = etapaDeFlujo(anterior);
          this.aviso.set(
            etapa ? `Paso restaurado: ${etapa.nombre}.` : `Paso restaurado al ${anterior}.`,
          );
          this.listado.recargar();
          this.detalle.recargar();
        },
        error: (fallo: unknown) => {
          this.guardando.set(false);
          this.errorGuardado.set(this.mensajeDeError(fallo));
        },
      });
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

  cambiarSinCaso(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ sinCaso: valor, pagina: 1 });
  }

  cambiarEstado(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ estado: valor, pagina: 1 });
  }

  cambiarOrden(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ orden: valor, pagina: 1 });
  }

  /**
   * El buscador sólo emite distritos: `core.alertas_tempranas.distrito_id` no
   * admite lugares operativos. Un lugar limpia el filtro en vez de degradarse a
   * su distrito.
   */
  alElegirDistrito(opcion: OpcionTerritorio | null): void {
    const distrito = opcion?.tipo === 'distrito' ? opcion : null;
    void this.actualizar({
      distritoId: distrito ? String(distrito.id) : '',
      distritoNombre: distrito ? distrito.nombre : '',
      pagina: 1,
    });
  }

  cambiarPagina(pagina: number): void {
    void this.actualizar({ pagina });
  }

  cambiarTamano(tamano: number): void {
    void this.actualizar({ tamano, pagina: 1 });
  }

  limpiar(): void {
    clearTimeout(this.temporizador);
    this.avisoFila.set(null);
    this.aprobacionFila.set(null);
    this.deshacerFila.set(null);
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {},
    });
  }

  /**
   * `pasoPrevio` sólo viaja cuando el PATCH es un cambio de paso: es el paso
   * desde el que se ofrece «Deshacer». En una edición de contenido queda
   * ausente y el aviso no ofrece volver.
   */
  private enviar(id: string, cuerpo: Record<string, unknown>, pasoPrevio?: number): void {
    this.guardando.set(true);
    this.errorGuardado.set(null);
    this.aviso.set(null);
    this.pasoDeshacer.set(null);
    this.aprobacionFila.set(null);
    this.deshacerFila.set(null);

    this.patchAlerta(id, cuerpo).subscribe({
      next: () => {
        this.guardando.set(false);
        if (pasoPrevio === undefined) {
          this.aviso.set('Cambios guardados.');
        } else {
          const destino = cuerpo['pasoActual'];
          const etapa = typeof destino === 'number' ? etapaDeFlujo(destino) : null;
          const codigo = this.alertaPanel()?.codigo || 'La alerta';
          const destinoTexto = etapa
            ? `Paso ${String(destino)} · ${etapa.nombre}`
            : `Paso ${String(destino)}`;
          this.aviso.set(`${codigo}: ${destinoTexto}. Puede deshacer este cambio de paso.`);
          this.pasoDeshacer.set(pasoPrevio);
        }
        this.listado.recargar();
        this.detalle.recargar();
      },
      error: (fallo: unknown) => {
        this.guardando.set(false);
        this.errorGuardado.set(this.mensajeDeError(fallo));
      },
    });
  }

  private patchAlerta(id: string, cuerpo: Record<string, unknown>) {
    return this.http.patch<unknown>(urlApi(`/v1/alerts/${encodeURIComponent(id)}`), cuerpo);
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
    this.avisoFila.set(null);
    this.aprobacionFila.set(null);
    this.deshacerFila.set(null);

    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        q: siguiente.q || null,
        prioridad: siguiente.prioridad || null,
        nivel: siguiente.nivel || null,
        estado: siguiente.estado || null,
        sinCaso: siguiente.sinCaso || null,
        orden: siguiente.orden !== 'recent' ? siguiente.orden : null,
        distritoId: siguiente.distritoId || null,
        distritoNombre: siguiente.distritoNombre || null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
