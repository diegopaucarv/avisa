import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, map, of } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import {
  Coleccion,
  TAMANO_PAGINA,
  normalizarColeccion,
  parametrosConValor,
  paramsDePagina,
  totalPaginas,
  urlConParametros,
} from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import {
  ALCANCES,
  aCaso,
  esRegistro,
  formatearFechaCaso,
  formatearFechaCorta,
  leer,
  texto,
} from '../../dominio/mapeo';
import type { Caso } from '../../dominio/modelos';
import { formatearFechaHora } from '../../shared/formato-fecha';
import { BarraSeleccionComponent } from '../../shared/ui/barra-seleccion.component';

import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { OrdenTabla } from '../../shared/ui/orden-tabla';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import { SeleccionTabla } from '../../shared/ui/seleccion-tabla';
import { ThOrdenDirective } from '../../shared/ui/th-orden.directive';
import { CasoPanelComponent, type CuerpoCasoAlta } from './caso-panel.component';
import { CasoVistaPreviaComponent } from './caso-vista-previa.component';
import { aDuplicados, type DuplicadoCandidatoFila } from './duplicados.mapeo';
import { aNudosSemana, type NudosSemanaTablero } from './nudos-matriz.mapeo';

/**
 * Código del caso recién creado. `POST /api/v1/cases` devuelve el `CaseDetail`
 * completo (`{ case: {...} }`), no una fila suelta.
 */
function codigoDeCasoCreado(bruto: unknown): string | null {
  const registro = esRegistro(bruto) ? bruto : {};
  const detalle = leer(registro, ['caso', 'case']);
  const fila = esRegistro(detalle) ? detalle : registro;
  return texto(fila, ['codigo', 'code', 'codigoCaso']);
}

type ModoVista = 'tarjetas' | 'tabla';
type VerRegistros = 'activos' | 'anulados';

type FiltrosCasos = {
  q: string;
  estado: string;
  /** `abiertos=true`: estados del catálogo con `es_activo` (hoy sólo `Abierto`). */
  abiertos: boolean;
  /** Código de `core.cat_niveles_conflicto`; la API lo valida contra el catálogo. */
  nivel: string;
  /** Código de `core.cat_niveles_riesgo`; eje distinto de la conflictividad. */
  riesgo: string;
  prioridad: string;
  alcance: string;
  /** Nombre canónico de `core.regiones`; la API lo normaliza y lo valida. */
  region: string;
  /**
   * Complemento de `region`: casos sin región principal. Excluyentes entre sí
   * (`sinRegion` gana en el repositorio), por eso la barra los trata como una
   * sola lista desplegable.
   */
  sinRegion: boolean;
  /**
   * Naturaleza declarada (`Territorial` / `Nacional o sectorial`) o el literal
   * «Sin declarar», que la API traduce a `naturaleza_id is null`.
   */
  naturaleza: string;
  unidad: string;
  pagina: number;
  tamano: number;
  orden: string;
  ver: VerRegistros;
};

const FILTROS_INICIALES: FiltrosCasos = {
  q: '',
  estado: '',
  abiertos: false,
  nivel: '',
  riesgo: '',
  prioridad: '',
  alcance: '',
  region: '',
  sinRegion: false,
  naturaleza: '',
  unidad: '',
  pagina: 1,
  tamano: TAMANO_PAGINA,
  orden: 'recent',
  ver: 'activos',
};

const ORDENES = [
  { valor: 'recent', etiqueta: 'Fecha (más reciente)' },
  { valor: 'risk', etiqueta: 'Riesgo (Alto → Bajo)' },
  { valor: 'priority', etiqueta: 'Prioridad (Urgente → Bajo)' },
] as const;

/** Clave de `localStorage` que guarda el ámbito predeterminado (item 28). */
const CLAVE_ALCANCE = 'avisa-alcance';

/**
 * Centinela de la lista de regiones para «sin región principal». No es un valor
 * de `core.regiones`: la barra lo traduce a `sinregion=true`.
 */
const SIN_REGION = '__sin_region__';

/**
 * Ámbito predeterminado elegido en Preferencias. Es un filtro de presentación,
 * no un permiso: el ámbito de la sesión lo aplica la RLS. Sólo se toma cuando la
 * URL no trae `alcance`, y `alcance=todos` lo desactiva de forma explícita para
 * que el usuario pueda limpiarlo sin que vuelva a aplicarse al recargar.
 */
