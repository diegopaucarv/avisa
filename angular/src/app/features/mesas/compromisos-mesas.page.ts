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
  paramsDePagina,
  urlConParametros,
  type Coleccion,
} from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { etiquetaHito as etiquetaHitoDe } from '../../shared/hito-texto';
import { IconoComponent } from '../../shared/ui/icono.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import {
  CeldaTablaDirectiva,
  TablaComponent,
  type ClicFila,
  type ColumnaTabla,
} from '../../shared/ui/tabla.component';
import { ESTADOS_COMPROMISO } from '../compromisos/compromiso.mapeo';

import { MesaPanelComponent } from './mesa-panel.component';
import { MesasGraficosComponent } from './mesas-graficos.component';
import {
  aCompromisoMesa,
  aMesa,
  fechaTexto,
  normalizarClave,
  type CompromisoMesa,
  type Mesa,
} from './mesa.mapeo';

type FiltrosMesas = {
  q: string;
  mesa: string;
  estado: string;
  pagina: number;
  tamano: number;
};

/**
 * Tono de `.commit-status` para el estado del compromiso.
 *
 * «Por iniciar» y «En proceso» comparten el azul de trabajo en curso; el resto
 * reutiliza los tonos ya definidos en `global.css`.
 */
function claseEstadoCompromiso(estado: string): string {
  switch (normalizarClave(estado)) {
    case 'cumplido':
      return 'commit-cumplido';
    case 'redefinido':
      return 'commit-por-vencer';
    case 'desestimado':
      return 'commit-vencido';
    default:
      return 'commit-en-curso';
  }
}

/**
 * `/mesas/compromisos`: compromisos de los casos vinculados a mesas de diálogo.
 *
 * Mientras la migración 81 no cree el caso espejo de cada mesa, la API devuelve
 * `total = 0`; la vista lo declara en vez de pintar una tabla vacía sin motivo.
 */
