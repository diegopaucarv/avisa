import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  TemplateRef,
  computed,
  contentChildren,
  inject,
  input,
  output,
} from '@angular/core';

import { comparar, type DireccionOrden } from './orden-tabla';

/**
 * Tabla única de las listas de AVISA.
 *
 * Replica el lenguaje de los mockups (`docs/07_frontend/mockups`): cabecera
 * tenue en mayúsculas, densidad controlada por `padding` con interlineado 1,
 * cebra opcional, estados vacío y cargando dentro del `tbody`, scroll
 * horizontal y cabecera pegajosa. En oscuro y en impresión usa las variables
 * de tema ya existentes.
 *
 * Es declarativa: no sabe de casos ni de alertas. Recibe columnas y filas, y
 * devuelve tres señales —`ordenCambio`, `filaClic` y `seleccionCambio`— para que
 * la pantalla decida si ordena en el servidor o en memoria.
 *
 * ── Celdas con plantilla ───────────────────────────────────────────────────
 * Una columna puede pintarse con un `<ng-template>` propio. El `ng-template` va
 * dentro de `<app-tabla>` y se marca con la clave de la columna:
 *
 * ```html
 * <app-tabla [columnas]="columnas" [filas]="filas">
 *   <ng-template appCeldaTabla="estado" let-fila let-valor="valor">
 *     <span class="chip">{{ valor }}</span>
 *   </ng-template>
 * </app-tabla>
 * ```
 *
 * El contexto expone `$implicit` (la fila), `valor` (lo que devuelve `acceso` o
 * la propiedad homónima), `columna` e `indice`.
 *
 * ── Por qué no usa `th-orden.directive.ts` ─────────────────────────────────
 * La directiva ciclo el orden en su propio estado y avisa `aria-sort` desde un
 * `ControlOrden`. Aquí el orden es un `input` (lo puede fijar la URL o el
 * servidor) y el cambio se emite; la directiva no cabe. Sí se reutiliza el
 * comparador y el tipo `DireccionOrden` de `orden-tabla.ts`, que es la parte
 * que importa: nulos al final, números, fechas ISO y texto en español.
 */

/** Fila genérica: cualquier objeto con propiedades legibles por clave. */
export type FilaTabla = Record<string, unknown>;

export type AlineacionColumna = 'izquierda' | 'centro' | 'derecha';

export type ColumnaTabla = {
  /** Propiedad de la fila (o clave con la que se enlaza la plantilla). */
  clave: string;
  titulo: string;
  /** Ancho CSS: `120px`, `18%`, `minmax(...)`…; si falta, lo reparte el navegador. */
  ancho?: string;
  alineacion?: AlineacionColumna;
  ordenable?: boolean;
  /** Cómo pintar el valor. Recibe el valor ya resuelto y la fila completa. */
  formato?: (valor: unknown, fila: FilaTabla) => string;
  /** Cómo leer/ordenar el valor cuando no es la propiedad homónima. */
  acceso?: (fila: FilaTabla) => unknown;
};

export type OrdenColumna = {
  clave: string;
  direccion: DireccionOrden;
};

export type ClicFila = {
  fila: FilaTabla;
  indice: number;
};

export type DensidadTabla = 'comoda' | 'compacta';

/** Declara la plantilla de una columna: `<ng-template appCeldaTabla="clave">`. */
@Directive({
  selector: 'ng-template[appCeldaTabla]',
})
export class CeldaTablaDirectiva {
  readonly clave = input.required<string>({ alias: 'appCeldaTabla' });
  readonly template = inject<TemplateRef<unknown>>(TemplateRef);
}

function esVacio(valor: unknown): boolean {
  return valor === null || valor === undefined || valor === '';
}

