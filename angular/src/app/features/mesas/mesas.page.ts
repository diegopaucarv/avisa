import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import {
  TAMANO_PAGINA,
  normalizarColeccion,
  urlConParametros,
  type Coleccion,
} from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { IconoComponent } from '../../shared/ui/icono.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import {
  CeldaTablaDirectiva,
  TablaComponent,
  type ColumnaTabla,
} from '../../shared/ui/tabla.component';
import {
  ESTADOS_VIGENCIA,
  NATURALEZAS,
  aMesa,
  avanceCompromisos,
  claseVigencia,
  leerResumen,
  type Mesa,
  type MesaResumen,
} from './mesa.mapeo';
import { MesaPanelComponent } from './mesa-panel.component';
import { MesasGraficosComponent } from './mesas-graficos.component';

type FiltrosMesas = {
  q: string;
  pagina: number;
  tamano: number;
  vigencia: string;
  naturaleza: string;
};

/** Cifra de la franja de indicadores; cada una filtra la tabla por vigencia. */
type IndicadorMesas = 'todos' | 'vigente' | 'porVencer' | 'vencido';

/** El listado y su resumen global vienen en la misma respuesta. */
type RespuestaMesas = {
  coleccion: Coleccion<Mesa>;
  resumen: MesaResumen | null;
};

@Component({
  selector: 'app-mesas',
  imports: [
    RouterLink,
    IconoComponent,
    PaginacionComponent,
    TablaComponent,
    CeldaTablaDirectiva,
    MesasGraficosComponent,
    MesaPanelComponent,
  ],
  templateUrl: './mesas.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .view-sub {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 13px;
    }
    /*
     * El td de app-tabla es nowrap; el bloque interno concede el salto de línea
     * al código y al título de la mesa, que puede ser largo.
     */
    .celda-mesa {
      display: block;
      max-width: 340px;
      white-space: normal;
    }
    .celda-mesa .mesa-codigo {
      display: block;
      margin: 0 0 2px;
      font-size: 12px;
    }
    .mesa-titulo {
      display: block;
    }
  `,
})
export class MesasPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly estados = ESTADOS_VIGENCIA;
  readonly naturalezas = NATURALEZAS;

  /** Fila abierta en el panel de ficha; `null` cuando está cerrado. */
  readonly seleccionada = signal<string | null>(null);

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({
        q: params.get('q') ?? '',
        pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
        tamano: Math.max(1, Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA),
        vigencia: params.get('vigencia') ?? '',
        naturaleza: params.get('naturaleza') ?? '',
      })),
    ),
    {
      initialValue: {
        q: '',
        pagina: 1,
        tamano: TAMANO_PAGINA,
        vigencia: '',
        naturaleza: '',
      } satisfies FiltrosMesas,
    },
  );

  readonly filtros = computed(() => this.parametros());

  /** Ventana de paginación pedida al servidor, derivada de la URL. */
  readonly peticion = computed(() => {
    const { pagina, tamano } = this.parametros();
    return { pagina, tamano };
  });

  private readonly recurso = consulta<RespuestaMesas>({
    fuente: () => {
      const filtros = this.parametros();
      const { pagina, tamano } = this.peticion();
      return urlConParametros(urlApi('/v1/mesas'), {
        q: filtros.q,
        vigencia: filtros.vigencia,
        naturaleza: filtros.naturaleza,
        pagina,
        tamano,
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return {
        coleccion: {
          ...coleccion,
          elementos: coleccion.elementos.map(aMesa),
        } satisfies Coleccion<Mesa>,
        resumen: leerResumen(bruto),
      };
    },
  });

  readonly mesas = computed(() => this.recurso.valor()?.coleccion.elementos ?? []);
  readonly total = computed(() => this.recurso.valor()?.coleccion.total ?? 0);
  readonly error = this.recurso.error;

  readonly cargando = computed(() => {
    const estado = this.recurso.estado();
    return estado === 'inactivo' || estado === 'cargando';
  });

  /** Cifras globales del servidor: no cambian con la búsqueda ni los filtros. */
  readonly resumen = computed(() => this.recurso.valor()?.resumen ?? null);

  readonly hayFiltros = computed(() => {
    const filtros = this.parametros();
    return Boolean(filtros.q.trim() || filtros.vigencia || filtros.naturaleza);
  });

  readonly columnas: readonly ColumnaTabla[] = [
    { clave: 'mesa', titulo: 'Mesa' },
    { clave: 'vigencia', titulo: 'Vigencia' },
    { clave: 'ambito', titulo: 'Ámbito' },
    { clave: 'compromisos', titulo: 'Compromisos' },
    { clave: 'miembros', titulo: 'Integrantes' },
  ];

  /** Utilidades de `mesa.mapeo` expuestas como miembros para la plantilla. */
  readonly avanceCompromisos = avanceCompromisos;
  readonly claseVigencia = claseVigencia;

  /** Cifra marcada en la franja; sólo la vigencia se puede fijar desde ella. */
  readonly indicadorActivo = computed<IndicadorMesas>(() => {
    switch (this.parametros().vigencia) {
      case 'Vigente':
        return 'vigente';
      case 'Por vencer':
        return 'porVencer';
      case 'Vencido':
        return 'vencido';
      default:
        return 'todos';
    }
  });

  private temporizador?: ReturnType<typeof setTimeout>;

  constructor() {
    // Una navegación de búsqueda pendiente no debe ejecutarse tras salir.
    inject(DestroyRef).onDestroy(() => clearTimeout(this.temporizador));
  }

  buscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      void this.actualizar({ q: valor, pagina: 1 });
    }, 300);
  }

  filtrarVigencia(evento: Event): void {
    void this.actualizar({ vigencia: this.valorDe(evento), pagina: 1 });
  }

  filtrarNaturaleza(evento: Event): void {
    void this.actualizar({ naturaleza: this.valorDe(evento), pagina: 1 });
  }

  /** Cada cifra filtra por vigencia; «todos» limpia ese filtro. */
  filtrarIndicador(indicador: IndicadorMesas): void {
    let vigencia = '';
    if (indicador === 'vigente') vigencia = 'Vigente';
    else if (indicador === 'porVencer') vigencia = 'Por vencer';
    else if (indicador === 'vencido') vigencia = 'Vencido';

    void this.actualizar({ vigencia, pagina: 1 });
  }

  cambiarPagina(pagina: number): void {
    void this.actualizar({ pagina });
  }

  /** Un tamaño distinto reordena los cortes: se vuelve a la primera página. */
  cambiarTamano(tamano: number): void {
    void this.actualizar({ tamano, pagina: 1 });
  }

  limpiar(): void {
    void this.router.navigate([], {
      relativeTo: this.ruta,
      // Sólo se borran los filtros y la página; `tamano` no es un filtro.
      queryParams: { q: null, vigencia: null, naturaleza: null, pagina: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  recargar(): void {
    this.recurso.recargar();
  }

  abrir(mesa: Mesa): void {
    this.seleccionada.set(mesa.codigo);
  }

  cerrarPanel(): void {
    this.seleccionada.set(null);
  }

  private valorDe(evento: Event): string {
    return (evento.target as HTMLSelectElement).value;
  }

  private actualizar(cambios: Partial<FiltrosMesas>): void {
    const siguiente = { ...this.parametros(), ...cambios };

    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        q: siguiente.q || null,
        vigencia: siguiente.vigencia || null,
        naturaleza: siguiente.naturaleza || null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
