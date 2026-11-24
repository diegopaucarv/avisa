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
import { SesionStore } from '../../core/auth/sesion.store';
import { ROL, CapacidadesService } from '../../core/permisos/capacidades.service';
import { RIESGOS, aCaso, formatearFechaCorta } from '../../dominio/mapeo';
import type { Riesgo } from '../../dominio/modelos';
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
import { AccionesFilaComponent, type AccionMenu } from './acciones-fila.component';
import { AlertaArchivoComponent } from './alerta-archivo.component';
import { AlertaModificacionComponent } from './alerta-modificacion.component';
import {
  AlertaPanelComponent,
  type CasoOpcion,
  type ModoPanelAlerta,
} from './alerta-panel.component';
import { AlertaWhatsappComponent } from './alerta-whatsapp.component';
import {
  ESTADOS_ALERTA,
  ORDENES_ALERTA,
  PASO_APROBACION_DEFINITIVA,
  PASO_REVISION,
  aAlerta,
  aDetalleAlerta,
  claseEstado,
  claveRiesgo,
  etapaDeFlujo,
  etiquetaEstado,
  geografiaAlerta,
  plantillaWhatsapp,
  tituloLimpio,
  type Alerta,
  type AltaAlerta,
  type DetalleAlerta,
  type PatchAlerta,
} from './alerta.mapeo';

type FiltrosAlertas = {
  q: string;
  riesgo: string;
  estado: string;
  orden: string;
  pagina: number;
  tamano: number;
  /** Sólo llega por URL: filtra el listado y presiembra el alta. */
  caso: string;
  /** `true` sólo sin caso, `false` sólo con caso; vacío, todos. */
  sinCaso: string;
  /** `true` muestra las archivadas; vacío, la cola de trabajo. */
  archivados: string;
};

const FILTROS_INICIALES: FiltrosAlertas = {
  q: '',
  riesgo: '',
  estado: '',
  orden: 'recent',
  pagina: 1,
  tamano: TAMANO_PAGINA,
  caso: '',
  sinCaso: '',
  archivados: '',
};

/**
 * Claves que cualquier perfil puede editar sin exigir la clasificación del
 * contenido narrativo. Backend debe aceptarlas en `PATCH /v1/alerts/:id`.
 */
const CLAVES_METADATOS = new Set([
  'riesgo',
  'alcance',
  'region',
  'provincia',
  'casoCode',
  'distritoId',
  'plantillaWhatsapp',
]);

/** `total` del sobre paginado sin construir las filas (consultas de indicadores). */
function totalDe(bruto: unknown): number {
  return normalizarColeccion<unknown>(bruto).total;
}

/**
 * Alertas tempranas (RED-RADAR PRODUCE).
 *
 * Listado con paginación de servidor y filtros en la URL (`replaceUrl`). Al
 * pulsar una fila no se navega: se abre `AlertaPanelComponent` como panel
 * El eje de riesgo es el del caso vinculado: Bajo · Medio · Alto.
 */
