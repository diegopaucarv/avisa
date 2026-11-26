import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
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
import { ESTADO_ARCHIVADO, ESTADO_RESUELTO } from './caso-edicion.mapeo';
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

/**
 * Item del listado con el sectorista asignado. La API ya entrega
 * `sectoristaUsuarioId` y el `sectorista` resuelto, pero `dominio/mapeo.ts`
 * todavía no conserva la columna: se suma aquí leyendo el bruto, con el mismo
 * patrón que la ficha usa para `descripcionRiesgo`.
 */
type CasoConSectorista = Caso & {
  sectorista: string | null;
};

function aCasoConSectorista(bruto: unknown): CasoConSectorista {
  const fila = esRegistro(bruto) ? bruto : {};
  return { ...aCaso(bruto), sectorista: texto(fila, ['sectorista', 'sectoristaNombre']) };
}

type FiltrosCasos = {
  q: string;
  estado: string;
  /** `abiertos=true`: estados del catálogo con `es_activo` (hoy sólo `Abierto`). */
  abiertos: boolean;
  /** Código de `core.cat_niveles_conflicto`; la API lo valida contra el catálogo. */
  nivel: string;
  /** Código de `core.cat_niveles_riesgo`; eje distinto de la conflictividad. */
  riesgo: string;
  alcance: string;
  /** Nombre canónico de `core.regiones`; la API lo normaliza y lo valida. */
  region: string;
  /**
   * Texto libre que la API compara contra el nombre resuelto del sectorista
   * asignado al caso. Viaja como `sectorista` y se filtra en el servidor: no se
   * recorta la página ya cargada.
   */
  sectorista: string;
  /**
   * Complemento de `region`: casos sin región principal. Excluyentes entre sí
   * (`sinRegion` gana en el repositorio), por eso la barra los trata como una
   * sola lista desplegable.
   */
  sinRegion: boolean;
  pagina: number;
  tamano: number;
  orden: string;
  ver: VerRegistros;
};

const FILTROS_INICIALES: FiltrosCasos = {
  q: '',
  estado: '',
  abiertos: true,
  nivel: '',
  riesgo: '',
  alcance: '',
  region: '',
  sectorista: '',
  sinRegion: false,
  pagina: 1,
  tamano: TAMANO_PAGINA,
  orden: 'risk',
  ver: 'activos',
};

const ORDENES = [
  { valor: 'risk', etiqueta: 'Riesgo (Alto → Bajo)' },
  { valor: 'recent', etiqueta: 'Fecha (más reciente)' },
  { valor: 'priority', etiqueta: 'Prioridad (Urgente → Bajo)' },
] as const;

/**
 * Orden con el que abre el listado. `risk` deja el riesgo Alto primero y los
 * archivados al final (los ordena el servidor). Es sólo el valor por defecto:
 * `?orden=…` sigue mandando para que la URL compartida reproduzca la vista.
 */
const ORDEN_INICIAL = 'risk';

/**
 * Sólo los órdenes que ofrece el desplegable. Un `?orden=` vacío —o un valor
 * retirado en una URL guardada— cae al inicial en vez de viajar al servidor,
 * que ante un `sort` desconocido aplica su propio orden por defecto (`recent`).
 */
function ordenDe(valor: string | null): string {
  return ORDENES.some((opcion) => opcion.valor === valor) ? (valor as string) : ORDEN_INICIAL;
}

/**
 * Severidad del riesgo para el orden local de la tabla: `0` es lo más alto.
 * Sin esto `OrdenTabla` compararía texto y «Alto» quedaría después de «Bajo».
 */
const PESO_RIESGO: Record<Caso['riesgo'], number> = { Alto: 0, Medio: 1, Bajo: 2 };

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
  alcances: OpcionFiltro[];
  regiones: OpcionFiltro[];
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
 * catálogo es el que valida la API. El estado ya no sale del catálogo: la
 * barra usa un interruptor `Abiertos`/`Archivados`, donde `Abiertos` viaja
 * como `abiertos=true` (el estado se define por `es_activo`).
 */
