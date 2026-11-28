import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { MAX_ADJUNTO_BYTES, AdjuntosService, type Adjunto } from '../../core/http/adjuntos.service';
import { aErrorApi } from '../../core/http/errores';
import { IconoComponent } from '../../shared/ui/icono.component';
import { AdjuntosPanelComponent } from '../../shared/ui/adjuntos-panel.component';
import { salirModal } from '../../shared/ui/modal-salida';
import { formatearFecha } from '../documentos/documento.mapeo';
import {
  type ActorOpcion,
  type Extraccion,
  type ReunionResumen,
  type Vinculacion,
} from './resultados.mapeo';
import { ResultadosService, type AsistenteEnvio, type NaturalezaActor } from './resultados.service';

type Paso = 'captura' | 'revision';

type EstadoFila = 'pendiente' | 'vinculado' | 'creado' | 'omitido' | 'error';

type OrigenFila = 'manual' | 'extraido' | 'directorio' | 'alta';

type Fila = {
  id: number;
  nombre: string;
  cargo: string;
  actorId: string | null;
  actorEtiqueta: string | null;
  estado: EstadoFila;
  origen: OrigenFila;
  mensaje: string | null;
  omitido: boolean;
  consulta: string;
  buscando: boolean;
  buscado: boolean;
  resultados: ActorOpcion[];
  mostrandoBusqueda: boolean;
  mostrandoAlta: boolean;
  altaNaturaleza: NaturalezaActor;
  creando: boolean;
};

/**
 * Ventana flotante centrada con la lista de asistencia y las fichas.
 *
 * Copia la estructura de `actores_ventana_flotante_centrada_con_lista_de_asistencia_y_fichas.html`
 * (cabecera con contador, riel de actores con número, cargo y organización,
 * pie con «Vaciar lista» y el par de acciones) y de `reuniones-ayuda-memoria.html`
 * (riel «Asistentes» con casilla, cargo por registrar y la nota de que la
 * casilla es `asistio`).
 *
 * La foto se guarda como adjunto de la reunión (`entidadTipo="reunion"`, máximo
 * 20 MB). La extracción de nombres **no es OCR real**: si la instalación no
 * configura un motor, la lista arranca vacía y se escribe a mano. Cada fila se
 * resuelve contra el directorio (`GET /v1/actors?q=`) o se crea con el alta
 * mínima (`POST /v1/actors`). El vínculo se confirma en una sola transacción
 * (`POST /v1/resultados/asistentes`), que devuelve el estado por fila.
 */
