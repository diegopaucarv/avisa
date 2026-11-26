import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { IconoComponent } from '../../shared/ui/icono.component';
import type { CasoOpcion } from './alerta-panel.component';

type Grupo = { nombre: string; opciones: readonly CasoOpcion[] };

/** Subsectores que se reconocen como grupo propio. */
const SUBSECTORES = ['MYPE e Industria', 'Pesca y Acuicultura'] as const;

/** Lo que no cae en un subsector conocido se agrupa aparte. */
const SIN_SUBSECTOR = 'Sin subsector';

/** Normaliza para buscar sin acentos ni mayúsculas. */
function normalizar(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function grupoDe(subsector: string | null): string {
  const limpio = (subsector ?? '').trim();
  return (SUBSECTORES as readonly string[]).includes(limpio) ? limpio : SIN_SUBSECTOR;
}

/**
 * Combobox de «Caso vinculado» con búsqueda y grupos por subsector.
 *
 * No usa `<select>`: la lista agrupa por subsector y muestra el código sobre el
 * título, algo que `<option>` no permite. Se resuelve con botones —accesibles y
 * con cierre al elegir— en lugar de navegación con flechas.
 */
@Component({
  selector: 'app-caso-combobox',
  imports: [IconoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="combo" (keydown.escape)="cerrar()">
      @if (!abierto()) {
        <button
          type="button"
          class="combo-seleccion"
          role="combobox"
          aria-haspopup="listbox"
          aria-label="Caso vinculado"
          [attr.aria-expanded]="false"
          (click)="abrir()"
        >
          <span class="combo-texto">
            @if (seleccionado(); as caso) {
              <span class="combo-codigo">{{ caso.codigo }}</span>
              <span class="combo-titulo">{{ caso.titulo }}</span>
            } @else if (valor()) {
              <span class="combo-codigo">{{ valor() }}</span>
              <span class="combo-titulo">Caso fuera del catálogo</span>
            } @else {
              <span class="combo-titulo combo-sin">SIN CASO</span>
            }
          </span>
          <app-icono nombre="chevron-abajo" [tamano]="16" />
        </button>
      } @else {
        <div class="combo-abierto">
          <div class="combo-buscador">
            <app-icono nombre="buscar" [tamano]="15" />
            <input
              type="text"
              role="combobox"
              aria-haspopup="listbox"
              aria-controls="combo-casos-lista"
              aria-label="Buscar caso por código o título"
              placeholder="Buscar por código o título…"
              autocomplete="off"
              [attr.aria-expanded]="true"
              [value]="consulta()"
              (input)="alBuscar($event)"
            />
          </div>

          <ul
            id="combo-casos-lista"
            class="combo-lista"
            role="listbox"
            aria-label="Casos disponibles"
          >
            <li role="presentation">
              <button
                type="button"
                class="combo-opcion"
                role="option"
                [attr.aria-selected]="valor() === ''"
                (click)="elegir('')"
              >
                <span class="combo-titulo combo-sin">SIN CASO</span>
              </button>
            </li>

            @for (grupo of grupos(); track grupo.nombre) {
              <li class="combo-grupo" role="presentation">{{ grupo.nombre }}</li>
              @for (caso of grupo.opciones; track caso.codigo) {
                <li role="presentation">
                  <button
                    type="button"
                    class="combo-opcion"
                    role="option"
                    [attr.aria-selected]="caso.codigo === valor()"
                    (click)="elegir(caso.codigo)"
                  >
                    <span class="combo-codigo">{{ caso.codigo }}</span>
                    <span class="combo-titulo">{{ caso.titulo }}</span>
                  </button>
                </li>
              }
            }
          </ul>

          @if (!grupos().length) {
            <p class="combo-vacio">Sin coincidencias.</p>
          }

          <button type="button" class="combo-cerrar" (click)="cerrar()">
            Cerrar la lista
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .combo {
      min-width: 0;
    }

    .combo-seleccion {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 10px;
      border: 1px solid #dde5ec;
      border-radius: 8px;
      background: #fff;
      text-align: left;
      font: inherit;
      cursor: pointer;
    }

    .combo-seleccion:hover {
      border-color: #1f5597;
    }

    .combo-texto {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }

    .combo-codigo {
      font-size: 11px;
      color: #8b97a1;
      font-weight: 700;
      letter-spacing: 0.04em;
    }

    .combo-titulo {
      overflow: hidden;
      color: #17283a;
      font-size: 13px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .combo-sin {
      color: #64748b;
      font-weight: 600;
    }

    .combo-abierto {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px;
      border: 1px solid #dde5ec;
      border-radius: 10px;
      background: #fff;
    }

    .combo-buscador {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      border: 1px solid #e0e6ec;
      border-radius: 7px;
      background: #f9fbfd;
      color: #8b97a1;
    }

    .combo-buscador input {
      flex: 1;
      min-width: 0;
      border: 0;
      background: transparent;
      color: #17283a;
      font: inherit;
      outline: none;
    }

    .combo-lista {
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-height: 260px;
      overflow-y: auto;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .combo-grupo {
      padding: 6px 4px 2px;
      color: #8b97a1;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .combo-opcion {
      display: flex;
      flex-direction: column;
      gap: 1px;
      width: 100%;
      padding: 6px 8px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      text-align: left;
      font: inherit;
      cursor: pointer;
    }

    .combo-opcion:hover {
      background: #eef3fa;
    }

    .combo-opcion[aria-selected='true'] {
      background: #e3edf9;
    }

    .combo-vacio {
      margin: 0;
      padding: 8px 6px;
      color: #99a3aa;
      font-size: 12.5px;
      font-style: italic;
    }

    .combo-cerrar {
      align-self: flex-start;
      padding: 4px 8px;
      border: 0;
      background: none;
      color: #1f5597;
      font: inherit;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }

    .combo-cerrar:hover {
      text-decoration: underline;
    }
  `,
})
export class CasoComboboxComponent {
  /** Casos del catálogo, ya normalizados por la página. */
  readonly opciones = input<readonly CasoOpcion[]>([]);
  /** Código del caso elegido; `''` es «SIN CASO». */
  readonly valor = input('');

  readonly cambio = output<string>();

  readonly abierto = signal(false);
  readonly consulta = signal('');

  readonly seleccionado = computed(
    () => this.opciones().find((opcion) => opcion.codigo === this.valor()) ?? null,
  );

  /** Grupos por subsector, ordenados por nombre y por código dentro de cada uno. */
  readonly grupos = computed<readonly Grupo[]>(() => {
    const busqueda = normalizar(this.consulta().trim());
    const filtradas = this.opciones().filter((opcion) => {
      if (!busqueda) return true;
      return normalizar(`${opcion.codigo} ${opcion.titulo}`).includes(busqueda);
    });

    const mapa = new Map<string, CasoOpcion[]>();
    for (const opcion of filtradas) {
      const nombre = grupoDe(opcion.subsector);
      const lista = mapa.get(nombre) ?? [];
      lista.push(opcion);
      mapa.set(nombre, lista);
    }

    return [...mapa.entries()]
      .map(([nombre, opciones]) => ({
        nombre,
        opciones: [...opciones].sort((uno, otro) => uno.codigo.localeCompare(otro.codigo, 'es')),
      }))
      .sort((uno, otro) => uno.nombre.localeCompare(otro.nombre, 'es'));
  });

  abrir(): void {
    this.abierto.set(true);
  }

  cerrar(): void {
    this.abierto.set(false);
    this.consulta.set('');
  }

  alBuscar(evento: Event): void {
    this.consulta.set((evento.target as HTMLInputElement).value);
  }

  elegir(codigo: string): void {
    this.cambio.emit(codigo);
    this.cerrar();
  }
}