@Component({
  selector: 'app-tabla',
  imports: [NgTemplateOutlet],
  templateUrl: './tabla.component.html',
  styleUrl: './tabla.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.aria-busy]': 'cargando() ? "true" : null',
  },
})
export class TablaComponent {
  readonly columnas = input.required<readonly ColumnaTabla[]>();
  readonly filas = input<readonly FilaTabla[]>([]);
  readonly cargando = input(false);
  /** Mensaje del estado vacío. Nunca se rellena con datos: se declara. */
  readonly vacio = input('Sin resultados para los filtros aplicados.');
  readonly orden = input<OrdenColumna | null>(null);
  /**
   * Cuando la pantalla ordena en el servidor, la tabla no reordena la página
   * recibida: sólo pinta el indicador y emite el cambio.
   */
  readonly ordenServidor = input(false);
  readonly seleccionable = input(false);
  /** Ids marcados. La tabla no los guarda: los devuelve en cada cambio. */
  readonly seleccion = input<readonly string[]>([]);
  /** Propiedad que identifica la fila (para `track` y la selección). */
  readonly claveFila = input('id');
  readonly cebra = input(false);
  readonly densidad = input<DensidadTabla>('comoda');
  /** Clase de impresión: sin cabecera pegajosa, sin scroll, filas sin cortar. */
  readonly imprimible = input(false);
  /** `max-height` del área con scroll; necesario para una cabecera pegajosa real. */
  readonly altoMaximo = input<string | null>(null);
  /** `<caption>` de la tabla: qué muestra y con qué alcance. */
  readonly resumen = input<string | null>(null);
  /** Cursor y foco de fila. El clic se emite siempre salvo en la casilla. */
  readonly clicable = input(false);

  readonly ordenCambio = output<OrdenColumna | null>();
  readonly filaClic = output<ClicFila>();
  readonly seleccionCambio = output<string[]>();

  private readonly celdas = contentChildren(CeldaTablaDirectiva);

  private readonly plantillas = computed(() => {
    const mapa = new Map<string, TemplateRef<unknown>>();
    for (const celda of this.celdas()) mapa.set(celda.clave(), celda.template);
    return mapa;
  });

  readonly columnasVisibles = computed(
    () => this.columnas().length + (this.seleccionable() ? 1 : 0),
  );

  /** Filas a pintar: la página recibida, ordenada en memoria salvo `ordenServidor`. */
  readonly filasVisibles = computed<readonly FilaTabla[]>(() => {
    const filas = this.filas();
    const orden = this.orden();
    if (!orden || this.ordenServidor()) return [...filas];

    const columna = this.columnas().find((item) => item.clave === orden.clave);
    if (!columna) return [...filas];

    const factor = orden.direccion === 'asc' ? 1 : -1;
    const acceso =
      columna.acceso ?? ((fila: FilaTabla) => this.leer(fila, columna.clave));

    return [...filas].sort((a, b) => {
      const valorA = acceso(a);
      const valorB = acceso(b);
      // Un hueco no es «lo más alto» ni «lo más bajo»: no se gira con la
      // dirección y queda al final en ambos sentidos.
      if (esVacio(valorA) || esVacio(valorB)) return comparar(valorA, valorB);
      return factor * comparar(valorA, valorB);
    });
  });

  private readonly seleccionadas = computed(() => new Set(this.seleccion()));

  private readonly idsVisibles = computed(() =>
    this.filasVisibles().map((fila, indice) => this.idDe(fila, indice)),
  );

  readonly todasVisibles = computed(() => {
    const ids = this.idsVisibles();
    const marcadas = this.seleccionadas();
    return ids.length > 0 && ids.every((id) => marcadas.has(id));
  });

  readonly algunasVisibles = computed(() => {
    const ids = this.idsVisibles();
    const marcadas = this.seleccionadas();
    return ids.some((id) => marcadas.has(id)) && !this.todasVisibles();
  });

  // ── Celdas ──────────────────────────────────────────────────────────────

  plantilla(clave: string): TemplateRef<unknown> | null {
    return this.plantillas().get(clave) ?? null;
  }

  contexto(fila: FilaTabla, columna: ColumnaTabla, indice: number): Record<string, unknown> {
    return {
      $implicit: fila,
      valor: this.valor(fila, columna),
      columna,
      indice,
    };
  }

