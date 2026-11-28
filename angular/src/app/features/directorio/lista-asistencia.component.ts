import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { firstValueFrom, Subject, takeUntil } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { normalizarColeccion, paramsDePagina, urlConParametros } from '../../core/http/coleccion';
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { IconoComponent } from '../../shared/ui/icono.component';
import {
  aActorDirectorio,
  aPiiLote,
  desglosarSinPii,
  type ActorDirectorio,
} from './directorio.mapeo';
import { ListaAsistenciaService, type EntradaLista } from './lista-asistencia.service';
import {
  crearXlsxPadron,
  etiquetaGrupoOrganizacion,
  filasPadronDePersonas,
  normalizarSesion,
  personasDeLista,
} from './padron-asistencia';
import { etiquetaItemLista } from './lista-temporal';
import { fechaLocalIso } from './padron-fecha';

/** Motivo auditado del descifrado en lote (Ley 29733). */
const MOTIVO_PII = 'Lista de asistencia';

/** Tope del endpoint de PII: los lotes mayores se parten. */
const LOTE_PII = 500;

/** Página amplia al recorrer integrantes de una organización. */
const TAMANO_INTEGRANTES = 100;

/** Guarda contra un bucle si la API no informa el total. */
const MAX_PAGINAS_INTEGRANTES = 200;

type PiiPadron = { dni: string | null; telefono: string | null };

/**
 * Lista de asistencia: selección de sesión compartida por actores y
 * organizaciones, con la cabecera de la sesión y la descarga del Excel.
 *
 * El estado vive en `ListaAsistenciaService` para sobrevivir a la navegación.
 * Este componente sólo monta el botón flotante, el cajón lateral y el flujo de
 * descarga: cada organización se expande a sus integrantes con
 * `GET /v1/actors?organizacion=<id>` y la PII se pide en lote con el motivo
 * «Lista de asistencia».
 */