@Component({
  selector: 'app-alertas',
  imports: [
    IconoComponent,
    PaginacionComponent,
    AccionesFilaComponent,
    AlertaPanelComponent,
    AlertaArchivoComponent,
    AlertaModificacionComponent,
    AlertaWhatsappComponent,
    AnularPanelComponent,
    BarraSeleccionComponent,
    ThOrdenDirective,
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
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .view-head h1 {
      margin: 0;
    }

    .alerta-titulo {
      min-width: 240px;
      max-width: 460px;
      white-space: normal;
    }

    .alerta-titulo strong {
      display: block;
      color: #17283a;
      font-size: 13.5px;
      font-weight: 700;
      line-height: 1.35;
    }

    .alerta-geografia {
      display: inline-flex;
      align-items: center;
      margin-top: 4px;
      padding: 1px 7px;
      border-radius: 999px;
      background: #eef3fa;
      color: #4a6b93;
      font-size: 11px;
      font-weight: 700;
    }

    .alerta-riesgo {
      display: inline-flex;
      align-items: center;
      margin-top: 5px;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
    }

    .alerta-caso strong {
      display: block;
      color: #465a6c;
      font-size: 12px;
      font-weight: 600;
    }

    .alerta-caso small {
      display: block;
      margin-top: 3px;
      color: #99a3aa;
      font-size: 12px;
    }

    .sin-caso {
      color: #99a3aa;
      font-size: 12.5px;
      font-style: italic;
    }

    .alerta-archivada {
      display: block;
      margin-top: 4px;
      width: fit-content;
      padding: 1px 7px;
      border-radius: 999px;
      background: #eef1f4;
      color: #526577;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }

    .alerta-revisor {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .alerta-revisor strong {
      color: #33475b;
      font-size: 12.5px;
      font-weight: 600;
    }

    .alerta-revisor small {
      color: #99a3aa;
      font-size: 11.5px;
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

    .alerta-guia {
      margin: 2px 0 0;
      color: #8d99a6;
      font-size: 12.5px;
    }

    .aviso-ok {
      color: #2f6f52;
      font-size: 13.5px;
    }

    .celda-acciones {
      white-space: nowrap;
      text-align: right;
    }

    .data-table tr.row-aviso-ok td {
      background: #f1f8f3;
    }

    .data-table tr.row-aviso-error td {
      background: #fdf2f1;
    }

    .col-codigo {
      width: 108px;
    }
    .col-caso {
      width: 160px;
    }
    .col-revisor {
      width: 150px;
    }
    .col-fecha {
      width: 120px;
    }
    .col-estado {
      width: 130px;
    }
    .col-acciones {
      width: 72px;
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
  private readonly sesion = inject(SesionStore);

  readonly estados = ESTADOS_ALERTA;
  readonly ordenes = ORDENES_ALERTA;
  readonly riesgos = RIESGOS;

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({
        q: params.get('q') ?? '',
        riesgo: params.get('riesgo') ?? '',
        estado: params.get('estado') ?? '',
        orden: params.get('orden') ?? 'recent',
        pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
        tamano: Math.max(1, Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA),
        caso: params.get('caso') ?? '',
        sinCaso: params.get('sinCaso') ?? '',
        archivados: params.get('archivados') ?? '',
      })),
    ),
    { initialValue: FILTROS_INICIALES },
  );

  readonly filtros = computed(() => this.parametros());

  /** Filtros vigentes con los nombres que acepta `GET /api/v1/alerts`. */
  readonly filtrosExportacion = computed(() => {
    const filtros = this.filtros();
    return parametrosConValor({
      q: filtros.q,
      riesgo: filtros.riesgo,
      estado: filtros.estado,
      sort: filtros.orden,
      caso: filtros.caso,
      sinCaso: filtros.sinCaso,
    });
  });

  private readonly listado = consulta<Coleccion<Alerta>>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/alerts'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        q: filtros.q,
        riesgo: filtros.riesgo,
        estado: filtros.estado,
        sort: filtros.orden,
        caso: filtros.caso,
        sinCaso: filtros.sinCaso,
        archivados: filtros.archivados,
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

  /** Indicadores: totales del servidor con el mismo recorte de filtros. */
  private contar(extra: Record<string, string>) {
    return consulta<number>({
      fuente: () => {
        const filtros = this.parametros();
        return urlConParametros(urlApi('/v1/alerts'), {
          ...paramsDePagina({ pagina: 1, tamano: 1 }),
          q: filtros.q,
          riesgo: filtros.riesgo,
          estado: filtros.estado,
          sort: filtros.orden,
          caso: filtros.caso,
          sinCaso: filtros.sinCaso,
          archivados: filtros.archivados,
          ...extra,
        });
      },
      esquema: totalDe,
    });
  }

  private readonly atendidasRec = this.contar({ estado: 'Atendida' });
  private readonly pendientesRec = this.contar({ estado: 'Pendiente de revisión' });

  // Segmento «Con caso» / «Sin caso»: respeta el resto de filtros y el archivo
  // vigente; el propio segmento se ignora para que los conteos sean comparables.
  private readonly conCasoRec = this.contar({ sinCaso: 'false' });
  private readonly sinCasoRec = this.contar({ sinCaso: 'true' });

  readonly atendidas = computed(() => this.atendidasRec.valor() ?? null);
  readonly pendientes = computed(() => this.pendientesRec.valor() ?? null);
  readonly conCaso = computed(() => this.conCasoRec.valor() ?? null);
  readonly sinCaso = computed(() => this.sinCasoRec.valor() ?? null);

  /** Total del segmento «Todos»: con caso + sin caso bajo los filtros vigentes. */
  readonly totalActivas = computed(() => {
    const conCaso = this.conCaso();
    const sinCaso = this.sinCaso();
    return conCaso === null || sinCaso === null ? null : conCaso + sinCaso;
  });

  /** Alerta abierta en el panel; `null` cierra el panel. */
  readonly alertaAbierta = signal<Alerta | null>(null);

  /** `true` mientras el panel muestra el formulario de alta. */
  readonly altaAbierta = signal(false);

  /** Modo con el que el panel abre la alerta. */
  readonly modoPanel = signal<ModoPanelAlerta>('ver');

  /** Identificador de la fila abierta; se usa para resaltarla en la tabla. */
  readonly seleccionadaId = signal<string | null>(null);

  /** El panel se abre para editar una alerta o para registrar una nueva. */
  readonly panelAbierto = computed(() => this.altaAbierta() || this.alertaPanel() !== null);

  private readonly detalle = consulta<DetalleAlerta>({
    fuente: () => {
      const id = this.seleccionadaId();
      return id ? urlApi(`/v1/alerts/${encodeURIComponent(id)}`) : null;
    },
    esquema: aDetalleAlerta,
  });

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

  /** Casos para el selector «Caso vinculado»; se piden al abrir el panel. */
  private readonly catalogoCasos = consulta<readonly CasoOpcion[]>({
    fuente: () =>
      this.panelAbierto()
        ? urlConParametros(urlApi('/v1/cases'), { ...paramsDePagina({ pagina: 1, tamano: 200 }) })
        : null,
    esquema: (bruto) =>
      normalizarColeccion<unknown>(bruto)
        .elementos.map(aCaso)
        .map((caso) => ({ codigo: caso.codigo, titulo: caso.titulo }))
        .filter((caso) => caso.codigo.length > 0),
  });

  readonly casos = computed(() => this.catalogoCasos.valor() ?? []);

  /** Código de caso con el que se presiembra el alta, si la URL trae `caso`. */
  readonly casoInicial = computed(() => this.filtros().caso);

  /** Editar contenido exige la clasificación; editar metadatos no. */
  readonly puedeModificarAbierta = computed(() => {
    const alerta = this.alertaPanel();
    return alerta ? this.capacidades.puedeModificar(alerta.clasificacion) : false;
  });

  readonly puedePanel = computed(() =>
    this.altaAbierta() ? this.capacidades.puedeEditar() : this.puedeModificarAbierta(),
  );

  readonly guardando = signal(false);
  readonly errorGuardado = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  /** Confirmación del alta en el listado (el panel se cierra al guardar). */
  readonly avisoAlta = signal<string | null>(null);

  /** Feedback de las acciones por fila. */
  readonly avisoFila = signal<{ id: string; texto: string; tipo: 'ok' | 'error' } | null>(null);
  readonly enviandoFila = signal<string | null>(null);

  /** Aprobación disparada desde una fila que espera confirmación explícita. */
  readonly aprobacionFila = signal<{ alerta: Alerta; paso: number } | null>(null);

  /** Paso al que puede volver una fila tras un cambio de flujo exitoso. */
  readonly deshacerFila = signal<{ id: string; pasoPrevio: number; codigo: string } | null>(null);

  readonly puedeDeshacerFila = computed(() => {
    const pendiente = this.deshacerFila();
    if (!pendiente) return false;
    const alerta = this.alertas().find((fila) => fila.id === pendiente.id);
    return alerta ? this.capacidades.puedeModificar(alerta.clasificacion) : false;
  });

  /** «Solicitar modificación»: alerta abierta en su ventana dedicada. */
  readonly alertaModificacion = signal<Alerta | null>(null);
  readonly enviandoModificacion = signal(false);
  readonly errorModificacion = signal<string | null>(null);

  /** Alerta abierta en la ventana de WhatsApp. */
  readonly alertaWhatsapp = signal<Alerta | null>(null);

  /** Alerta que se está anulando en el panel compartido. */
  readonly alertaAnulacion = signal<Alerta | null>(null);
  readonly enviandoAnulacion = signal(false);
  readonly errorAnulacion = signal<string | null>(null);
  readonly avisoAnulacion = signal<string | null>(null);

  /** Alerta que se está archivando o devolviendo a las colas de trabajo. */
  readonly alertaArchivo = signal<Alerta | null>(null);
  readonly enviandoArchivo = signal(false);
  readonly errorArchivo = signal<string | null>(null);
  readonly avisoArchivo = signal<string | null>(null);

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  /** Botón de alta: basta el permiso global de escritura. */
  readonly puedeRegistrar = this.capacidades.puedeEditar;

  /**
   * «Edith» y la Dirección OAIPCS comparten rol. Aprobar y solicitar
   * modificación quedan reservados a este conjunto (la alta dirección y el
   * administrador también lo ven, como en `core.roles`).
   */
  readonly esDirectora = computed(() => {
    const roles = this.sesion.roles();
    return (
      roles.includes(ROL.direccionOaipcs) ||
      roles.includes(ROL.altaDireccion) ||
      roles.includes(ROL.administrador)
    );
  });

  /** Selección de la tabla (página visible) para exportar o anular en lote. */
  readonly seleccion = new SeleccionTabla();

  /** Orden local de la página visible. */
  readonly orden = new OrdenTabla<Alerta>();

  private readonly accesoresAlerta: Record<string, (alerta: Alerta) => unknown> = {
    codigo: (alerta) => alerta.codigo,
    titulo: (alerta) => alerta.titulo,
    caso: (alerta) => alerta.casoCodigo,
    revisor: (alerta) => alerta.ultimoRevisor,
    fecha: (alerta) => alerta.fechaReporte,
    estado: (alerta) => alerta.estado,
    riesgo: (alerta) => this.pesoRiesgo(alerta.riesgo),
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

  /* ---------------------------------------------------------------------- *
   * Presentación
   * ---------------------------------------------------------------------- */

  fechaReporte(valor: string | null): string {
    return formatearFechaCorta(valor);
  }

  tituloAlerta(alerta: Alerta): string {
    return tituloLimpio(alerta.titulo) || 'Sin título';
  }

  geografia(alerta: Alerta): string {
    return geografiaAlerta(alerta);
  }

  etiquetaEstadoAlerta(alerta: Alerta): string {
    return etiquetaEstado(alerta.estado);
  }

  /** Rótulo corto del estado en el filtro; el valor sigue siendo el canónico. */
  etiquetaEstadoFiltro(estado: string): string {
    return etiquetaEstado(estado);
  }

  claseEstadoAlerta(alerta: Alerta): string {
    return `status-badge ${claseEstado(alerta.estado)}`;
  }

  claseRiesgo(alerta: Alerta): string {
    return `alerta-riesgo risk-${claveRiesgo(alerta.riesgo)}`;
  }

  private pesoRiesgo(riesgo: Riesgo): number {
    switch (riesgo) {
      case 'Alto':
        return 0;
      case 'Medio':
        return 1;
      default:
        return 2;
    }
  }

  /* ---------------------------------------------------------------------- *
   * Acciones de fila
   * ---------------------------------------------------------------------- */

  accionesFila(alerta: Alerta): readonly AccionMenu[] {
    const acciones: AccionMenu[] = [];

    if (this.esDirectora()) {
      if (alerta.pasoActual < PASO_APROBACION_DEFINITIVA) {
        acciones.push({ id: 'aprobar', etiqueta: 'Aprobar alerta', seccion: 'Dirección OAIPCS' });
      }
      acciones.push({
        id: 'solicitar-modificacion',
        etiqueta: 'Solicitar modificación',
        seccion: 'Dirección OAIPCS',
      });
      // La Dirección puede devolver la alerta a revisión en cualquier momento.
      acciones.push({
        id: 'enviar-revision',
        etiqueta: 'Enviar a revisión',
        seccion: 'Dirección OAIPCS',
      });
    }

    acciones.push(
      { id: 'modificar', etiqueta: 'Modificar', seccion: 'Gestión' },
      { id: 'historial', etiqueta: 'Ver historial', seccion: 'Gestión' },
      { id: 'whatsapp', etiqueta: 'Enviar por WhatsApp', seccion: 'Gestión' },
    );

    if (this.puedeArchivar(alerta)) {
      acciones.push({
        id: 'archivar',
        etiqueta: alerta.archivadoEn ? 'Quitar del archivo' : 'Archivar sin caso',
        seccion: 'Gestión',
      });
    }

    return acciones;
  }

  accionFila(alerta: Alerta, id: AccionMenu['id']): void {
    if (!alerta.id) return;

    switch (id) {
      case 'aprobar':
        this.pedirAprobacionFila(alerta);
        break;
      case 'solicitar-modificacion':
        this.abrirModificacion(alerta);
        break;
      case 'enviar-revision':
        this.enviarAccionFila(alerta, PASO_REVISION, alerta.pasoActual);
        break;
      case 'modificar':
        this.abrir(alerta, 'editar');
        break;
      case 'historial':
        this.abrir(alerta, 'historial');
        break;
      case 'whatsapp':
        this.abrirWhatsapp(alerta);
        break;
      case 'archivar':
        this.abrirArchivo(alerta);
        break;
    }
  }

  claseAvisoFila(alerta: Alerta): string {
    const aviso = this.avisoFila();
    if (!aviso || aviso.id !== alerta.id) return '';
    return aviso.tipo === 'ok' ? 'row-aviso-ok' : 'row-aviso-error';
  }

  abrir(alerta: Alerta, modo: ModoPanelAlerta = 'ver'): void {
    if (!alerta.id) return;
    this.altaAbierta.set(false);
    this.errorGuardado.set(null);
    this.aviso.set(null);
    this.aprobacionFila.set(null);
    this.deshacerFila.set(null);
    this.modoPanel.set(modo);
    this.alertaAbierta.set(alerta);
    this.seleccionadaId.set(alerta.id);
  }

  /** Abre el alta (panel con `alerta === null`). */
  abrirAlta(): void {
    if (!this.capacidades.puedeEditar()) return;
    this.errorGuardado.set(null);
    this.aviso.set(null);
    this.aprobacionFila.set(null);
    this.deshacerFila.set(null);
    this.avisoAlta.set(null);
    this.modoPanel.set('ver');
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
   * Archivar sólo aplica a alertas sin caso vinculado y vigentes (no anuladas).
   * Desarchivar siempre se permite: devuelve la fila a las colas aunque mientras
   * tanto haya ganado un caso. Archivar no es anular: no exige el privilegio de
   * borrado, sino de escritura.
   */
  puedeArchivar(alerta: Alerta): boolean {
    if (!this.capacidades.puedeModificar(alerta.clasificacion)) return false;
    if (alerta.archivadoEn) return !alerta.anuladoEn;
    return !alerta.casoId && !alerta.anuladoEn;
  }

  /* ---------------------------------------------------------------------- *
   * Aprobación / envío a revisión
   * ---------------------------------------------------------------------- */

  private pedirAprobacionFila(alerta: Alerta): void {
    if (!this.capacidades.puedeModificar(alerta.clasificacion)) {
      this.avisoFila.set({
        id: alerta.id,
        texto: 'Su rol no permite aprobar esta alerta.',
        tipo: 'error',
      });
      return;
    }
    this.deshacerFila.set(null);
    this.avisoFila.set(null);
    this.aprobacionFila.set({ alerta, paso: PASO_APROBACION_DEFINITIVA });
  }

  confirmarAprobacionFila(): void {
    const pendiente = this.aprobacionFila();
    if (!pendiente || this.enviandoFila()) return;

    const { alerta, paso } = pendiente;
    this.aprobacionFila.set(null);
    if (!alerta.id) return;

    if (!this.capacidades.puedeModificar(alerta.clasificacion)) {
      this.avisoFila.set({
        id: alerta.id,
        texto: 'Su rol no permite aprobar esta alerta.',
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
    if (!alerta.id) return;
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

  /* ---------------------------------------------------------------------- *
   * Ventanas dedicadas
   * ---------------------------------------------------------------------- */

  abrirModificacion(alerta: Alerta): void {
    if (!alerta.id || !this.esDirectora()) return;
    this.errorModificacion.set(null);
    this.alertaModificacion.set(alerta);
  }

  cerrarModificacion(): void {
    if (this.enviandoModificacion()) return;
    this.alertaModificacion.set(null);
    this.errorModificacion.set(null);
  }

  enviarModificacion(motivo: string): void {
    const alerta = this.alertaModificacion();
    if (!alerta || !motivo.trim() || this.enviandoModificacion()) return;

    this.enviandoModificacion.set(true);
    this.errorModificacion.set(null);

    this.patchAlerta(alerta.id, { pasoActual: PASO_REVISION, motivo: motivo.trim() }).subscribe({
      next: () => {
        this.enviandoModificacion.set(false);
        this.alertaModificacion.set(null);
        this.avisoFila.set({
          id: alerta.id,
          texto: `${alerta.codigo || 'La alerta'}: se solicitó la modificación.`,
          tipo: 'ok',
        });
        this.listado.recargar();
        if (this.seleccionadaId() === alerta.id) this.detalle.recargar();
      },
      error: (fallo: unknown) => {
        this.enviandoModificacion.set(false);
        this.errorModificacion.set(this.mensajeDeError(fallo));
      },
    });
  }

  abrirWhatsapp(alerta: Alerta): void {
    if (!alerta.id) return;
    this.alertaWhatsapp.set(alerta);
  }

  cerrarWhatsapp(): void {
    this.alertaWhatsapp.set(null);
  }

  /** Texto inicial de la ventana de WhatsApp: la plantilla guardada o la generada. */
  mensajeWhatsapp(alerta: Alerta): string {
    return alerta.plantillaWhatsapp ?? plantillaWhatsapp(alerta);
  }

  guardarPlantillaWhatsapp(texto: string): void {
    const alerta = this.alertaWhatsapp();
    if (!alerta) return;
    const plantilla = texto.trim() || null;
    this.alertaWhatsapp.set(null);
    this.enviar(alerta.id, { plantillaWhatsapp: plantilla });
  }

  /* ---------------------------------------------------------------------- *
   * Archivo (sin caso, sin anular)
   * ---------------------------------------------------------------------- */

  abrirArchivo(alerta: Alerta): void {
    if (!alerta.id || !this.puedeArchivar(alerta)) return;
    this.aprobacionFila.set(null);
    this.deshacerFila.set(null);
    this.errorArchivo.set(null);
    this.avisoArchivo.set(null);
    this.alertaArchivo.set(alerta);
  }

  cerrarArchivo(): void {
    if (this.enviandoArchivo()) return;
    this.alertaArchivo.set(null);
    this.errorArchivo.set(null);
  }

  confirmarArchivo(motivo: string | null): void {
    const alerta = this.alertaArchivo();
    if (!alerta || !alerta.id) return;

    const archivar = !alerta.archivadoEn;
    if (archivar && !(motivo ?? '').trim()) return;

    this.enviandoArchivo.set(true);
    this.errorArchivo.set(null);

    const ruta = urlApi(`/v1/alerts/${encodeURIComponent(alerta.id)}/archivar`);
    const peticion = archivar
      ? this.http.post<unknown>(ruta, { motivo: (motivo ?? '').trim() })
      : this.http.delete<unknown>(ruta);

    peticion.subscribe({
      next: () => {
        this.enviandoArchivo.set(false);
        this.alertaArchivo.set(null);
        if (this.alertaAbierta()?.id === alerta.id) this.cerrarPanel();
        this.avisoArchivo.set(
          archivar
            ? `Alerta ${alerta.codigo || 'seleccionada'} archivada. No se anuló: puede consultarse en las archivadas.`
            : `Alerta ${alerta.codigo || 'seleccionada'} devuelta a las colas de trabajo.`,
        );
        this.recargarIndicadores();
        this.listado.recargar();
      },
      error: (fallo: unknown) => {
        this.enviandoArchivo.set(false);
        this.errorArchivo.set(this.mensajeDeError(fallo));
      },
    });
  }

  private recargarIndicadores(): void {
    this.atendidasRec.recargar();
    this.pendientesRec.recargar();
    this.conCasoRec.recargar();
    this.sinCasoRec.recargar();
  }

  /* ---------------------------------------------------------------------- *
   * Anulación
   * ---------------------------------------------------------------------- */

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
    this.modoPanel.set('ver');
  }

  recargarListado(): void {
    this.aprobacionFila.set(null);
    this.deshacerFila.set(null);
    this.listado.recargar();
  }

  alAnularLote(cantidad: number): void {
    this.seleccion.limpiar();
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

  /* ---------------------------------------------------------------------- *
   * Persistencia
   * ---------------------------------------------------------------------- */

  guardar(cambios: PatchAlerta): void {
    const alerta = this.alertaPanel();
    if (!alerta) return;

    const claves = Object.entries(cambios)
      .filter(([, valor]) => valor !== undefined)
      .map(([clave]) => clave);

    if (claves.length === 0) {
      this.errorGuardado.set('No hay cambios que guardar.');
      return;
    }

    // Los metadatos los edita cualquier perfil; el contenido exige clasificación.
    const soloMetadatos = claves.every((clave) => CLAVES_METADATOS.has(clave));
    if (!this.puedeModificarAbierta() && !soloMetadatos) {
      this.errorGuardado.set('Su rol no permite modificar esta alerta.');
      return;
    }

    const cuerpo: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor !== undefined) cuerpo[clave] = valor;
    }

    this.enviar(alerta.id, cuerpo);
  }

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

  /* ---------------------------------------------------------------------- *
   * Filtros
   * ---------------------------------------------------------------------- */

  buscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      void this.actualizar({ q: valor, pagina: 1 });
    }, 300);
  }

  cambiarRiesgo(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ riesgo: valor, pagina: 1 });
  }

  cambiarEstado(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ estado: valor, pagina: 1 });
  }

  cambiarCaso(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ sinCaso: valor, pagina: 1 });
  }

  cambiarArchivados(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ archivados: valor, pagina: 1 });
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
    this.avisoFila.set(null);
    this.aprobacionFila.set(null);
    this.deshacerFila.set(null);
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {},
    });
  }

  /* ---------------------------------------------------------------------- *
   * Internos
   * ---------------------------------------------------------------------- */

  /**
   * `pasoPrevio` sólo viaja cuando el PATCH es un cambio de paso: es el paso
   * desde el que se ofrece «Deshacer». En una edición queda ausente.
   */
  private enviar(id: string, cuerpo: Record<string, unknown>, pasoPrevio?: number): void {
    this.guardando.set(true);
    this.errorGuardado.set(null);
    this.aviso.set(null);
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
        riesgo: siguiente.riesgo || null,
        estado: siguiente.estado || null,
        orden: siguiente.orden !== 'recent' ? siguiente.orden : null,
        caso: siguiente.caso || null,
        sinCaso: siguiente.sinCaso || null,
        archivados: siguiente.archivados || null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
