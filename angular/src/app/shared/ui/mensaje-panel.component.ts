import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { normalizarColeccion, paramsDePagina, urlConParametros } from '../../core/http/coleccion';
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { IconoComponent } from './icono.component';

/** Motivo auditado del descifrado en lote (Ley 29733). */
const MOTIVO_PII = 'Enviar mensaje';
/** Tope del endpoint de PII: los lotes mayores se parten. */
const LOTE_PII = 500;
/** Término mínimo del buscador de destinatarios. */
const MIN_BUSQUEDA = 2;
/** Asunto inicial del compositor; sirve para saber si hubo cambios. */
const ASUNTO_INICIAL = 'Convocatoria a reunión de diálogo';

export type CanalMensaje = 'whatsapp' | 'correo' | 'institucional';

/**
 * Un destinatario del panel. `telefono`/`correo` son contactos ya conocidos
 * (por ejemplo `telefono_contacto` del listado o lo que escriba la persona
 * usuaria); si falta el teléfono y hay `actorId`, el panel pide la PII auditada.
 */
export type DestinatarioMensaje = {
  actorId?: string | null;
  nombre: string;
  telefono?: string | null;
  correo?: string | null;
};

type Aviso = { tipo: 'exito' | 'error'; texto: string };

/** Registro mínimo de `GET /v1/actors` para el buscador del panel. */
function aDestinatarioBusqueda(bruto: unknown): DestinatarioMensaje | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const registro = bruto as Record<string, unknown>;
  const idBruto = registro['id'] ?? registro['uid'];
  const actorId = typeof idBruto === 'string' ? idBruto : null;

  const nombreBruto = registro['nombre'];
  const nombre = typeof nombreBruto === 'string' ? nombreBruto.trim() : '';
  if (!nombre) return null;

  const correoBruto = registro['email'] ?? registro['emailContacto'] ?? registro['email_contacto'];
  const correo = typeof correoBruto === 'string' && correoBruto.trim() ? correoBruto.trim() : null;

  const telBruto = registro['telefono'] ?? registro['telefonoContacto'] ?? registro['telefono_contacto'];
  const telefono = typeof telBruto === 'string' && telBruto.trim() ? telBruto.trim() : null;

  return { actorId, nombre, telefono, correo };
}

/**
 * `POST /v1/actors/pii` → sólo los teléfonos legibles, por id.
 * Nunca se guarda ni se muestra un valor descifrado fuera del enlace `wa.me`.
 */
function telefonosDeLote(bruto: unknown): Record<string, string> {
  const salida: Record<string, string> = {};
  if (!bruto || typeof bruto !== 'object') return salida;
  const datos = (bruto as Record<string, unknown>)['datos'];
  if (!datos || typeof datos !== 'object') return salida;
  for (const [id, valor] of Object.entries(datos as Record<string, unknown>)) {
    if (!valor || typeof valor !== 'object') continue;
    const telefono = (valor as Record<string, unknown>)['telefono'];
    if (typeof telefono === 'string' && telefono.trim()) salida[id] = telefono.trim();
  }
  return salida;
}

/** Sólo dígitos: `wa.me` no acepta espacios, guiones ni el prefijo `+`. */
function digitosTelefono(telefono: string): string {
  return telefono.replace(/[^\d]/g, '');
}

/**
 * Panel de mensajes orientado a destinatarios.
 *
 * Reúne el compositor que antes vivía en la vista de reuniones, pero recibe una
 * lista de personas/organizaciones. El teléfono sólo se obtiene por el endpoint
 * auditado (`POST /v1/actors/pii`, motivo «Enviar mensaje») y sólo si el perfil
 * puede ver PII; el resto se pide en el propio campo o el canal se declara
 * incompleto. Nunca se simula un envío.
 *
 * Reglas de cierre pedidas por la Dirección: el velo NO cierra si hay cambios,
 * Escape tampoco; la «X» cierra siempre. No hay botón «Cerrar» adicional.
 */
