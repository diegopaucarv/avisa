import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  computed,
} from '@angular/core';

import { urlApi } from '../../core/config/entorno';
import { consulta } from '../../core/http/consulta';
import { booleano, esRegistro, lista, numero, texto } from '../../dominio/mapeo';
import { IconoComponent } from './icono.component';

/** Un distrito del catálogo INEI (1 891 filas). */
export type DistritoTerritorio = {
  tipo: 'distrito';
  id: number;
  nombre: string;
  region: string;
  /** «Distrito · Provincia · Región»: desambigua los 15 «Santa Rosa». */
  ruta: string;
};

/**
 * Un lugar operativo que **no** es distrito: puerto, caleta, desembarcadero.
 * Matarani entra por aquí —es puerto del distrito de Islay—, y se guarda en
 * `core.caso_lugares` sin degradarlo al distrito que lo contiene.
 */
export type LugarTerritorio = {
  tipo: 'lugar';
  id: string;
  nombre: string;
  /** `puerto`, `caleta`, `desembarcadero_artesanal`… */
  etiquetaTipo: string;
  region: string;
  ruta: string;
};

export type OpcionTerritorio = DistritoTerritorio | LugarTerritorio;

export type ResultadoTerritorio = {
  aplicada: boolean;
  distritos: DistritoTerritorio[];
  lugares: LugarTerritorio[];
};

export function aTerritorio(bruto: unknown): ResultadoTerritorio {
  const registro = esRegistro(bruto) ? bruto : {};

  const distritos: DistritoTerritorio[] = [];
  for (const item of lista(registro, ['distritos'])) {
    const fila = esRegistro(item) ? item : {};
    const id = numero(fila, ['id']);
    const nombre = texto(fila, ['nombre']);
    const ruta = texto(fila, ['ruta']) ?? nombre;
    if (id === null || !nombre || !ruta) continue;
    distritos.push({
      tipo: 'distrito',
      id,
      nombre,
      region: texto(fila, ['region']) ?? '',
      ruta,
    });
  }

  const lugares: LugarTerritorio[] = [];
  for (const item of lista(registro, ['lugares'])) {
    const fila = esRegistro(item) ? item : {};
    const id = texto(fila, ['id']);
    const nombre = texto(fila, ['nombre']);
    const ruta = texto(fila, ['ruta']) ?? nombre;
    if (!id || !nombre || !ruta) continue;
    lugares.push({
      tipo: 'lugar',
      id,
      nombre,
      etiquetaTipo: texto(fila, ['tipo']) ?? 'lugar',
      region: texto(fila, ['region']) ?? '',
      ruta,
    });
  }

  return { aplicada: booleano(registro, ['aplicada']), distritos, lugares };
}

const RESULTADO_VACIO: ResultadoTerritorio = {
  aplicada: false,
  distritos: [],
  lugares: [],
};

/** Dos letras es el mínimo del endpoint (`TERRITORIO_Q_MIN`). */
const MINIMO_CARACTERES = 2;
const ESPERA_TECLEO_MS = 250;

/**
 * Buscador único de territorio para el alta: devuelve distritos del INEI y
 * lugares operativos en la misma lista, y los distingue con una etiqueta.
 *
 * La distinción no es cosmética: Matarani no es un distrito. Un buscador que
 * sólo listara distritos obligaría a guardar «Islay» y el expediente diría una
 * ubicación que nadie eligió. Por eso el componente emite `tipo` y el alta
 * decide en qué columna guardarlo.
 *
 * El componente es autónomo en HTTP (`consulta`): el panel de alta sigue sin
 * conocer la API, como el resto de sus campos.
 */