@Component({
  selector: 'app-lista-asistencia',
  imports: [IconoComponent, AdjuntosPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'cerrarModal()',
  },
  template: `
    <div class="la-scrim" (click)="alFondo($event)">
      <section
        #dialogo
        class="la"
        role="dialog"
        aria-modal="true"
        aria-labelledby="la-titulo"
        tabindex="-1"
      >
        <header class="la-head">
          <div class="la-head-id">
            <app-icono nombre="cuadricula" [tamano]="16" />
            <app-icono nombre="check" [tamano]="18" />
            <h2 id="la-titulo">Lista de asistencia</h2>
            <span class="la-badge">{{ conteoFilas() }}</span>
          </div>
          <div class="la-head-acciones">
            <button
              type="button"
              class="la-ico"
              [attr.title]="plegado() ? 'Desplegar contenido' : 'Plegar contenido'"
              (click)="alternarPlegado()"
            >
              <app-icono [nombre]="plegado() ? 'chevron-derecha' : 'chevron-abajo'" [tamano]="16" />
            </button>
            <button type="button" class="la-ico" title="Cerrar ventana" (click)="cerrarModal()">
              <app-icono nombre="cerrar" [tamano]="16" />
            </button>
          </div>
        </header>

        <div class="la-subbar">
          <span class="la-sub-texto">
            <span class="la-punto"></span>
            Revisa la lista antes de vincular
          </span>
          <span class="la-sub-paso">
            {{ paso() === 'captura' ? 'Paso 1 · Foto' : 'Paso 2 · Revisión' }}
          </span>
        </div>

        @if (!plegado()) {
          <div class="la-body">
            <div class="la-bloque">
              <span class="form-label">Reunión de diálogo</span>
              @if (reunion(); as r) {
                <div class="la-reunion-elegida">
                  <div>
                    <strong>{{ r.titulo || 'Reunión sin título' }}</strong>
                    <small>
                      {{ formatearFecha(r.fecha) }}
                      @if (r.codigo) {
                        · {{ r.codigo }}
                      }
                      @if (r.casoCodigo) {
                        · Caso {{ r.casoCodigo }}
                      }
                      @if (r.lugar) {
                        · {{ r.lugar }}
                      }
                    </small>
                  </div>
                  @if (paso() === 'captura') {
                    <button type="button" class="la-link" (click)="cambiarReunion()">
                      Cambiar
                    </button>
                  }
                </div>
              } @else {
                <input
                  class="form-input"
                  type="search"
                  placeholder="Buscar reunión por código, título, lugar o caso"
                  aria-label="Buscar reunión"
                  (input)="alBuscarReunion($event)"
                />
                @if (cargandoReuniones()) {
                  <p class="form-hint">Buscando reuniones…</p>
                } @else if (reuniones().length === 0) {
                  <p class="form-hint">Sin reuniones que coincidan.</p>
                } @else {
                  <ul class="la-opciones">
                    @for (opcion of reuniones(); track opcion.id) {
                      <li>
                        <button type="button" class="la-opcion" (click)="elegirReunion(opcion)">
                          <span class="la-opcion-titulo">
                            {{ opcion.titulo || 'Reunión sin título' }}
                          </span>
                          <span class="la-opcion-meta">
                            {{ formatearFecha(opcion.fecha) }}
                            @if (opcion.codigo) {
                              · {{ opcion.codigo }}
                            }
                            @if (opcion.casoCodigo) {
                              · Caso {{ opcion.casoCodigo }}
                            }
                            · {{ opcion.asistentes }} asistentes
                          </span>
                        </button>
                      </li>
                    }
                  </ul>
                }
              }
              @if (errorReunion(); as mensaje) {
                <p class="form-error">{{ mensaje }}</p>
              }
            </div>

            @if (paso() === 'captura') {
              <div class="la-bloque">
                <span class="form-label">Foto de la lista</span>
                <input
                  #inputFoto
                  class="la-input-oculto"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  (change)="alElegirFoto($event)"
                />
                @if (previewUrl(); as url) {
                  <figure class="la-preview">
                    <img [src]="url" alt="Vista previa de la foto de la lista de asistencia" />
                  </figure>
                  <p class="la-preview-meta">{{ nombreFoto() }} · {{ tamanoFoto() }}</p>
                  <div class="la-acciones-foto">
                    <button type="button" class="button-secondary" (click)="reintentarFoto()">
                      Repetir foto
                    </button>
                    <button
                      type="button"
                      class="button-primary"
                      [disabled]="!reunion() || subiendo() || extrayendo()"
                      (click)="usarFoto()"
                    >
                      {{
                        subiendo() ? 'Guardando…' : extrayendo() ? 'Procesando…' : 'Usar esta foto'
                      }}
                    </button>
                  </div>
                } @else {
                  <button type="button" class="la-camara" (click)="abrirCamara()">
                    <app-icono nombre="documentos" [tamano]="26" />
                    <strong>Tomar foto de la lista de asistencia</strong>
                    <small>En computadora, este botón abre el selector de archivos.</small>
                    <small>Máximo 20 MB · JPG, PNG o WEBP</small>
                  </button>
                }
                @if (errorFoto(); as mensaje) {
                  <p class="form-error" role="alert">{{ mensaje }}</p>
                }
                <button type="button" class="la-link" (click)="continuarSinFoto()">
                  Continuar sin foto (escribir la lista a mano)
                </button>
              </div>
            } @else {
              @if (extraccion(); as ex) {
                @if (ex.disponible) {
                  <div class="la-nota la-nota--info">
                    <app-icono nombre="info" [tamano]="18" />
                    <span>
                      Se propusieron {{ ex.asistentes.length }} nombres con el motor de extracción.
                      <strong>Revísalos y corrígelos</strong> antes de vincular.
                      {{ ex.nota }}
                    </span>
                  </div>
                } @else {
                  <div class="la-nota la-nota--amber">
                    <app-icono nombre="alerta" [tamano]="18" />
                    <span>
                      <strong>Sin motor de OCR:</strong> no se reconoce el texto de la foto. La
                      lista arranca vacía; escríbela y revísala a mano. {{ ex.nota }}
                    </span>
                  </div>
                }
              }

              @if (adjunto(); as a) {
                <p class="la-adjunto">
                  <app-icono nombre="check" [tamano]="15" />
                  Foto guardada como adjunto: <strong>{{ a.nombre }}</strong> ({{
                    formatearTamano(a.tamanoBytes)
                  }})
                </p>
              } @else {
                <p class="la-adjunto la-adjunto--vacio">
                  Sin foto adjunta: la lista se registra a mano.
                </p>
              }

              @if (reunion(); as r) {
                <app-adjuntos-panel
                  entidadTipo="reunion"
                  [entidadId]="r.id"
                  titulo="Adjuntos de la reunión"
                />
              }

              <div class="la-lista">
                <div class="la-lista-head">
                  <span>N.º</span>
                  <span>Asistente y cargo</span>
                  <span>Estado</span>
                  <span class="la-lista-head-acc">Acciones</span>
                </div>

                @if (filas().length === 0) {
                  <div class="empty-state">
                    Sin asistentes en la lista. Agrega uno o busca en el directorio.
                  </div>
                }

                @for (fila of filas(); track fila.id; let i = $index) {
                  <div class="la-fila" [class.la-fila--om]="fila.omitido">
                    <span class="la-num">{{ i + 1 }}.</span>
                    <div class="la-campos">
                      <input
                        class="form-input"
                        type="text"
                        [value]="fila.nombre"
                        placeholder="Apellidos y nombres"
                        aria-label="Nombre del asistente"
                        (input)="actualizarNombre(fila.id, $event)"
                      />
                      <input
                        class="form-input"
                        type="text"
                        [value]="fila.cargo"
                        placeholder="Cargo (opcional)"
                        aria-label="Cargo del asistente"
                        (input)="actualizarCargo(fila.id, $event)"
                      />
                      @if (fila.actorEtiqueta) {
                        <span class="la-vinculo">
                          <app-icono nombre="check" [tamano]="13" />
                          {{ fila.actorEtiqueta }}
                        </span>
                      }
                      @if (fila.mensaje) {
                        <span class="la-motivo">{{ fila.mensaje }}</span>
                      }
                    </div>
                    <div class="la-estado-col">
                      <span [class]="'la-estado ' + claseEstado(fila)">{{
                        etiquetaEstado(fila)
                      }}</span>
                    </div>
                    <div class="la-fila-acciones">
                      <button
                        type="button"
                        class="la-mini"
                        title="Buscar en el directorio"
                        (click)="abrirBusqueda(fila.id)"
                      >
                        <app-icono nombre="buscar" [tamano]="15" />
                      </button>
                      <button
                        type="button"
                        class="la-mini"
                        title="Crear actor en el directorio"
                        (click)="abrirAlta(fila.id)"
                      >
                        <app-icono nombre="actores" [tamano]="15" />
                      </button>
                      <button
                        type="button"
                        class="la-mini"
                        [attr.title]="fila.omitido ? 'Incluir en la lista' : 'Omitir de la lista'"
                        (click)="alternarOmitir(fila.id)"
                      >
                        {{ fila.omitido ? 'Incluir' : 'Omitir' }}
                      </button>
                      <button
                        type="button"
                        class="la-mini la-mini--quitar"
                        title="Quitar de la lista"
                        (click)="quitarFila(fila.id)"
                      >
                        <app-icono nombre="cerrar" [tamano]="14" />
                      </button>
                    </div>

                    @if (fila.mostrandoBusqueda) {
                      <div class="la-subpanel">
                        <input
                          class="form-input"
                          type="search"
                          [value]="fila.consulta"
                          placeholder="Buscar por nombre en el directorio"
                          aria-label="Buscar actor en el directorio"
                          (input)="alBuscarActor(fila.id, $event)"
                        />
                        @if (fila.buscando) {
                          <span class="form-hint">Buscando…</span>
                        } @else if (fila.resultados.length) {
                          <ul class="la-opciones">
                            @for (actor of fila.resultados; track actor.id) {
                              <li>
                                <button
                                  type="button"
                                  class="la-opcion"
                                  (click)="elegirActor(fila.id, actor)"
                                >
                                  <span class="la-opcion-titulo">{{ actor.nombre }}</span>
                                  <span class="la-opcion-meta">
                                    {{ actor.tipo || 'Sin tipo' }}
                                    @if (actor.institucion) {
                                      · {{ actor.institucion }}
                                    }
                                  </span>
                                </button>
                              </li>
                            }
                          </ul>
                        } @else if (fila.buscado) {
                          <span class="form-hint">Sin coincidencias. Usa «Crear actor».</span>
                        }
                      </div>
                    }

                    @if (fila.mostrandoAlta) {
                      <div class="la-subpanel la-alta">
                        <p class="la-alta-texto">
                          Alta rápida: se crea en el directorio y se vincula a la reunión.
                        </p>
                        <div class="la-alta-campos">
                          <label class="la-alta-campo">
                            <span>Nombre</span>
                            <input
                              class="form-input"
                              type="text"
                              [value]="fila.nombre"
                              placeholder="Apellidos y nombres"
                              (input)="actualizarNombre(fila.id, $event)"
                            />
                          </label>
                          <label class="la-alta-campo">
                            <span>Naturaleza</span>
                            <select
                              class="form-select"
                              (change)="alCambiarNaturaleza(fila.id, $event)"
                            >
                              <option
                                value="persona"
                                [selected]="fila.altaNaturaleza === 'persona'"
                              >
                                Persona
                              </option>
                              <option
                                value="organizacion"
                                [selected]="fila.altaNaturaleza === 'organizacion'"
                              >
                                Organización
                              </option>
                            </select>
                          </label>
                        </div>
                        <div class="la-alta-acciones">
                          <button
                            type="button"
                            class="button-primary"
                            [disabled]="fila.creando || !fila.nombre.trim()"
                            (click)="crearActor(fila.id)"
                          >
                            {{ fila.creando ? 'Creando…' : 'Crear y vincular' }}
                          </button>
                          <button
                            type="button"
                            class="button-secondary"
                            (click)="cerrarAlta(fila.id)"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                }
              </div>

              <button type="button" class="la-agregar" (click)="agregarFila()">
                <app-icono nombre="actores" [tamano]="15" />
                Agregar asistente a mano
              </button>

              @if (errorEnvio(); as mensaje) {
                <p class="form-error" role="alert">{{ mensaje }}</p>
              }

              @if (resultado(); as res) {
                <div class="la-nota la-nota--ok">
                  <app-icono nombre="check" [tamano]="18" />
                  <span>
                    Listo: {{ res.resumen.vinculados }} vinculados ·
                    {{ res.resumen.omitidos }} omitidos
                    @if (res.resumen.errores) {
                      · {{ res.resumen.errores }} con error
                    }
                  </span>
                </div>
              }
            }
          </div>

          <footer class="la-foot">
            <div class="la-foot-info">
              @if (paso() === 'revision') {
                <span>{{ resumenFilas().listos }} listos</span>
                <span>· {{ resumenFilas().omitidos }} omitidos</span>
                @if (resumenFilas().sinActor) {
                  <span>· {{ resumenFilas().sinActor }} sin actor</span>
                }
              } @else {
                <span>La foto se guarda como adjunto de la reunión (máximo 20 MB).</span>
              }
            </div>
            <div class="la-foot-botones">
              @if (paso() === 'revision' && !resultado()) {
                <button type="button" class="la-link" (click)="vaciar()">Vaciar lista</button>
                <button type="button" class="button-secondary" (click)="cerrarModal()">
                  Cancelar
                </button>
                <button
                  type="button"
                  class="button-primary"
                  [disabled]="!puedeConfirmar()"
                  (click)="confirmar()"
                >
                  {{ confirmando() ? 'Vinculando…' : 'Confirmar y vincular' }}
                </button>
              }
            </div>
          </footer>
        }
      </section>
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }

    /*
     * Misma geometría que un diálogo modal centrado (la clase modal global):
     * velo único, 14 px de radio, la misma sombra y margin auto para centrarse cuando
     * cabe y no recortarse cuando es más alto que la ventana.
     */
    .la-scrim {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 20px;
      overflow-y: auto;
    }

    .la {
      width: min(760px, 100%);
      max-height: calc(100vh - 40px);
      display: flex;
      flex-direction: column;
      margin: auto;
      overflow: hidden;
      background: var(--paper, #fff);
      border: 1px solid var(--line, #e6ebef);
      border-radius: 14px;
      box-shadow: 0 24px 60px rgba(17, 32, 45, 0.28);
      outline: none;
    }

    .la-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--line, #e6ebef);
      background: var(--canvas, #f5f7f8);
      border-radius: 12px 12px 0 0;
    }

    .la-head-id {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--ink, #17283a);
    }

    .la-head-id h2 {
      margin: 0;
      font-size: 15px;
      font-family: var(--font-display, inherit);
    }

    .la-badge {
      min-width: 20px;
      text-align: center;
      padding: 1px 6px;
      border-radius: 999px;
      background: var(--blue, #2455a2);
      color: #fff;
      font-size: 11.5px;
      font-weight: 700;
    }

    .la-head-acciones {
      display: flex;
      gap: 2px;
    }

    .la-ico {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--muted, #5d6d7c);
      cursor: pointer;
    }

    .la-ico:hover {
      background: var(--blue-pale, #eaf1fb);
      color: var(--ink, #17283a);
    }

    .la-subbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 6px 16px;
      border-bottom: 1px solid var(--line, #e6ebef);
      font-size: 12px;
      color: var(--muted, #5d6d7c);
    }

    .la-sub-texto {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .la-punto {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--teal, #397c79);
    }

    .la-sub-paso {
      font-weight: 600;
      color: var(--ink-2, #33475b);
    }

    .la-body {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 16px;
      overflow-y: auto;
    }

    .la-bloque {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .la-reunion-elegida {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 9px 11px;
      border: 1px solid var(--line, #e6ebef);
      border-radius: 8px;
      background: var(--canvas, #f5f7f8);
    }

    .la-reunion-elegida strong {
      display: block;
      font-size: 13.5px;
    }

    .la-reunion-elegida small {
      display: block;
      margin-top: 2px;
      font-size: 12px;
      color: var(--muted, #5d6d7c);
    }

    .la-opciones {
      list-style: none;
      margin: 0;
      padding: 4px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-height: 220px;
      overflow-y: auto;
      border: 1px solid var(--line, #e6ebef);
      border-radius: 8px;
      background: #fff;
    }

    .la-opcion {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 7px 9px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      text-align: left;
      cursor: pointer;
      font: inherit;
    }

    .la-opcion:hover {
      background: var(--blue-pale, #eaf1fb);
    }

    .la-opcion-titulo {
      font-size: 13px;
      font-weight: 600;
      color: var(--ink, #17283a);
    }

    .la-opcion-meta {
      font-size: 11.5px;
      color: var(--muted, #5d6d7c);
    }

    .la-input-oculto {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      overflow: hidden;
      pointer-events: none;
    }

    .la-camara {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 5px;
      min-height: 150px;
      padding: 16px;
      border: 1.5px dashed var(--line, #e6ebef);
      border-radius: 10px;
      background: var(--canvas, #f5f7f8);
      color: var(--muted, #5d6d7c);
      cursor: pointer;
      text-align: center;
    }

    .la-camara:hover,
    .la-camara:focus-visible {
      border-color: var(--blue, #2455a2);
      color: var(--ink-2, #33475b);
    }

    .la-camara strong {
      font-size: 14.5px;
      color: var(--ink, #17283a);
    }

    .la-camara small {
      font-size: 12.5px;
    }

    .la-preview {
      margin: 0;
      border: 1px solid var(--line, #e6ebef);
      border-radius: 10px;
      overflow: hidden;
      background: #0f1b26;
    }

    .la-preview img {
      display: block;
      width: 100%;
      max-height: 320px;
      object-fit: contain;
    }

    .la-preview-meta {
      margin: 0;
      font-size: 12px;
      color: var(--muted, #5d6d7c);
    }

    .la-acciones-foto {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .la-link {
      align-self: flex-start;
      padding: 0;
      border: 0;
      background: none;
      color: var(--blue, #2455a2);
      font: inherit;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
    }

    .la-link:hover {
      text-decoration: underline;
    }

    .la-nota {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 12.5px;
      line-height: 1.5;
    }

    .la-nota--info {
      background: var(--blue-pale, #eaf1fb);
      color: var(--ink-2, #33475b);
    }

    .la-nota--amber {
      background: var(--amber-pale, #fff4e2);
      color: #7a4d0c;
    }

    .la-nota--ok {
      background: var(--green-pale, #e9f5ef);
      color: var(--green, #34785b);
    }

    .la-adjunto {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      font-size: 12.5px;
      color: var(--green, #34785b);
    }

    .la-adjunto--vacio {
      color: var(--muted, #5d6d7c);
    }

    .la-lista {
      border: 1px solid var(--line, #e6ebef);
      border-radius: 10px;
      overflow: hidden;
    }

    .la-lista-head {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr) 120px 168px;
      gap: 8px;
      padding: 7px 10px;
      background: var(--canvas, #f5f7f8);
      border-bottom: 1px solid var(--line, #e6ebef);
      font-size: 10.5px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--ink-2, #33475b);
      font-weight: 700;
    }

    .la-lista-head-acc {
      text-align: right;
    }

    .la-fila {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr) 120px 168px;
      gap: 8px;
      align-items: start;
      padding: 10px;
      border-bottom: 1px solid #eef2f6;
    }

    .la-fila:last-child {
      border-bottom: 0;
    }

    .la-fila--om {
      opacity: 0.62;
    }

    .la-num {
      font-size: 12.5px;
      font-weight: 700;
      color: var(--blue, #2455a2);
      padding-top: 8px;
    }

    .la-campos {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }

    .la-vinculo {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--green, #34785b);
      font-weight: 600;
    }

    .la-motivo {
      font-size: 11.5px;
      color: var(--red, #ad4d46);
    }

    .la-estado-col {
      padding-top: 6px;
    }

    .la-estado {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
    }

    .la-estado--ok {
      background: var(--green-pale, #e9f5ef);
      color: var(--green, #34785b);
    }

    .la-estado--info {
      background: var(--blue-pale, #eaf1fb);
      color: var(--blue, #2455a2);
    }

    .la-estado--om {
      background: #eef1f4;
      color: var(--muted, #5d6d7c);
    }

    .la-estado--err {
      background: var(--red-pale, #fbeceb);
      color: var(--red, #ad4d46);
    }

    .la-estado--pend {
      background: var(--amber-pale, #fff4e2);
      color: var(--amber, #aa6a11);
    }

    .la-fila-acciones {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 3px;
    }

    .la-mini {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 4px 6px;
      border: 1px solid var(--line, #e6ebef);
      border-radius: 6px;
      background: #fff;
      color: var(--ink-2, #33475b);
      font: inherit;
      font-size: 11.5px;
      cursor: pointer;
    }

    .la-mini:hover {
      border-color: var(--blue, #2455a2);
      color: var(--blue, #2455a2);
    }

    .la-mini--quitar:hover {
      border-color: var(--red, #ad4d46);
      color: var(--red, #ad4d46);
    }

    .la-subpanel {
      grid-column: 2 / -1;
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 6px;
      padding: 8px;
      border: 1px solid var(--line, #e6ebef);
      border-radius: 8px;
      background: var(--canvas, #f5f7f8);
    }

    .la-alta-texto {
      margin: 0;
      font-size: 12px;
      color: var(--muted, #5d6d7c);
    }

    .la-alta-campos {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 160px;
      gap: 8px;
    }

    .la-alta-campo {
      display: flex;
      flex-direction: column;
      gap: 3px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #7b8896;
    }

    .la-alta-acciones {
      display: flex;
      gap: 8px;
    }

    .la-agregar {
      align-self: flex-start;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border: 1px dashed var(--line, #e6ebef);
      border-radius: 8px;
      background: transparent;
      color: var(--ink-2, #33475b);
      font: inherit;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
    }

    .la-agregar:hover {
      border-color: var(--blue, #2455a2);
      color: var(--blue, #2455a2);
    }

    .la-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 11px 16px;
      border-top: 1px solid var(--line, #e6ebef);
      background: var(--canvas, #f5f7f8);
      border-radius: 0 0 12px 12px;
    }

    .la-foot-info {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      font-size: 12px;
      color: var(--muted, #5d6d7c);
    }

    .la-foot-botones {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    @media (max-width: 720px) {
      .la-lista-head {
        display: none;
      }

      .la-fila {
        grid-template-columns: 28px minmax(0, 1fr);
      }

      .la-estado-col {
        grid-column: 2;
      }

      .la-fila-acciones {
        grid-column: 2;
        justify-content: flex-start;
      }

      .la-subpanel {
        grid-column: 1 / -1;
      }

      .la-alta-campos {
        grid-template-columns: 1fr;
      }

      .la-foot {
        flex-direction: column;
        align-items: stretch;
      }

      .la-foot-botones {
        justify-content: flex-end;
      }
    }
  `,
})
export class ListaAsistenciaComponent {
  private readonly adjuntos = inject(AdjuntosService);
  private readonly servicio = inject(ResultadosService);
  private readonly destruir = inject(DestroyRef);

