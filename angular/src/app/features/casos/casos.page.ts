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
import { aCaso } from '../../dominio/mapeo';
import type { Caso } from '../../dominio/modelos';
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';

type ModoVista = 'tarjetas' | 'tabla';

type FiltrosCasos = {
  q: string;
  pagina: number;
  tamano: number;
  orden: string;
};

const ORDENES = [
  { valor: 'recent', etiqueta: 'Fecha (más reciente)' },
  { valor: 'risk', etiqueta: 'Riesgo (Alto → Bajo)' },
  { valor: 'priority', etiqueta: 'Prioridad (Urgente → Bajo)' },
] as const;

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
        pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
        tamano: Math.max(1, Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA),
        orden: params.get('orden') ?? 'recent',
      })),
    ),
    {
      initialValue: {
        q: '',
        pagina: 1,
        tamano: TAMANO_PAGINA,
        orden: 'recent',
      } satisfies FiltrosCasos,
    },
  );

  readonly filtros = computed(() => this.parametros());

  private readonly recurso = consulta<Coleccion<Caso>>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/cases'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        q: filtros.q,
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
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
        orden: siguiente.orden !== 'recent' ? siguiente.orden : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
