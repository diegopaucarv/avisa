import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import {
  TAMANO_PAGINA,
  normalizarColeccion,
  paramsDePagina,
  rangoPagina,
  urlConParametros,
  type Coleccion,
} from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import {
  ESTADOS_COMPROMISO,
  NIVELES_GOBIERNO,
  TIPOS_COMPROMISO,
  aCompromiso,
  formatearFecha,
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
};

const GENERO = [
  { valor: '', etiqueta: 'Todos' },
  { valor: 'true', etiqueta: 'Sí atiende brecha de género' },
  { valor: 'false', etiqueta: 'No atiende brecha de género' },
] as const;

@Component({
  selector: 'app-compromisos',
  imports: [IconoComponent, PaginacionComponent, CompromisoPanelComponent, ExportarMenuComponent],
  templateUrl: './compromisos.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .filter-bar {
      flex-wrap: wrap;
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
  `,
})
export class CompromisosPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly estados = ESTADOS_COMPROMISO as readonly string[];
  readonly tipos = TIPOS_COMPROMISO as readonly string[];
  readonly niveles = NIVELES_GOBIERNO as readonly string[];
  readonly generos = GENERO;

  readonly seleccionado = signal<Compromiso | null>(null);

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

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
      } satisfies FiltrosCompromisos,
    },
  );

  readonly filtros = computed(() => this.parametros());

  private readonly recurso = consulta<Coleccion<Compromiso>>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/commitments'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
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

  limpiar(): void {
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {},
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
    this.seleccionado.set(compromiso);
  }

  cerrarPanel(): void {
    this.seleccionado.set(null);
  }

  alActualizar(): void {
    this.recurso.recargar();
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
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