  valor(fila: FilaTabla, columna: ColumnaTabla): unknown {
    return columna.acceso
      ? columna.acceso(fila)
      : this.leer(fila, columna.clave);
  }

  /** Texto de la celda. Una columna con `formato` manda; el resto se declara. */
  mostrar(fila: FilaTabla, columna: ColumnaTabla): string {
    const valor = this.valor(fila, columna);
    if (columna.formato) {
      try {
        return columna.formato(valor, fila);
      } catch {
        // Una celda no puede tumbar la tabla: cae al formateo por defecto.
      }
    }
    return this.formatearPorDefecto(valor);
  }

  alineacion(columna: ColumnaTabla): string {
    switch (columna.alineacion) {
      case 'centro':
        return 'center';
      case 'derecha':
        return 'right';
      default:
        return 'left';
    }
  }

  // ── Orden ───────────────────────────────────────────────────────────────

  ariaSort(columna: ColumnaTabla): 'ascending' | 'descending' | 'none' | null {
    if (!columna.ordenable) return null;
    const orden = this.orden();
    if (!orden || orden.clave !== columna.clave) return 'none';
    return orden.direccion === 'asc' ? 'ascending' : 'descending';
  }

  indicador(clave: string): DireccionOrden | '' {
    const orden = this.orden();
    return orden && orden.clave === clave ? orden.direccion : '';
  }

  alternarOrden(clave: string): void {
    const actual = this.orden();
    let siguiente: OrdenColumna | null;
    if (!actual || actual.clave !== clave) {
      siguiente = { clave, direccion: 'asc' };
    } else if (actual.direccion === 'asc') {
      siguiente = { clave, direccion: 'desc' };
    } else {
      siguiente = null;
    }
    this.ordenCambio.emit(siguiente);
  }

  // ── Selección ───────────────────────────────────────────────────────────

  estaSeleccionada(fila: FilaTabla, indice: number): boolean {
    return this.seleccionadas().has(this.idDe(fila, indice));
  }

  alternarFila(fila: FilaTabla, indice: number, evento: Event): void {
    const id = this.idDe(fila, indice);
    const marcar = (evento.target as HTMLInputElement).checked;
    const siguiente = new Set(this.seleccion());
    if (marcar) {
      siguiente.add(id);
    } else {
      siguiente.delete(id);
    }
    this.seleccionCambio.emit([...siguiente]);
  }

  /** «Seleccionar todo» alcanza a las filas visibles, no al conjunto filtrado. */
  alternarPagina(evento: Event): void {
    const marcar = (evento.target as HTMLInputElement).checked;
    const siguiente = new Set(this.seleccion());
    for (const id of this.idsVisibles()) {
      if (marcar) {
        siguiente.add(id);
      } else {
        siguiente.delete(id);
      }
    }
    this.seleccionCambio.emit([...siguiente]);
  }

  // ── Fila ────────────────────────────────────────────────────────────────

  alClicFila(fila: FilaTabla, indice: number): void {
    this.filaClic.emit({ fila, indice });
  }

  idDe(fila: FilaTabla, indice: number): string {
    const clave = this.claveFila();
    const valor = this.leer(fila, clave);
    if (typeof valor === 'string' && valor) return valor;
    if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
    return `#${indice}`;
  }

  /** La primera columna de datos es la que identifica la fila (como el mockup). */
  esPrincipal(indice: number): boolean {
    return indice === 0;
  }

  // ── Interno ─────────────────────────────────────────────────────────────

  private leer(fila: FilaTabla, clave: string): unknown {
    return fila[clave];
  }

  private formatearPorDefecto(valor: unknown): string {
    if (valor === null || valor === undefined) return '—';
    if (typeof valor === 'string') return valor.trim() ? valor : '—';
    if (typeof valor === 'number') return Number.isFinite(valor) ? String(valor) : '—';
    if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
    return String(valor);
  }
}