  readonly cerrar = output<void>();

  private readonly dialogo = viewChild<ElementRef<HTMLElement>>('dialogo');
  private readonly inputFoto = viewChild<ElementRef<HTMLInputElement>>('inputFoto');

  readonly paso = signal<Paso>('captura');
  readonly plegado = signal(false);

  readonly reunion = signal<ReunionResumen | null>(null);
  readonly reuniones = signal<ReunionResumen[]>([]);
  readonly cargandoReuniones = signal(false);
  readonly errorReunion = signal<string | null>(null);

  readonly filas = signal<Fila[]>([]);
  readonly foto = signal<File | null>(null);
  readonly previewUrl = signal<string | null>(null);
  readonly errorFoto = signal<string | null>(null);
  readonly subiendo = signal(false);
  readonly extrayendo = signal(false);
  readonly adjunto = signal<Adjunto | null>(null);
  readonly extraccion = signal<Extraccion | null>(null);

  readonly errorEnvio = signal<string | null>(null);
  readonly confirmando = signal(false);
  readonly resultado = signal<Vinculacion | null>(null);

  readonly formatearFecha = formatearFecha;

  private secuencia = 0;
  private timerReunion: ReturnType<typeof setTimeout> | null = null;
  private readonly timersActor = new Map<number, ReturnType<typeof setTimeout>>();

