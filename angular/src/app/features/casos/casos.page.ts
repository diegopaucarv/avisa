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
import { map } from 'rxjs';

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

  /** Fecha abreviada «18 nov 2026», sin el punto que añade `es-PE`. */
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
    this.panelAbierto.set(true);
  }

  cerrarAlta(): void {
    if (this.guardando()) return;
    this.panelAbierto.set(false);
    this.errorAlta.set(null);
  }

  /**
   * `POST /api/v1/cases`: el código lo asigna el servidor. Si la respuesta lo
   * trae, se abre la ficha; si no, se recarga el listado. Un fallo deja el panel
   * abierto con el mensaje de la API.
   */
  registrarCaso(cuerpo: CuerpoCasoAlta): void {
    if (this.guardando()) return;
    this.guardando.set(true);
    this.errorAlta.set(null);

    this.http.post<unknown>(urlApi('/v1/cases'), cuerpo).subscribe({
      next: (bruto) => {
        this.guardando.set(false);
        const codigo = codigoDeCasoCreado(bruto);
        this.panelAbierto.set(false);
        if (codigo) {
          void this.router.navigate(['/casos', codigo]);
          return;
        }
        this.aviso.set('Caso registrado. Se actualizó el listado.');
        this.recargar();
      },
      error: (fallo: unknown) => {
        this.guardando.set(false);
        this.errorAlta.set(aErrorApi(fallo).message);
      },
    });
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
