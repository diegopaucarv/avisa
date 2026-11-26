import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
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
import { consulta, type Consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import {
  AnularPanelComponent,
  type ModoAnulacion,
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
import {
  ESTADOS_COMPROMISO,
  TIPOS_COMPROMISO,
  aCompromiso,
  etiquetaNivelGobierno,
  formatearFecha,
  formatearFechaHora,
  resolverVencimiento,
  situacionDe,
  type Compromiso,
  type EstadoHito,
  type Hito,
  type OrigenVencimiento,
  type ResolucionVencimiento,
  type Situacion,
} from './compromiso.mapeo';
import { CompromisoPanelComponent } from './compromiso-panel.component';
import { MatrizEquipoComponent } from './matriz-equipo.component';

type FiltrosCompromisos = {
  q: string;
  pagina: number;
  tamano: number;
  estado: string;
  tipo: string;
  nivelGobierno: string;
  atiendeGenero: string;
  /** `?vencidos=1`: sólo compromisos con vencimiento efectivo anterior a hoy. */
  vencidos: boolean;
  ver: VerRegistros;
};

/** Cifra de la franja de indicadores; cada una filtra la tabla. */
type IndicadorCompromisos = 'todos' | 'cumplido' | 'enProceso' | 'vencidos';

type ModoVista = 'tabla' | 'calendario' | 'resumen' | 'matriz' | 'anexo14';

/** Una fila del desglose: la etiqueta agrupada y cuántos compromisos suma. */
type FilaDesglose = { etiqueta: string; total: number };

/** La papelera lista sólo lo anulado; «activos» es la vista de siempre. */
type VerRegistros = 'activos' | 'anulados';

type MesCalendario = { anio: number; mes: number };

type PlazoCompromiso = { texto: string; clase: string };

type CompromisoDia = {
  compromiso: Compromiso;
  plazo: PlazoCompromiso;
  /** Etiqueta accesible de la pastilla: código, caso, fecha y plazo. */
  etiqueta: string;
};

type DiaCalendario = {
  fecha: string;
  dia: number;
  delMes: boolean;
  esHoy: boolean;
  nombreFecha: string;
  etiqueta: string;
  visibles: CompromisoDia[];
  restantes: number;
  expandido: boolean;
  total: number;
};

type Calendario = {
  titulo: string;
  dias: DiaCalendario[];
  /** Compromisos cuyo vencimiento cae en el mes visible (no en los ajenos). */
  totalMes: number;
  truncado: boolean;
  desde: string;
  hasta: string;
};

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

const DIAS_SEMANA = [
  { corto: 'L', largo: 'Lunes' },
  { corto: 'M', largo: 'Martes' },
  { corto: 'X', largo: 'Miércoles' },
  { corto: 'J', largo: 'Jueves' },
  { corto: 'V', largo: 'Viernes' },
  { corto: 'S', largo: 'Sábado' },
  { corto: 'D', largo: 'Domingo' },
] as const;

/** Pastillas visibles por celda antes del «+N más». */
const MAX_PASTILLAS = 3;

/** Tope de la vista de calendario: coincide con el máximo de la API. */
const TAMANO_CALENDARIO = 100;

/** Tope de lectura del desglose: también el máximo por página que admite la API. */
const TAMANO_DESGLOSE = 100;

const MS_DIA = 86_400_000;

/**
 * Conteo por etiqueta, de mayor a menor y luego alfabético en español. Un
 * valor ausente se cuenta como «—», nunca se descarta el registro.
 */
function agruparPor(
  compromisos: readonly Compromiso[],
  etiquetaDe: (compromiso: Compromiso) => string,
): FilaDesglose[] {
  const conteo = new Map<string, number>();

  for (const compromiso of compromisos) {
    const etiqueta = etiquetaDe(compromiso) || '—';
    conteo.set(etiqueta, (conteo.get(etiqueta) ?? 0) + 1);
  }

  return Array.from(conteo, ([etiqueta, total]) => ({ etiqueta, total })).sort(
    (izquierda, derecha) =>
      derecha.total - izquierda.total || izquierda.etiqueta.localeCompare(derecha.etiqueta, 'es'),
  );
}

/** Fecha de una rejilla construida en UTC (`YYYY-MM-DD`). */
function isoDia(fecha: Date): string {
  const anio = fecha.getUTCFullYear();
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getUTCDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

/** Fecha local de hoy, sin pasar por `toISOString` para no cruzar de día. */
function isoHoy(): string {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = String(hoy.getMonth() + 1).padStart(2, '0');
  const dia = String(hoy.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

/** Fecha local de ayer en `YYYY-MM-DD`, sin cruzar de día por UTC. */
function isoAyer(): string {
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  const anio = ayer.getFullYear();
  const mes = String(ayer.getMonth() + 1).padStart(2, '0');
  const dia = String(ayer.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

/** `total` del sobre paginado sin construir las filas (consultas de indicadores). */
function totalDe(bruto: unknown): number {
  return normalizarColeccion<unknown>(bruto).total;
}

@Component({
  selector: 'app-compromisos',
  imports: [
    IconoComponent,
    PaginacionComponent,
    CompromisoPanelComponent,
    AnularPanelComponent,
    BarraSeleccionComponent,
    MatrizEquipoComponent,
    TablaComponent,
    CeldaTablaDirectiva,
  ],
  templateUrl: './compromisos.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .filter-bar {
      flex-wrap: wrap;
    }
    /*
     * Franja de cifras: una sola línea de indicadores pulsables, con el idioma
     * visual de la franja de realidad del caso (celdas separadas por la línea
     * del tema). Cada botón filtra la tabla y se marca con aria-pressed.
     */
    .reality-strip {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 1px;
      margin: 0 0 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--line);
      overflow: hidden;
    }
    .reality-strip button {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      min-width: 0;
      padding: 10px 12px;
      border: 0;
      background: var(--paper);
      color: var(--muted);
      font: inherit;
      font-size: 12.5px;
      text-align: left;
      cursor: pointer;
    }
    .reality-strip button:hover {
      background: var(--blue-pale);
    }
    .reality-strip button:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: -2px;
    }
    .reality-strip button[aria-pressed='true'] {
      background: var(--blue-pale);
      box-shadow: inset 0 -2px 0 var(--blue);
    }
    .reality-strip b {
      color: var(--ink);
      font-size: 18px;
      font-variant-numeric: tabular-nums;
      line-height: 1.1;
    }
    .reality-strip span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .aviso-ok {
      margin: 0;
      color: var(--green);
      font-size: 13.5px;
    }

    /*
     * app-tabla gobierna el hover y la fila abierta; aquí sólo quedan los
     * bloques de celda, que ahora viven dentro del ng-template (el td es
     * nowrap, así que el salto de línea se declara en el bloque interno).
     */
    .celda-compromiso {
      display: block;
      max-width: 320px;
      white-space: normal;
    }
    .celda-compromiso .compromiso-codigo {
      display: block;
      margin: 0 0 2px;
      font-size: 12px;
    }
    .compromiso-accion {
      display: block;
    }
    /*
     * Franja de hitos de una fila: un punto por hito, en orden de fecha. El
     * color sale de las variables de tema y el tamaño del punto lo aporta la
     * clase global status-dot; el anillo rojo marca el hito vencido y el
     * tachado el desestimado.
     */
    .hitos-franja {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 3px;
      margin-top: 4px;
      cursor: help;
    }
    .hito-punto {
      position: relative;
      flex: none;
    }
    .hito-registrado {
      color: var(--muted);
    }
    .hito-ejecucion {
      color: var(--blue);
    }
    .hito-paralizado {
      color: var(--amber);
    }
    .hito-cumplido {
      color: var(--green);
    }
    .hito-desestimado {
      color: var(--muted);
    }
    .hito-desestimado::after {
      content: '';
      position: absolute;
      top: 50%;
      left: -1px;
      right: -1px;
      height: 1px;
      background: currentColor;
      transform: translateY(-50%);
    }
    .hito-vencido {
      box-shadow: 0 0 0 1px var(--red);
    }
    .celda-vencimiento {
      display: block;
      white-space: normal;
    }
    .celda-vencimiento small {
      display: block;
      margin-top: 2px;
      color: var(--muted);
      font-size: 12px;
    }
    .celda-vencimiento .due-state {
      margin-left: 4px;
    }
    .aviso-fecha {
      color: var(--amber);
    }
    .anexo-observaciones {
      display: block;
      min-width: 220px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
      white-space: normal;
    }

    /* La papelera la nombra el código, no una acción: conserva su ancho menor. */
    :host ::ng-deep .tabla-papelera app-tabla .tabla tbody td.celda-principal {
      min-width: 132px;
      white-space: nowrap;
    }
    .calendario-barra {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      margin: 0 0 12px;
    }
    .calendario-nav {
      display: inline-flex;
      gap: 6px;
    }
    .calendario-titulo {
      margin: 0;
      font-size: 16px;
      color: #1c2a38;
    }
    .calendario-aviso {
      margin: 0 0 10px;
      padding: 8px 10px;
      border: 1px solid #f0d9b5;
      border-radius: 6px;
      background: #fff8ec;
      color: #8a5a1f;
      font-size: 12.5px;
      line-height: 1.45;
    }
    /* Si la rejilla no cabe se desplaza en horizontal antes que apilar días. */
    .calendario-wrap {
      overflow-x: auto;
      border: 1px solid #e6ecf1;
      border-radius: 8px;
    }
    .calendario-rejilla {
      width: 100%;
      min-width: 760px;
      table-layout: fixed;
    }
    .calendario-rejilla th {
      padding: 7px 6px;
      border-bottom: 1px solid #e6ecf1;
      color: #647487;
      font-size: 12px;
      font-weight: 700;
      text-align: center;
      text-transform: uppercase;
    }
    .calendario-rejilla td {
      height: 96px;
      padding: 5px;
      border: 1px solid #eef2f6;
      vertical-align: top;
    }
    .calendario-rejilla td:focus-visible {
      outline: 2px solid #1d4b86;
      outline-offset: -2px;
    }
    .calendario-dia-ajeno {
      opacity: 0.55;
    }
    .calendario-dia-hoy {
      outline: 2px solid #1d4b86;
      outline-offset: -2px;
    }
    .calendario-dia-hoy .calendario-numero {
      color: #1d4b86;
    }
    .calendario-numero {
      display: block;
      margin-bottom: 4px;
      color: #52677a;
      font-size: 12.5px;
      font-weight: 600;
    }
    .calendario-pastillas {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .calendario-pastilla {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 4px;
      width: 100%;
      padding: 2px 5px;
      border: 0;
      border-left: 3px solid transparent;
      border-radius: 4px;
      font-size: 12px;
      line-height: 1.3;
      text-align: left;
      cursor: pointer;
    }
    .calendario-pastilla.due-vencido {
      border-left-color: #ad4d46;
    }
    .calendario-pastilla.due-por-vencer {
      border-left-color: #93621d;
    }
    .calendario-pastilla.due-en-plazo {
      border-left-color: #34785b;
    }
    .calendario-pastilla:hover {
      filter: brightness(0.97);
    }
    .calendario-pastilla:focus-visible {
      outline: 2px solid #1d4b86;
      outline-offset: 1px;
    }
    .calendario-pastilla-codigo {
      overflow: hidden;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .calendario-pastilla-plazo {
      flex: none;
      font-size: 12px;
      font-weight: 700;
    }
    .calendario-mas {
      padding: 1px 2px;
      border: 0;
      background: transparent;
      color: #1d4b86;
      font-size: 12px;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
    }
    .calendario-mas:hover {
      text-decoration: underline;
    }
    .calendario-mas:focus-visible {
      outline: 2px solid #1d4b86;
      outline-offset: 1px;
    }
    .desglose-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
    }
    .desglose-card {
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--paper);
    }
    .desglose-card h3 {
      margin: 0 0 9px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .desglose-lista {
      display: flex;
      flex-direction: column;
      gap: 7px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .desglose-fila {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 3px 10px;
      font-size: 12.5px;
    }
    .desglose-etiqueta {
      overflow: hidden;
      color: var(--ink-2);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .desglose-barra {
      grid-column: 1 / -1;
      height: 3px;
      border-radius: 2px;
      background: var(--line);
    }
    .desglose-barra i {
      display: block;
      height: 100%;
      border-radius: 2px;
      background: var(--blue);
    }
    .desglose-cuenta {
      color: var(--ink);
      font-weight: 700;
      white-space: nowrap;
    }
    .desglose-cuenta small {
      margin-left: 3px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
    }
    .desglose-nota {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
  `,
})
export class CompromisosPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly registroSolicitado = toSignal(
    this.ruta.queryParamMap.pipe(map((params) => params.get('registrar'))),
    { initialValue: null },
  );
  private readonly http = inject(HttpClient);
  private readonly capacidades = inject(CapacidadesService);

  /** La papelera sólo se ofrece a quien puede anular y restaurar. */
  readonly puedeVerPapelera = this.capacidades.puedeEliminar;

  readonly estados = ESTADOS_COMPROMISO as readonly string[];
  readonly tipos = TIPOS_COMPROMISO as readonly string[];

  readonly seleccionado = signal<Compromiso | null>(null);

  /** Alta abierta en el panel; el panel sin compromiso es el modo alta. */
  readonly altaAbierta = signal(false);

  /** Aviso posterior a un alta correcta. */
  readonly avisoCreacion = signal<string | null>(null);

  /** El alta se ofrece a quien tiene permiso de escritura. */
  readonly puedeRegistrar = this.capacidades.puedeEditar;

  /** Selección de la tabla (página visible) para exportar o anular en lote. */
  readonly seleccion = new SeleccionTabla();

  /** Orden local de la página visible. */
  readonly orden = new OrdenTabla<Compromiso>();

  private readonly accesoresCompromiso: Record<string, (compromiso: Compromiso) => unknown> = {
    codigo: (compromiso) => compromiso.codigo,
    compromiso: (compromiso) => compromiso.accion,
    caso: (compromiso) => compromiso.casoCodigo,
    unidad: (compromiso) => compromiso.unidad,
    estado: (compromiso) => compromiso.estado,
    vencimiento: (compromiso) => compromiso.fechaVencimiento,
    anulado: (compromiso) => compromiso.anuladoEn,
  };

  readonly filasVisibles = computed(() =>
    this.orden.ordenar(this.compromisos(), this.accesoresCompromiso),
  );

  /** Ids marcados, en una referencia estable para `app-tabla`. */
  readonly idsSeleccionados = computed(() => this.seleccion.lista());

  /** Columnas de la matriz del Anexo 14, en el orden del mockup. */
  readonly columnasAnexo14: readonly ColumnaTabla[] = [
    { clave: 'compromiso', titulo: 'Compromiso', ordenable: true },
    { clave: 'unidad', titulo: 'Responsable', ordenable: true },
    {
      clave: 'fechaInicio',
      titulo: 'Fecha de inicio',
      formato: (valor) => this.fechaTexto(valor as string | null),
    },
    { clave: 'estado', titulo: 'Estado', ordenable: true },
    {
      clave: 'avance',
      titulo: 'Avance',
      acceso: (fila) => this.avanceTexto(fila as Compromiso),
    },
    { clave: 'observaciones', titulo: 'Observaciones' },
  ];

  /** Columnas de la papelera: mismo orden que el listado de anulados. */
  readonly columnasPapelera: readonly ColumnaTabla[] = [
    { clave: 'codigo', titulo: 'Código', ordenable: true },
    { clave: 'compromiso', titulo: 'Compromiso', ordenable: true },
    { clave: 'caso', titulo: 'Caso', ordenable: true },
    {
      clave: 'anulado',
      titulo: 'Fecha de anulación',
      ordenable: true,
      acceso: (fila) => (fila as Compromiso).anuladoEn,
      formato: (valor) => this.fechaHoraTexto(valor as string | null),
    },
    { clave: 'accion', titulo: 'Acción' },
  ];

  /** Columnas del listado activo. */
  readonly columnasListado: readonly ColumnaTabla[] = [
    { clave: 'compromiso', titulo: 'Compromiso', ordenable: true },
    { clave: 'caso', titulo: 'Caso', ordenable: true },
    { clave: 'unidad', titulo: 'Unidad responsable', ordenable: true },
    { clave: 'estado', titulo: 'Estado', ordenable: true },
    { clave: 'vencimiento', titulo: 'Vencimiento', ordenable: true },
  ];

  /** Orden que pinta `app-tabla`; la página sigue ordenando con `OrdenTabla`. */
  readonly ordenTabla = computed<OrdenColumna | null>(() => {
    const clave = this.orden.columna();
    return clave ? { clave, direccion: this.orden.direccion() } : null;
  });

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
    this.abrir(evento.fila as Compromiso);
  }

  /** Compromiso que se está anulando en el panel compartido. */
  readonly compromisoAnulacion = signal<Compromiso | null>(null);
  readonly enviandoAnulacion = signal(false);
  readonly errorAnulacion = signal<string | null>(null);
  readonly avisoAnulacion = signal<string | null>(null);

  /** Modo del panel compartido: anular pide motivo, restaurar no. */
  readonly modoAnulacion = signal<ModoAnulacion>('anular');

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  /** Vista activa: tabla paginada, calendario mensual o desglose por responsable y nivel. */
  readonly modo = signal<ModoVista>('tabla');

  private readonly hoy = new Date();
  readonly mesVisible = signal<MesCalendario>({
    anio: this.hoy.getFullYear(),
    mes: this.hoy.getMonth() + 1,
  });

  /** Días con «+N más» desplegado; se reinicia al cambiar de mes. */
  private readonly diasExpandidos = signal<ReadonlySet<string>>(new Set());

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({
        q: params.get('q') ?? '',
        pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
        tamano: Math.max(1, Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA),
        estado: params.get('estado') ?? '',
        tipo: params.get('tipo') ?? '',
        nivelGobierno: params.get('nivelGobierno') ?? '',
        atiendeGenero: params.get('atiendeGenero') ?? '',
        vencidos: params.get('vencidos') === '1',
        ver: params.get('ver') === 'anulados' ? 'anulados' : 'activos',
      })),
    ),
    {
      initialValue: {
        q: '',
        pagina: 1,
        tamano: TAMANO_PAGINA,
        estado: '',
        tipo: '',
        nivelGobierno: '',
        atiendeGenero: '',
        vencidos: false,
        ver: 'activos',
      } satisfies FiltrosCompromisos,
    },
  );

  readonly filtros = computed(() => this.parametros());

  /**
   * Filtros, búsqueda y orden vigentes, con los nombres que acepta
   * `GET /api/v1/commitments`. En el calendario se suman las fechas del mes
   * visible, que son el rango que la pantalla está consultando; el desglose usa
   * sólo los filtros, porque agrega el conjunto completo.
   */
  readonly filtrosExportacion = computed(() => {
    const filtros = this.filtros();
    const parametros: Record<string, string | null | undefined> = {
      q: filtros.q,
      estado: filtros.estado,
      tipo: filtros.tipo,
      nivelGobierno: filtros.nivelGobierno,
      atiendeGenero: filtros.atiendeGenero,
    };

    if (this.vistaCalendario()) {
      const calendario = this.calendario();
      parametros['vencimiento_desde'] = calendario.desde;
      parametros['vencimiento_hasta'] = calendario.hasta;
    }

    return parametrosConValor(parametros);
  });

  /** `?ver=anulados`: la tabla muestra la papelera y el calendario no aplica. */
  readonly verPapelera = computed(() => this.parametros().ver === 'anulados');

  /** El calendario no existe para registros anulados. */
  readonly vistaCalendario = computed(() => !this.verPapelera() && this.modo() === 'calendario');

  /** El desglose tampoco: la papelera se lista como tabla de restauración. */
  readonly vistaResumen = computed(() => !this.verPapelera() && this.modo() === 'resumen');

  /** La matriz del equipo (Anexo 15 × Anexo 14, formato A..W) tampoco lista la papelera. */
  readonly vistaMatriz = computed(() => !this.verPapelera() && this.modo() === 'matriz');

  /** La matriz del Anexo 14 lista los compromisos con sus columnas de seguimiento. */
  readonly vistaAnexo14 = computed(() => !this.verPapelera() && this.modo() === 'anexo14');

  /**
   * Rejilla del mes visible, de lunes a domingo. Incluye los días de los meses
   * vecinos que completan la primera y la última semana, para que el rango
   * consultado y lo dibujado coincidan.
   */
  private readonly rejilla = computed(() => {
    const { anio, mes } = this.mesVisible();
    const primero = new Date(Date.UTC(anio, mes - 1, 1));
    const inicio = new Date(primero.getTime() - ((primero.getUTCDay() + 6) % 7) * MS_DIA);
    const ultimo = new Date(Date.UTC(anio, mes, 0));
    const fin = new Date(ultimo.getTime() + (6 - ((ultimo.getUTCDay() + 6) % 7)) * MS_DIA);
    return { inicio, fin, desde: isoDia(inicio), hasta: isoDia(fin) };
  });

  private readonly recurso = consulta<Coleccion<Compromiso>>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/commitments'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        anulados: filtros.ver === 'anulados' ? 'true' : '',
        q: filtros.q,
        estado: filtros.estado,
        tipo: filtros.tipo,
        nivelGobierno: filtros.nivelGobierno,
        atiendeGenero: filtros.atiendeGenero,
        // «Vencidos» es el mismo corte que usa el semáforo de la fila:
        // vencimiento efectivo anterior a hoy (la API compara <= hasta).
        vencimiento_hasta: filtros.vencidos ? isoAyer() : '',
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return {
        ...coleccion,
        elementos: coleccion.elementos.map(aCompromiso),
      } satisfies Coleccion<Compromiso>;
    },
  });

  readonly compromisos = computed(() => this.recurso.valor()?.elementos ?? []);
  readonly total = computed(() => this.recurso.valor()?.total ?? 0);
  readonly estado = this.recurso.estado;
  readonly error = this.recurso.error;
  readonly rango = computed(() => {
    const valor = this.recurso.valor();
    return valor ? rangoPagina(valor) : { desde: 0, hasta: 0 };
  });

  readonly resumenTabla = computed(() => {
    const rango = this.rango();
    return `${this.total()} compromisos · ${rango.desde}–${rango.hasta} · el vencimiento manual prevalece sobre el derivado del próximo hito.`;
  });

  /** Pie de la papelera: sólo lo que devuelve la API, sin estimar nada. */
  readonly resumenPapelera = computed(() => {
    const rango = this.rango();
    return `${this.total()} compromisos anulados · ${rango.desde}–${rango.hasta}`;
  });

  /**
   * Indicadores de la pantalla (item 112): totales del servidor, no de la página
   * visible. Cada cifra repite el recorte de filtros con un `estado` adicional (o
   * el corte de vencidos) y lee `total` con `pageSize=1`. Se ocultan en la papelera.
   */
  private contar(extra: Record<string, string | undefined>) {
    return consulta<number>({
      fuente: () => {
        const filtros = this.parametros();
        return urlConParametros(urlApi('/v1/commitments'), {
          ...paramsDePagina({ pagina: 1, tamano: 1 }),
          anulados: filtros.ver === 'anulados' ? 'true' : '',
          q: filtros.q,
          estado: filtros.estado,
          tipo: filtros.tipo,
          nivelGobierno: filtros.nivelGobierno,
          atiendeGenero: filtros.atiendeGenero,
          vencimiento_hasta: filtros.vencidos ? isoAyer() : '',
          ...extra,
        });
      },
      esquema: totalDe,
    });
  }

  /*
   * Cuatro cifras, cada una independiente de la dimensión que representa:
   * «compromisos» ignora estado y vencidos; «cumplidos» y «en proceso» fijan su
   * estado; «vencidos» aplica el mismo corte de vencimiento efectivo que el
   * semáforo de la tabla. «Sin hitos» y «sin validar» no se muestran porque la
   * API no ofrece ni filtro ni agregado para ellos.
   */
  private readonly todosRec = this.contar({ estado: undefined, vencimiento_hasta: undefined });
  private readonly cumplidosRec = this.contar({
    estado: 'Cumplido',
    vencimiento_hasta: undefined,
  });
  private readonly enProcesoRec = this.contar({
    estado: 'En proceso',
    vencimiento_hasta: undefined,
  });
  private readonly vencidosRec = this.contar({ estado: undefined, vencimiento_hasta: isoAyer() });

  /**
   * Texto de una cifra: «…» mientras la consulta no resuelve y «—» sólo si
   * falló. Antes cualquier valor ausente (incluida la carga) se pintaba «—»,
   * que se leía como un cero desconocido.
   */
  private textoCifra(recurso: Consulta<number>): string {
    if (recurso.estado() === 'error') return '—';
    const valor = recurso.valor();
    return valor === undefined ? '…' : String(valor);
  }

  readonly cifraCompromisos = computed(() => this.textoCifra(this.todosRec));
  readonly cifraCumplidos = computed(() => this.textoCifra(this.cumplidosRec));
  readonly cifraEnProceso = computed(() => this.textoCifra(this.enProcesoRec));
  readonly cifraVencidos = computed(() => this.textoCifra(this.vencidosRec));

  /** Cifra que corresponde al filtro vigente; se marca con `aria-pressed`. */
  readonly indicadorActivo = computed<IndicadorCompromisos>(() => {
    const { estado, vencidos } = this.parametros();
    if (vencidos) return 'vencidos';
    if (estado === 'Cumplido') return 'cumplido';
    if (estado === 'En proceso') return 'enProceso';
    return 'todos';
  });

  /** Cada cifra filtra la tabla: fija su dimensión y reinicia la paginación. */
  filtrarIndicador(indicador: IndicadorCompromisos): void {
    const cambios: Partial<FiltrosCompromisos> = { pagina: 1, estado: '', vencidos: false };
    if (indicador === 'cumplido') cambios.estado = 'Cumplido';
    if (indicador === 'enProceso') cambios.estado = 'En proceso';
    if (indicador === 'vencidos') cambios.vencidos = true;
    // Las cifras describen la tabla; si se pulsa desde otra vista, se vuelve a ella.
    this.modo.set('tabla');
    void this.actualizar(cambios);
  }

  /**
   * El calendario no pagina de 25 en 25: pide el rango completo de la rejilla
   * (con los filtros activos) y se queda con el tope de la API. `total` avisa
   * si se cortó.
   */
  private readonly recursoCalendario = consulta<Coleccion<Compromiso>>({
    fuente: () => {
      if (!this.vistaCalendario()) return null;

      const filtros = this.parametros();
      const rango = this.rejilla();

      return urlConParametros(urlApi('/v1/commitments'), {
        ...paramsDePagina({ pagina: 1, tamano: TAMANO_CALENDARIO }),
        vencimiento_desde: rango.desde,
        vencimiento_hasta: rango.hasta,
        q: filtros.q,
        estado: filtros.estado,
        tipo: filtros.tipo,
        nivelGobierno: filtros.nivelGobierno,
        atiendeGenero: filtros.atiendeGenero,
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return {
        ...coleccion,
        elementos: coleccion.elementos.map(aCompromiso),
      } satisfies Coleccion<Compromiso>;
    },
  });

  readonly compromisosCalendario = computed(() => this.recursoCalendario.valor()?.elementos ?? []);
  readonly totalCalendario = computed(() => this.recursoCalendario.valor()?.total ?? 0);
  readonly estadoCalendario = this.recursoCalendario.estado;
  readonly errorCalendario = this.recursoCalendario.error;

  /**
   * Conjunto filtrado para el desglose por responsable y nivel de gobierno. Se
   * calcula sobre lo que devuelve el filtro, no sobre la página: se pide el tope
   * de la API y, si quedan filas fuera, la pantalla lo avisa (misma regla que
   * el calendario) en lugar de inventar el resto.
   */
  private readonly recursoResumen = consulta<Coleccion<Compromiso>>({
    fuente: () => {
      if (!this.vistaResumen()) return null;

      const filtros = this.parametros();

      return urlConParametros(urlApi('/v1/commitments'), {
        ...paramsDePagina({ pagina: 1, tamano: TAMANO_DESGLOSE }),
        q: filtros.q,
        estado: filtros.estado,
        tipo: filtros.tipo,
        nivelGobierno: filtros.nivelGobierno,
        atiendeGenero: filtros.atiendeGenero,
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return {
        ...coleccion,
        elementos: coleccion.elementos.map(aCompromiso),
      } satisfies Coleccion<Compromiso>;
    },
  });

  readonly compromisosResumen = computed(() => this.recursoResumen.valor()?.elementos ?? []);
  readonly totalResumen = computed(() => this.recursoResumen.valor()?.total ?? 0);
  readonly estadoResumen = this.recursoResumen.estado;
  readonly errorResumen = this.recursoResumen.error;

  /** `true` cuando el filtro devuelve más filas que el tope leído. */
  readonly desgloseTruncado = computed(
    () => this.totalResumen() > this.compromisosResumen().length,
  );

  readonly desgloseResponsable = computed(() =>
    agruparPor(this.compromisosResumen(), (compromiso) => compromiso.unidad ?? '—'),
  );

  readonly desgloseNivel = computed(() =>
    agruparPor(this.compromisosResumen(), (compromiso) =>
      etiquetaNivelGobierno(compromiso.nivelGobierno),
    ),
  );

  readonly maxPastillas = MAX_PASTILLAS;
  readonly diasSemana = DIAS_SEMANA;

  readonly calendario = computed<Calendario>(() => {
    const { anio, mes } = this.mesVisible();
    const rejilla = this.rejilla();
    const hoy = isoHoy();
    const expandidos = this.diasExpandidos();

    const porFecha = new Map<string, CompromisoDia[]>();
    for (const compromiso of this.compromisosCalendario()) {
      const { fecha } = resolverVencimiento(compromiso);
      if (!fecha) continue;

      const clave = fecha.slice(0, 10);
      const plazo = this.plazoDe(compromiso);
      const caso = compromiso.casoCodigo ? `caso ${compromiso.casoCodigo}` : 'sin caso asociado';
      const item: CompromisoDia = {
        compromiso,
        plazo,
        etiqueta: `Compromiso ${compromiso.codigo}, ${caso}, vence el ${formatearFecha(
          clave,
        )}: ${plazo.texto}. ${compromiso.accion}`,
      };

      const lista = porFecha.get(clave);
      if (lista) lista.push(item);
      else porFecha.set(clave, [item]);
    }

    const totalDias = Math.round((rejilla.fin.getTime() - rejilla.inicio.getTime()) / MS_DIA) + 1;
    const dias: DiaCalendario[] = [];
    let totalMes = 0;

    for (let i = 0; i < totalDias; i += 1) {
      const fecha = new Date(rejilla.inicio.getTime() + i * MS_DIA);
      const clave = isoDia(fecha);
      const delMes = fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1;
      const items = porFecha.get(clave) ?? [];
      if (delMes) totalMes += items.length;

      const expandido = expandidos.has(clave);
      const visibles = expandido ? items : items.slice(0, MAX_PASTILLAS);
      const nombreFecha = `${fecha.getUTCDate()} de ${MESES[
        fecha.getUTCMonth()
      ].toLowerCase()} de ${fecha.getUTCFullYear()}`;
      const cuenta =
        items.length === 0
          ? 'sin compromisos'
          : items.length === 1
            ? '1 compromiso'
            : `${items.length} compromisos`;

      dias.push({
        fecha: clave,
        dia: fecha.getUTCDate(),
        delMes,
        esHoy: clave === hoy,
        nombreFecha,
        etiqueta: `${delMes ? 'Día ' : ''}${nombreFecha}, ${cuenta}`,
        visibles,
        restantes: Math.max(0, items.length - MAX_PASTILLAS),
        expandido,
        total: items.length,
      });
    }

    return {
      titulo: `${MESES[mes - 1]} ${anio}`,
      dias,
      totalMes,
      truncado: this.totalCalendario() > this.compromisosCalendario().length,
      desde: rejilla.desde,
      hasta: rejilla.hasta,
    };
  });

  /** Filas de la tabla: siempre bloques de siete días. */
  readonly semanas = computed(() => {
    const dias = this.calendario().dias;
    const semanas: DiaCalendario[][] = [];
    for (let i = 0; i < dias.length; i += 7) {
      semanas.push(dias.slice(i, i + 7));
    }
    return semanas;
  });

  private temporizador?: ReturnType<typeof setTimeout>;

  buscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      void this.actualizar({ q: valor, pagina: 1 });
    }, 300);
  }

  filtrarEstado(evento: Event): void {
    // Elegir un estado a mano descarta el corte de «vencidos» de la franja.
    void this.actualizar({ estado: this.valorDe(evento), vencidos: false, pagina: 1 });
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

  cambiarModo(modo: ModoVista): void {
    this.modo.set(modo);
    // «Vencidos» sólo filtra el listado; en calendario, resumen o matriz no aplica.
    if (modo !== 'tabla' && modo !== 'anexo14' && this.parametros().vencidos) {
      void this.actualizar({ vencidos: false });
    }
  }

  /** Cambia entre activos y papelera; reinicia a la primera página. */
  cambiarVer(ver: VerRegistros): void {
    this.cerrarPanel();
    this.cerrarAlta();
    this.cerrarAnulacion();
    // La papelera oculta la franja: no puede quedar un filtro de vencidos invisible.
    void this.actualizar({ ver, vencidos: false, pagina: 1 });
  }

  mesAnterior(): void {
    this.desplazarMes(-1);
  }

  mesSiguiente(): void {
    this.desplazarMes(1);
  }

  irAHoy(): void {
    const hoy = new Date();
    this.mesVisible.set({ anio: hoy.getFullYear(), mes: hoy.getMonth() + 1 });
    this.diasExpandidos.set(new Set());
  }

  alternarDia(fecha: string): void {
    this.diasExpandidos.update((actual) => {
      const siguiente = new Set(actual);
      if (siguiente.has(fecha)) siguiente.delete(fecha);
      else siguiente.add(fecha);
      return siguiente;
    });
  }

  recargarCalendario(): void {
    this.recursoCalendario.recargar();
  }

  recargarResumen(): void {
    this.recursoResumen.recargar();
  }

  /** Porcentaje de una fila del desglose sobre el conjunto leído. */
  porcentaje(cantidad: number): number {
    const base = this.compromisosResumen().length;
    return base ? Math.round((cantidad / base) * 100) : 0;
  }

  limpiar(): void {
    void this.router.navigate([], {
      relativeTo: this.ruta,
      // `ver` no es un filtro: se conserva la pestaña (activos o papelera).
      queryParams: { ver: this.verPapelera() ? 'anulados' : null },
      replaceUrl: true,
    });
  }

  recargar(): void {
    this.recurso.recargar();
  }

  alAnularLote(cantidad: number): void {
    this.seleccion.limpiar();
    this.avisoAnulacion.set(
      cantidad === 1 ? '1 registro anulado.' : `${cantidad} registros anulados.`,
    );
    this.alActualizar();
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  abrir(compromiso: Compromiso): void {
    this.cerrarAlta();
    this.seleccionado.set(compromiso);
  }

  cerrarPanel(): void {
    this.seleccionado.set(null);
  }

  constructor() {
    effect(() => {
      if (this.registroSolicitado() !== 'compromiso') return;
      this.abrirAlta();
      void this.router.navigate([], {
        relativeTo: this.ruta,
        queryParams: { registrar: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });
  }

  abrirAlta(): void {
    if (!this.puedeRegistrar()) return;
    this.cerrarPanel();
    this.cerrarAnulacion();
    this.avisoCreacion.set(null);
    this.altaAbierta.set(true);
  }

  cerrarAlta(): void {
    this.altaAbierta.set(false);
  }

  /** Tras el `POST` correcto: cierra el panel, recarga el listado y avisa. */
  alCrear(): void {
    this.altaAbierta.set(false);
    this.avisoCreacion.set('Compromiso registrado.');
    if (this.verPapelera()) {
      void this.actualizar({ ver: 'activos', pagina: 1 });
      return;
    }
    this.alActualizar();
  }

  alActualizar(): void {
    this.recurso.recargar();
    if (this.vistaCalendario()) this.recursoCalendario.recargar();
    if (this.vistaResumen()) this.recursoResumen.recargar();
  }

  /** Anular exige el privilegio de anulación y escritura sobre la clasificación. */
  puedeAnular(compromiso: Compromiso): boolean {
    return (
      this.capacidades.puedeEliminar() && this.capacidades.puedeModificar(compromiso.clasificacion)
    );
  }

  abrirAnulacion(compromiso: Compromiso): void {
    if (!compromiso.id || !this.puedeAnular(compromiso)) return;
    this.errorAnulacion.set(null);
    this.avisoAnulacion.set(null);
    // El panel del compromiso y el de anulación escuchan Escape en `document`:
    // se deja abierto uno solo.
    this.cerrarPanel();
    this.modoAnulacion.set('anular');
    this.compromisoAnulacion.set(compromiso);
  }

  /**
   * Restaurar desde la papelera: no pide motivo. No se abre el panel de detalle
   * porque `GET /v1/commitments/{id}` responde 404 mientras el registro está
   * anulado; la acción vive en la propia fila.
   */
  abrirRestauracion(compromiso: Compromiso): void {
    if (!compromiso.id || !this.puedeVerPapelera()) return;
    this.errorAnulacion.set(null);
    this.avisoAnulacion.set(null);
    this.cerrarPanel();
    this.modoAnulacion.set('restaurar');
    this.compromisoAnulacion.set(compromiso);
  }

  cerrarAnulacion(): void {
    this.compromisoAnulacion.set(null);
    this.errorAnulacion.set(null);
  }

  /**
   * `DELETE /v1/commitments/{id}` con `{ motivo }` es la anulación lógica: la fila
   * deja de devolverse y sus hitos caen en cascada. Restaurar no lleva cuerpo.
   *
   * Al terminar se recarga el listado: no hay navegación, así que los filtros y
   * la página que viven en la URL se conservan.
   */
  confirmarAnulacion(resultado: ResultadoAnulacion): void {
    const compromiso = this.compromisoAnulacion();
    if (!compromiso?.id) return;

    const anular = resultado.modo === 'anular';
    const motivo = (resultado.motivo ?? '').trim();
    if (anular && !motivo) return;

    const id = encodeURIComponent(compromiso.id);
    const peticion = anular
      ? this.http.delete<unknown>(urlApi(`/v1/commitments/${id}`), { body: { motivo } })
      : this.http.post<unknown>(urlApi(`/v1/commitments/${id}/restaurar`), null);

    this.enviandoAnulacion.set(true);
    this.errorAnulacion.set(null);

    peticion.subscribe({
      next: () => {
        this.enviandoAnulacion.set(false);
        this.compromisoAnulacion.set(null);
        this.avisoAnulacion.set(
          anular
            ? `Compromiso ${compromiso.codigo} anulado. Sus hitos quedaron anulados en cascada.`
            : `Compromiso ${compromiso.codigo} restaurado.`,
        );
        this.alActualizar();
      },
      error: (fallo: unknown) => {
        this.enviandoAnulacion.set(false);
        this.errorAnulacion.set(aErrorApi(fallo).message);
      },
    });
  }

  /**
   * Traduce la situación de la tabla al vocabulario del calendario, sin
   * cambiar la regla: `situacionDe` sigue decidiendo vencido / por vencer.
   */
  private plazoDe(compromiso: Compromiso): PlazoCompromiso {
    const { clase } = situacionDe(compromiso);
    if (clase === 'due-vencido') return { texto: 'Vencido', clase };
    if (clase === 'due-por-vencer') return { texto: 'Por vencer', clase };
    if (clase === 'due-en-plazo') return { texto: 'Vigente', clase };
    return { texto: 'Sin fecha', clase };
  }

  private desplazarMes(delta: number): void {
    const { anio, mes } = this.mesVisible();
    const indice = anio * 12 + (mes - 1) + delta;
    const siguienteAnio = Math.floor(indice / 12);
    const siguienteMes = (indice % 12) + 1;
    this.mesVisible.set({ anio: siguienteAnio, mes: siguienteMes });
    this.diasExpandidos.set(new Set());
  }

  vencimiento(compromiso: Compromiso): ResolucionVencimiento {
    return resolverVencimiento(compromiso);
  }

  /** Semáforo de la fila: vencido, por vencer, en plazo o sin fecha. */
  situacion(compromiso: Compromiso): Situacion {
    return situacionDe(compromiso);
  }

  /**
   * Hitos de la franja, en orden de fecha. Los que no tienen fecha tipada (por
   * ejemplo «Julio 2026») van al final, ordenados por código.
   */
  hitosOrdenados(compromiso: Compromiso): Hito[] {
    return [...compromiso.hitos].sort((izquierda, derecha) => {
      const fechaIzquierda = izquierda.fecha ?? '';
      const fechaDerecha = derecha.fecha ?? '';
      if (fechaIzquierda && fechaDerecha && fechaIzquierda !== fechaDerecha) {
        return fechaIzquierda < fechaDerecha ? -1 : 1;
      }
      if (fechaIzquierda && !fechaDerecha) return -1;
      if (!fechaIzquierda && fechaDerecha) return 1;
      return (izquierda.codigo ?? '').localeCompare(derecha.codigo ?? '', 'es');
    });
  }

  /** Vencido es fecha planificada pasada en un hito que todavía no es terminal. */
  hitoVencido(hito: Hito): boolean {
    if (!hito.fecha || hito.terminal) return false;
    return hito.fecha.slice(0, 10) < isoHoy();
  }

  /** Clases del punto: base de `status-dot`, color por estado y anillo si venció. */
  clasesHito(hito: Hito): string {
    const clases = ['hito-punto', 'status-dot', this.claseEstadoHito(hito.estado)];
    if (this.hitoVencido(hito)) clases.push('hito-vencido');
    return clases.join(' ');
  }

  /** Texto accesible de la franja: estado y fecha de cada hito, en orden. */
  resumenHitos(compromiso: Compromiso): string {
    const hitos = this.hitosOrdenados(compromiso);
    const partes = hitos.map((hito) => {
      const fecha = hito.fecha ? this.fechaTexto(hito.fecha) : hito.fechaTexto || 'sin fecha';
      return `${hito.estado} (${fecha})${this.hitoVencido(hito) ? ', vencido' : ''}`;
    });
    return `Hitos: ${partes.join('; ')}`;
  }

  private claseEstadoHito(estado: EstadoHito): string {
    if (estado === 'En ejecución') return 'hito-ejecucion';
    if (estado === 'Paralizado') return 'hito-paralizado';
    if (estado === 'Cumplido') return 'hito-cumplido';
    if (estado === 'Desestimado') return 'hito-desestimado';
    return 'hito-registrado';
  }

  /**
   * Avance del Anexo 14: hitos cumplidos sobre hitos registrados del
   * compromiso. Sin hitos no se estima nada: se declara «Sin hitos».
   */
  avanceTexto(compromiso: Compromiso): string {
    const total = compromiso.hitos.length;
    if (total === 0) return 'Sin hitos';
    const cumplidos = compromiso.hitos.filter((hito) => hito.estado === 'Cumplido').length;
    return `${cumplidos}/${total} hitos cumplidos`;
  }

  /**
   * La matriz del Anexo 14 no tiene columna de observaciones y AVISA no guarda
   * texto libre por compromiso: se muestra sólo lo declarado, sin inventar.
   */
  observacionesTexto(compromiso: Compromiso): string {
    const partes = [`Vencimiento: ${situacionDe(compromiso).etiqueta}`];
    if (compromiso.tematica) partes.push(`Temática: ${compromiso.tematica}`);
    if (compromiso.alcance) partes.push(`Alcance: ${compromiso.alcance}`);
    return partes.join(' · ');
  }

  origenTexto(origen: OrigenVencimiento): string {
    if (origen === 'manual') return 'Fecha manual';
    if (origen === 'hito') return 'Derivada del próximo hito';
    return 'Sin fecha';
  }

  fechaTexto(valor: string | null | undefined): string {
    return formatearFecha(valor);
  }

  fechaHoraTexto(valor: string | null | undefined): string {
    return formatearFechaHora(valor);
  }

  private valorDe(evento: Event): string {
    return (evento.target as HTMLSelectElement).value;
  }

  private actualizar(cambios: Partial<FiltrosCompromisos>): void {
    const siguiente = { ...this.parametros(), ...cambios };

    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        q: siguiente.q || null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
        estado: siguiente.estado || null,
        tipo: siguiente.tipo || null,
        nivelGobierno: siguiente.nivelGobierno || null,
        atiendeGenero: siguiente.atiendeGenero || null,
        vencidos: siguiente.vencidos ? '1' : null,
        ver: siguiente.ver === 'anulados' ? 'anulados' : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