  readonly conteoFilas = computed(() => this.filas().length);

  readonly resumenFilas = computed(() => {
    let listos = 0;
    let omitidos = 0;
    let sinActor = 0;
    for (const fila of this.filas()) {
      if (fila.omitido) {
        omitidos += 1;
        continue;
      }
      if (fila.actorId) listos += 1;
      else sinActor += 1;
    }
    return { listos, omitidos, sinActor, total: this.filas().length };
  });

  readonly puedeConfirmar = computed(
    () =>
      this.reunion() !== null &&
      this.resumenFilas().listos > 0 &&
      !this.confirmando() &&
      this.resultado() === null,
  );

  readonly nombreFoto = computed(() => this.foto()?.name ?? '');
  readonly tamanoFoto = computed(() => this.formatearTamano(this.foto()?.size ?? 0));

  constructor() {
    this.cargarReuniones('');
    afterNextRender(() => this.dialogo()?.nativeElement.focus({ preventScroll: true }));

    this.destruir.onDestroy(() => {
      if (this.timerReunion) clearTimeout(this.timerReunion);
      for (const timer of this.timersActor.values()) clearTimeout(timer);
      this.timersActor.clear();
      const url = this.previewUrl();
      if (url) URL.revokeObjectURL(url);
    });
  }

  /* ----------------------------- Reunión ----------------------------- */

