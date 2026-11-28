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
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import {
  TAMANO_PAGINA,
  normalizarColeccion,
  parametrosConValor,
  paramsDePagina,
  rangoPagina,
  urlConParametros,
  type Coleccion,
} from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { GlosarioComponent } from '../../shared/ui/glosario.component';
import { BotonAccionComponent } from '../../shared/ui/boton-accion.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { OrdenTabla } from '../../shared/ui/orden-tabla';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import { ThOrdenDirective } from '../../shared/ui/th-orden.directive';

import { SugerenciaFormComponent } from './sugerencia-form.component';
import { descargarSugerencias, type FormatoSugerencias } from './sugerencias-descargas';
import {
  ESTADOS_SUGERENCIA,
  aOpcionesSugerencias,
  aRegiones,
  aSugerencia,
  aSugerenciaDetalle,
  aSugerenciaResumen,
  claveEstado,
  etiquetaOrigen,
  formatearDuracionHoras,
  formatearFecha,
  formatearFechaHora,
  formatearPorcentaje,
  simboloEstado,
  type OpcionEstado,
  type OpcionRegion,
  type OpcionesSugerencias,
  type Sugerencia,
  type SugerenciaResumen,
} from './sugerencia.mapeo';

type FiltrosSugerencias = {
  q: string;
  pagina: number;
  tamano: number;
  caso: string;
  territorio: string;
  estado: string;
  prioridad: string;
  tipo: string;
};

const FILTROS_VACIOS: FiltrosSugerencias = {
  q: '',
  pagina: 1,
  tamano: TAMANO_PAGINA,
  caso: '',
  territorio: '',
  estado: '',
  prioridad: '',
  tipo: '',
};

/** Resumen neutro mientras carga: ceros reales y cifras derivadas «sin dato». */
const RESUMEN_VACIO: SugerenciaResumen = {
  total: 0,
  pendientes: 0,
  decididas: 0,
  aceptadas: 0,
  aceptadasConCambios: 0,
  rechazadas: 0,
  expiradas: 0,
  sinDecision: 0,
  conSustento: 0,
  autoAplicadas: 0,
  tasaAceptacion: null,
  tiempoMedioHoras: null,
};

type OpcionSimple = { codigo: string; etiqueta: string };

/**
 * Matriz de sugerencias de intervención.
 *
 * Pantalla de conducción de la mesa: cada fila registra qué se sugiere, a quién,
 * con qué prioridad y estado, quién la atiende y con qué sustento. La tabla es
 * ordenable y paginada en servidor; el panel lateral abre el detalle, el cambio
 * de estado (con decisión humana y motivo obligatorio al rechazar) y la
 * asignación. La exportación CSV/PDF reenvía los filtros vigentes.
 */
