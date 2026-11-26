import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
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
import { CapacidadesService } from '../../core/permisos/capacidades.service';
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
import {
  CeldaTablaDirectiva,
  TablaComponent,
  type ClicFila,
  type ColumnaTabla,
  type OrdenColumna,
} from '../../shared/ui/tabla.component';
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
import { copiarAlPortapapeles } from './portapapeles';

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
    TablaComponent,
    CeldaTablaDirectiva,
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
      gap: 12px 18px;
    }

    .view-head h1 {
      margin: 0;
    }

    /*
     * Indicadores en la cabecera: cuatro tarjetas compactas en una fila, entre
     * el título y las acciones. La barra global reserva 91 px de alto, que aquí
     * empujaban el listado una banda entera; el número manda (18 px) y el
     * rótulo queda al lado para no repetir esa banda.
     */
    .view-head .executive-kpis {
      flex: 1 1 420px;
      min-width: 0;
      margin-bottom: 0;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }

    .view-head .stat-card {
      min-height: 0;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
    }

    .view-head .stat-icon {
      width: 24px;
      height: 24px;
      border-radius: 6px;
    }

    .view-head .stat-copy {
      gap: 0;
    }

    .view-head .stat-copy > span {
      font-size: 11.5px;
      line-height: 1.2;
    }

    .view-head .stat-copy > strong {
      font-size: 18px;
    }

    /* En pantallas estrechas los cuatro indicadores se envuelven en 2 × 2. */
    @media (max-width: 980px) {
      .view-head .executive-kpis {
        flex-basis: 100%;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    .alerta-titulo {
      display: block;
      min-width: 288px;
      max-width: 480px;
      white-space: normal;
    }

    /* El listado lo nombra el título, no el código: el código conserva su ancho. */
    :host ::ng-deep app-tabla .tabla tbody td.celda-principal {
      min-width: 0;
      white-space: nowrap;
    }

    .alerta-titulo strong {
      display: block;
      color: var(--ink);
      font-size: 13.5px;
      font-weight: 700;
      line-height: 1.35;
    }

    .alerta-meta {
      display: block;
      margin-top: 4px;
      font-size: 11px;
    }

    .alerta-geografia {
      display: inline;
      color: var(--muted);
      font-size: 11px;
      font-weight: 400;
    }

    /* Separador «·» del título: 8 px fijos para que no toque los extremos. */
    .sep {
      display: inline-block;
      width: 8px;
      color: var(--muted);
      text-align: center;
    }

    .alerta-riesgo {
      display: inline;
      padding: 0;
      border-radius: 0;
      font-weight: 400;
      font-size: 11px;
    }

    .alerta-riesgo.risk-bajo {
      color: #1f5597;
      background: none;
    }

    .alerta-riesgo.risk-medio {
      color: #93621d;
      background: none;
    }

    .alerta-riesgo.risk-alto {
      color: #ad4d46;
      background: none;
    }

    /* El riesgo es texto sobre la fila: en oscuro usa los tonos del tema. */
    :host-context(html[data-theme='dark']) .alerta-riesgo.risk-bajo {
      color: var(--blue);
    }

    :host-context(html[data-theme='dark']) .alerta-riesgo.risk-medio {
      color: var(--amber);
    }

    :host-context(html[data-theme='dark']) .alerta-riesgo.risk-alto {
      color: var(--red);
    }

    /*
     * Caso vinculado: el código enlaza al expediente y un botón lo copia; debajo
     * va el título recortado a dos líneas. El atributo title conserva el texto
     * completo cuando el recorte lo esconde.
     */
    .alerta-caso {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .alerta-caso-linea {
      display: flex;
      align-items: center;
      gap: 2px;
      min-width: 0;
    }

    .alerta-caso-enlace {
      display: block;
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      color: var(--ink-2);
      font-size: 12px;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .alerta-caso-enlace:hover {
      color: var(--blue-dark);
      text-decoration: underline;
    }

    .boton-copiar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 20px;
      height: 20px;
      padding: 0;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
    }

    .boton-copiar:hover {
      background: var(--canvas);
      color: var(--ink-2);
    }

    .boton-copiar:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: 1px;
    }

    .alerta-caso-titulo {
      display: -webkit-box;
      overflow: hidden;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.3;
      white-space: normal;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
    }

    .sin-caso {
      color: var(--muted);
      font-size: 12.5px;
      font-style: italic;
    }

    .alerta-archivada {
      display: block;
      margin-top: 4px;
      width: fit-content;
      padding: 1px 7px;
      border-radius: 999px;
      background: var(--canvas);
      color: var(--muted);
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
      color: var(--ink-2);
      font-size: 12.5px;
      font-weight: 600;
    }

    .alerta-revisor small {
      color: var(--muted);
      font-size: 11.5px;
    }

    .table-link {
      cursor: pointer;
      font-family: inherit;
      text-align: left;
    }

    /*
     * Filtros avanzados: un desplegable anclado al botón que lo abre. No es un
     * modal: se cierra con el clic de fuera o con Escape (lo escucha la
     * página), no con un fondo oscurecido.
     */
    .filtro-avanzado {
      position: relative;
      margin-left: auto;
    }

    .filtro-avanzado .avanzado-enlace {
      white-space: nowrap;
    }

    .panel-avanzado {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      z-index: 40;
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 8px 10px;
      width: max-content;
      max-width: min(560px, calc(100vw - 32px));
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--paper);
      box-shadow: 0 12px 32px rgb(26 43 62 / 14%);
    }

    .alerta-actualizando {
      margin: 0;
      color: #8d99a6;
      font-size: 12px;
    }

    .aviso-ok {
      color: var(--green);
      font-size: 13.5px;
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
        .map((caso) => ({ codigo: caso.codigo, titulo: caso.titulo, subsector: caso.subsector }))
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

  /** Envío a revisión disparado desde una fila que espera confirmación explícita. */
  readonly revisionFila = signal<{ alerta: Alerta; paso: number } | null>(null);

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
   * Dirección de la vista de alertas: `direccion_oaipcs`, alta dirección y
   * administrador (el cuadro `DIRECCION` de `CapacidadesService`). La sección
   * del menú de fila se llama igual; el resto del flujo ve «Flujo».
   */
  readonly esDirectora = this.capacidades.esDirectora;

  /** Selección de la tabla (página visible) para exportar o anular en lote. */
  readonly seleccion = new SeleccionTabla();

  /** Ids marcados, en una referencia estable para `app-tabla`. */
  readonly idsSeleccionados = computed(() => this.seleccion.lista());

  /** Orden local de la página visible. */
  readonly orden = new OrdenTabla<Alerta>();

  /** Columnas del listado, con el código estrecho y el título como eje. */
  readonly columnas: readonly ColumnaTabla[] = [
    { clave: 'codigo', titulo: 'Código', ancho: '54px', ordenable: true },
    { clave: 'titulo', titulo: 'Título', ordenable: true },
    { clave: 'caso', titulo: 'Caso vinculado', ancho: '112px', ordenable: true },
    {
      clave: 'fecha',
      titulo: 'Fecha reporte',
      ancho: '120px',
      alineacion: 'centro',
      ordenable: true,
      acceso: (fila) => (fila as Alerta).fechaReporte,
      formato: (valor) => this.fechaReporte(valor as string | null),
    },
    { clave: 'estado', titulo: 'Estado', ancho: '130px', ordenable: true },
    { clave: 'revisor', titulo: 'Último revisor', ancho: '150px', ordenable: true },
    { clave: 'acciones', titulo: 'Acciones', ancho: '72px', alineacion: 'centro' },
  ];

  /** Orden que pinta `app-tabla`; la página sigue ordenando con `OrdenTabla`. */
  readonly ordenTabla = computed<OrdenColumna | null>(() => {
    const clave = this.orden.columna();
    return clave ? { clave, direccion: this.orden.direccion() } : null;
  });

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

  alCambiarOrden(cambio: OrdenColumna | null): void {
    const clave = cambio?.clave ?? this.orden.columna();
    if (clave) this.orden.alternar(clave);
  }

  /** Refleja en `SeleccionTabla` lo que marca la tabla (barra de selección). */
  alCambiarSeleccion(ids: readonly string[]): void {
    const marcadas = new Set(ids);
    for (const id of this.seleccion.lista()) {
      if (!marcadas.has(id)) this.seleccion.alternar(id);
    }
    for (const id of ids) {
      if (!this.seleccion.esta(id)) this.seleccion.alternar(id);
    }
  }

  alClicFila(evento: ClicFila): void {
    this.abrir(evento.fila as Alerta);
  }

  private temporizador?: ReturnType<typeof setTimeout>;
  private temporizadorCopia?: ReturnType<typeof setTimeout>;

  constructor() {
    this.destruccion.onDestroy(() => {
      clearTimeout(this.temporizador);
      clearTimeout(this.temporizadorCopia);
      document.removeEventListener('click', this.cerrarAvanzadaFuera);
      document.removeEventListener('keydown', this.cerrarAvanzadaConEscape);
    });

    // Desplegable de filtros: el clic fuera cierra; el de dentro, no.
    document.addEventListener('click', this.cerrarAvanzadaFuera);
    document.addEventListener('keydown', this.cerrarAvanzadaConEscape);

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

  private readonly cerrarAvanzadaFuera = (evento: MouseEvent): void => {
    if (!this.avanzadaAbierta()) return;
    const destino = evento.target as Node | null;
    const contenedor = this.filtrosAvanzados()?.nativeElement;
    if (destino && contenedor?.contains(destino)) return;
    this.avanzadaAbierta.set(false);
  };

  private readonly cerrarAvanzadaConEscape = (evento: KeyboardEvent): void => {
    if (evento.key === 'Escape') this.avanzadaAbierta.set(false);
  };

  /* ---------------------------------------------------------------------- *
   * Presentación
   * ---------------------------------------------------------------------- */

  fechaReporte(valor: string | null): string {
    return formatearFechaCorta(valor);
  }

  tituloAlerta(alerta: Alerta): string {
    return `🔔 ${tituloLimpio(alerta.titulo) || 'Sin título'}`;
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

  etiquetaRiesgo(riesgo: Riesgo): string {
    return riesgo === 'Alto' ? 'alto' : riesgo === 'Medio' ? 'moderado' : 'bajo';
  }

  /** Código del caso copiado hace un instante; la marca caduca sola. */
  readonly copiadoCaso = signal<string | null>(null);

  /** Copia el código del caso sin abrir la ficha de la fila. */
  async copiarCaso(codigo: string | null | undefined, evento?: Event): Promise<void> {
    evento?.stopPropagation();
    if (!codigo) return;

    const ok = await copiarAlPortapapeles(codigo);
    if (!ok) return;

    clearTimeout(this.temporizadorCopia);
    this.copiadoCaso.set(codigo);
    this.temporizadorCopia = setTimeout(() => {
      if (this.copiadoCaso() === codigo) this.copiadoCaso.set(null);
    }, 1600);
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

  /**
   * Menú de acciones de la fila, en secciones:
   *
   * · «Dirección OAIPCS», sólo para la Dirección: aprobar, solicitar
   *   modificación y archivar sin caso (el «Anular» lo añade
   *   `app-acciones-fila` al final del menú).
   * · «Flujo», sólo para quien no es Dirección: enviar a revisión, que es el
   *   paso de elaboración (1) a validación previa (2).
   * · «Otras acciones»: modificar y mensajería instantánea.
   */
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
      if (this.puedeArchivar(alerta)) {
        acciones.push({
          id: 'archivar',
          etiqueta: alerta.archivadoEn ? 'Quitar del archivo' : 'Archivar sin caso',
          seccion: 'Dirección OAIPCS',
        });
      }
    } else if (alerta.pasoActual < PASO_REVISION) {
      acciones.push({
        id: 'enviar-revision',
        etiqueta: 'Enviar a revisión',
        seccion: 'Flujo',
      });
    }

    acciones.push(
      { id: 'modificar', etiqueta: 'Modificar', seccion: 'Otras acciones' },
      { id: 'whatsapp', etiqueta: 'Enviar por mensajería instantánea', seccion: 'Otras acciones' },
    );

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
        this.pedirRevisionFila(alerta);
        break;
      case 'modificar':
        this.abrir(alerta, 'editar');
        break;
      case 'whatsapp':
        this.abrirWhatsapp(alerta);
        break;
      case 'archivar':
        this.abrirArchivo(alerta);
        break;
    }
  }

  abrir(alerta: Alerta, modo: ModoPanelAlerta = 'ver'): void {
    if (!alerta.id) return;
    this.altaAbierta.set(false);
    this.errorGuardado.set(null);
    this.aviso.set(null);
    this.aprobacionFila.set(null);
    this.revisionFila.set(null);
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
    // La acción queda reservada a la Dirección (o al administrador), aunque la
    // base se la permitiera a otro perfil.
    if (!this.esDirectora() && !this.capacidades.esAdmin()) return false;
    return (
      this.capacidades.puedeEliminar() && this.capacidades.puedeModificar(alerta.clasificacion)
    );
  }

  /**
   * Archivar sólo aplica a alertas sin caso vinculado y vigentes (no anuladas).
   * Desarchivar siempre se permite: devuelve la fila a las colas aunque mientras
   * tanto haya ganado un caso. Archivar no es anular: no exige el privilegio de
   * borrado, sino el de escritura, y sólo lo ofrece la Dirección.
   */
  puedeArchivar(alerta: Alerta): boolean {
    if (!this.esDirectora() && !this.capacidades.esAdmin()) return false;
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

  private pedirRevisionFila(alerta: Alerta): void {
    if (!this.capacidades.puedeModificar(alerta.clasificacion)) {
      this.avisoFila.set({
        id: alerta.id,
        texto: 'Su rol no permite enviar esta alerta a revisión.',
        tipo: 'error',
      });
      return;
    }
    this.deshacerFila.set(null);
    this.avisoFila.set(null);
    this.aprobacionFila.set(null);
    this.revisionFila.set({ alerta, paso: PASO_REVISION });
  }

  confirmarRevisionFila(): void {
    const pendiente = this.revisionFila();
    if (!pendiente || this.enviandoFila()) return;

    const { alerta } = pendiente;
    this.revisionFila.set(null);
    if (!alerta.id) return;

    if (!this.capacidades.puedeModificar(alerta.clasificacion)) {
      this.avisoFila.set({
        id: alerta.id,
        texto: 'Su rol no permite enviar esta alerta a revisión.',
        tipo: 'error',
      });
      return;
    }

    this.deshacerFila.set(null);
    this.enviarAccionFila(alerta, PASO_REVISION, alerta.pasoActual);
  }

  cancelarRevisionFila(): void {
    this.revisionFila.set(null);
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

  /**
   * Desplegable de «Búsqueda avanzada»: caso, archivo y limpieza. Se cierra con
   * el clic de fuera o con Escape; un clic dentro no lo cierra, porque los
   * selects y «Limpiar filtros» se usan con el panel abierto.
   */
  readonly avanzadaAbierta = signal(false);

  /** Contenedor del botón y del panel: distingue el clic de dentro del de fuera. */
  private readonly filtrosAvanzados = viewChild<ElementRef<HTMLElement>>('filtrosAvanzados');

  /** «Búsqueda avanzada · activos»: los filtros del panel que no están vacíos. */
  readonly filtrosAvanzadosActivos = computed(() => {
    const filtros = this.filtros();
    return filtros.sinCaso !== '' || filtros.archivados !== '';
  });

  alternarAvanzada(): void {
    this.avanzadaAbierta.update((abierto) => !abierto);
  }

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