@Component({
  selector: 'app-territorio-buscador',
  imports: [IconoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="territorio">
      @if (!compacto()) {
        <label class="form-label" [attr.for]="'territorio-' + identidad()">
          {{ etiqueta() }}
        </label>
      }

      <div class="territorio-campo">
        <span class="territorio-lupa" aria-hidden="true">
          <app-icono nombre="buscar" [tamano]="14" />
        </span>
        <input
          class="form-input territorio-entrada"
          type="text"
          role="combobox"
          autocomplete="off"
          aria-autocomplete="list"
          [attr.aria-controls]="'territorio-lista-' + identidad()"
          [id]="'territorio-' + identidad()"
          [attr.aria-label]="etiqueta()"
          [attr.aria-expanded]="listaVisible()"
          [attr.aria-activedescendant]="activaId()"
          [placeholder]="marcador()"
          [value]="textoVisible()"
          (input)="alTeclear($event)"
          (keydown)="alTecla($event)"
          (focus)="alEnfocar()"
        />
        @if (seleccion() || (inicial() && !inicialIgnorada())) {
          <button
            type="button"
            class="territorio-quitar"
            aria-label="Quitar la ubicación elegida"
            (click)="limpiar()"
          >
            <app-icono nombre="cerrar" [tamano]="14" />
          </button>
        }
      </div>

      @if (listaVisible()) {
        <div class="territorio-lista" [attr.id]="'territorio-lista-' + identidad()" role="listbox">
          @if (distritos().length > 0) {
            <p class="territorio-grupo" aria-hidden="true">Distritos</p>
            @for (opcion of distritos(); track opcion.id; let i = $index) {
              <button
                type="button"
                role="option"
                class="territorio-opcion"
                [id]="'territorio-opcion-' + i"
                [attr.aria-selected]="indice() === i"
                [class.territorio-opcion-activa]="indice() === i"
                (click)="elegir(opcion)"
              >
                <span class="territorio-opcion-nombre">{{ opcion.nombre }}</span>
                <span class="territorio-opcion-ruta">{{ opcion.ruta }}</span>
              </button>
            }
          }

          @if (lugares().length > 0) {
            <p class="territorio-grupo" aria-hidden="true">Lugares operativos</p>
            @for (opcion of lugares(); track opcion.id; let i = $index) {
              <button
                type="button"
                role="option"
                class="territorio-opcion"
                [id]="'territorio-opcion-' + (distritos().length + i)"
                [attr.aria-selected]="indice() === distritos().length + i"
                [class.territorio-opcion-activa]="indice() === distritos().length + i"
                (click)="elegir(opcion)"
              >
                <span class="territorio-opcion-nombre">
                  {{ opcion.nombre }}
                  <span class="territorio-sello">{{ opcion.etiquetaTipo }}</span>
                </span>
                <span class="territorio-opcion-ruta">{{ opcion.ruta }}</span>
              </button>
            }
          }
        </div>
      }

      @if (sinResultados()) {
        <p class="form-hint" role="status">
          @if (soloDistritos()) {
            No hay distritos que coincidan con «{{ consultaTexto() }}».
          } @else {
            No hay distritos ni lugares que coincidan con «{{ consultaTexto() }}».
          }
        </p>
      } @else if (!compacto()) {
        @if (cargando()) {
          <p class="form-hint" role="status">Buscando en el catálogo territorial…</p>
        } @else if (seleccion(); as elegido) {
          <p class="form-hint">
            {{ elegido.tipo === 'distrito' ? 'Distrito del catálogo INEI' : 'Lugar operativo' }}
            en {{ elegido.region }}.
          </p>
        } @else {
          <p class="form-hint">
            Escriba al menos {{ MINIMO_CARACTERES }} letras. Los distritos salen del catálogo INEI.
            @if (!soloDistritos()) {
              Matarani aparece como puerto de Islay, no como distrito.
            }
          </p>
        }
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .territorio {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 5px;
      min-width: 0;
    }

    .territorio-campo {
      position: relative;
      display: flex;
      align-items: center;
    }

    .territorio-lupa {
      position: absolute;
      left: 9px;
      display: flex;
      color: var(--muted);
      pointer-events: none;
    }

    .territorio-entrada {
      width: 100%;
      padding-left: 30px;
      padding-right: 32px;
    }

    .territorio-quitar {
      position: absolute;
      right: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--muted);
    }

    .territorio-quitar:hover {
      background: var(--canvas);
      color: var(--ink);
    }

    .territorio-lista {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      z-index: 40;
      max-height: 280px;
      overflow-y: auto;
      padding: 4px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--paper);
      box-shadow: 0 12px 28px rgba(23, 40, 58, 0.16);
      text-align: left;
    }

    .territorio-grupo {
      margin: 6px 8px 3px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.7px;
      text-transform: uppercase;
    }

    .territorio-opcion {
      display: flex;
      flex-direction: column;
      gap: 1px;
      width: 100%;
      padding: 6px 8px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--ink);
      text-align: left;
    }

    .territorio-opcion-activa,
    .territorio-opcion:hover {
      background: var(--blue-pale);
    }

    .territorio-opcion-nombre {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 600;
      line-height: 1.3;
    }

    .territorio-opcion-ruta {
      color: var(--muted);
      font-size: 12.5px;
      line-height: 1.35;
    }

    .territorio-sello {
      padding: 1px 5px;
      border-radius: 999px;
      background: var(--canvas);
      color: var(--ink-2);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.3px;
      text-transform: uppercase;
    }
  `,
})
export class TerritorioBuscadorComponent {
  readonly etiqueta = input('Ubicación');
  readonly marcador = input('Distrito o lugar: Islay, Matarani…');
  /**
   * `true` oculta los lugares operativos y sólo ofrece distritos. Se usa donde
   * el destino guarda una clave ajena a `core.distritos` (alertas) y no puede
   * distinguir un puerto de un distrito.
   */
  readonly soloDistritos = input(false);
  /**
   * Modo de barra de filtros: oculta la etiqueta y las ayudas y deja sólo el
   * campo con su lista. El nombre accesible sigue saliendo de `etiqueta`.
   */
  readonly compacto = input(false);
  /**
   * Etiqueta de una selección que ya existe fuera del componente (por ejemplo,
   * un filtro restaurado desde la URL). Sólo se pinta: el id viaja aparte y el
   * componente no emite nada hasta que el usuario elige o limpia.
   */
  readonly inicial = input<{ id: number; nombre: string; ruta?: string } | null>(null);

  readonly elegido = output<OpcionTerritorio | null>();

  readonly MINIMO_CARACTERES = MINIMO_CARACTERES;

  readonly texto = signal('');
  readonly consultaTexto = signal('');
  readonly indice = signal(0);
  readonly abierto = signal(false);
  readonly seleccion = signal<OpcionTerritorio | null>(null);

  /** Lo escrito manda; si no hay nada, se muestra la etiqueta inicial. */
  readonly textoVisible = computed(
    () =>
      this.texto() ||
      (this.inicialIgnorada() ? '' : this.inicial()?.ruta || this.inicial()?.nombre || ''),
  );

  private readonly elemento = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destruccion = inject(DestroyRef);
  /** Una vez el usuario edita o limpia, la etiqueta inicial deja de mostrarse. */
  readonly inicialIgnorada = signal(false);
  private temporizador: ReturnType<typeof setTimeout> | null = null;

  private readonly recurso = consulta<ResultadoTerritorio>({
    fuente: () => {
      const consulta = this.consultaTexto().trim();
      if (consulta.length < MINIMO_CARACTERES) return null;
      return urlApi(`/v1/territorio?q=${encodeURIComponent(consulta)}&limite=20`);
    },
    esquema: aTerritorio,
  });

  private readonly resultado = computed(() => this.recurso.valor() ?? RESULTADO_VACIO);

  readonly distritos = computed(() => this.resultado().distritos);
  readonly lugares = computed(() => (this.soloDistritos() ? [] : this.resultado().lugares));
  readonly cargando = computed(() => this.recurso.estado() === 'cargando');

  private readonly total = computed(() => this.distritos().length + this.lugares().length);

  readonly listaVisible = computed(() => this.abierto() && this.total() > 0);

  readonly sinResultados = computed(
    () =>
      this.abierto() &&
      !this.cargando() &&
      this.consultaTexto().trim().length >= MINIMO_CARACTERES &&
      this.resultado().aplicada &&
      this.total() === 0,
  );

  readonly activaId = computed(() =>
    this.listaVisible() ? `territorio-opcion-${this.indice()}` : null,
  );

  /** Id estable por instancia: el panel puede abrirse más de una vez. */
  readonly identidad = signal(`buscador-${Math.random().toString(36).slice(2, 8)}`);

  /** Último id aplicado desde `inicial`, para no repintar en cada lectura. */
  private ultimoInicial: number | null = null;

  constructor() {
    this.destruccion.onDestroy(() => {
      if (this.temporizador) clearTimeout(this.temporizador);
    });

    // El padre puede fijar la ubicación por código (p. ej. «usar el distrito del
    // caso»). Cuando el id de `inicial` cambia, la caja vuelve a mostrar esa
    // ruta aunque el usuario hubiera editado antes. Un `null` no se aplica:
    // el padre limpió el valor y la caja puede tener texto en curso.
    effect(() => {
      const id = this.inicial()?.id ?? null;
      if (id === this.ultimoInicial) return;
      this.ultimoInicial = id;
      if (id === null) return;
      this.texto.set('');
      this.seleccion.set(null);
      this.inicialIgnorada.set(false);
    });
  }

  alTeclear(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    // Antes de marcar la etiqueta inicial como ignorada: si la caja mostraba
    // una selección (elegida o heredada del padre), el texto ya no la
    // representa y el panel no debe conservar su id.
    const mostrabaSeleccion =
      this.seleccion() !== null || (this.inicial() !== null && !this.inicialIgnorada());

    this.texto.set(valor);
    this.inicialIgnorada.set(true);
    this.abierto.set(true);
    this.indice.set(0);

    if (mostrabaSeleccion) {
      this.seleccion.set(null);
      this.elegido.emit(null);
    }

    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      this.consultaTexto.set(valor);
      this.temporizador = null;
    }, ESPERA_TECLEO_MS);
  }

  alEnfocar(): void {
    if (this.texto().trim().length >= MINIMO_CARACTERES) this.abierto.set(true);
  }

  alTecla(evento: KeyboardEvent): void {
    if (evento.key === 'Escape') {
      this.abierto.set(false);
      return;
    }

    if (!this.listaVisible()) return;

    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      this.indice.update((i) => (i + 1) % this.total());
      return;
    }

    if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      this.indice.update((i) => (i - 1 + this.total()) % this.total());
      return;
    }

    if (evento.key === 'Enter') {
      evento.preventDefault();
      const opcion = this.opciones()[this.indice()];
      if (opcion) this.elegir(opcion);
    }
  }

  elegir(opcion: OpcionTerritorio): void {
    this.seleccion.set(opcion);
    this.texto.set(opcion.ruta);
    this.consultaTexto.set('');
    this.abierto.set(false);
    this.indice.set(0);
    this.elegido.emit(opcion);
    this.elemento.nativeElement.querySelector<HTMLElement>('input')?.blur();
  }

  limpiar(): void {
    this.seleccion.set(null);
    this.texto.set('');
    this.inicialIgnorada.set(true);
    this.consultaTexto.set('');
    this.abierto.set(false);
    this.indice.set(0);
    this.elegido.emit(null);
  }

  /** Lista plana en el mismo orden que la plantilla, para el teclado. */
  private opciones(): OpcionTerritorio[] {
    return [...this.distritos(), ...this.lugares()];
  }
}