@Component({
  selector: 'app-gobierno-sugerencias-page',
  imports: [
    IconoComponent,
    BotonAccionComponent,
    PaginacionComponent,
    ThOrdenDirective,
    SugerenciaFormComponent,
    GlosarioComponent,
  ],
  templateUrl: './gobierno-sugerencias.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    .view-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .sr-solo {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
      border: 0;
    }

    /* ── Regla de oro ─────────────────────────────────────────────── */
    .golden {
      display: grid;
      grid-template-columns: 118px minmax(0, 1fr) auto;
      gap: 14px;
      align-items: center;
      margin-bottom: 14px;
      padding: 12px 16px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--blue-pale);
    }
    .golden-key {
      align-self: start;
      justify-self: start;
      padding: 3px 9px;
      border-radius: 999px;
      background: var(--blue);
      color: var(--paper);
      font: 700 10px var(--font-display);
      letter-spacing: 0.08em;
      text-align: center;
      text-transform: uppercase;
    }
    .golden p {
      margin: 0;
      color: var(--ink-2);
      font-size: 12.5px;
      line-height: 1.5;
    }
    .golden p b {
      color: var(--ink);
    }
    .golden-stats {
      display: flex;
      gap: 16px;
    }
    .golden-stats div {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }
    .golden-stats b {
      color: var(--blue-dark);
      font: 700 16px var(--font-display);
    }
    .golden-stats span {
      color: var(--muted);
      font-size: 10.5px;
      line-height: 1.25;
    }

    /* ── KPIs ─────────────────────────────────────────────────────── */
    .panel-kpis {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 11px;
      margin-bottom: 15px;
    }
    .kpi {
      min-width: 0;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--paper);
    }
    .kpi-top {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }
    .kpi .label {
      color: var(--muted);
      font-size: 11px;
      font-weight: 600;
    }
    .kpi .val {
      margin-top: 6px;
      color: var(--ink);
      font: 700 24px var(--font-display);
      line-height: 1.1;
    }
    .kpi .val .unit {
      margin-left: 4px;
      color: var(--ink-2);
      font: 600 12px var(--font-sans);
    }
    .kpi .val.suave {
      color: var(--muted);
      font-size: 17px;
    }
    .kpi .hint {
      margin-top: 4px;
      color: var(--ink-2);
      font-size: 11px;
      line-height: 1.35;
    }
    .kpi .foot {
      margin-top: 8px;
      padding-top: 7px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 10px;
      line-height: 1.35;
    }

    .filter-bar {
      flex-wrap: wrap;
    }
    .filtro-texto {
      width: 128px;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--ink);
      font-size: 12.5px;
    }
    .filtro-texto::placeholder {
      color: var(--muted);
    }

    /* ── Workspace: bandeja + detalle ─────────────────────────────── */
    .workspace {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
      align-items: start;
    }
    .workspace.con-detalle {
      grid-template-columns: minmax(0, 1fr) 422px;
    }
    .panel {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--paper);
      box-shadow: 0 1px 3px rgb(23 40 58 / 5%);
      overflow: hidden;
    }
    .panel-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--line);
    }
    .panel-title {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 9px;
      min-width: 0;
    }
    .panel-title h2 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 15px;
    }
    .panel-title .count {
      color: var(--muted);
      font-size: 11.5px;
    }
    .panel-note {
      color: var(--muted);
      font-size: 10.5px;
      text-align: right;
    }

    .table-wrap {
      overflow-x: auto;
    }
    .tabla-sugerencias {
      width: 100%;
      min-width: 980px;
      border-collapse: collapse;
      text-align: left;
    }
    .tabla-sugerencias th {
      padding: 9px 10px 8px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.055em;
      text-align: left;
      text-transform: uppercase;
      vertical-align: bottom;
      white-space: nowrap;
    }
    .tabla-sugerencias th.th-orden {
      cursor: pointer;
      user-select: none;
    }
    .tabla-sugerencias th.th-orden:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: -2px;
    }
    .tabla-sugerencias th.th-orden::after {
      content: '';
      display: inline-block;
      width: 0;
      height: 0;
      margin-left: 5px;
      border-right: 3.5px solid transparent;
      border-left: 3.5px solid transparent;
      border-bottom: 5px solid currentColor;
      vertical-align: middle;
      opacity: 0.25;
    }
    .tabla-sugerencias th.th-orden-asc::after {
      opacity: 1;
    }
    .tabla-sugerencias th.th-orden-desc::after {
      opacity: 1;
      transform: rotate(180deg);
    }
    .tabla-sugerencias td {
      height: 52px;
      padding: 7px 10px;
      border-bottom: 1px solid var(--line);
      color: var(--ink-2);
      font-size: 12px;
      vertical-align: middle;
    }
    .tabla-sugerencias tbody tr {
      cursor: pointer;
    }
    .tabla-sugerencias tbody tr:hover td {
      background: var(--canvas);
    }
    .tabla-sugerencias tbody tr.fila-abierta td {
      background: var(--blue-pale);
    }
    .tabla-sugerencias tbody tr.fila-abierta td:first-child {
      box-shadow: inset 3px 0 0 var(--blue);
    }
    .tabla-sugerencias tbody tr:last-child td {
      border-bottom: 0;
    }

    .celda-fecha {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .celda-titulo {
      min-width: 210px;
      max-width: 340px;
    }
    .titulo-sugerencia {
      display: block;
      color: var(--ink);
      font-weight: 600;
      line-height: 1.3;
      text-align: left;
      white-space: normal;
    }
    .codigo-sugerencia {
      display: block;
      margin-top: 2px;
      color: var(--muted);
      font-size: 10.5px;
      font-variant-numeric: tabular-nums;
    }
    .entidad-codigo {
      display: block;
      color: var(--ink);
      font-weight: 600;
      white-space: nowrap;
    }
    .entidad-detalle {
      display: block;
      margin-top: 2px;
      color: var(--muted);
      font-size: 10.5px;
      line-height: 1.25;
      white-space: normal;
    }
    .celda-destinatario {
      max-width: 160px;
    }
    .texto-dos-lineas {
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      line-height: 1.3;
      white-space: normal;
    }
    .prioridad-pastilla {
      display: inline-block;
      padding: 1px 7px;
      border-radius: 999px;
      background: var(--canvas);
      color: var(--ink-2);
      font-size: 10.5px;
      font-weight: 600;
      white-space: nowrap;
    }
    .celda-sustento {
      max-width: 190px;
    }
    .texto-truncado {
      display: block;
      overflow: hidden;
      color: var(--muted);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sin-dato-texto {
      color: var(--muted);
      font-style: italic;
    }

    /* ── Chips de estado (color + símbolo + texto) ────────────────── */
    .sug-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 7px;
      border: 1px solid transparent;
      border-radius: 999px;
      font-size: 10.5px;
      font-weight: 600;
      white-space: nowrap;
    }
    .sug-chip-simbolo {
      font-size: 10px;
    }
    .sug-chip.pendiente {
      background: var(--amber-pale);
      color: var(--amber);
    }
    .sug-chip.aceptada {
      background: var(--green-pale);
      color: var(--green);
    }
    .sug-chip.cambios {
      background: var(--blue-pale);
      color: var(--blue);
    }
    .sug-chip.rechazada {
      background: var(--red-pale);
      color: var(--red);
    }
    .sug-chip.expirada,
    .sug-chip.gris {
      background: var(--canvas);
      color: var(--muted);
    }

    .tabla-nota {
      margin: 0;
      padding: 9px 16px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 10.5px;
      line-height: 1.45;
    }
    .leyenda {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 9px 16px 11px;
      border-top: 1px solid var(--line);
    }

    /* ── Panel de detalle ─────────────────────────────────────────── */
    .detalle-head {
      align-items: flex-start;
    }
    .detalle-head h2 {
      margin: 6px 0 0;
      font-family: var(--font-display);
      font-size: 15.5px;
      line-height: 1.25;
    }
    .detalle-sub {
      display: block;
      margin-top: 2px;
      color: var(--muted);
      font-size: 11px;
    }
    .detalle-acciones {
      display: flex;
      align-items: center;
      flex-shrink: 0;
      gap: 4px;
    }
    .eyebrow {
      display: block;
      color: var(--muted);
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }
    .detalle-body {
      display: flex;
      flex-direction: column;
      gap: 13px;
      padding: 13px 16px 16px;
    }
    .meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 7px 12px;
      margin: 0;
    }
    .meta > div {
      min-width: 0;
    }
    .meta dt {
      color: var(--muted);
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .meta dd {
      margin: 2px 0 0;
      color: var(--ink-2);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .dsec h3 {
      margin: 0 0 6px;
      color: var(--muted);
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }
    .dsec p {
      margin: 0;
      color: var(--ink-2);
      font-size: 12.5px;
      line-height: 1.5;
    }
    .dsec .src-line {
      margin-top: 5px;
      color: var(--muted);
      font-size: 10.5px;
      font-style: italic;
    }
    .decision-box {
      padding: 9px 11px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--canvas);
    }
    .decision-box p + p {
      margin-top: 5px;
    }
    .decision-box b {
      color: var(--ink);
    }
    .conf {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .bar {
      display: block;
      width: 58px;
      height: 6px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--line);
    }
    .bar .fill {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--blue);
    }
    .conf b {
      color: var(--ink-2);
      font-size: 11.5px;
      font-variant-numeric: tabular-nums;
    }
    .sug-form {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 11px;
      border-top: 1px solid var(--line);
    }
    .sug-form .form-label {
      margin-bottom: -4px;
    }
    .sug-form .button-primary {
      align-self: flex-start;
    }

    @media (max-width: 1240px) {
      .workspace.con-detalle {
        grid-template-columns: minmax(0, 1fr);
      }
      .panel-kpis {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 1024px) {
      .golden {
        grid-template-columns: 1fr;
      }
      .golden-stats {
        flex-wrap: wrap;
      }
    }
    @media (max-width: 680px) {
      .panel-kpis {
        grid-template-columns: 1fr;
      }
      .meta {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class GobiernoSugerenciasPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly capacidades = inject(CapacidadesService);
  private readonly destruccion = inject(DestroyRef);

  /** La escritura (alta, edición, estado y asignación) sigue la matriz de roles. */
  readonly puedeEditar = this.capacidades.puedeEditar;

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map(
        (params): FiltrosSugerencias => ({
          q: params.get('q') ?? '',
          pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
          tamano: Math.max(
            1,
            Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA,
          ),
          caso: params.get('caso') ?? '',
          territorio: params.get('territorio') ?? '',
          estado: params.get('estado') ?? '',
          prioridad: params.get('prioridad') ?? '',
          tipo: params.get('tipo') ?? '',
        }),
      ),
    ),
    { initialValue: FILTROS_VACIOS },
  );

  readonly filtros = computed(() => this.parametros());

  /** Filtros activos para la exportación (sin paginación). */
  readonly filtrosExportacion = computed(() =>
    parametrosConValor({
      q: this.filtros().q,
      caso: this.filtros().caso,
      territorio: this.filtros().territorio,
      estado: this.filtros().estado,
      prioridad: this.filtros().prioridad,
      tipo: this.filtros().tipo,
    }),
  );

  private readonly recurso = consulta<Coleccion<Sugerencia>>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/sugerencias'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        q: filtros.q,
        caso: filtros.caso,
        territorio: filtros.territorio,
        estado: filtros.estado,
        prioridad: filtros.prioridad,
        tipo: filtros.tipo,
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return {
        ...coleccion,
        elementos: coleccion.elementos.map(aSugerencia),
      } satisfies Coleccion<Sugerencia>;
    },
  });

  private readonly recursoResumen = consulta<SugerenciaResumen>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/sugerencias/resumen'), {
        q: filtros.q,
        caso: filtros.caso,
        territorio: filtros.territorio,
        estado: filtros.estado,
        prioridad: filtros.prioridad,
        tipo: filtros.tipo,
      });
    },
    esquema: aSugerenciaResumen,
  });

  private readonly recursoOpciones = consulta<OpcionesSugerencias>({
    fuente: () => urlApi('/v1/sugerencias/opciones'),
    esquema: aOpcionesSugerencias,
  });

  private readonly recursoRegiones = consulta<OpcionRegion[]>({
    fuente: () => urlApi('/v1/catalogs'),
    esquema: aRegiones,
  });

  readonly sugerencias = computed(() => this.recurso.valor()?.elementos ?? []);
  readonly total = computed(() => this.recurso.valor()?.total ?? 0);
  readonly estadoLista = this.recurso.estado;
  readonly errorLista = this.recurso.error;
  readonly resumen = computed(() => this.recursoResumen.valor() ?? RESUMEN_VACIO);
  readonly opciones = computed(() => this.recursoOpciones.valor() ?? null);
  readonly regiones = computed(() => this.recursoRegiones.valor() ?? []);

  readonly estadosLeyenda = ESTADOS_SUGERENCIA;

  /** Estados del desplegable; si el vocabulario aún no llega, usa el local. */
  readonly estadosFiltro = computed<readonly OpcionSimple[]>(() => {
    const delServidor = this.opciones()?.estados;
    if (delServidor && delServidor.length > 0) {
      return delServidor.map((estado: OpcionEstado) => ({
        codigo: estado.codigo,
        etiqueta: estado.etiqueta,
      }));
    }
    return ESTADOS_SUGERENCIA.map((estado) => ({
      codigo: estado.codigo,
      etiqueta: estado.etiqueta,
    }));
  });

  readonly tiposFiltro = computed<readonly OpcionSimple[]>(() => this.opciones()?.tipos ?? []);
  readonly prioridadesFiltro = computed<readonly { codigo: string }[]>(
    () => this.opciones()?.prioridades ?? [],
  );
  readonly unidadesAsignacion = computed(() => this.opciones()?.unidades ?? []);
  readonly responsablesAsignacion = computed(() => this.opciones()?.responsables ?? []);

  /* ── Estado de interfaz ───────────────────────────────────────── */
  readonly seleccionado = signal<Sugerencia | null>(null);
  readonly formAbierto = signal(false);
  readonly formSugerencia = signal<Sugerencia | null>(null);
  readonly exportando = signal<FormatoSugerencias | null>(null);
  readonly exportarError = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  /** Formulario de cambio de estado del panel lateral. */
  readonly estadoNuevo = signal('');
  readonly notaDecision = signal('');
  readonly motivoRechazoEstado = signal('');
  readonly guardandoEstado = signal(false);
  readonly errorEstado = signal<string | null>(null);

  /** Formulario de asignación del panel lateral. */
  readonly unidadAsignada = signal('');
  readonly responsableAsignado = signal('');
  readonly responsableTextoAsignado = signal('');
  readonly guardandoAsignacion = signal(false);
  readonly errorAsignacion = signal<string | null>(null);

  readonly avisoDetalle = signal<string | null>(null);

  /* ── Orden local de la página visible ─────────────────────────── */
  readonly orden = new OrdenTabla<Sugerencia>();

  private readonly accesoresSugerencia: Record<string, (sugerencia: Sugerencia) => unknown> = {
    fecha: (sugerencia) => sugerencia.fecha,
    tipo: (sugerencia) => sugerencia.tipo,
    entidad: (sugerencia) => sugerencia.entidad,
    titulo: (sugerencia) => sugerencia.titulo,
    destinatario: (sugerencia) => sugerencia.destinatario,
    prioridad: (sugerencia) => [sugerencia.prioridadOrden ?? 999, sugerencia.prioridad ?? ''],
    estado: (sugerencia) => [sugerencia.estadoCategoria ?? '', sugerencia.estado],
    atiende: (sugerencia) => sugerencia.responsable,
    sustento: (sugerencia) => sugerencia.sustento,
  };

  readonly filasVisibles = computed(() =>
    this.orden.ordenar(this.sugerencias(), this.accesoresSugerencia),
  );

  readonly rango = computed(() => {
    const valor = this.recurso.valor();
    return valor ? rangoPagina(valor) : { desde: 0, hasta: 0 };
  });

  readonly resumenTabla = computed(() => {
    const rango = this.rango();
    return `${this.total()} sugerencias · ${rango.desde}–${rango.hasta}`;
  });

  private readonly temporizadores: Record<string, ReturnType<typeof setTimeout>> = {};

  constructor() {
    // El panel lateral refleja la fila abierta. Sólo escribe señales: no las
    // vuelve a leer, así que no reabre el ciclo de detección.
    effect(() => {
      const sugerencia = this.seleccionado();
      this.estadoNuevo.set(sugerencia?.estadoCodigo ?? '');
      this.notaDecision.set(sugerencia?.decisionNota ?? '');
      this.motivoRechazoEstado.set(sugerencia?.motivoRechazo ?? '');
      this.unidadAsignada.set(sugerencia?.unidad ?? '');
      this.responsableAsignado.set(sugerencia?.responsableUsuarioId ?? '');
      this.responsableTextoAsignado.set(sugerencia?.responsableTexto ?? '');
      this.errorEstado.set(null);
      this.errorAsignacion.set(null);
      this.avisoDetalle.set(null);
    });

    this.destruccion.onDestroy(() => {
      for (const temporizador of Object.values(this.temporizadores)) {
        clearTimeout(temporizador);
      }
    });
  }

  /* ── Filtros ──────────────────────────────────────────────────── */
  buscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.demorar('q', () => void this.actualizar({ q: valor, pagina: 1 }));
  }

  buscarCaso(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.demorar('caso', () => void this.actualizar({ caso: valor, pagina: 1 }));
  }

  buscarTerritorio(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.demorar('territorio', () => void this.actualizar({ territorio: valor, pagina: 1 }));
  }

  filtrarEstado(evento: Event): void {
    void this.actualizar({ estado: this.valorDe(evento), pagina: 1 });
  }

  filtrarPrioridad(evento: Event): void {
    void this.actualizar({ prioridad: this.valorDe(evento), pagina: 1 });
  }

  filtrarTipo(evento: Event): void {
    void this.actualizar({ tipo: this.valorDe(evento), pagina: 1 });
  }

  cambiarPagina(pagina: number): void {
    void this.actualizar({ pagina });
  }

  cambiarTamano(tamano: number): void {
    void this.actualizar({ tamano, pagina: 1 });
  }

  limpiar(): void {
    for (const temporizador of Object.values(this.temporizadores)) {
      clearTimeout(temporizador);
    }
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        q: null,
        pagina: null,
        tamano: null,
        caso: null,
        territorio: null,
        estado: null,
        prioridad: null,
        tipo: null,
      },
      replaceUrl: true,
    });
  }

  recargar(): void {
    this.recurso.recargar();
    this.recursoResumen.recargar();
  }

  /* ── Bandeja y detalle ────────────────────────────────────────── */
  abrir(sugerencia: Sugerencia): void {
    this.seleccionado.set(sugerencia);
  }

  cerrarDetalle(): void {
    this.seleccionado.set(null);
  }

  abrirAlta(): void {
    if (!this.puedeEditar()) return;
    this.formSugerencia.set(null);
    this.formAbierto.set(true);
    this.aviso.set(null);
  }

  abrirEdicion(sugerencia: Sugerencia): void {
    if (!this.puedeEditar()) return;
    this.formSugerencia.set(sugerencia);
    this.formAbierto.set(true);
    this.aviso.set(null);
  }

  cerrarForm(): void {
    this.formAbierto.set(false);
    this.formSugerencia.set(null);
  }

  alGuardar(): void {
    this.formAbierto.set(false);
    this.formSugerencia.set(null);
    this.aviso.set('Sugerencia guardada.');
    this.recargar();
    this.refrescarDetalle();
  }

  /* ── Cambio de estado y asignación ────────────────────────────── */
  alCambiarEstado(evento: Event): void {
    this.estadoNuevo.set(this.valorDe(evento));
    this.errorEstado.set(null);
  }

  alMotivoEstado(evento: Event): void {
    this.motivoRechazoEstado.set((evento.target as HTMLTextAreaElement).value);
  }

  alNotaDecision(evento: Event): void {
    this.notaDecision.set((evento.target as HTMLTextAreaElement).value);
  }

  cambiarEstado(): void {
    const sugerencia = this.seleccionado();
    if (!sugerencia || !this.puedeEditar() || this.guardandoEstado()) return;

    const codigo = this.estadoNuevo().trim();
    if (!codigo) {
      this.errorEstado.set('Elija el estado al que pasa la sugerencia.');
      return;
    }
    if (codigo === sugerencia.estadoCodigo) {
      this.errorEstado.set('La sugerencia ya está en ese estado.');
      return;
    }

    const motivo = this.motivoRechazoEstado().trim();
    if (codigo === 'rechazada' && !motivo) {
      this.errorEstado.set('El motivo del rechazo es obligatorio.');
      return;
    }

    const cuerpo: Record<string, unknown> = { estado: codigo };
    if (codigo === 'rechazada') cuerpo['motivoRechazo'] = motivo;
    const nota = this.notaDecision().trim();
    if (nota) cuerpo['decisionNota'] = nota;

    this.guardandoEstado.set(true);
    this.errorEstado.set(null);
    this.avisoDetalle.set(null);

    this.http
      .patch<unknown>(urlApi(`/v1/sugerencias/${encodeURIComponent(sugerencia.id)}`), cuerpo)
      .subscribe({
        next: (bruto) => {
          this.guardandoEstado.set(false);
          this.seleccionado.set(aSugerenciaDetalle(bruto).sugerencia);
          this.avisoDetalle.set('Decisión registrada.');
          this.recargar();
        },
        error: (fallo: unknown) => {
          this.guardandoEstado.set(false);
          this.errorEstado.set(aErrorApi(fallo).message);
        },
      });
  }

  alUnidadAsignada(evento: Event): void {
    this.unidadAsignada.set(this.valorDe(evento));
  }

  alResponsableAsignado(evento: Event): void {
    this.responsableAsignado.set(this.valorDe(evento));
  }

  alResponsableTexto(evento: Event): void {
    this.responsableTextoAsignado.set((evento.target as HTMLInputElement).value);
  }

  asignar(): void {
    const sugerencia = this.seleccionado();
    if (!sugerencia || !this.puedeEditar() || this.guardandoAsignacion()) return;

    const cuerpo: Record<string, unknown> = {
      unidad: this.unidadAsignada(),
      responsableUsuarioId: this.responsableAsignado() || null,
      responsableTexto: this.responsableTextoAsignado(),
    };

    this.guardandoAsignacion.set(true);
    this.errorAsignacion.set(null);
    this.avisoDetalle.set(null);

    this.http
      .patch<unknown>(urlApi(`/v1/sugerencias/${encodeURIComponent(sugerencia.id)}`), cuerpo)
      .subscribe({
        next: (bruto) => {
          this.guardandoAsignacion.set(false);
          this.seleccionado.set(aSugerenciaDetalle(bruto).sugerencia);
          this.avisoDetalle.set('Asignación guardada.');
          this.recargar();
        },
        error: (fallo: unknown) => {
          this.guardandoAsignacion.set(false);
          this.errorAsignacion.set(aErrorApi(fallo).message);
        },
      });
  }

  /* ── Exportación ──────────────────────────────────────────────── */
  async exportar(formato: FormatoSugerencias): Promise<void> {
    if (this.exportando()) return;
    this.exportando.set(formato);
    this.exportarError.set(null);
    try {
      await descargarSugerencias(formato, this.filtrosExportacion());
    } catch (fallo) {
      this.exportarError.set(aErrorApi(fallo).message);
    } finally {
      this.exportando.set(null);
    }
  }

  /* ── Presentación ─────────────────────────────────────────────── */
  fechaTexto(valor: string | null | undefined): string {
    return formatearFecha(valor);
  }

  fechaHoraTexto(valor: string | null | undefined): string {
    return formatearFechaHora(valor);
  }

  duracionTexto(valor: number | null | undefined): string {
    return formatearDuracionHoras(valor);
  }

  porcentajeTexto(valor: number | null | undefined): string {
    return formatearPorcentaje(valor);
  }

  simbolo(codigo: string | null | undefined): string {
    return simboloEstado(codigo);
  }

  claseChip(codigo: string | null | undefined): string {
    return `sug-chip ${claveEstado(codigo)}`;
  }

  origenTexto(origen: string | null | undefined): string {
    return etiquetaOrigen(origen);
  }

  prioridadTexto(codigo: string | null | undefined): string {
    if (!codigo) return '—';
    return codigo.charAt(0).toUpperCase() + codigo.slice(1);
  }

  confianzaTexto(valor: number | null | undefined): string {
    if (valor === null || valor === undefined || !Number.isFinite(valor)) return 'sin dato';
    return `${Math.round(valor)} %`;
  }

  barraConfianza(valor: number | null | undefined): string | null {
    if (valor === null || valor === undefined || !Number.isFinite(valor)) return null;
    const ancho = Math.max(0, Math.min(100, valor));
    return `${ancho}%`;
  }

  /** Línea secundaria de la entidad afectada: caso o ámbito territorial. */
  entidadSecundaria(sugerencia: Sugerencia): string {
    if (sugerencia.entidadTipo === 'caso') {
      return sugerencia.casoTitulo ?? 'Caso abierto';
    }
    const partes = [
      sugerencia.region,
      sugerencia.provincia,
      sugerencia.distrito,
      sugerencia.territorioTexto,
    ].filter((valor): valor is string => !!valor);
    return partes.length > 0 ? partes.join(' · ') : 'Territorio sin detalle';
  }

  textoOSinDato(valor: string | null | undefined): string {
    const limpio = (valor ?? '').trim();
    return limpio || 'sin dato';
  }

  /* ── Navegación de filtros ────────────────────────────────────── */
  private valorDe(evento: Event): string {
    return (evento.target as HTMLSelectElement).value;
  }

  private demorar(clave: string, accion: () => void): void {
    clearTimeout(this.temporizadores[clave]);
    this.temporizadores[clave] = setTimeout(accion, 300);
  }

  private actualizar(cambios: Partial<FiltrosSugerencias>): void {
    const siguiente = { ...this.parametros(), ...cambios };

    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        q: siguiente.q || null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
        caso: siguiente.caso || null,
        territorio: siguiente.territorio || null,
        estado: siguiente.estado || null,
        prioridad: siguiente.prioridad || null,
        tipo: siguiente.tipo || null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Relee el detalle abierto tras un alta o edición; si falla, conserva el previo. */
  private refrescarDetalle(): void {
    const sugerencia = this.seleccionado();
    if (!sugerencia) return;

    this.http
      .get<unknown>(urlApi(`/v1/sugerencias/${encodeURIComponent(sugerencia.id)}`))
      .subscribe({
        next: (bruto) => this.seleccionado.set(aSugerenciaDetalle(bruto).sugerencia),
        error: () => {
          // La lista y el resumen ya se recargaron; el detalle previo se mantiene.
        },
      });
  }
}
