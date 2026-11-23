import { HttpClient } from '@angular/common/http';
import {   ChangeDetectionStrategy,
  Component,
  computed,
  effect, inject, signal } from '@angular/core';
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
import {
  AnularPanelComponent,
  type ModoAnulacion,
  type ResultadoAnulacion,
} from '../../shared/ui/anular-panel.component';
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { GlosarioComponent } from '../../shared/ui/glosario.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import {
  ESTADOS_COMPROMISO,
  NIVELES_GOBIERNO,
  TIPOS_COMPROMISO,
  aCompromiso,
  etiquetaNivelGobierno,
  formatearFecha,
  formatearFechaHora,
  resolverVencimiento,
  situacionDe,
  type Compromiso,
  type OrigenVencimiento,
  type ResolucionVencimiento,
  type Situacion,
} from './compromiso.mapeo';
import { CompromisoPanelComponent } from './compromiso-panel.component';

type FiltrosCompromisos = {
  q: string;
  pagina: number;
  tamano: number;
  estado: string;
  tipo: string;
  nivelGobierno: string;
  atiendeGenero: string;
  ver: VerRegistros;
};

const GENERO = [
  { valor: '', etiqueta: 'Todos' },
  { valor: 'true', etiqueta: 'Sí atiende brecha de género' },
  { valor: 'false', etiqueta: 'No atiende brecha de género' },
] as const;

type ModoVista = 'tabla' | 'calendario' | 'resumen';

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

/** `total` del sobre paginado sin construir las filas (consultas de indicadores). */
function totalDe(bruto: unknown): number {
  return normalizarColeccion<unknown>(bruto).total;
}

@Component({
  selector: 'app-compromisos',
  imports: [
    IconoComponent,
    GlosarioComponent,
    PaginacionComponent,
    CompromisoPanelComponent,
    AnularPanelComponent,
    ExportarMenuComponent,
  ],
  templateUrl: './compromisos.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .filter-bar {
      flex-wrap: wrap;
    }
    .aviso-ok {
      margin: 0;
      color: #2f6f52;
      font-size: 11.5px;
    }
    .fila-compromiso {
      cursor: pointer;
    }
    .fila-compromiso:hover,
    .fila-compromiso:focus-within {
      background: #fafbfc;
    }
    .data-table td:first-child {
      min-width: 132px;
    }
    .celda-compromiso {
      max-width: 320px;
      white-space: normal;
    }
    .celda-vencimiento {
      white-space: normal;
    }
    .celda-vencimiento small {
      display: block;
      margin-top: 2px;
      color: #8d99a6;
      font-size: 8px;
    }
    .celda-vencimiento .due-state {
      margin-left: 4px;
    }
    .aviso-fecha {
      color: #a27435 !important;
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
      font-size: 15px;
      color: #1c2a38;
    }
    .calendario-resumen {
      margin: 0 0 0 auto;
      color: #647487;
      font-size: 10px;
    }
    .calendario-aviso {
      margin: 0 0 10px;
      padding: 8px 10px;
      border: 1px solid #f0d9b5;
      border-radius: 6px;
      background: #fff8ec;
      color: #8a5a1f;
      font-size: 10px;
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
      font-size: 9px;
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
      font-size: 10px;
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
      font-size: 8.5px;
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
      font-size: 8px;
      font-weight: 700;
    }
    .calendario-mas {
      padding: 1px 2px;
      border: 0;
      background: transparent;
      color: #1d4b86;
      font-size: 8px;
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
      font-size: 9px;
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
      font-size: 10px;
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
      font-size: 8.5px;
      font-weight: 600;
    }
    .desglose-nota {
      margin: 0;
      color: var(--muted);
      font-size: 9.5px;
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
  readonly niveles = NIVELES_GOBIERNO as readonly string[];
  readonly generos = GENERO;

  readonly seleccionado = signal<Compromiso | null>(null);

  /** Alta abierta en el panel; el panel sin compromiso es el modo alta. */
  readonly altaAbierta = signal(false);

  /** Aviso posterior a un alta correcta. */
  readonly avisoCreacion = signal<string | null>(null);

  /** El alta se ofrece a quien tiene permiso de escritura. */
  readonly puedeRegistrar = this.capacidades.puedeEditar;

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
   * visible. Cada tarjeta repite el recorte de filtros con un `estado` adicional
   * y lee `total` con `pageSize=1`. Se ocultan en la papelera.
   */
  private contar(extra: Record<string, string>) {
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
          ...extra,
        });
      },
      esquema: totalDe,
    });
  }

  private readonly cumplidosRec = this.contar({ estado: 'Cumplido' });
  private readonly enProcesoRec = this.contar({ estado: 'En proceso' });
  private readonly porIniciarRec = this.contar({ estado: 'Por iniciar' });

  readonly cumplidos = computed(() => this.cumplidosRec.valor() ?? null);
  readonly enProceso = computed(() => this.enProcesoRec.valor() ?? null);
  readonly porIniciar = computed(() => this.porIniciarRec.valor() ?? null);

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
    void this.actualizar({ estado: this.valorDe(evento), pagina: 1 });
  }

  filtrarTipo(evento: Event): void {
    void this.actualizar({ tipo: this.valorDe(evento), pagina: 1 });
  }

  filtrarNivel(evento: Event): void {
    void this.actualizar({ nivelGobierno: this.valorDe(evento), pagina: 1 });
  }

  filtrarGenero(evento: Event): void {
    void this.actualizar({ atiendeGenero: this.valorDe(evento), pagina: 1 });
  }

  cambiarPagina(pagina: number): void {
    void this.actualizar({ pagina });
  }

  cambiarTamano(tamano: number): void {
    void this.actualizar({ tamano, pagina: 1 });
  }

  cambiarModo(modo: ModoVista): void {
    this.modo.set(modo);
  }

  /** Cambia entre activos y papelera; reinicia a la primera página. */
  cambiarVer(ver: VerRegistros): void {
    this.cerrarPanel();
    this.cerrarAlta();
    this.cerrarAnulacion();
    void this.actualizar({ ver, pagina: 1 });
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

  origenTexto(origen: OrigenVencimiento): string {
    if (origen === 'manual') return 'Fecha manual';
    if (origen === 'hito') return 'Derivada del próximo hito';
    return 'Sin fecha';
  }

  situacion(compromiso: Compromiso): Situacion {
    return situacionDe(compromiso);
  }

  fechaTexto(valor: string | null | undefined): string {
    return formatearFecha(valor);
  }

  /** «Regional» se muestra como GORE; a la API sigue viajando el valor del catálogo. */
  nivelTexto(valor: string | null | undefined): string {
    return etiquetaNivelGobierno(valor ?? null);
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
        ver: siguiente.ver === 'anulados' ? 'anulados' : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
