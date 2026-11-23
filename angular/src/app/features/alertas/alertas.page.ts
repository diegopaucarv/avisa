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
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import {
  TerritorioBuscadorComponent,
  type OpcionTerritorio,
} from '../../shared/ui/territorio-buscador.component';
import { AlertaPanelComponent } from './alerta-panel.component';
import {
  ESTADOS_ALERTA,
  OPCIONES_NIVEL,
  ORDENES_ALERTA,
  PRIORIDADES_ALERTA,
  aAlerta,
  aDetalleAlerta,
  aPrioridadesAlerta,
  clavePrioridad as clavePrioridadDe,
  etiquetaPrioridadConPlazo,
  formatearPlazo as formatearPlazoDe,
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
    AlertaPanelComponent,
    AnularPanelComponent,
    ExportarMenuComponent,
    TerritorioBuscadorComponent,
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

    .aviso-ok {
      color: #2f6f52;
      font-size: 11.5px;
    }

    .celda-anular {
      white-space: nowrap;
      text-align: right;
    }

    .celda-anular .button-secondary {
      min-height: 26px;
      padding: 0 9px;
      font-size: 9.5px;
    }

    .tabla-nota {
      margin: 0 0 8px;
      color: #8d99a6;
      font-size: 9.5px;
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

  /** Confirmación del alta en el listado (el panel se cierra al guardar). */
  readonly avisoAlta = signal<string | null>(null);

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

  private temporizador?: ReturnType<typeof setTimeout>;

  constructor() {
    this.destruccion.onDestroy(() => clearTimeout(this.temporizador));
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

  abrir(alerta: Alerta): void {
    if (!alerta.id) return;
    this.altaAbierta.set(false);
    this.errorGuardado.set(null);
    this.aviso.set(null);
    this.alertaAbierta.set(alerta);
    this.seleccionadaId.set(alerta.id);
  }

  /** Abre el alta (panel con `alerta === null`). */
  abrirAlta(): void {
    if (!this.capacidades.puedeEditar()) return;
    this.errorGuardado.set(null);
    this.aviso.set(null);
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

  abrirAnulacion(alerta: Alerta): void {
    if (!alerta.id || !this.puedeAnular(alerta)) return;
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
          this.avisoAnulacion.set(`Alerta ${alerta.codigo || 'seleccionada'} anulada.`);
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