@Component({
  selector: 'app-lista-asistencia',
  imports: [IconoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="lista-asistencia-fab"
      [class.lista-asistencia-fab-vacia]="total() === 0"
      [attr.aria-expanded]="abierto()"
      aria-controls="lista-asistencia-cajon"
      [attr.aria-label]="'Abrir la lista de asistencia (' + total() + ')'"
      (click)="abrir()"
    >
      <app-icono nombre="reloj-mas" [tamano]="18" />
      <span class="lista-asistencia-fab-texto">Lista de asistencia</span>
      <span class="lista-asistencia-contador">{{ total() }}</span>
    </button>

    @if (abierto()) {
      <div
        class="drawer-scrim"
        role="presentation"
        (click)="alFondo($event)"
        (document:keydown.escape)="cerrar()"
      >
        <aside
          class="drawer lista-asistencia-drawer"
          id="lista-asistencia-cajon"
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-lista-asistencia"
        >
          <header class="drawer-head">
            <div>
              <h2 id="titulo-lista-asistencia">Generar lista de asistencia</h2>
              <p>Selección de la sesión; se conserva al cambiar entre actores y organizaciones.</p>
            </div>
            <button
              type="button"
              class="icon-button"
              aria-label="Cerrar la lista de asistencia"
              (click)="cerrar()"
            >
              <app-icono nombre="cerrar" [tamano]="18" />
            </button>
          </header>

          <div class="drawer-body lista-asistencia-cuerpo">
            <div class="lista-asistencia-campos">
              <label class="lista-asistencia-campo">
                Título de la sesión
                <input
                  maxlength="180"
                  [value]="sesion().titulo"
                  (input)="cambiar('titulo', $event)"
                />
              </label>
              <label class="lista-asistencia-campo">
                Lugar / sede
                <input
                  maxlength="180"
                  [value]="sesion().lugar"
                  (input)="cambiar('lugar', $event)"
                />
              </label>
              <label class="lista-asistencia-campo">
                Fecha
                <input type="date" [value]="sesion().fecha" (input)="cambiar('fecha', $event)" />
              </label>
            </div>

            @if (!capacidades.puedeVerPii()) {
              <p class="lista-asistencia-aviso" role="status">
                Tu perfil no puede leer DNI ni celulares: esas dos columnas saldrán en blanco. Pide
                la lista a un sectorista o a la Dirección para completarlas.
              </p>
            }

            @if (entradas().length === 0) {
              <p class="lista-asistencia-vacia">
                Aún no agregaste entradas. Marca el checkbox de una fila en el directorio de
                personas o de organizaciones para sumarla a la lista de asistencia.
              </p>
            } @else {
              <div class="lista-asistencia-acciones">
                <span class="lista-asistencia-conteo" aria-live="polite">
                  {{ incluidosCount() }} seleccionados
                </span>
                <div class="lista-asistencia-botones">
                  <button
                    type="button"
                    class="button-secondary"
                    [disabled]="generando()"
                    (click)="eliminarSeleccionados()"
                  >
                    Eliminar seleccionados
                  </button>
                  <button
                    type="button"
                    class="button-primary"
                    [disabled]="generando() || incluidosCount() === 0"
                    (click)="descargar()"
                  >
                    {{ generando() ? 'Generando…' : 'Descargar Excel' }}
                  </button>
                </div>
              </div>

              <ul class="lista-asistencia-items">
                @for (entrada of entradas(); track $index) {
                  <li>
                    <label class="lista-asistencia-fila">
                      <input
                        type="checkbox"
                        [checked]="estaIncluido(entrada.actor.id)"
                        (change)="alternarInclusion(entrada.actor.id)"
                      />
                      <span class="lista-asistencia-datos">
                        <strong>{{ entrada.actor.nombre }}</strong>
                        <span>{{ etiquetaEntrada(entrada) }}</span>
                      </span>
                    </label>
                    <button
                      type="button"
                      class="lista-asistencia-quitar"
                      [attr.aria-label]="
                        'Quitar ' + entrada.actor.nombre + ' de la lista de asistencia'
                      "
                      (click)="lista.quitarPorIndice($index)"
                    >
                      Quitar
                    </button>
                  </li>
                }
              </ul>
            }

            @if (error(); as mensaje) {
              <p class="lista-asistencia-error" role="alert">{{ mensaje }}</p>
            }
            @if (notaSinPii(); as mensaje) {
              <p class="lista-asistencia-nota" role="status">{{ mensaje }}</p>
            }
            @if (notaIlegibles(); as mensaje) {
              <p class="lista-asistencia-nota" role="status">{{ mensaje }}</p>
            }
          </div>
        </aside>
      </div>
    }
  `,
  styles: `
    :host {
      display: contents;
    }

    /*
      Botón flotante de la lista de asistencia. z-index 60: por encima de la
      cabecera (30) y del menú lateral (41), pero por debajo del velo modal
      (80). El desplazamiento inferior respeta el área segura de los móviles.
    */
    .lista-asistencia-fab {
      position: fixed;
      right: 28px;
      bottom: calc(28px + env(safe-area-inset-bottom, 0px));
      z-index: 60;
      display: inline-flex;
      align-items: center;
      gap: 9px;
      padding: 12px 16px;
      border: 1px solid #cfd9e2;
      border-radius: 999px;
      background: #1f5597;
      color: #fff;
      font: 600 13px/1 var(--font-body, inherit);
      box-shadow: 0 10px 26px rgb(17 32 45 / 22%);
      cursor: pointer;
    }

    .lista-asistencia-fab:hover {
      background: #1a4a85;
    }

    .lista-asistencia-fab:focus-visible {
      outline: 2px solid #3576c5;
      outline-offset: 2px;
    }

    /* Sin entradas la lista sigue accesible, pero no llama la atención. */
    .lista-asistencia-fab-vacia {
      border-color: #cfd9e2;
      background: #fff;
      color: #465a6c;
      box-shadow: 0 8px 20px rgb(17 32 45 / 12%);
    }

    .lista-asistencia-fab-vacia:hover {
      background: #f5f7f8;
    }

    .lista-asistencia-contador {
      min-width: 22px;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgb(255 255 255 / 22%);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      text-align: center;
    }

    .lista-asistencia-fab-vacia .lista-asistencia-contador {
      background: #eef2f6;
      color: #526577;
    }

    /* El cajón de la lista no necesita los 600 px de una ficha. */
    .lista-asistencia-drawer {
      width: min(460px, 100%);
    }

    .lista-asistencia-cuerpo {
      gap: 14px;
    }

    .lista-asistencia-campos {
      display: grid;
      gap: 11px;
    }

    .lista-asistencia-campo {
      display: grid;
      gap: 5px;
      color: #465a6c;
      font-size: 13px;
      font-weight: 600;
    }

    .lista-asistencia-campo input {
      min-width: 0;
      min-height: 38px;
      padding: 0 10px;
      border: 1px solid #cfd9e2;
      border-radius: 6px;
      background: #fff;
      color: #26384a;
      font: inherit;
    }

    .lista-asistencia-campo input:focus-visible {
      outline: 2px solid #3576c5;
      outline-offset: 2px;
    }

    .lista-asistencia-vacia {
      margin: 0;
      color: #7b8896;
      font-size: 13px;
      line-height: 1.5;
    }

    /* Cabecera de acciones de la selección que entra al Excel. */
    .lista-asistencia-acciones {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px 12px;
      padding: 10px 12px;
      border: 1px solid #e1e8ef;
      border-radius: 8px;
      background: #f7f9fc;
    }

    .lista-asistencia-conteo {
      color: #35495c;
      font-size: 12.5px;
      font-weight: 700;
    }

    .lista-asistencia-botones {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .lista-asistencia-items {
      display: grid;
      gap: 0;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .lista-asistencia-items li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
      padding: 9px 0;
      border-top: 1px solid #edf0f2;
    }

    .lista-asistencia-fila {
      display: flex;
      align-items: center;
      gap: 9px;
      min-width: 0;
      cursor: pointer;
    }

    .lista-asistencia-fila input {
      flex: none;
      width: 16px;
      height: 16px;
      margin: 0;
      accent-color: #3576c5;
    }

    .lista-asistencia-datos {
      display: grid;
      gap: 3px;
      min-width: 0;
    }

    .lista-asistencia-datos strong {
      color: #465a6c;
      font-size: 13px;
    }

    .lista-asistencia-datos span {
      color: #8a98a5;
      font-size: 12.5px;
    }

    .lista-asistencia-quitar {
      flex: none;
      padding: 5px 8px;
      border: 1px solid #dce3e8;
      border-radius: 5px;
      background: #fff;
      color: #526577;
      font-size: 12.5px;
      cursor: pointer;
    }

    /* Aviso de permisos: informativo, no un error de la descarga. */
    .lista-asistencia-aviso {
      margin: 0;
      padding: 8px 10px;
      border: 1px solid #e6d5a8;
      border-radius: 6px;
      background: #fdf8e8;
      color: #7a5c08;
      font-size: 13px;
      line-height: 1.45;
    }

    /* Nota discreta tras generar: no es un fallo, la lista se descargó. */
    .lista-asistencia-nota {
      margin: 0;
      color: #7b8896;
      font-size: 12.5px;
      line-height: 1.45;
    }

    .lista-asistencia-error {
      margin: 0;
      padding: 8px 10px;
      border: 1px solid #f0b8b3;
      border-radius: 6px;
      background: #fef3f2;
      color: #b42318;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.45;
    }

    @media (max-width: 720px) {
      .lista-asistencia-fab {
        right: 16px;
        bottom: calc(16px + env(safe-area-inset-bottom, 0px));
      }

      /* En pantallas angostas el botón se queda con el icono y el contador. */
      .lista-asistencia-fab-texto {
        display: none;
      }
    }
  `,
})
export class ListaAsistenciaComponent {
  readonly lista = inject(ListaAsistenciaService);
  readonly capacidades = inject(CapacidadesService);
  private readonly http = inject(HttpClient);
  private readonly destruccion = inject(DestroyRef);

  readonly entradas = this.lista.entradas;
  readonly sesion = this.lista.sesion;
  readonly total = this.lista.total;
  readonly incluidosCount = this.lista.cantidadIncluidos;

  readonly abierto = signal(false);
  readonly generando = signal(false);
  readonly error = signal<string | null>(null);
  /** Actores que nunca registraron DNI/celular; no incluye los ilegibles. */
  readonly notaSinPii = signal<string | null>(null);
  /** Actores cuyo DNI/celular existe pero no se pudo descifrar. */
  readonly notaIlegibles = signal<string | null>(null);

  /**
   * Generación en curso. Se numera cada intento: al cerrar el cajón se
   * incrementa el contador y lo que llegue con un token viejo se descarta.
   */
  private token = 0;
  /** Corta las peticiones de integrantes y PII en vuelo al cerrar el cajón. */
  private readonly cancelado = new Subject<void>();

  constructor() {
    this.destruccion.onDestroy(() => this.cancelado.complete());
  }

  abrir(): void {
    this.error.set(null);
    this.abierto.set(true);
  }

  /** Cierra el cajón y, si había una descarga en curso, la cancela. */
  cerrar(): void {
    if (this.generando()) {
      this.token += 1;
      this.cancelado.next();
      this.generando.set(false);
    }
    this.abierto.set(false);
  }

  /** El clic dentro del cajón también burbujea: sólo cierra si nació en el velo. */
  alFondo(evento: Event): void {
    if (evento.target !== evento.currentTarget) return;
    this.cerrar();
  }

  cambiar(campo: 'titulo' | 'lugar' | 'fecha', evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.lista.cambiarSesion({ [campo]: valor });
  }

  estaIncluido(id: string): boolean {
    return this.lista.estaIncluido(id);
  }

  alternarInclusion(id: string): void {
    this.lista.alternarInclusion(id);
    this.error.set(null);
  }

  eliminarSeleccionados(): void {
    this.lista.eliminarSeleccionados();
    this.error.set(null);
  }

  /** «Cargo · OSPA» para personas; grupo con integrantes para organizaciones. */
  etiquetaEntrada(entrada: EntradaLista): string {
    return entrada.tipo === 'organizacion'
      ? etiquetaGrupoOrganizacion(entrada.actor)
      : etiquetaItemLista(entrada.actor);
  }

  async descargar(): Promise<void> {
    const sesion = normalizarSesion(this.sesion());
    if (!sesion) {
      this.error.set('Completa el título, el lugar y la fecha de la sesión.');
      return;
    }

    const incluidas = this.entradasIncluidas();
    if (incluidas.length === 0) {
      this.error.set('Selecciona al menos una entrada para generar la lista.');
      return;
    }
    if (this.generando()) return;

    this.token += 1;
    const token = this.token;
    this.generando.set(true);
    this.error.set(null);
    this.notaSinPii.set(null);
    this.notaIlegibles.set(null);

    try {
      const miembros = await this.expandirOrganizaciones(incluidas, token);
      if (token !== this.token) return;

      const personas = personasDeLista(incluidas, miembros);
      if (personas.length === 0) {
        this.error.set('Las entradas seleccionadas no tienen integrantes para la lista.');
        return;
      }

      const { datos: pii, noDescifrados } = await this.piiDePersonas(personas, token);
      if (token !== this.token) return;

      const { filas, sinPii } = filasPadronDePersonas(personas, pii);
      const archivo = await crearXlsxPadron({ ...sesion, filas });
      // El armado del libro no se puede abortar: si se cerró mientras tanto, el
      // archivo se descarta en vez de aparecer tras cerrar el cajón.
      if (token !== this.token) return;

      this.descargarArchivo(archivo, `lista-asistencia-${fechaLocalIso()}.xlsx`);
      if (this.capacidades.puedeVerPii()) {
        const { sinDato, ilegibles } = desglosarSinPii(sinPii, noDescifrados);
        this.notaSinPii.set(
          sinDato > 0
            ? `${sinDato} ${sinDato === 1 ? 'actor sin DNI/celular' : 'actores sin DNI/celular'}`
            : null,
        );
        // Nota agregada: el motivo por id de `errores` no se muestra crudo.
        this.notaIlegibles.set(
          ilegibles > 0
            ? `${ilegibles} ${
                ilegibles === 1 ? 'actor con datos ilegibles' : 'actores con datos ilegibles'
              }`
            : null,
        );
      }
    } catch (fallo) {
      if (token !== this.token) return;
      this.error.set(aErrorApi(fallo).message);
    } finally {
      if (token === this.token) this.generando.set(false);
    }
  }

  private entradasIncluidas(): EntradaLista[] {
    const incluidos = this.lista.incluidos();
    return this.entradas().filter((entrada) => incluidos.has(entrada.actor.id));
  }

  /** Integrantes de cada organización incluida, en una petición por página. */
  private async expandirOrganizaciones(
    entradas: readonly EntradaLista[],
    token: number,
  ): Promise<Map<string, ActorDirectorio[]>> {
    const miembros = new Map<string, ActorDirectorio[]>();
    for (const entrada of entradas) {
      if (entrada.tipo !== 'organizacion') continue;
      const lista = await this.integrantesDe(entrada.actor.id, token);
      if (token !== this.token) return miembros;
      miembros.set(entrada.actor.id, lista);
    }
    return miembros;
  }

  private async integrantesDe(organizacionId: string, token: number): Promise<ActorDirectorio[]> {
    const integrantes: ActorDirectorio[] = [];
    let pagina = 1;

    for (;;) {
      const bruto = await firstValueFrom(
        this.http
          .get<unknown>(
            urlConParametros(urlApi('/v1/actors'), {
              organizacion: organizacionId,
              ...paramsDePagina({ pagina, tamano: TAMANO_INTEGRANTES }),
            }),
          )
          .pipe(takeUntil(this.cancelado)),
      );
      if (token !== this.token) return integrantes;

      const coleccion = normalizarColeccion<unknown>(bruto);
      integrantes.push(...coleccion.elementos.map(aActorDirectorio).filter((actor) => !!actor.id));

      const total = coleccion.total ?? integrantes.length;
      if (
        coleccion.elementos.length === 0 ||
        integrantes.length >= total ||
        pagina >= MAX_PAGINAS_INTEGRANTES
      ) {
        break;
      }
      pagina += 1;
    }

    return integrantes;
  }

  /**
   * DNI y celular de todas las personas en lotes de 500. Un id sin dato no es
   * un error: la fila se imprime en blanco y la nota final lo resume.
   *
   * Devuelve además el total de filas ilegibles. Los ids se deduplican antes de
   * partir los lotes y cada uno viaja en uno solo, así que sumar el conteo por
   * lote no repite actores aportados por varias organizaciones.
   */
  private async piiDePersonas(
    personas: readonly ActorDirectorio[],
    token: number,
  ): Promise<{ datos: Map<string, PiiPadron>; noDescifrados: number }> {
    const datos = new Map<string, PiiPadron>();
    let noDescifrados = 0;
    if (!this.capacidades.puedeVerPii()) return { datos, noDescifrados };

    const ids = [...new Set(personas.map((persona) => persona.id).filter((id) => !!id))];
    for (let inicio = 0; inicio < ids.length; inicio += LOTE_PII) {
      const loteIds = ids.slice(inicio, inicio + LOTE_PII);
      const bruto = await firstValueFrom(
        this.http
          .post<unknown>(urlApi('/v1/actors/pii'), { ids: loteIds, motivo: MOTIVO_PII })
          .pipe(takeUntil(this.cancelado)),
      );
      if (token !== this.token) return { datos, noDescifrados };

      const lote = aPiiLote(bruto);
      for (const [id, valor] of lote.datos) datos.set(id, valor);
      noDescifrados += lote.noDescifrados;
    }

    return { datos, noDescifrados };
  }

  private descargarArchivo(archivo: Blob, nombre: string): void {
    const url = URL.createObjectURL(archivo);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre;
    enlace.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