function alcancePreferido(): string {
  try {
    const valor = window.localStorage.getItem(CLAVE_ALCANCE) ?? '';
    return (ALCANCES as readonly string[]).includes(valor) ? valor : '';
  } catch {
    return '';
  }
}

/** Opción de `GET /api/v1/catalogs` para los selects de filtro. */
type OpcionFiltro = {
  valor: string;
  etiqueta: string;
};

type CatalogosCasos = {
  conflictividades: OpcionFiltro[];
  riesgos: OpcionFiltro[];
  prioridades: OpcionFiltro[];
  alcances: OpcionFiltro[];
  regiones: OpcionFiltro[];
  naturalezas: OpcionFiltro[];
  unidades: OpcionFiltro[];
};

function opcionesDe(catalogo: Record<string, unknown>, clave: string): OpcionFiltro[] {
  const crudo = leer(catalogo, [clave]);
  if (!Array.isArray(crudo)) return [];

  const opciones: OpcionFiltro[] = [];
  for (const item of crudo) {
    const fila = esRegistro(item) ? item : {};
    const valor = texto(fila, ['codigo', 'valor', 'nombre']);
    const etiqueta = texto(fila, ['etiqueta', 'nombre']) ?? valor;
    if (valor && etiqueta) opciones.push({ valor, etiqueta });
  }
  return opciones;
}

/**
 * `GET /api/v1/catalogs` reducido a los selects del listado.
 *
 * No se codifican etiquetas en el cliente: el mismo valor que ofrece el
 * catálogo es el que valida la API (`unidad` por siglas). El estado ya no
 * sale del catálogo: la barra usa cuatro chips
 * operativos (`Todos`, `Abiertos`, `Resueltos`, `Archivados`), y `Abiertos`
 * viaja como `abiertos=true` porque el estado se define por `es_activo`.
 */
function aCatalogosCasos(bruto: unknown): CatalogosCasos {
  const registro = esRegistro(bruto) ? bruto : {};
  const crudo = leer(registro, ['catalogs', 'catalogos']);
  const catalogo = esRegistro(crudo) ? crudo : {};

  return {
    conflictividades: opcionesDe(catalogo, 'nivelesConflicto'),
    riesgos: opcionesDe(catalogo, 'nivelesRiesgo'),
    prioridades: opcionesDe(catalogo, 'prioridadesAtencion'),
    alcances: opcionesDe(catalogo, 'alcances'),
    regiones: opcionesDe(catalogo, 'regiones'),
    naturalezas: opcionesDe(catalogo, 'naturalezasCaso'),
    unidades: opcionesDe(catalogo, 'unidades'),
  };
}

/**
 * Conteos de la barra de estados (`GET /api/v1/cases?conteos=true`). Se calculan
 * con los filtros vigentes pero sin `estado` ni `abiertos`, así que cada chip
 * muestra cuántos casos quedarían al activarlo.
 */
type ConteosCasos = {
  todos: number;
  abiertos: number;
  resueltos: number;
  archivados: number;
};

const CONTEO_VACIO: ConteosCasos = { todos: 0, abiertos: 0, resueltos: 0, archivados: 0 };

function aConteos(bruto: unknown): ConteosCasos {
  const registro = esRegistro(bruto) ? bruto : {};
  const crudo = leer(registro, ['conteos']);
  const fila = esRegistro(crudo) ? crudo : {};

  const numeroDe = (clave: keyof ConteosCasos): number => {
    const valor = leer(fila, [clave]);
    return typeof valor === 'number' && Number.isFinite(valor) ? valor : 0;
  };

  return {
    todos: numeroDe('todos'),
    abiertos: numeroDe('abiertos'),
    resueltos: numeroDe('resueltos'),
    archivados: numeroDe('archivados'),
  };
}

/**
 * Casos: listado con paginación y filtros de servidor.
 *
 * Todos los filtros viajan a `GET /api/v1/cases` (`estado`/`abiertos`,
 * `prioridad`, `alcance`, `tematica`, `unidad`) y viven en la URL para que el
 * enlace se pueda compartir. Cambiar cualquiera de ellos reinicia a la página 1;
 * nunca se filtra sobre las filas ya cargadas.
 */