@Component({
  selector: 'app-compromisos-mesas-page',
  imports: [
    RouterLink,
    IconoComponent,
    PaginacionComponent,
    TablaComponent,
    CeldaTablaDirectiva,
    MesasGraficosComponent,
    MesaPanelComponent,
  ],
  templateUrl: './compromisos-mesas.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .view-sub {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 12.5px;
    }
    .celda-compromiso {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }
    .compromiso-codigo {
      font-weight: 600;
    }
    .compromiso-accion {
      color: var(--ink-2);
      font-size: 12.5px;
      line-height: 1.4;
      white-space: normal;
    }
    .celda-mesa {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .mesa-codigo {
      cursor: pointer;
      font-weight: 600;
      text-align: left;
    }
    .mesa-titulo-tabla {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
      white-space: normal;
    }
    .celda-hitos {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .hitos-cuenta {
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
    .celda-hitos-texto {
      max-width: 260px;
      overflow: hidden;
      color: var(--ink-2);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .hito-fecha {
      color: var(--muted);
      font-size: 11.5px;
    }
  `,
})
export class CompromisosMesasPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly estados = ESTADOS_COMPROMISO as readonly string[];

  /** Código de la mesa cuyo panel lateral está abierto. */
  readonly mesaAbierta = signal<string | null>(null);

  readonly etiquetaHito = etiquetaHitoDe;
  readonly fechaTexto = fechaTexto;

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({
        q: params.get('q') ?? '',
        mesa: params.get('mesa') ?? '',
        estado: params.get('estado') ?? '',
        pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
        tamano: Math.max(1, Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA),
      })),
    ),
    {
      initialValue: {
        q: '',
        mesa: '',
        estado: '',
        pagina: 1,
        tamano: TAMANO_PAGINA,
      } satisfies FiltrosMesas,
    },
  );

  readonly filtros = computed(() => this.parametros());

  /** Hay una búsqueda o un filtro activo: el vacío no es «falta migración 81». */
  readonly hayFiltros = computed(() => {
    const filtros = this.parametros();
    return Boolean(filtros.q.trim() || filtros.mesa || filtros.estado);
  });

  private readonly recurso = consulta<Coleccion<CompromisoMesa>>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/mesas/compromisos'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        q: filtros.q,
        mesa: filtros.mesa,
        estado: filtros.estado,
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return {
        ...coleccion,
        elementos: coleccion.elementos.map(aCompromisoMesa),
      } satisfies Coleccion<CompromisoMesa>;
    },
  });

  /** Mesas para el selector; el filtro viaja por código (`OAIPCS-001`). */
  private readonly recursoMesas = consulta<Mesa[]>({
    fuente: () => urlConParametros(urlApi('/v1/mesas'), { tamano: 100 }),
    esquema: (bruto) => normalizarColeccion<unknown>(bruto).elementos.map(aMesa),
  });

  readonly compromisos = computed(() => this.recurso.valor()?.elementos ?? []);
  readonly total = computed(() => this.recurso.valor()?.total ?? 0);
  readonly estado = this.recurso.estado;
  readonly error = this.recurso.error;
  readonly mesas = computed(() => this.recursoMesas.valor() ?? []);

  readonly cargando = computed(() => {
    const estado = this.estado();
    return estado === 'inactivo' || estado === 'cargando';
  });

  readonly columnas: readonly ColumnaTabla[] = [
    { clave: 'compromiso', titulo: 'Compromiso' },
    { clave: 'mesa', titulo: 'Mesa de diálogo' },
    { clave: 'estado', titulo: 'Estado' },
    { clave: 'area', titulo: 'Área responsable' },
    {
      clave: 'vencimiento',
      titulo: 'Vencimiento',
      acceso: (fila) => (fila as CompromisoMesa).fechaLimite,
      formato: (valor) => fechaTexto(valor as string | null),
    },
    { clave: 'seguimiento', titulo: 'Seguimiento de hitos' },
  ];

  private temporizador?: ReturnType<typeof setTimeout>;

  constructor() {
    // Una navegación de búsqueda pendiente no debe ejecutarse tras salir.
    inject(DestroyRef).onDestroy(() => clearTimeout(this.temporizador));
  }

  buscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      void this.navegar({ q: valor, pagina: 1 });
    }, 300);
  }

  filtrarMesa(evento: Event): void {
    void this.navegar({ mesa: this.valorDe(evento), pagina: 1 });
  }

  filtrarEstado(evento: Event): void {
    void this.navegar({ estado: this.valorDe(evento), pagina: 1 });
  }

  cambiarPagina(pagina: number): void {
    void this.navegar({ pagina });
  }

  cambiarTamano(tamano: number): void {
    void this.navegar({ tamano, pagina: 1 });
  }

  limpiar(): void {
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: { q: null, mesa: null, estado: null, pagina: null },
      replaceUrl: true,
    });
  }

  recargar(): void {
    this.recurso.recargar();
  }

  abrirMesa(codigo: string | null): void {
    if (!codigo) return;
    this.mesaAbierta.set(codigo);
  }

  cerrarPanel(): void {
    this.mesaAbierta.set(null);
  }

  /** La fila entera abre la ficha de su mesa, igual que la celda «Mesa». */
  alClicFila(evento: ClicFila): void {
    this.abrirMesa((evento.fila as CompromisoMesa).mesaCodigo);
  }

  claseEstado(estado: string): string {
    return claseEstadoCompromiso(estado);
  }

  private valorDe(evento: Event): string {
    return (evento.target as HTMLSelectElement).value;
  }

  private navegar(cambios: Partial<FiltrosMesas>): void {
    const siguiente = { ...this.filtros(), ...cambios };
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        q: siguiente.q || null,
        mesa: siguiente.mesa || null,
        estado: siguiente.estado || null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
      },
      replaceUrl: true,
    });
  }
}