  private cargarReuniones(q: string): void {
    this.cargandoReuniones.set(true);
    this.errorReunion.set(null);
    this.servicio.listarReuniones(q).subscribe({
      next: (reuniones) => {
        this.reuniones.set(reuniones);
        this.cargandoReuniones.set(false);
      },
      error: () => {
        this.reuniones.set([]);
        this.cargandoReuniones.set(false);
        this.errorReunion.set('No se pudieron cargar las reuniones.');
      },
    });
  }

  alBuscarReunion(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    if (this.timerReunion) clearTimeout(this.timerReunion);
    this.timerReunion = setTimeout(() => {
      this.timerReunion = null;
      this.cargarReuniones(valor.trim());
    }, 250);
  }

  elegirReunion(reunion: ReunionResumen): void {
    this.reunion.set(reunion);
    this.errorReunion.set(null);
  }

  cambiarReunion(): void {
    this.reunion.set(null);
    this.cargarReuniones('');
  }

  /* ------------------------------ Foto ------------------------------- */

  abrirCamara(): void {
    const input = this.inputFoto()?.nativeElement;
    if (!input) return;
    input.value = '';
    input.click();
  }

  alElegirFoto(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const archivo = entrada.files?.[0] ?? null;
    if (!archivo) return;

    if (!archivo.type.startsWith('image/')) {
      this.errorFoto.set('El archivo debe ser una imagen (JPG, PNG o WEBP).');
      entrada.value = '';
      return;
    }
    if (archivo.size > MAX_ADJUNTO_BYTES) {
      this.errorFoto.set('La imagen supera el máximo de 20 MB.');
      entrada.value = '';
      return;
    }
    if (archivo.size === 0) {
      this.errorFoto.set('La imagen está vacía.');
      entrada.value = '';
      return;
    }

    this.descartarPreview();
    this.foto.set(archivo);
    this.previewUrl.set(URL.createObjectURL(archivo));
    this.errorFoto.set(null);
  }

