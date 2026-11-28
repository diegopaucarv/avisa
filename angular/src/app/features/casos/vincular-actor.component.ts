import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { urlApi } from '../../core/config/entorno';
import { aErrorApi } from '../../core/http/errores';
import { IconoComponent } from '../../shared/ui/icono.component';
import { POSICIONAMIENTOS_ACTOR } from '../directorio/directorio.mapeo';
import { CuerpoVincularActor, type CasoActorVinculoFlags } from './nudos-matriz.mapeo';

/** Actor del Directorio tal como lo devuelve `GET /api/v1/actors`. */
export type ActorOpcion = {
  id: string;
  nombre: string;
  tipo: string | null;
  institucion: string | null;
  /** `cargo_actual` del actor; puede faltar. */
  cargo: string | null;
  /**
   * Teléfono del actor. La lista lo trae cuando está disponible; se usa para
   * componer la línea de «Actores clave» y nunca se envía por WhatsApp.
   */
  telefono: string | null;
};

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  return limpio === '' ? null : limpio;
}

function aOpcion(valor: unknown): ActorOpcion | null {
  const fila = esRegistro(valor) ? valor : {};
  const id = texto(fila['id']);
  const nombre = texto(fila['nombre']);
  if (!id || !nombre) return null;
  return {
    id,
    nombre,
    tipo: texto(fila['tipo']),
    institucion: texto(fila['organizacionAncla']) ?? texto(fila['distrito']),
    cargo: texto(fila['cargo']),
    telefono: texto(fila['telefono']),
  };
}

/** Normaliza la respuesta de `GET /api/v1/actors` a opciones del buscador. */
export function aOpciones(bruto: unknown): readonly ActorOpcion[] {
  const registro = esRegistro(bruto) ? bruto : {};
  const items = Array.isArray(registro['items']) ? registro['items'] : [];
  const opciones: ActorOpcion[] = [];
  for (const item of items) {
    const opcion = aOpcion(item);
    if (opcion) opciones.push(opcion);
  }
  return opciones;
}

/**
 * Panel de alta de actor en el caso.
 *
 * No conoce HTTP de escritura: emite `guardar` con el cuerpo ya validado y el
 * contenedor decide. La búsqueda sí es local porque sólo lee el Directorio.
 */
@Component({
  selector: 'app-vincular-actor',
  imports: [IconoComponent],
  templateUrl: './vincular-actor.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .actor-resultados {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 240px;
      overflow-y: auto;
      margin: 8px 0 0;
      padding: 0;
      list-style: none;
    }

    .actor-opcion {
      display: flex;
      flex-direction: column;
      gap: 2px;
      width: 100%;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--canvas);
      text-align: left;
      cursor: pointer;
      font: inherit;
    }

    .actor-opcion:hover,
    .actor-opcion[aria-pressed='true'] {
      border-color: var(--blue);
    }

    .actor-opcion-nombre {
      font-weight: 600;
    }

    .actor-opcion-meta {
      font-size: 12.5px;
      color: var(--muted);
    }

    .actor-elegido {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--canvas);
    }
  `,
})
export class VincularActorComponent {
  private readonly http = inject(HttpClient);
  private readonly destruir = inject(DestroyRef);

  readonly codigoCaso = input.required<string>();
  readonly vinculo = input<CasoActorVinculoFlags | null>(null);
  readonly vinculados = input<readonly string[]>([]);
  readonly guardando = input(false);
  readonly errorEnvio = input<string | null>(null);

  readonly cerrar = output<void>();
  readonly guardar = output<CuerpoVincularActor>();

  readonly busqueda = signal('');
  readonly resultados = signal<readonly ActorOpcion[]>([]);
  readonly buscando = signal(false);
  readonly buscandoAlgo = signal(false);
  readonly seleccionado = signal<ActorOpcion | null>(null);
  readonly posicion = signal('');
  readonly vigenteDesde = signal('');
  readonly errorLocal = signal<string | null>(null);

  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private turno = 0;

  constructor() {
    this.destruir.onDestroy(() => {
      if (this.temporizador) clearTimeout(this.temporizador);
    });
  }

  // Guía §8.2.4: Dialogante, Legitimante o Conflictivo. Es el mismo vocabulario
  // que valida `vincularActorCaso` en la API (migración 77).
  readonly posiciones = POSICIONAMIENTOS_ACTOR;

  alBuscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.busqueda.set(valor);
    this.seleccionado.set(null);

    if (this.temporizador) clearTimeout(this.temporizador);
    const consulta = valor.trim();
    if (consulta.length < 2) {
      this.resultados.set([]);
      this.buscando.set(false);
      this.buscandoAlgo.set(false);
      return;
    }

    this.buscando.set(true);
    this.buscandoAlgo.set(true);
    this.temporizador = setTimeout(() => this.buscar(consulta), 300);
  }

  private buscar(consulta: string): void {
    const turnoActual = ++this.turno;
    const url = urlApi(`/v1/actors?q=${encodeURIComponent(consulta)}&pageSize=20`);

    this.http.get<unknown>(url).subscribe({
      next: (bruto) => {
        if (turnoActual !== this.turno) return;
        const yaVinculados = new Set(this.vinculados());
        this.resultados.set(aOpciones(bruto).filter((opcion) => !yaVinculados.has(opcion.id)));
        this.buscando.set(false);
      },
      error: () => {
        if (turnoActual !== this.turno) return;
        this.resultados.set([]);
        this.buscando.set(false);
        this.errorLocal.set('No se pudo consultar el Directorio de actores.');
      },
    });
  }

  elegir(actor: ActorOpcion): void {
    this.seleccionado.set(actor);
    this.errorLocal.set(null);
  }

  quitarSeleccion(): void {
    this.seleccionado.set(null);
  }

  alCambiarPosicion(evento: Event): void {
    this.posicion.set((evento.target as HTMLSelectElement).value);
  }

  alCambiarVigencia(evento: Event): void {
    this.vigenteDesde.set((evento.target as HTMLInputElement).value);
  }

  readonly requierePosicion = () => this.vinculo()?.posicionObligatoria ?? true;

  puedeGuardar(): boolean {
    if (this.guardando()) return false;
    if (!this.seleccionado()) return false;
    if (this.requierePosicion() && !this.posicion()) return false;
    return true;
  }

  enviar(evento: Event): void {
    evento.preventDefault();
    const actor = this.seleccionado();
    if (!actor) return;

    if (this.requierePosicion() && !this.posicion()) {
      this.errorLocal.set('Declara el posicionamiento del actor.');
      return;
    }

    const cuerpo: CuerpoVincularActor = { actorId: actor.id };
    if (this.posicion()) cuerpo.posicion = this.posicion();
    if (this.vigenteDesde().trim()) {
      cuerpo.vigenteDesde = this.vigenteDesde().trim();
    }

    this.errorLocal.set(null);
    this.guardar.emit(cuerpo);
  }

  mensajeError(): string | null {
    const externo = this.errorEnvio();
    if (externo) return externo;
    return this.errorLocal();
  }

  /** Un fallo de red al buscar no debe confundirse con un error de guardado. */
  limpiarErrorLocal(): void {
    this.errorLocal.set(null);
  }

  static mensajeDeFallo(fallo: unknown): string {
    return aErrorApi(fallo).message;
  }
}
