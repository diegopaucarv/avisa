import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
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
import { aCaso, esRegistro, leer, texto } from '../../dominio/mapeo';
import type { Caso } from '../../dominio/modelos';
import { formatearFecha, formatearFechaHora } from '../../shared/formato-fecha';
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';

type ModoVista = 'tarjetas' | 'tabla';
type VerRegistros = 'activos' | 'anulados';

type FiltrosCasos = {
  q: string;
  estado: string;
  /** `abiertos=true`: estados con `es_activo` (hoy `Activo` y `En seguimiento`). */
  abiertos: boolean;
  prioridad: string;
  alcance: string;
  tematica: string;
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
  prioridad: '',
  alcance: '',
  tematica: '',
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

/** Opción de `GET /api/v1/catalogs` para los selects de filtro. */
type OpcionFiltro = {
  valor: string;
  etiqueta: string;
};

type CatalogosCasos = {
  prioridades: OpcionFiltro[];
  alcances: OpcionFiltro[];
  tematicas: OpcionFiltro[];
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
 * catálogo es el que valida la API (`tematica` por nombre, `unidad` por
 * siglas). El estado ya no sale del catálogo: la barra usa cuatro chips
 * operativos (`Todos`, `Abiertos`, `Resueltos`, `Archivados`).
 */
function aCatalogosCasos(bruto: unknown): CatalogosCasos {
  const registro = esRegistro(bruto) ? bruto : {};
  const crudo = leer(registro, ['catalogs', 'catalogos']);
  const catalogo = esRegistro(crudo) ? crudo : {};

  return {
    prioridades: opcionesDe(catalogo, 'prioridadesAtencion'),
    alcances: opcionesDe(catalogo, 'alcances'),
    tematicas: opcionesDe(catalogo, 'tematicas'),
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
  imports: [RouterLink, IconoComponent, PaginacionComponent, ExportarMenuComponent],
  templateUrl: './casos.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .aviso-ok {
      color: #2f6f52;
      font-size: 11.5px;
    }

    .status-chips {
      flex-wrap: wrap;
    }

    .status-chips button {
      white-space: nowrap;
    }

    .chip-count {
      margin-left: 4px;
      padding: 0 5px;
      border-radius: 999px;
      background: rgba(100, 116, 135, 0.14);
      font-size: 10px;
      font-variant-numeric: tabular-nums;
    }

    .segmented > button[aria-pressed='true'] .chip-count {
      background: rgba(29, 75, 134, 0.14);
    }

    /* Un chip sin resultados sigue siendo clicable; sólo se atenúa. */
    .chip-vacia {
      opacity: 0.55;
    }
  `,
})
export class CasosPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  readonly capacidades = inject(CapacidadesService);

  readonly ordenes = ORDENES;
  readonly modo = signal<ModoVista>('tarjetas');

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  /** Caso en curso de restauración (por código) y aviso del resultado. */
  readonly restaurando = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({
        q: params.get('q') ?? '',
        estado: params.get('estado') ?? '',
        abiertos: params.get('abiertos') === 'true',
        prioridad: params.get('prioridad') ?? '',
        alcance: params.get('alcance') ?? '',
        tematica: params.get('tematica') ?? '',
        unidad: params.get('unidad') ?? '',
        pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
        tamano: Math.max(1, Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA),
        orden: params.get('orden') ?? 'recent',
        ver: params.get('ver') === 'anulados' ? 'anulados' : 'activos',
      })),
    ),
    { initialValue: FILTROS_INICIALES },
  );

  readonly filtros = computed(() => this.parametros());

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
      prioridad: filtros.prioridad,
      alcance: filtros.alcance,
      tematica: filtros.tematica,
      unidad: filtros.unidad,
      sort: filtros.orden,
    });
  });

  /** La papelera sólo se ofrece a quien puede anular y restaurar. */
  readonly puedeVerPapelera = computed(() => this.capacidades.puedeEliminar());

  /** `?ver=anulados`: la vista pinta la papelera de casos. */
  readonly verPapelera = computed(() => this.filtros().ver === 'anulados');

  /** Opciones de los selects; si el catálogo falla, se muestran sólo «Todos». */
  private readonly catalogoRecurso = consulta<CatalogosCasos>({
    fuente: () => urlApi('/v1/catalogs'),
    esquema: aCatalogosCasos,
  });

  readonly prioridades = computed(() => this.catalogoRecurso.valor()?.prioridades ?? []);
  readonly alcances = computed(() => this.catalogoRecurso.valor()?.alcances ?? []);
  readonly tematicas = computed(() => this.catalogoRecurso.valor()?.tematicas ?? []);
  readonly unidades = computed(() => this.catalogoRecurso.valor()?.unidades ?? []);

  private readonly recurso = consulta<Coleccion<Caso> & { conteos: ConteosCasos }>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/cases'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        q: filtros.q,
        estado: filtros.estado,
        abiertos: filtros.abiertos ? 'true' : '',
        prioridad: filtros.prioridad,
        alcance: filtros.alcance,
        tematica: filtros.tematica,
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

  private temporizador?: ReturnType<typeof setTimeout>;

  cambiarModo(modo: ModoVista): void {
    this.modo.set(modo);
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
   * Chip operativo de estado. `Abiertos` viaja como `abiertos=true`; `Resueltos`
   * y `Archivados` como `estado=<código canónico>`; `Todos` limpia ambos.
   */
  cambiarChip(estado: string, abiertos = false): void {
    void this.actualizar({ estado, abiertos, pagina: 1 });
  }

  cambiarPrioridad(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ prioridad: valor, pagina: 1 });
  }

  cambiarAlcance(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ alcance: valor, pagina: 1 });
  }

  cambiarTematica(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ tematica: valor, pagina: 1 });
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
    return formatearFecha(valor);
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

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  private actualizar(cambios: Partial<FiltrosCasos>): void {
    const actuales = this.parametros();
    const siguiente = { ...actuales, ...cambios };

    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        q: siguiente.q || null,
        estado: siguiente.estado || null,
        abiertos: siguiente.abiertos ? 'true' : null,
        prioridad: siguiente.prioridad || null,
        alcance: siguiente.alcance || null,
        tematica: siguiente.tematica || null,
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