  reintentarFoto(): void {
    this.descartarPreview();
    this.foto.set(null);
    this.errorFoto.set(null);
    this.abrirCamara();
  }

  private descartarPreview(): void {
    const url = this.previewUrl();
    if (url) URL.revokeObjectURL(url);
    this.previewUrl.set(null);
  }

  usarFoto(): void {
    const reunion = this.reunion();
    const archivo = this.foto();
    if (!reunion) {
      this.errorFoto.set('Elige la reunión antes de guardar la foto.');
      return;
    }
    if (!archivo) {
      this.errorFoto.set('Toma o elige una foto primero.');
      return;
    }
    if (this.subiendo() || this.extrayendo()) return;

    this.errorFoto.set(null);
    this.subiendo.set(true);

    this.adjuntos
      .subir('reunion', reunion.id, archivo, 'Foto de la lista de asistencia')
      .subscribe({
        next: (adjunto) => {
          this.adjunto.set(adjunto);
          this.subiendo.set(false);
          this.procesar(adjunto.id);
        },
        error: (fallo: unknown) => {
          this.subiendo.set(false);
          this.errorFoto.set(aErrorApi(fallo).message);
        },
      });
  }

  private procesar(adjuntoId: string): void {
    const reunion = this.reunion();
    if (!reunion) return;

    this.extrayendo.set(true);
    this.servicio.extraer(reunion.id, adjuntoId).subscribe({
      next: (extraccion) => {
        this.extrayendo.set(false);
        this.aplicarExtraccion(extraccion);
      },
      error: (fallo: unknown) => {
        this.extrayendo.set(false);
        this.extraccion.set({
          disponible: false,
          motor: null,
          asistentes: [],
          nota: aErrorApi(fallo).message,
        });
        this.paso.set('revision');
      },
    });
  }