function aCatalogosCasos(bruto: unknown): CatalogosCasos {
  const registro = esRegistro(bruto) ? bruto : {};
  const crudo = leer(registro, ['catalogs', 'catalogos']);
  const catalogo = esRegistro(crudo) ? crudo : {};

  return {
    conflictividades: opcionesDe(catalogo, 'nivelesConflicto'),
    riesgos: opcionesDe(catalogo, 'nivelesRiesgo'),
    alcances: opcionesDe(catalogo, 'alcances'),
    regiones: opcionesDe(catalogo, 'regiones'),
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
 * Todos los filtros viajan a `GET /api/v1/cases` (`estado`/`abiertos`, `riesgo`,
 * `nivel`, `alcance`, `region`/`sinregion`, `sort`) y viven en la URL para que el
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

    /*
     * La búsqueda comparte fila con cinco filtros: usa la variante estrecha
     * global (search-field--compacta en global.css), no un ancho propio.
     */

    /* Chips de riesgo y «Resueltos»: son tab-bar/tab-button, sin el margen
       vertical que usan las pestañas de sección. */
    .chips-en-linea {
      margin: 0;
    }

    .chips-en-linea .tab-button {
      padding: 6px 10px;
    }

    /*
     * Interruptor Abiertos/Archivados. Replica la lengua visual del
     * edit-switch de la ficha (que es encapsulado y no aplica aquí), con
     * variables de tema para no depender de literales en modo noche.
     */
    .edit-switch {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font: 600 13px var(--font-sans);
      cursor: pointer;
      user-select: none;
    }

    .edit-switch input {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
      border: 0;
    }

    .edit-switch-track {
      position: relative;
      display: inline-block;
      flex: none;
      width: 38px;
      height: 22px;
      border-radius: 999px;
      background: var(--line);
      transition: background 0.15s ease;
    }

    .edit-switch-thumb {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--muted);
      transition: transform 0.15s ease;
    }

    .edit-switch.activo .edit-switch-track {
      background: var(--blue);
    }

    .edit-switch.activo .edit-switch-thumb {
      transform: translateX(16px);
      background: var(--paper);
    }

    .edit-switch span.activo {
      color: var(--ink);
      font-weight: 700;
    }

    .edit-switch input:focus-visible + .edit-switch-track {
      outline: 2px solid var(--blue);
      outline-offset: 2px;
    }

    /* Enlace discreto de búsqueda avanzada, más pequeño que los filtros. */
    .avanzado-enlace {
      white-space: nowrap;
    }

    /*
     * Barra principal de filtros (barra-filtros-casos).
     *
     * Medido con el CSS real: los seis controles con rótulo más el botón de
     * búsqueda avanzada suman ~1.490 px, de modo que la fila solo cabe de una
     * pieza a partir de ~1.500 px de ventana; el campo de búsqueda puede
     * encogerse hasta 140 px para absorber la diferencia. Por debajo se reparte
     * en una rejilla de columnas iguales (3, luego 2, luego 1) en vez de
     * envolver en filas irregulares.
     *
     * Estos estilos viven aquí, y no en la hoja global, porque los del
     * componente ganan por especificidad.
     */
    .barra-filtros-casos > * {
      min-width: 0;
    }

    @media (min-width: 1500px) {
      .barra-filtros-casos {
        flex-wrap: nowrap;
      }

      .barra-filtros-casos .search-field--compacta {
        flex: 1 1 200px;
        min-width: 140px;
      }
    }

    @media (max-width: 1499px) {
      .barra-filtros-casos {
        display: grid;
        align-items: center;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px 10px;
      }

      .barra-filtros-casos .search-field--compacta {
        width: 100%;
        max-width: none;
        flex: initial;
      }

      .barra-filtros-casos > .select-filter select {
        flex: 1 1 auto;
        min-width: 0;
        max-width: none;
      }
    }

    @media (max-width: 1100px) {
      .barra-filtros-casos {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 560px) {
      .barra-filtros-casos {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    /* Búsqueda avanzada: no lleva la clase de la barra principal. */
    @media (max-width: 760px) {
      .filter-bar:not(.barra-filtros-casos) {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px 10px;
      }

      .filter-bar:not(.barra-filtros-casos) > .select-filter,
      .filter-bar:not(.barra-filtros-casos) > .select-filter select {
        min-width: 0;
      }
    }

    @media (max-width: 520px) {
      .filter-bar:not(.barra-filtros-casos) {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    .vista-previa-aviso {
      margin: 0 0 10px;
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
  private readonly destruccion = inject(DestroyRef);
  private readonly registroSolicitado = toSignal(
    this.ruta.queryParamMap.pipe(map((params) => params.get('registrar'))),
    { initialValue: null },
  );
  private readonly http = inject(HttpClient);
  readonly capacidades = inject(CapacidadesService);

  readonly ordenes = ORDENES;
  readonly modo = signal<ModoVista>('tarjetas');

  /**
   * Filtros secundarios: nivel de conflictividad, resueltos, alcance y orden. Se
   * despliegan con «Búsqueda avanzada» para que la barra de entrada quede corta:
   * búsqueda, riesgo, región, sectorista e interruptor Abiertos/Archivados.
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
        const ver: VerRegistros = params.get('ver') === 'anulados' ? 'anulados' : 'activos';
        const estado = params.get('estado') ?? '';
        const abiertosParam = params.get('abiertos');
        return {
          q: params.get('q') ?? '',
          estado,
          // El interruptor Abiertos/Archivados sustituye al desplegable de
          // estado: sin estado explícito la lista se abre en «Abiertos». En la
          // papelera no se aplica, porque `anulados` ya define el conjunto.
          abiertos:
            ver === 'activos' &&
            (abiertosParam === 'true' || (!estado && abiertosParam !== 'false')),
          nivel: params.get('nivel') ?? '',
          riesgo: params.get('riesgo') ?? '',
          // Sin `alcance` rige Preferencias; `todos` es la limpieza explícita.
          alcance: alcance === null ? alcancePreferido() : alcance === 'todos' ? '' : alcance,
          region: params.get('region') ?? '',
          sectorista: params.get('sectorista') ?? '',
          sinRegion: params.get('sinregion') === 'true',
          pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
          tamano: Math.max(
            1,
            Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA,
          ),
          orden: ordenDe(params.get('orden')),
          ver,
        };
      }),
    ),
    { initialValue: FILTROS_INICIALES },
  );

  readonly filtros = computed(() => this.parametros());

  /**
   * Interruptor Abiertos/Archivados. «Abiertos» viaja como `abiertos=true`
   * (por `es_activo` del catálogo) y «Archivados» como `estado=Archivado`.
   * «Resueltos» dejó la barra principal: se filtra desde la búsqueda avanzada.
   */
  readonly archivados = computed(() => this.filtros().estado === ESTADO_ARCHIVADO);

  /** Chip «Resueltos» de la búsqueda avanzada. */
  readonly resueltosActivo = computed(() => this.filtros().estado === ESTADO_RESUELTO);

  /**
   * ¿Hay algún filtro secundario puesto? El ámbito no cuenta: llega de
   * Preferencias y estaría siempre activo.
   */
  readonly filtrosAvanzadosActivos = computed(() => {
    const filtros = this.filtros();
    return Boolean(
      filtros.nivel || filtros.estado === ESTADO_RESUELTO || filtros.orden !== ORDEN_INICIAL,
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
      alcance: filtros.alcance,
      region: filtros.region,
      sectorista: filtros.sectorista,
      sinregion: filtros.sinRegion ? 'true' : '',
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

  readonly riesgos = computed(() => this.catalogoRecurso.valor()?.riesgos ?? []);
  readonly conflictividades = computed(() => this.catalogoRecurso.valor()?.conflictividades ?? []);
  readonly alcances = computed(() => this.catalogoRecurso.valor()?.alcances ?? []);
  readonly regiones = computed(() => this.catalogoRecurso.valor()?.regiones ?? []);

  private readonly recurso = consulta<Coleccion<CasoConSectorista> & { conteos: ConteosCasos }>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/cases'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        q: filtros.q,
        estado: filtros.estado,
        abiertos: filtros.abiertos && filtros.ver !== 'anulados' ? 'true' : '',
        nivel: filtros.nivel,
        riesgo: filtros.riesgo,
        alcance: filtros.alcance,
        region: filtros.region,
        sectorista: filtros.sectorista,
        sinregion: filtros.sinRegion ? 'true' : '',
        sort: filtros.orden,
        anulados: filtros.ver === 'anulados' ? 'true' : '',
        conteos: 'true',
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return {
        ...coleccion,
        elementos: coleccion.elementos.map(aCasoConSectorista),
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
  readonly orden = new OrdenTabla<CasoConSectorista>();

  private readonly accesoresCaso: Record<string, (caso: CasoConSectorista) => unknown> = {
    codigo: (caso) => caso.codigo,
    titulo: (caso) => caso.titulo,
    anulado: (caso) => caso.anuladoEn,
    region: (caso) => caso.region,
    sectorista: (caso) => caso.sectorista,
    estado: (caso) => caso.estado,
    prioridad: (caso) => caso.prioridad,
    riesgo: (caso) => PESO_RIESGO[caso.riesgo],
    etapa: (caso) => caso.etapa,
    inicio: (caso) => caso.inicio,
  };

  readonly filasVisibles = computed(() => this.orden.ordenar(this.casos(), this.accesoresCaso));

  private temporizador?: ReturnType<typeof setTimeout>;
  /** Turno propio del filtro por sectorista: no pisa la búsqueda por palabra. */
  private temporizadorSectorista?: ReturnType<typeof setTimeout>;

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
   * Filtro por sectorista asignado. Es texto libre y lo resuelve la API contra
   * el nombre del usuario; espera el mismo retardo que la búsqueda por palabra
   * para no navegar en cada tecla.
   */
  cambiarSectorista(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizadorSectorista);
    this.temporizadorSectorista = setTimeout(() => {
      void this.actualizar({ sectorista: valor, pagina: 1 });
    }, 300);
  }

  /**
   * Interruptor Abiertos/Archivados. «Abiertos» viaja como `abiertos=true`
   * porque el estado abierto se define por `es_activo`, no por etiqueta;
   * «Archivados» viaja como `estado=Archivado`.
   */
  cambiarArchivados(evento: Event): void {
    const archivados = (evento.target as HTMLInputElement).checked;
    this.actualizar({
      estado: archivados ? ESTADO_ARCHIVADO : '',
      abiertos: !archivados,
      pagina: 1,
    });
  }

  /**
   * Nivel de conflictividad (item 100). Viaja como `nivel=<codigo>` y lo valida
   * el repositorio contra `core.cat_niveles_conflicto`: no se filtra en cliente,
   * así los conteos y la paginación siguen siendo ciertos.
   */
  /** «Resueltos» vive en la búsqueda avanzada como chip de estado. */
  alternarResueltos(): void {
    const activo = this.filtros().estado === ESTADO_RESUELTO;
    this.actualizar({ estado: activo ? '' : ESTADO_RESUELTO, abiertos: activo, pagina: 1 });
  }

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

  /** Chips de nivel de riesgo: no abren la búsqueda avanzada. */
  seleccionarRiesgo(valor: string): void {
    this.actualizar({ riesgo: valor, pagina: 1 });
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
    clearTimeout(this.temporizadorSectorista);
    void this.router.navigate([], {
      relativeTo: this.ruta,
      // `ver` no es un filtro: se conserva la pestaña (vigentes o papelera).
      queryParams: { ver: this.verPapelera() ? 'anulados' : null },
    });
  }

  fechaTexto(valor: string | null | undefined): string {
    return formatearFechaCaso(valor);
  }

  /** Un caso archivado ya no tiene riesgo operativo: se muestra «Inactivo». */
  estaArchivado(caso: Caso): boolean {
    return caso.estado === ESTADO_ARCHIVADO;
  }

  riesgoMostrado(caso: Caso): string {
    return caso.estado === ESTADO_ARCHIVADO ? 'Inactivo' : caso.riesgo;
  }

  /** Clase del badge de riesgo: sin color de nivel cuando está archivado. */
  claseRiesgo(caso: Caso): string {
    return caso.estado === ESTADO_ARCHIVADO
      ? 'status-badge'
      : 'status-badge risk-' + caso.riesgo.toLowerCase();
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
    // Una navegación de filtro pendiente no debe ejecutarse tras salir.
    this.destruccion.onDestroy(() => {
      clearTimeout(this.temporizador);
      clearTimeout(this.temporizadorSectorista);
    });

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
        alcance,
        region: siguiente.region || null,
        sectorista: siguiente.sectorista || null,
        sinregion: siguiente.sinRegion ? 'true' : null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
        orden: siguiente.orden !== ORDEN_INICIAL ? siguiente.orden : null,
        ver: siguiente.ver === 'anulados' ? 'anulados' : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
