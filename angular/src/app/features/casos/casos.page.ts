import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import {
  Coleccion,
  TAMANO_PAGINA,
  normalizarColeccion,
  paramsDePagina,
  totalPaginas,
  urlConParametros,
} from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { aCaso, esRegistro, leer, texto } from '../../dominio/mapeo';
import type { Caso } from '../../dominio/modelos';
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';

type ModoVista = 'tarjetas' | 'tabla';

type FiltrosCasos = {
  q: string;
  estado: string;
  prioridad: string;
  alcance: string;
  tematica: string;
  unidad: string;
  pagina: number;
  tamano: number;
  orden: string;
};

const FILTROS_INICIALES: FiltrosCasos = {
  q: '',
  estado: '',
  prioridad: '',
  alcance: '',
  tematica: '',
  unidad: '',
  pagina: 1,
  tamano: TAMANO_PAGINA,
  orden: 'recent',
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
  estados: OpcionFiltro[];
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
 * `GET /api/v1/catalogs` reducido a los cinco filtros del listado.
 *
 * No se codifican etiquetas en el cliente: el mismo valor que ofrece el
 * catálogo es el que valida la API (`estado` por código, `tematica` por nombre,
 * `unidad` por siglas).
 */
function aCatalogosCasos(bruto: unknown): CatalogosCasos {
  const registro = esRegistro(bruto) ? bruto : {};
  const crudo = leer(registro, ['catalogs', 'catalogos']);
  const catalogo = esRegistro(crudo) ? crudo : {};

  return {
    estados: opcionesDe(catalogo, 'estadosCaso'),
    prioridades: opcionesDe(catalogo, 'prioridadesAtencion'),
    alcances: opcionesDe(catalogo, 'alcances'),
    tematicas: opcionesDe(catalogo, 'tematicas'),
    unidades: opcionesDe(catalogo, 'unidades'),
  };
}

/**
 * Casos: listado con paginación y filtros de servidor.
 *
 * Todos los filtros viajan a `GET /api/v1/cases` (`estado`, `prioridad`,
 * `alcance`, `tematica`, `unidad`) y viven en la URL para que el enlace se
 * pueda compartir. Cambiar cualquiera de ellos reinicia a la página 1; nunca se
 * filtra sobre las filas ya cargadas.
 */
@Component({
  selector: 'app-casos',
  imports: [RouterLink, IconoComponent, PaginacionComponent, ExportarMenuComponent],
  templateUrl: './casos.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CasosPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly capacidades = inject(CapacidadesService);

  readonly ordenes = ORDENES;
  readonly modo = signal<ModoVista>('tarjetas');

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({
        q: params.get('q') ?? '',
        estado: params.get('estado') ?? '',
        prioridad: params.get('prioridad') ?? '',
        alcance: params.get('alcance') ?? '',
        tematica: params.get('tematica') ?? '',
        unidad: params.get('unidad') ?? '',
        pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
        tamano: Math.max(1, Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA),
        orden: params.get('orden') ?? 'recent',
      })),
    ),
    { initialValue: FILTROS_INICIALES },
  );

  readonly filtros = computed(() => this.parametros());

  /** Opciones de los selects; si el catálogo falla, se muestran sólo «Todos». */
  private readonly catalogoRecurso = consulta<CatalogosCasos>({
    fuente: () => urlApi('/v1/catalogs'),
    esquema: aCatalogosCasos,
  });

  readonly estados = computed(() => this.catalogoRecurso.valor()?.estados ?? []);
  readonly prioridades = computed(() => this.catalogoRecurso.valor()?.prioridades ?? []);
  readonly alcances = computed(() => this.catalogoRecurso.valor()?.alcances ?? []);
  readonly tematicas = computed(() => this.catalogoRecurso.valor()?.tematicas ?? []);
  readonly unidades = computed(() => this.catalogoRecurso.valor()?.unidades ?? []);

  private readonly recurso = consulta<Coleccion<Caso>>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/cases'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        q: filtros.q,
        estado: filtros.estado,
        prioridad: filtros.prioridad,
        alcance: filtros.alcance,
        tematica: filtros.tematica,
        unidad: filtros.unidad,
        sort: filtros.orden,
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aCaso) };
    },
  });

  readonly casos = computed(() => this.recurso.valor()?.elementos ?? []);
  readonly total = computed(() => this.recurso.valor()?.total ?? 0);
  readonly estado = this.recurso.estado;
  readonly error = this.recurso.error;
  readonly paginas = computed(() =>
    totalPaginas(this.recurso.valor() ?? { total: 0, tamanoPagina: TAMANO_PAGINA }),
  );

  private temporizador?: ReturnType<typeof setTimeout>;

  cambiarModo(modo: ModoVista): void {
    this.modo.set(modo);
  }

  buscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      void this.actualizar({ q: valor, pagina: 1 });
    }, 300);
  }

  cambiarEstado(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ estado: valor, pagina: 1 });
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
      queryParams: {},
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
        prioridad: siguiente.prioridad || null,
        alcance: siguiente.alcance || null,
        tematica: siguiente.tematica || null,
        unidad: siguiente.unidad || null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
        orden: siguiente.orden !== 'recent' ? siguiente.orden : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