  private aplicarExtraccion(extraccion: Extraccion): void {
    this.extraccion.set(extraccion);
    if (extraccion.asistentes.length > 0) {
      const nuevas = extraccion.asistentes.map((propuesto) =>
        this.crearFila(propuesto.nombre, propuesto.cargo, 'extraido'),
      );
      this.filas.update((actuales) => [...actuales, ...nuevas]);
    }
    this.paso.set('revision');
  }

  continuarSinFoto(): void {
    if (!this.reunion()) {
      this.errorFoto.set('Elige la reunión primero.');
      return;
    }
    this.extraccion.set({
      disponible: false,
      motor: null,
      asistentes: [],
      nota: 'Sin foto: la lista se escribe y revisa a mano.',
    });
    this.paso.set('revision');
  }

  /* ------------------------------ Filas ------------------------------ */

  private crearFila(nombre: string, cargo: string | null, origen: OrigenFila): Fila {
    this.secuencia += 1;
    return {
      id: this.secuencia,
      nombre,
      cargo: cargo ?? '',
      actorId: null,
      actorEtiqueta: null,
      estado: 'pendiente',
      origen,
      mensaje: null,
      omitido: false,
      consulta: nombre,
      buscando: false,
      buscado: false,
      resultados: [],
      mostrandoBusqueda: false,
      mostrandoAlta: false,
      altaNaturaleza: 'persona',
      creando: false,
    };
  }

  private parchear(id: number, cambios: Partial<Fila>): void {
    this.filas.update((actuales) =>
      actuales.map((fila) => (fila.id === id ? { ...fila, ...cambios } : fila)),
    );
  }

  private fila(id: number): Fila | undefined {
    return this.filas().find((actual) => actual.id === id);
  }

  agregarFila(): void {
    this.filas.update((actuales) => [...actuales, this.crearFila('', null, 'manual')]);
  }

  actualizarNombre(id: number, evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.parchear(id, { nombre: valor });
  }

  actualizarCargo(id: number, evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.parchear(id, { cargo: valor });
  }

  alCambiarNaturaleza(id: number, evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    const naturaleza: NaturalezaActor = valor === 'organizacion' ? 'organizacion' : 'persona';
    this.parchear(id, { altaNaturaleza: naturaleza });
  }

  abrirBusqueda(id: number): void {
    const actual = this.fila(id);
    const consulta = actual?.nombre ?? '';
    this.parchear(id, {
      mostrandoBusqueda: true,
      mostrandoAlta: false,
      consulta,
      resultados: [],
      buscado: false,
      mensaje: null,
    });
    if (consulta.trim().length >= 2) {
      this.buscarActor(id, consulta.trim());
    }
  }

  alBuscarActor(id: number, evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.parchear(id, { consulta: valor, buscado: false });

    const previo = this.timersActor.get(id);
    if (previo) clearTimeout(previo);

    const q = valor.trim();
    if (q.length < 2) {
      this.parchear(id, { resultados: [], buscando: false });
      return;
    }

    this.parchear(id, { buscando: true });
    const timer = setTimeout(() => {
      this.timersActor.delete(id);
      this.buscarActor(id, q);
    }, 300);
    this.timersActor.set(id, timer);
  }

  private buscarActor(id: number, q: string): void {
    if (!this.fila(id)) return;
    this.servicio.buscarActores(q).subscribe({
      next: (actores) => {
        this.parchear(id, { resultados: actores, buscando: false, buscado: true });
      },
      error: () => {
        this.parchear(id, {
          resultados: [],
          buscando: false,
          buscado: true,
          mensaje: 'No se pudo consultar el directorio.',
        });
      },
    });
  }