@Component({
  selector: 'app-mensaje-panel',
  imports: [IconoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (abierto()) {
      <div
        class="drawer-scrim"
        role="presentation"
        (click)="alFondo($event)"
        (document:keydown.escape)="intentarCerrar()"
      >
        <aside
          class="drawer mensaje-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-mensaje-panel"
        >
          <header class="drawer-head">
            <div>
              <h2 id="titulo-mensaje-panel">Enviar mensaje</h2>
              <p>{{ resumenContexto() }}</p>
            </div>
            <button
              type="button"
              class="icon-button"
              aria-label="Cerrar el panel de mensaje"
              (click)="cerrarPanel()"
            >
              <app-icono nombre="cerrar" [tamano]="18" />
            </button>
          </header>

          <div class="drawer-body mensaje-cuerpo">
            <section class="mensaje-bloque" aria-labelledby="mensaje-destinatarios">
              <div class="mensaje-bloque-cabecera">
                <h3 id="mensaje-destinatarios">Destinatarios</h3>
                <span class="mensaje-contador">{{ destinatarios().length }}</span>
              </div>

              @if (destinatarios().length === 0) {
                <p class="mensaje-vacio">
                  No hay destinatarios todavía. Añade personas u organizaciones desde el buscador.
                </p>
              } @else {
                <ul class="mensaje-lista">
                  @for (d of destinatarios(); track $index) {
                    <li class="mensaje-fila">
                      <div class="mensaje-fila-datos">
                        <strong>{{ d.nombre }}</strong>

                        @if (canal() === 'whatsapp') {
                          <label class="mensaje-contacto">
                            <span>Teléfono</span>
                            <input
                              type="tel"
                              [value]="telefonoDe(d, $index)"
                              placeholder="sin teléfono"
                              (input)="cambiarTelefono(d, $index, $event)"
                            />
                          </label>
                        } @else {
                          <label class="mensaje-contacto">
                            <span>Correo</span>
                            <input
                              type="email"
                              [value]="correoDe(d, $index)"
                              placeholder="sin correo"
                              (input)="cambiarCorreo(d, $index, $event)"
                            />
                          </label>
                        }

                        <span class="mensaje-fila-estado">{{ estadoContacto(d, $index) }}</span>
                      </div>

                      <div class="mensaje-fila-acciones">
                        @if (canal() === 'whatsapp') {
                          @if (telefonoDe(d, $index) && mensaje().trim()) {
                            <a
                              class="button-secondary mensaje-enlace"
                              [href]="enlaceWhatsApp(telefonoDe(d, $index))"
                              target="_blank"
                              rel="noopener"
                              [attr.aria-label]="'Abrir WhatsApp para ' + d.nombre"
                            >
                              Abrir WhatsApp
                            </a>
                          }
                        } @else if (canal() === 'correo') {
                          @if (correoDe(d, $index) && mensaje().trim()) {
                            <a
                              class="button-secondary mensaje-enlace"
                              [href]="enlaceCorreo(correoDe(d, $index))"
                              [attr.aria-label]="'Abrir correo para ' + d.nombre"
                            >
                              Abrir correo
                            </a>
                          }
                        } @else {
                          <button
                            type="button"
                            class="button-secondary"
                            [disabled]="!puedeEnviarInstitucional(d, $index)"
                            (click)="enviarInstitucional(d, $index)"
                          >
                            {{
                              estadoEnvio(claveDe(d, $index)) === 'enviando' ? 'Enviando…' : 'Enviar'
                            }}
                          </button>
                          @if (estadoEnvio(claveDe(d, $index)) === 'enviado') {
                            <span class="mensaje-fila-estado mensaje-ok">Enviado</span>
                          } @else if (estadoEnvio(claveDe(d, $index)) === 'error') {
                            <span class="mensaje-fila-estado mensaje-ko">No se pudo enviar</span>
                          }
                        }

                        @if (permitirAnadir()) {
                          <button
                            type="button"
                            class="mensaje-quitar"
                            [attr.aria-label]="'Quitar a ' + d.nombre + ' de los destinatarios'"
                            (click)="quitar($index)"
                          >
                            Quitar
                          </button>
                        }
                      </div>
                    </li>
                  }
                </ul>
              }

              @if (cargandoPii()) {
                <p class="mensaje-nota" role="status">Buscando teléfonos autorizados…</p>
              }
              @if (errorPii(); as mensajeError) {
                <p class="mensaje-error" role="alert">{{ mensajeError }}</p>
              }
              @if (!puedeVerPii() && haySinTelefonoVisible()) {
                <p class="mensaje-aviso" role="status">
                  Tu perfil no puede leer los teléfonos de las fichas. Escribe el número a mano o
                  pide el envío a un sectorista o a la Dirección.
                </p>
              }

              @if (permitirAnadir()) {
                <div class="mensaje-buscador">
                  <label class="search-field">
                    <app-icono nombre="buscar" [tamano]="14" />
                    <input
                      type="search"
                      placeholder="Añadir persona u organización por nombre"
                      aria-label="Buscar destinatarios para el mensaje"
                      [value]="busqueda()"
                      (input)="alBuscar($event)"
                    />
                  </label>
                  @if (buscando()) {
                    <p class="mensaje-nota" role="status">Buscando…</p>
                  }
                  @if (resultados().length > 0) {
                    <ul class="mensaje-resultados">
                      @for (r of resultados(); track $index) {
                        <li>
                          <span>{{ r.nombre }}</span>
                          <button type="button" class="button-secondary" (click)="agregar(r)">
                            Añadir
                          </button>
                        </li>
                      }
                    </ul>
                  }
                  @if (errorBusqueda(); as mensajeError) {
                    <p class="mensaje-error" role="alert">{{ mensajeError }}</p>
                  }
                </div>
              }
            </section>

            <div class="segmented" role="group" aria-label="Canal de envío">
              <button
                type="button"
                [attr.aria-pressed]="canal() === 'whatsapp'"
                (click)="cambiarCanal('whatsapp')"
              >
                WhatsApp
              </button>
              <button
                type="button"
                [attr.aria-pressed]="canal() === 'correo'"
                (click)="cambiarCanal('correo')"
              >
                Correo
              </button>
              <button
                type="button"
                [attr.aria-pressed]="canal() === 'institucional'"
                (click)="cambiarCanal('institucional')"
              >
                Correo institucional
              </button>
            </div>

            @if (canal() !== 'whatsapp') {
              <label class="mensaje-campo">
                Asunto
                <input
                  type="text"
                  maxlength="150"
                  [value]="asunto()"
                  (input)="asunto.set($any($event.target).value)"
                />
              </label>
            }

            <label class="mensaje-campo">
              Mensaje
              <textarea
                rows="5"
                [value]="mensaje()"
                (input)="mensaje.set($any($event.target).value)"
              ></textarea>
            </label>

            <p class="mensaje-nota">{{ avisoCanal() }}</p>

            @if (aviso(); as avisoActual) {
              <p
                class="mensaje-estado"
                [class.mensaje-estado-error]="avisoActual.tipo === 'error'"
                role="status"
              >
                {{ avisoActual.texto }}
              </p>
            }

            @if (destinatarios().length > 0 && !hayDestinatariosContactables()) {
              <p class="mensaje-aviso" role="status">
                Ningún destinatario tiene
                {{ canal() === 'whatsapp' ? 'teléfono' : 'correo' }} para este canal. Añade el
                contacto o cambia de canal; no se simula ningún envío.
              </p>
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

    .mensaje-drawer {
      width: min(540px, 100%);
    }

    .mensaje-cuerpo {
      gap: 15px;
    }

    .mensaje-bloque {
      display: grid;
      gap: 10px;
    }

    .mensaje-bloque-cabecera {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .mensaje-bloque-cabecera h3 {
      margin: 0;
      color: #1c2a38;
      font-size: 13.5px;
      font-weight: 700;
    }

    .mensaje-contador {
      min-width: 22px;
      padding: 2px 8px;
      border-radius: 999px;
      background: #eef2f6;
      color: #526577;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      text-align: center;
    }

    .mensaje-vacio {
      margin: 0;
      color: #7b8896;
      font-size: 13px;
      line-height: 1.5;
    }

    .mensaje-lista {
      display: grid;
      gap: 0;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .mensaje-fila {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 9px 0;
      border-top: 1px solid #edf0f2;
    }

    .mensaje-fila-datos {
      display: grid;
      gap: 4px;
      min-width: 0;
      flex: 1;
    }

    .mensaje-fila-datos strong {
      color: #38495a;
      font-size: 13px;
    }

    .mensaje-fila-estado {
      color: #8a98a5;
      font-size: 12px;
      line-height: 1.4;
    }

    .mensaje-ok {
      color: #2f6b3a;
      font-weight: 700;
    }

    .mensaje-ko {
      color: #a3402f;
      font-weight: 700;
    }

    .mensaje-contacto {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #5a6a78;
      font-size: 12px;
      font-weight: 600;
    }

    .mensaje-contacto input {
      flex: 1;
      min-width: 0;
      min-height: 32px;
      padding: 0 9px;
      border: 1px solid #cfd9e2;
      border-radius: 6px;
      background: #fff;
      color: #26384a;
      font: inherit;
      font-weight: 400;
    }

    .mensaje-contacto input:focus-visible {
      outline: 2px solid #3576c5;
      outline-offset: 2px;
    }

    .mensaje-fila-acciones {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      flex: none;
    }

    .mensaje-enlace {
      text-decoration: none;
    }

    .mensaje-quitar {
      padding: 5px 8px;
      border: 1px solid #dce3e8;
      border-radius: 5px;
      background: #fff;
      color: #526577;
      font-size: 12.5px;
      cursor: pointer;
    }

    .mensaje-quitar:hover {
      background: #f5f7f8;
    }

    .mensaje-buscador {
      display: grid;
      gap: 8px;
    }

    .mensaje-resultados {
      display: grid;
      gap: 0;
      margin: 0;
      padding: 0;
      list-style: none;
      border: 1px solid #e1e8ef;
      border-radius: 8px;
      overflow: hidden;
    }

    .mensaje-resultados li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 7px 10px;
      border-top: 1px solid #edf0f2;
      font-size: 13px;
      color: #38495a;
    }

    .mensaje-resultados li:first-child {
      border-top: 0;
    }

    .mensaje-campo {
      display: grid;
      gap: 5px;
      color: #465a6c;
      font-size: 13px;
      font-weight: 600;
    }

    .mensaje-campo input,
    .mensaje-campo textarea {
      min-width: 0;
      padding: 8px 10px;
      border: 1px solid #cfd9e2;
      border-radius: 6px;
      background: #fff;
      color: #26384a;
      font: inherit;
      font-weight: 400;
    }

    .mensaje-campo textarea {
      resize: vertical;
    }

    .mensaje-campo input:focus-visible,
    .mensaje-campo textarea:focus-visible {
      outline: 2px solid #3576c5;
      outline-offset: 2px;
    }

    .mensaje-nota {
      margin: 0;
      color: #7b8896;
      font-size: 12.5px;
      line-height: 1.45;
    }

    .mensaje-aviso {
      margin: 0;
      padding: 8px 10px;
      border: 1px solid #e6d5a8;
      border-radius: 6px;
      background: #fdf8e8;
      color: #7a5c08;
      font-size: 13px;
      line-height: 1.45;
    }

    .mensaje-error {
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

    .mensaje-estado {
      margin: 0;
      padding: 8px 10px;
      border-radius: 6px;
      background: #edf6ee;
      color: #2f6b3a;
      font-size: 13px;
      line-height: 1.5;
    }

    .mensaje-estado-error {
      background: #fdf1ef;
      color: #a34c45;
    }
  `,
})
export class MensajePanelComponent {
  private readonly http = inject(HttpClient);
  private readonly destruccion = inject(DestroyRef);
  readonly capacidades = inject(CapacidadesService);

  readonly abierto = input(false);
  readonly contexto = input<string | null>(null);
  readonly destinatarios = input<DestinatarioMensaje[]>([]);
  readonly permitirAnadir = input(false);

  readonly cerrar = output<void>();
  readonly destinatariosCambio = output<DestinatarioMensaje[]>();

  readonly canal = signal<CanalMensaje>('whatsapp');
  readonly asunto = signal(ASUNTO_INICIAL);
  readonly mensaje = signal('');

  /** Contraseñas escritas a mano por destinatario (clave → valor). */
  readonly manualTelefono = signal<Record<string, string>>({});
  readonly manualCorreo = signal<Record<string, string>>({});
  /** Teléfonos obtenidos por el endpoint auditado, por `actorId`. */
  readonly telefonosPii = signal<Record<string, string>>({});

  readonly cargandoPii = signal(false);
  readonly errorPii = signal<string | null>(null);

  readonly enviando = signal<Record<string, 'enviando' | 'enviado' | 'error'>>({});
  readonly aviso = signal<Aviso | null>(null);

  readonly busqueda = signal('');
  readonly resultados = signal<DestinatarioMensaje[]>([]);
  readonly buscando = signal(false);
  readonly errorBusqueda = signal<string | null>(null);

  readonly puedeVerPii = this.capacidades.puedeVerPii;

  /** Ids que necesitan teléfono y aún no lo tienen ni por PII ni a mano. */
  private readonly idsSinTelefono = computed(() => {
    const pii = this.telefonosPii();
    const manual = this.manualTelefono();
    const ids = new Set<string>();
    for (let i = 0; i < this.destinatarios().length; i += 1) {
      const d = this.destinatarios()[i];
      const id = d.actorId;
      if (!id) continue;
      if (manual[id]) continue;
      if (d.telefono) continue;
      if (pii[id]) continue;
      ids.add(id);
    }
    return [...ids];
  });

  readonly haySinTelefonoVisible = computed(() =>
    this.destinatarios().some((d, i) => !this.telefonoDe(d, i)),
  );

  readonly contactablesCanal = computed<DestinatarioMensaje[]>(() => {
    const canal = this.canal();
    return this.destinatarios().filter((d, i) =>
      canal === 'whatsapp' ? !!this.telefonoDe(d, i) : !!this.correoDe(d, i),
    );
  });

  readonly contactablesCorreo = computed<DestinatarioMensaje[]>(() =>
    this.destinatarios().filter((d, i) => !!this.correoDe(d, i)),
  );

  readonly hayDestinatariosContactables = computed(() => this.contactablesCanal().length > 0);

  /** ¿Hay ediciones sin guardar? Gobierna si el velo/Escape pueden cerrar. */
  readonly hayCambios = computed(
    () =>
      this.mensaje().trim().length > 0 ||
      this.asunto().trim() !== ASUNTO_INICIAL ||
      Object.keys(this.manualTelefono()).length > 0 ||
      Object.keys(this.manualCorreo()).length > 0,
  );

  private readonly piiPedida = new Set<string>();
  private tokenBusqueda = 0;
  private temporizadorBusqueda?: ReturnType<typeof setTimeout>;

  constructor() {
    this.destruccion.onDestroy(() => clearTimeout(this.temporizadorBusqueda));
  }

  /**
   * Pide la PII en lote sólo al abrir y sólo si el perfil puede verla. Los ids
   * ya pedidos no se repiten aunque el panel se cierre y vuelva a abrirse.
   */
  private readonly pedirPii = effect(() => {
    if (!this.abierto() || !this.puedeVerPii()) return;
    const nuevos = this.idsSinTelefono().filter((id) => !this.piiPedida.has(id));
    if (nuevos.length === 0) return;
    for (const id of nuevos) this.piiPedida.add(id);
    void this.cargarPii(nuevos);
  });

  resumenContexto(): string {
    const contexto = this.contexto();
    const total = this.destinatarios().length;
    if (contexto) return `${contexto} · ${total} ${total === 1 ? 'destinatario' : 'destinatarios'}`;
    return `${total} ${total === 1 ? 'destinatario' : 'destinatarios'}`;
  }

  avisoCanal(): string {
    if (this.canal() === 'whatsapp') {
      return 'El enlace abre WhatsApp con el mensaje preparado. Revisa cada destinatario; no se abren pestañas de golpe.';
    }
    if (this.canal() === 'correo') {
      return 'Se abre tu cliente de correo con el mensaje preparado para cada destinatario.';
    }
    return 'El correo sale de la cuenta institucional del Ministerio. Si esa cuenta no está configurada, la API responde 503 y aquí se muestra el aviso.';
  }

  claveDe(d: DestinatarioMensaje, indice: number): string {
    return d.actorId || `n:${d.nombre}` || `fila-${indice}`;
  }

  telefonoDe(d: DestinatarioMensaje, indice: number): string {
    const clave = this.claveDe(d, indice);
    const manual = this.manualTelefono();
    if (clave in manual) return manual[clave];
    if (d.telefono) return d.telefono;
    if (d.actorId) return this.telefonosPii()[d.actorId] ?? '';
    return '';
  }

  correoDe(d: DestinatarioMensaje, indice: number): string {
    const clave = this.claveDe(d, indice);
    const manual = this.manualCorreo();
    if (clave in manual) return manual[clave];
    return d.correo ?? '';
  }

  estadoContacto(d: DestinatarioMensaje, indice: number): string {
    if (this.canal() === 'whatsapp') {
      if (this.telefonoDe(d, indice)) return 'Listo para WhatsApp';
      return d.actorId && !this.puedeVerPii() ? 'Sin teléfono visible' : 'Sin teléfono registrado';
    }
    return this.correoDe(d, indice) ? 'Listo para correo' : 'Sin correo registrado';
  }

  enlaceWhatsApp(telefono: string): string {
    const destino = digitosTelefono(telefono);
    return `https://wa.me/${destino}?text=${encodeURIComponent(this.mensaje().trim())}`;
  }

  enlaceCorreo(correo: string): string {
    const asunto = encodeURIComponent(this.asunto().trim());
    const cuerpo = encodeURIComponent(this.mensaje().trim());
    return `mailto:${correo}?subject=${asunto}&body=${cuerpo}`;
  }

  cambiarCanal(canal: CanalMensaje): void {
    this.canal.set(canal);
    this.aviso.set(null);
  }

  cambiarTelefono(d: DestinatarioMensaje, indice: number, evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    const clave = this.claveDe(d, indice);
    this.manualTelefono.update((actual) => ({ ...actual, [clave]: valor }));
  }

  cambiarCorreo(d: DestinatarioMensaje, indice: number, evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    const clave = this.claveDe(d, indice);
    this.manualCorreo.update((actual) => ({ ...actual, [clave]: valor }));
  }

  quitar(indice: number): void {
    const siguiente = this.destinatarios().filter((_, posicion) => posicion !== indice);
    this.destinatariosCambio.emit(siguiente);
  }

  agregar(destinatario: DestinatarioMensaje): void {
    const yaEsta =
      !!destinatario.actorId &&
      this.destinatarios().some((existente) => existente.actorId === destinatario.actorId);
    if (!yaEsta) {
      this.destinatariosCambio.emit([...this.destinatarios(), destinatario]);
    }
    this.busqueda.set('');
    this.resultados.set([]);
  }

  alBuscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.busqueda.set(valor);
    clearTimeout(this.temporizadorBusqueda);
    this.temporizadorBusqueda = setTimeout(() => void this.buscar(valor), 250);
  }

  cerrarPanel(): void {
    this.cerrar.emit();
  }

  /** Escape cierra sólo si no hay cambios. */
  intentarCerrar(): void {
    if (this.hayCambios()) return;
    this.cerrar.emit();
  }

  /** El clic dentro del cajón también burbujea: sólo cierra si nació en el velo. */
  alFondo(evento: Event): void {
    if (evento.target !== evento.currentTarget) return;
    this.intentarCerrar();
  }

  estadoEnvio(clave: string): 'enviando' | 'enviado' | 'error' | null {
    return this.enviando()[clave] ?? null;
  }

  puedeEnviarInstitucional(d: DestinatarioMensaje, indice: number): boolean {
    const clave = this.claveDe(d, indice);
    return (
      !!this.correoDe(d, indice) &&
      this.mensaje().trim().length > 0 &&
      this.asunto().trim().length > 0 &&
      this.estadoEnvio(clave) !== 'enviando'
    );
  }

  async enviarInstitucional(d: DestinatarioMensaje, indice: number): Promise<void> {
    if (!this.puedeEnviarInstitucional(d, indice)) return;
    const clave = this.claveDe(d, indice);
    await this.enviarCorreo(clave, this.correoDe(d, indice));
  }

  /** Envío institucional a todos los destinatarios con correo, uno por uno. */
  async enviarInstitucionalATodos(): Promise<void> {
    const destinatarios = this.destinatarios();
    for (let i = 0; i < destinatarios.length; i += 1) {
      const d = destinatarios[i];
      if (!this.puedeEnviarInstitucional(d, i)) continue;
      await this.enviarCorreo(this.claveDe(d, i), this.correoDe(d, i));
    }
  }

  private async enviarCorreo(clave: string, correo: string): Promise<void> {
    this.marcarEstado(clave, 'enviando');
    this.aviso.set(null);
    try {
      await firstValueFrom(
        this.http.post<unknown>(urlApi('/v1/mensajes/correo'), {
          destinatario: correo,
          asunto: this.asunto().trim(),
          cuerpo: this.mensaje().trim(),
        }),
      );
      this.marcarEstado(clave, 'enviado');
      this.aviso.set({ tipo: 'exito', texto: `Correo enviado a ${correo}.` });
    } catch (fallo) {
      this.marcarEstado(clave, 'error');
      const error = aErrorApi(fallo, 'No se pudo enviar el correo institucional.');
      const texto =
        error.estado === 503 || error.codigo === 'CONFIG_MISSING'
          ? 'Correo institucional no configurado.'
          : error.message;
      this.aviso.set({ tipo: 'error', texto });
    }
  }

  private marcarEstado(clave: string, estado: 'enviando' | 'enviado' | 'error'): void {
    this.enviando.update((actual) => ({ ...actual, [clave]: estado }));
  }

  private async buscar(texto: string): Promise<void> {
    const termino = texto.trim();
    this.tokenBusqueda += 1;
    const token = this.tokenBusqueda;
    this.errorBusqueda.set(null);

    if (termino.length < MIN_BUSQUEDA) {
      this.resultados.set([]);
      this.buscando.set(false);
      return;
    }

    this.buscando.set(true);
    try {
      const bruto = await firstValueFrom(
        this.http.get<unknown>(
          urlConParametros(urlApi('/v1/actors'), {
            q: termino,
            ...paramsDePagina({ pagina: 1, tamano: 8 }),
          }),
        ),
      );
      if (token !== this.tokenBusqueda) return;
      const coleccion = normalizarColeccion<unknown>(bruto);
      this.resultados.set(
        coleccion.elementos
          .map(aDestinatarioBusqueda)
          .filter((d): d is DestinatarioMensaje => d !== null),
      );
    } catch (fallo) {
      if (token !== this.tokenBusqueda) return;
      this.errorBusqueda.set(aErrorApi(fallo, 'No se pudo buscar destinatarios.').message);
    } finally {
      if (token === this.tokenBusqueda) this.buscando.set(false);
    }
  }

  private async cargarPii(ids: string[]): Promise<void> {
    this.cargandoPii.set(true);
    this.errorPii.set(null);
    try {
      for (let inicio = 0; inicio < ids.length; inicio += LOTE_PII) {
        const lote = ids.slice(inicio, inicio + LOTE_PII);
        const bruto = await firstValueFrom(
          this.http.post<unknown>(urlApi('/v1/actors/pii'), { ids: lote, motivo: MOTIVO_PII }),
        );
        const telefonos = telefonosDeLote(bruto);
        if (Object.keys(telefonos).length > 0) {
          this.telefonosPii.update((actual) => ({ ...actual, ...telefonos }));
        }
      }
    } catch (fallo) {
      this.errorPii.set(aErrorApi(fallo, 'No se pudieron leer los teléfonos.').message);
    } finally {
      this.cargandoPii.set(false);
    }
  }
}