@Component({
  selector: 'app-casos',
  imports: [
    RouterLink,
    IconoComponent,
    PaginacionComponent,
    BarraSeleccionComponent,
    CasoPanelComponent,
    CasoVistaPreviaComponent,
    ExportarMenuComponent,
    ThOrdenDirective,
  ],
  templateUrl: './casos.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .aviso-ok {
      color: #2f6f52;
      font-size: 13.5px;
    }

    /* La búsqueda comparte fila con cuatro filtros: no debe estirarse. */
    .search-field-angosta {
      max-width: 300px;
      flex: 0 1 300px;
    }

    /* Estado cierra la fila de filtros, alineado a la derecha. */
    .estado-final {
      margin-left: auto;
    }

    /*
     * Responsive de los filtros. Estos estilos viven aquí, y no en la hoja
     * global, porque los del componente ganan por especificidad: una regla
     * movil en global.css no puede anular las clases del componente.
     * - Hasta 760 px: busqueda a todo el ancho y filtros en dos columnas.
     * - Hasta 520 px: una sola columna, cada control a todo el ancho.
     */
    @media (max-width: 760px) {
      .filter-bar {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px 10px;
      }

      .search-field-angosta {
        grid-column: 1 / -1;
        max-width: none;
        flex: initial;
      }

      .filter-bar > .select-filter {
        min-width: 0;
      }

      .filter-bar > .select-filter select {
        min-width: 0;
      }

      .estado-final {
        margin-left: 0;
      }
    }

    @media (max-width: 520px) {
      .filter-bar {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    .vista-previa-aviso {
      margin: 0 0 10px;
    }

    /* Chip de naturaleza declarada. «Sin declarar» se distingue a la vista
       (borde discontinuo y color apagado): es un hueco, no un valor. */
    .case-naturaleza {
      display: inline-block;
      margin: 8px 0 0;
      padding: 2px 7px;
      border: 1px solid #dbe3ea;
      border-radius: 10px;
      color: #47566a;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.3px;
      line-height: 1.6;
    }

    .case-naturaleza.sin-declarar {
      border-style: dashed;
      color: #8a98a5;
      font-weight: 500;
    }

    /* Indicador operativo de la semana: tira de cifras con la jerarquía del
       mockup (cifra grande, leyenda debajo) y lista de casos con nudo. */
    .nudos-semana {
      padding: 12px 14px;
      border: 1px solid #dbe3ea;
      border-radius: 8px;
      background: #fbfcfd;
    }

    .nudos-semana-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }

    .nudos-semana-head h2 {
      margin: 0;
      color: #22303f;
      font: 700 15px var(--font-display);
    }

    .nudos-semana-head span {
      color: #647487;
      font-size: 12.5px;
    }

    .nudos-semana-cifras {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin-top: 10px;
    }

    .nudos-semana-cifras div {
      display: flex;
      flex-direction: column;
      gap: 1px;
      padding: 8px 10px;
      border: 1px solid #e4eaf0;
      border-radius: 6px;
      background: #fff;
    }

    .nudos-semana-cifras b {
      color: #22303f;
      font: 700 17px/1.2 var(--font-display);
    }

    .nudos-semana-cifras span {
      color: #647487;
      font-size: 12px;
      line-height: 1.35;
    }

    .nudos-semana-lista {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 10px 0 0;
      padding: 0;
      list-style: none;
    }

    .nudos-semana-lista li {
      padding: 8px 10px;
      border: 1px solid #e4eaf0;
      border-radius: 6px;
      background: #fff;
    }

    .nudos-semana-caso {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 7px;
    }

    .nudos-semana-titulo {
      color: #22303f;
      font-size: 13.5px;
      font-weight: 600;
    }

    .nudos-semana-region {
      color: #8a98a5;
      font-size: 12px;
    }

    .nudos-semana-nudo {
      margin: 4px 0 0;
      color: #47566a;
      font-size: 12.5px;
      line-height: 1.45;
    }
  `,
})
export class CasosPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly registroSolicitado = toSignal(
    this.ruta.queryParamMap.pipe(map((params) => params.get('registrar'))),
    { initialValue: null },
  );
  private readonly http = inject(HttpClient);
  readonly capacidades = inject(CapacidadesService);

  readonly ordenes = ORDENES;
  readonly modo = signal<ModoVista>('tarjetas');

  /**
   * Filtros secundarios (prioridad, región, temática, unidad, orden). Se
   * despliegan con «Búsqueda avanzada» para que la barra de entrada quede en tres
   * controles: búsqueda, estado y conflictividad (item 100).
   */
  readonly avanzado = signal(false);

  /** Caso abierto en la ventana de vista previa (item 101); `null` = cerrada. */
  readonly casoPrevio = signal<Caso | null>(null);

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  /** Caso en curso de restauración (por código) y aviso del resultado. */
  readonly restaurando = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  /** Selección de la tabla (página visible) para exportar o anular en lote. */
  readonly seleccion = new SeleccionTabla();

  idsVisibles(): string[] {
    return this.casos()
      .map((caso) => caso.codigo)
      .filter((codigo): codigo is string => !!codigo);
  }

  /** Alta de caso: el panel emite el cuerpo y esta página hace el `POST`. */
  readonly panelAbierto = signal(false);
  readonly guardando = signal(false);
  readonly errorAlta = signal<string | null>(null);

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => {
        const alcance = params.get('alcance');
        return {
          q: params.get('q') ?? '',
          estado: params.get('estado') ?? '',
          abiertos: params.get('abiertos') === 'true',
          nivel: params.get('nivel') ?? '',
          riesgo: params.get('riesgo') ?? '',
          prioridad: params.get('prioridad') ?? '',
          // Sin `alcance` rige Preferencias; `todos` es la limpieza explícita.
          alcance: alcance === null ? alcancePreferido() : alcance === 'todos' ? '' : alcance,
          region: params.get('region') ?? '',
          sinRegion: params.get('sinregion') === 'true',
          naturaleza: params.get('naturaleza') ?? '',
          unidad: params.get('unidad') ?? '',
          pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
          tamano: Math.max(
            1,
            Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA,
          ),
          orden: params.get('orden') ?? 'recent',
          ver: params.get('ver') === 'anulados' ? 'anulados' : 'activos',
        };
      }),
    ),
    { initialValue: FILTROS_INICIALES },
  );

  readonly filtros = computed(() => this.parametros());

  /**
   * Valor del desplegable de estado. Codifica en un solo control lo que antes
   * eran cuatro chips: `todos`, `abiertos` (por `es_activo`) o el código
   * canónico del estado.
   */
  readonly estadoSeleccionado = computed(() => {
    const filtros = this.filtros();
    if (filtros.abiertos) return 'abiertos';
    return filtros.estado || 'todos';
  });

  /**
   * ¿Hay algún filtro secundario puesto? El ámbito no cuenta: llega de
   * Preferencias y estaría siempre activo.
   */
  readonly filtrosAvanzadosActivos = computed(() => {
    const filtros = this.filtros();
    return Boolean(
      filtros.riesgo ||
      filtros.prioridad ||
      filtros.region ||
      filtros.sinRegion ||
      filtros.naturaleza ||
      filtros.unidad ||
      filtros.orden !== 'recent',
    );
  });

  /**
   * Filtros, búsqueda y orden vigentes, con los nombres que acepta
   * `GET /api/v1/cases`. Es lo que la exportación reenvía para no volcar el
   * conjunto completo cuando la pantalla muestra un subconjunto.
   */
  readonly filtrosExportacion = computed(() => {
    const filtros = this.filtros();
    return parametrosConValor({
      q: filtros.q,
      estado: filtros.estado,
      abiertos: filtros.abiertos ? 'true' : '',
      nivel: filtros.nivel,
      riesgo: filtros.riesgo,
      prioridad: filtros.prioridad,
      alcance: filtros.alcance,
      region: filtros.region,
      sinregion: filtros.sinRegion ? 'true' : '',
      naturaleza: filtros.naturaleza,
      unidad: filtros.unidad,
      sort: filtros.orden,
    });
  });

  /** La papelera sólo se ofrece a quien puede anular y restaurar. */
  readonly puedeVerPapelera = computed(() => this.capacidades.puedeEliminar());

  /** `?ver=anulados`: la vista pinta la papelera de casos. */
  readonly verPapelera = computed(() => this.filtros().ver === 'anulados');

  /**
   * Valor centinela de la lista de regiones para «sin región principal».
   * `core.regiones` no tiene un nombre vacío, así que no colisiona con ninguna
   * región real; el enlace del panorama territorial envía `sinregion`.
   */
  readonly valorSinRegion = SIN_REGION;

  /** Opciones de los selects; si el catálogo falla, se muestran sólo «Todos». */
  private readonly catalogoRecurso = consulta<CatalogosCasos>({
    fuente: () => urlApi('/v1/catalogs'),
    esquema: aCatalogosCasos,
  });

  readonly prioridades = computed(() => this.catalogoRecurso.valor()?.prioridades ?? []);
  readonly riesgos = computed(() => this.catalogoRecurso.valor()?.riesgos ?? []);
  readonly conflictividades = computed(() => this.catalogoRecurso.valor()?.conflictividades ?? []);
  readonly alcances = computed(() => this.catalogoRecurso.valor()?.alcances ?? []);
  readonly regiones = computed(() => this.catalogoRecurso.valor()?.regiones ?? []);
  readonly naturalezas = computed(() => this.catalogoRecurso.valor()?.naturalezas ?? []);
  readonly unidades = computed(() => this.catalogoRecurso.valor()?.unidades ?? []);

  private readonly recurso = consulta<Coleccion<Caso> & { conteos: ConteosCasos }>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/cases'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        q: filtros.q,
        estado: filtros.estado,
        abiertos: filtros.abiertos ? 'true' : '',
        nivel: filtros.nivel,
        riesgo: filtros.riesgo,
        prioridad: filtros.prioridad,
        alcance: filtros.alcance,
        region: filtros.region,
        sinregion: filtros.sinRegion ? 'true' : '',
        naturaleza: filtros.naturaleza,
        unidad: filtros.unidad,
        sort: filtros.orden,
        anulados: filtros.ver === 'anulados' ? 'true' : '',
        conteos: 'true',
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return {
        ...coleccion,
        elementos: coleccion.elementos.map(aCaso),
        conteos: aConteos(bruto),
      };
    },
  });

  readonly casos = computed(() => this.recurso.valor()?.elementos ?? []);
  readonly total = computed(() => this.recurso.valor()?.total ?? 0);
  readonly conteos = computed(() => this.recurso.valor()?.conteos ?? CONTEO_VACIO);
  readonly estado = this.recurso.estado;
  readonly error = this.recurso.error;
  readonly paginas = computed(() =>
    totalPaginas(this.recurso.valor() ?? { total: 0, tamanoPagina: TAMANO_PAGINA }),
  );

  /**
   * Nudos de la semana del ámbito de la sesión (`GET /api/v1/cases/nudos`). Es el
   * indicador «X de Y casos con nudo abierto» del tablero; no depende de la
   * página ni de los filtros de la lista. En la papelera no aplica: `fuente`
   * devuelve `null` y el recurso queda inactivo.
   */
  private readonly nudosRecurso = consulta<NudosSemanaTablero>({
    fuente: () => (this.filtros().ver === 'anulados' ? null : urlApi('/v1/cases/nudos')),
    esquema: aNudosSemana,
  });

  readonly nudosSemana = this.nudosRecurso.valor;
  readonly estadoNudos = this.nudosRecurso.estado;
  readonly errorNudos = this.nudosRecurso.error;

  /**
   * Aviso de duplicados del alta. `cuerpoVerificado` guarda el cuerpo ya
   * comprobado: el mismo cuerpo con el aviso a la vista es la confirmación; si
   * el usuario cambia el título o el distrito, se vuelve a comprobar.
   */
  readonly duplicadosAlta = signal<readonly DuplicadoCandidatoFila[]>([]);
  readonly verificandoDuplicados = signal(false);
  readonly descartesDuplicados = signal<readonly string[]>([]);
  readonly errorDuplicadosAlta = signal<string | null>(null);
  private cuerpoVerificado: string | null = null;
  /**
   * Turno de la comprobación en curso. Cerrar el panel o volver a enviar lo
   * invalida: una respuesta tardía no debe registrar un caso ya abandonado.
   */
  private turnoDuplicados = 0;

  /** Orden local de la página visible. */
  readonly orden = new OrdenTabla<Caso>();

  private readonly accesoresCaso: Record<string, (caso: Caso) => unknown> = {
    codigo: (caso) => caso.codigo,
    titulo: (caso) => caso.titulo,
    anulado: (caso) => caso.anuladoEn,
    region: (caso) => caso.region,
    estado: (caso) => caso.estado,
    prioridad: (caso) => caso.prioridad,
    riesgo: (caso) => caso.riesgo,
    unidad: (caso) => caso.unidadResponsable,
    etapa: (caso) => caso.etapa,
    inicio: (caso) => caso.inicio,
  };

  readonly filasVisibles = computed(() => this.orden.ordenar(this.casos(), this.accesoresCaso));

  private temporizador?: ReturnType<typeof setTimeout>;

  cambiarModo(modo: ModoVista): void {
    this.modo.set(modo);
  }

  /** El formato de la lista es un desplegable a la izquierda (item 100). */
  cambiarModoDesde(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    this.modo.set(valor === 'tabla' ? 'tabla' : 'tarjetas');
  }

  /** Cambia entre vigentes y papelera; al entrar en la papelera fuerza tabla. */
  cambiarVer(valor: VerRegistros): void {
    if (valor === 'anulados') this.modo.set('tabla');
    this.aviso.set(null);
    void this.actualizar({ ver: valor, pagina: 1 });
  }

  buscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      void this.actualizar({ q: valor, pagina: 1 });
    }, 300);
  }

  /**
   * Estado desde el desplegable único (item 100). `abiertos` viaja como
   * `abiertos=true` porque el estado abierto se define por `es_activo`, no por
   * una etiqueta.
   */
  cambiarEstado(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    if (valor === 'abiertos') {
      void this.actualizar({ estado: '', abiertos: true, pagina: 1 });
      return;
    }
    void this.actualizar({ estado: valor === 'todos' ? '' : valor, abiertos: false, pagina: 1 });
  }

  /**
   * Nivel de conflictividad (item 100). Viaja como `nivel=<codigo>` y lo valida
   * el repositorio contra `core.cat_niveles_conflicto`: no se filtra en cliente,
   * así los conteos y la paginación siguen siendo ciertos.
   */
  cambiarNivel(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ nivel: valor, pagina: 1 });
  }

  alternarAvanzado(): void {
    this.avanzado.update((abierto) => !abierto);
  }

  /** Abre la ventana de vista previa en lugar de saltar a la ficha (item 101). */
  abrirVistaPrevia(caso: Caso, evento?: Event): void {
    evento?.preventDefault();
    this.casoPrevio.set(caso);
  }

  cerrarVistaPrevia(): void {
    this.casoPrevio.set(null);
  }

  /** Fecha en formato compacto «18NOV2026». */
  fechaCorta(valor: string | null | undefined): string {
    return formatearFechaCorta(valor);
  }

  cambiarRiesgo(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ riesgo: valor, pagina: 1 });
  }

  cambiarPrioridad(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ prioridad: valor, pagina: 1 });
  }

  cambiarAlcance(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ alcance: valor, pagina: 1 });
  }

  /**
   * Región principal del caso. Es el filtro que aplica «Ver casos» en el
   * panorama territorial, así que la barra lo muestra y lo deja limpiar: sin
   * esto el listado llegaría recortado sin un control visible que lo explique.
   *
   * «Sin región» es el complemento, no una región: se elige en el mismo control
   * y al cambiar de opción se limpia el otro criterio para que nunca viajen
   * juntos (el repositorio daría prioridad a `sinRegion`).
   */
  cambiarRegion(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    if (valor === SIN_REGION) {
      void this.actualizar({ region: '', sinRegion: true, pagina: 1 });
      return;
    }
    void this.actualizar({ region: valor, sinRegion: false, pagina: 1 });
  }

  /**
   * Naturaleza declarada. Es un eje propio del caso, no el alcance geográfico:
   * «Sin declarar» no es un valor del catálogo sino la ausencia de valor, y sólo
   * el servidor puede resolverlo (`naturaleza_id is null`), así que nunca se
   * filtra en cliente.
   */
  cambiarNaturaleza(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ naturaleza: valor, pagina: 1 });
  }

  cambiarUnidad(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ unidad: valor, pagina: 1 });
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
      // `ver` no es un filtro: se conserva la pestaña (vigentes o papelera).
      queryParams: { ver: this.verPapelera() ? 'anulados' : null },
    });
  }

  fechaTexto(valor: string | null | undefined): string {
    return formatearFechaCaso(valor);
  }

  fechaHoraTexto(valor: string | null | undefined): string {
    return formatearFechaHora(valor);
  }

  /** Restaura un caso anulado desde la papelera y recarga el listado. */
  restaurar(caso: Caso, evento: Event): void {
    evento.stopPropagation();
    if (this.restaurando()) return;

    this.restaurando.set(caso.codigo);
    this.aviso.set(null);

    this.http
      .post<unknown>(urlApi(`/v1/cases/${encodeURIComponent(caso.codigo)}/restaurar`), {})
      .subscribe({
        next: () => {
          this.restaurando.set(null);
          this.aviso.set(`Caso ${caso.codigo} restaurado.`);
          this.recargar();
        },
        error: (fallo: unknown) => {
          this.restaurando.set(null);
          this.aviso.set(aErrorApi(fallo).message);
        },
      });
  }

  recargar(): void {
    this.recurso.recargar();
    this.nudosRecurso.recargar();
  }

  /**
   * Guarda la URL del tablero de Canva del caso desde la vista previa. El
   * endpoint `PATCH /v1/cases/:codigo` la persiste en `enlace_analisis`. Al
   * terminar se refresca la fila abierta para que el acceso pase a enlace.
   */
  guardarEnlaceAnalisis(caso: Caso, url: string): void {
    this.http
      .patch<unknown>(urlApi(`/v1/cases/${encodeURIComponent(caso.codigo)}`), {
        enlaceAnalisis: url,
      })
      .subscribe({
        next: () => {
          this.casoPrevio.set({ ...caso, enlaceAnalisis: url });
          this.recargar();
        },
        error: (fallo: unknown) => this.aviso.set(aErrorApi(fallo).message),
      });
  }

  alAnularLote(cantidad: number): void {
    this.seleccion.limpiar();
    this.aviso.set(cantidad === 1 ? '1 registro anulado.' : `${cantidad} registros anulados.`);
    this.recargar();
  }

  constructor() {
    effect(() => {
      if (this.registroSolicitado() !== 'caso') return;
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
    if (!this.capacidades.puedeEditar()) return;
    this.errorAlta.set(null);
    this.aviso.set(null);
    this.limpiarDuplicados();
    this.panelAbierto.set(true);
  }

  cerrarAlta(): void {
    if (this.guardando()) return;
    this.panelAbierto.set(false);
    this.errorAlta.set(null);
    this.limpiarDuplicados();
  }

  /** «No es duplicado»: se recuerda el código para registrar el descarte al crear. */
  marcarNoDuplicado(codigo: string): void {
    this.descartesDuplicados.update((actuales) =>
      actuales.includes(codigo) ? actuales : [...actuales, codigo],
    );
  }

  /**
   * Alta de caso en dos pasos. El primer envío comprueba duplicados; si hay
   * candidatos se muestran y no se registra nada. El segundo envío con el mismo
   * cuerpo confirma el registro; si el cuerpo cambió, se vuelve a comprobar.
   */
  registrarCaso(cuerpo: CuerpoCasoAlta): void {
    if (this.guardando()) return;

    const clave = JSON.stringify(cuerpo);
    if (this.duplicadosAlta().length > 0 && this.cuerpoVerificado === clave) {
      this.enviarAlta(cuerpo);
      return;
    }

    this.errorAlta.set(null);
    this.verificarDuplicados(cuerpo, clave);
  }

  private verificarDuplicados(cuerpo: CuerpoCasoAlta, clave: string): void {
    const turno = ++this.turnoDuplicados;
    this.verificandoDuplicados.set(true);
    this.errorDuplicadosAlta.set(null);
    this.duplicadosAlta.set([]);
    this.descartesDuplicados.set([]);
    this.cuerpoVerificado = null;

    const parametros: Record<string, string> = { titulo: cuerpo.titulo };
    if (cuerpo.distritoPrincipalId !== undefined) {
      parametros['distritoId'] = String(cuerpo.distritoPrincipalId);
    }

    this.http.get<unknown>(urlConParametros(urlApi('/v1/cases/duplicados'), parametros)).subscribe({
      next: (bruto) => {
        if (turno !== this.turnoDuplicados) return;
        this.verificandoDuplicados.set(false);
        this.cuerpoVerificado = clave;
        const candidatos = aDuplicados(bruto).candidatos;
        if (candidatos.length === 0) {
          this.enviarAlta(cuerpo);
          return;
        }
        this.duplicadosAlta.set(candidatos);
      },
      error: (fallo: unknown) => {
        if (turno !== this.turnoDuplicados) return;
        // Sin la comprobación no se bloquea el alta: se registra y se declara
        // que el aviso no pudo aplicarse.
        this.verificandoDuplicados.set(false);
        this.errorDuplicadosAlta.set(
          `No se pudo verificar duplicados: ${aErrorApi(fallo).message}`,
        );
        this.enviarAlta(cuerpo);
      },
    });
  }

  /**
   * `POST /api/v1/cases`: el código lo asigna el servidor. Si la respuesta lo
   * trae, se abre la ficha; si no, se recarga el listado. Un fallo deja el panel
   * abierto con el mensaje de la API. Los descartes marcados se envían después
   * del alta, porque necesitan el código del caso recién creado.
   */
  private enviarAlta(cuerpo: CuerpoCasoAlta): void {
    this.guardando.set(true);
    this.errorAlta.set(null);

    this.http.post<unknown>(urlApi('/v1/cases'), cuerpo).subscribe({
      next: (bruto) => {
        this.guardando.set(false);
        const codigo = codigoDeCasoCreado(bruto);
        const descartes = [...this.descartesDuplicados()];
        this.panelAbierto.set(false);
        this.limpiarDuplicados();
        if (!codigo) {
          this.aviso.set('Caso registrado. Se actualizó el listado.');
          this.recargar();
          return;
        }
        if (descartes.length === 0) {
          void this.router.navigate(['/casos', codigo]);
          return;
        }
        this.registrarDescartes(codigo, descartes);
      },
      error: (fallo: unknown) => {
        this.guardando.set(false);
        this.errorAlta.set(aErrorApi(fallo).message);
      },
    });
  }

  private registrarDescartes(codigo: string, descartes: readonly string[]): void {
    const motivo = 'Descartado en el alta: el usuario indicó que no es duplicado.';
    const peticiones = descartes.map((candidato) =>
      this.http
        .post<unknown>(urlApi('/v1/cases/duplicados'), {
          casoA: codigo,
          casoB: candidato,
          motivo,
        })
        .pipe(
          map(() => null),
          catchError((fallo: unknown) => of(aErrorApi(fallo).message)),
        ),
    );

    forkJoin(peticiones).subscribe((resultados) => {
      const fallo = resultados.find((resultado): resultado is string => resultado !== null);
      if (fallo) {
        this.aviso.set(
          `Caso ${codigo} registrado, pero no se guardó el descarte de duplicado: ${fallo}`,
        );
        this.recargar();
        return;
      }
      void this.router.navigate(['/casos', codigo]);
    });
  }

  private limpiarDuplicados(): void {
    this.turnoDuplicados += 1;
    this.duplicadosAlta.set([]);
    this.descartesDuplicados.set([]);
    this.errorDuplicadosAlta.set(null);
    this.verificandoDuplicados.set(false);
    this.cuerpoVerificado = null;
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  private actualizar(cambios: Partial<FiltrosCasos>): void {
    const actuales = this.parametros();
    const siguiente = { ...actuales, ...cambios };

    // `alcance=todos` fija la limpieza del ámbito predeterminado en la URL: si
    // se enviara `null`, la vista volvería a aplicar la preferencia.
    const alcanceCrudo = this.ruta.snapshot.queryParamMap.get('alcance');
    const limpioAlcance = cambios.alcance !== undefined && !cambios.alcance;
    const alcance = limpioAlcance
      ? 'todos'
      : siguiente.alcance || (alcanceCrudo === 'todos' ? 'todos' : null);

    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        q: siguiente.q || null,
        estado: siguiente.estado || null,
        abiertos: siguiente.abiertos ? 'true' : null,
        nivel: siguiente.nivel || null,
        riesgo: siguiente.riesgo || null,
        prioridad: siguiente.prioridad || null,
        alcance,
        region: siguiente.region || null,
        sinregion: siguiente.sinRegion ? 'true' : null,
        naturaleza: siguiente.naturaleza || null,
        unidad: siguiente.unidad || null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
        orden: siguiente.orden !== 'recent' ? siguiente.orden : null,
        ver: siguiente.ver === 'anulados' ? 'anulados' : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