  elegirActor(id: number, actor: ActorOpcion): void {
    const actual = this.fila(id);
    const nombre = actual && actual.nombre.trim() ? actual.nombre : actor.nombre;
    this.parchear(id, {
      actorId: actor.id,
      actorEtiqueta: actor.nombre,
      nombre,
      estado: 'vinculado',
      origen: 'directorio',
      mostrandoBusqueda: false,
      resultados: [],
      buscado: false,
      mensaje: null,
    });
  }

  abrirAlta(id: number): void {
    this.parchear(id, { mostrandoAlta: true, mostrandoBusqueda: false, mensaje: null });
  }

  cerrarAlta(id: number): void {
    this.parchear(id, { mostrandoAlta: false });
  }

  crearActor(id: number): void {
    const actual = this.fila(id);
    if (!actual || actual.creando) return;

    const nombre = actual.nombre.trim();
    if (!nombre) {
      this.parchear(id, { mensaje: 'Escribe el nombre antes de crear el actor.' });
      return;
    }

    this.parchear(id, { creando: true, mensaje: null });
    this.servicio.crearActor(nombre, actual.altaNaturaleza).subscribe({
      next: (actor) => {
        this.parchear(id, {
          creando: false,
          actorId: actor.id,
          actorEtiqueta: actor.nombre,
          nombre: actor.nombre,
          estado: 'creado',
          origen: 'alta',
          mostrandoAlta: false,
          mensaje: null,
        });
      },
      error: (fallo: unknown) => {
        this.parchear(id, { creando: false, mensaje: aErrorApi(fallo).message });
      },
    });
  }

  alternarOmitir(id: number): void {
    const actual = this.fila(id);
    if (!actual) return;

    if (!actual.omitido) {
      this.parchear(id, {
        omitido: true,
        estado: 'omitido',
        mostrandoBusqueda: false,
        mostrandoAlta: false,
      });
      return;
    }

    const estado: EstadoFila = actual.actorId
      ? actual.origen === 'alta'
        ? 'creado'
        : 'vinculado'
      : 'pendiente';
    this.parchear(id, { omitido: false, estado });
  }

  quitarFila(id: number): void {
    const timer = this.timersActor.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timersActor.delete(id);
    }
    this.filas.update((actuales) => actuales.filter((fila) => fila.id !== id));
  }

  vaciar(): void {
    for (const timer of this.timersActor.values()) clearTimeout(timer);
    this.timersActor.clear();
    this.filas.set([]);
    this.resultado.set(null);
    this.errorEnvio.set(null);
  }

  /* ---------------------------- Confirmar ---------------------------- */

  confirmar(): void {
    const reunion = this.reunion();
    if (!reunion || this.confirmando()) return;

    const filas = this.filas();
    const listos = filas.filter((fila) => !fila.omitido && fila.actorId);
    if (listos.length === 0) {
      this.errorEnvio.set('Vincula al menos un asistente del directorio antes de confirmar.');
      return;
    }

    const envio: AsistenteEnvio[] = filas.map((fila) => ({
      nombre: fila.actorEtiqueta ?? fila.nombre,
      cargo: fila.cargo.trim() || null,
      actorId: fila.omitido ? null : fila.actorId,
      omitido: fila.omitido || !fila.actorId,
    }));

    this.confirmando.set(true);
    this.errorEnvio.set(null);

    this.servicio.vincular(reunion.id, envio).subscribe({
      next: (resultado) => {
        this.confirmando.set(false);
        this.resultado.set(resultado);
        this.filas.update((actuales) =>
          actuales.map((fila, indice) => {
            const item = resultado.items[indice];
            if (!item) return fila;
            const estado: EstadoFila =
              item.estado === 'vinculado'
                ? fila.origen === 'alta'
                  ? 'creado'
                  : 'vinculado'
                : item.estado === 'omitido'
                  ? 'omitido'
                  : 'error';
            return { ...fila, estado, mensaje: item.motivo };
          }),
        );
      },
      error: (fallo: unknown) => {
        this.confirmando.set(false);
        this.errorEnvio.set(aErrorApi(fallo).message);
      },
    });
  }

  /* ----------------------------- Estado ------------------------------ */

  claseEstado(fila: Fila): string {
    switch (fila.estado) {
      case 'vinculado':
        return 'la-estado--ok';
      case 'creado':
        return 'la-estado--info';
      case 'omitido':
        return 'la-estado--om';
      case 'error':
        return 'la-estado--err';
      default:
        return 'la-estado--pend';
    }
  }

  etiquetaEstado(fila: Fila): string {
    switch (fila.estado) {
      case 'vinculado':
        return 'Vinculado';
      case 'creado':
        return 'Creado y vinculado';
      case 'omitido':
        return 'Omitido';
      case 'error':
        return 'Error';
      default:
        return fila.actorId ? 'Por confirmar' : 'Sin actor';
    }
  }

  formatearTamano(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) {
      return '0 KB';
    }
    if (bytes < 1024 * 1024) {
      return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  }

  /* ----------------------------- Ventana ----------------------------- */

  alternarPlegado(): void {
    this.plegado.update((valor) => !valor);
  }

  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrarModal();
  }

  /** Cierra con la animación de salida y luego avisa al contenedor. */
  cerrarModal(): void {
    salirModal(this.dialogo()?.nativeElement, () => {
      this.descartarPreview();
      this.cerrar.emit();
    });
  }
}
