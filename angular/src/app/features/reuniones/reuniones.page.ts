import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { aErrorApi } from '../../core/http/errores';

type Canal = 'whatsapp' | 'correo' | 'institucional';

type Aviso = { tipo: 'exito' | 'error'; texto: string };

/**
 * Gestión de reuniones.
 *
 * La base no tiene reuniones registradas (`core.reuniones_dialogo` está vacía),
 * así que el listado declara el vacío en vez de inventar filas. Lo que sí es
 * funcional es el envío del mensaje: el compositor arma enlaces `wa.me` y
 * `mailto:` con el destinatario que escribe la persona usuaria, sin tomar
 * contactos de fichas ni suponer a quién corresponde el mensaje.
 *
 * El canal «correo institucional» envía de verdad desde el servidor con la
 * cuenta de Gmail del Ministerio; si esa cuenta no está configurada, la API
 * responde 503 y aquí se muestra el aviso honesto en vez de simular el envío.
 */
@Component({
  selector: 'app-reuniones',
  imports: [RouterLink],
  template: `
    <section class="view-body" aria-labelledby="titulo-reuniones">
      <header class="view-head">
        <div>
          <h1 id="titulo-reuniones">Reuniones</h1>
        </div>
        <div class="view-actions">
          <a class="button-secondary" routerLink="/resultados">Ver resultados</a>
        </div>
      </header>

      <section class="surface panel" aria-labelledby="titulo-mensaje">
        <div class="surface-heading">
          <div>
            <h3 id="titulo-mensaje">Enviar mensaje a participantes</h3>
            <p>
              El mensaje se envía desde su WhatsApp, su cliente de correo o la cuenta institucional
              del Ministerio. No se toman contactos de fichas: escriba el destinatario.
            </p>
          </div>
        </div>

        <div class="compositor">
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

          <label class="campo">
            {{
              canal() === 'whatsapp' ? 'Teléfono (con código de país)' : 'Correo del destinatario'
            }}
            <input
              type="text"
              [attr.inputmode]="canal() === 'whatsapp' ? 'tel' : 'email'"
              [attr.placeholder]="
                canal() === 'whatsapp' ? '51 999 888 777' : 'nombre@dominio.gob.pe'
              "
              [value]="destinatario()"
              (input)="destinatario.set($any($event.target).value)"
            />
          </label>

          @if (canal() !== 'whatsapp') {
            <label class="campo">
              Asunto
              <input
                type="text"
                [value]="asunto()"
                (input)="asunto.set($any($event.target).value)"
              />
            </label>
          }

          <label class="campo">
            Mensaje
            <textarea
              rows="5"
              [value]="mensaje()"
              (input)="mensaje.set($any($event.target).value)"
            ></textarea>
          </label>

          <div class="compositor-pie">
            @if (!listo()) {
              <p class="compositor-aviso">
                Complete el destinatario y el mensaje para habilitar el envío.
              </p>
            } @else if (canal() === 'institucional') {
              <p class="compositor-aviso">
                El correo saldrá de la cuenta institucional del Ministerio. No se guarda el
                destinatario ni el cuerpo.
              </p>
            } @else {
              <p class="compositor-aviso">
                Se abrirá {{ canal() === 'whatsapp' ? 'WhatsApp' : 'su cliente de correo' }} con el
                mensaje preparado.
              </p>
            }
            @if (canal() === 'whatsapp') {
              <a
                class="button-primary"
                [class.deshabilitado]="!listo()"
                [attr.href]="listo() ? enlaceWhatsApp() : null"
                target="_blank"
                rel="noopener"
              >
                Abrir WhatsApp
              </a>
            } @else if (canal() === 'correo') {
              <a
                class="button-primary"
                [class.deshabilitado]="!listo()"
                [attr.href]="listo() ? enlaceCorreo() : null"
              >
                Abrir correo
              </a>
            } @else {
              <div class="compositor-envio">
                <button
                  type="button"
                  class="button-primary"
                  [disabled]="!puedeEnviarInstitucional()"
                  (click)="enviarInstitucional()"
                >
                  {{ enviando() ? 'Enviando…' : 'Enviar por correo institucional' }}
                </button>
                <a
                  class="button-secondary"
                  [class.deshabilitado]="!listo()"
                  [attr.href]="listo() ? enlaceCorreo() : null"
                >
                  Abrir en su cliente de correo
                </a>
              </div>
            }
          </div>

          @if (aviso(); as avisoActual) {
            <p
              class="compositor-estado"
              [class.compositor-estado-error]="avisoActual.tipo === 'error'"
              role="status"
            >
              {{ avisoActual.texto }}
            </p>
          }
        </div>
      </section>

      <section class="surface panel" aria-labelledby="titulo-listado">
        <div class="surface-heading">
          <div>
            <h3 id="titulo-listado">Reuniones registradas</h3>
            <p>Programadas y realizadas, con su acta vinculada cuando exista.</p>
          </div>
        </div>

        <div class="empty-state">
          <strong>Sin reuniones registradas</strong>
          <p>
            La base no tiene reuniones cargadas todavía. Cuando se registren, aparecerán aquí con su
            fecha, lugar, caso y estado; el acta quedará en Resultados.
          </p>
        </div>
      </section>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    .surface.panel {
      padding: 17px;
    }

    .compositor {
      display: grid;
      gap: 12px;
      max-width: 640px;
    }

    .empty-state p {
      max-width: 620px;
      margin: 8px auto 0;
      color: var(--muted);
      line-height: 1.6;
    }

    .campo {
      display: grid;
      gap: 5px;
      color: var(--ink-2);
      font-size: 13px;
      font-weight: 600;
    }

    .campo input,
    .campo textarea {
      min-width: 0;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--paper, #fff);
      color: var(--ink);
      font: inherit;
      font-weight: 400;
    }

    .campo textarea {
      resize: vertical;
    }

    .campo input:focus-visible,
    .campo textarea:focus-visible {
      outline: 2px solid #3576c5;
      outline-offset: 2px;
    }

    .compositor-pie {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .compositor-aviso {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
    }

    .compositor-pie a {
      text-decoration: none;
    }

    .compositor-envio {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }

    .compositor-estado {
      margin: 0;
      padding: 8px 10px;
      border-radius: 6px;
      background: #edf6ee;
      color: #2f6b3a;
      font-size: 13px;
      line-height: 1.5;
    }

    .compositor-estado-error {
      background: #fdf1ef;
      color: #a34c45;
    }

    .deshabilitado {
      opacity: 0.5;
      pointer-events: none;
    }
  `,
})
export class ReunionesPage {
  private readonly http = inject(HttpClient);

  readonly canal = signal<Canal>('whatsapp');
  readonly destinatario = signal('');
  readonly asunto = signal('Convocatoria a reunión de diálogo');
  readonly mensaje = signal('');

  readonly enviando = signal(false);
  readonly aviso = signal<Aviso | null>(null);

  readonly listo = computed(
    () => this.destinatario().trim().length > 0 && this.mensaje().trim().length > 0,
  );

  readonly puedeEnviarInstitucional = computed(() => {
    const asunto = this.asunto().trim();
    return this.listo() && asunto.length > 0 && asunto.length <= 150 && !this.enviando();
  });

  readonly enlaceWhatsApp = computed(() => {
    const telefono = this.destinatario().replace(/[^\d]/g, '');
    return `https://wa.me/${telefono}?text=${encodeURIComponent(this.mensaje().trim())}`;
  });

  readonly enlaceCorreo = computed(() => {
    const asunto = encodeURIComponent(this.asunto().trim());
    const cuerpo = encodeURIComponent(this.mensaje().trim());
    return `mailto:${this.destinatario().trim()}?subject=${asunto}&body=${cuerpo}`;
  });

  cambiarCanal(canal: Canal): void {
    this.canal.set(canal);
    this.aviso.set(null);
  }

  /**
   * Envía el mensaje desde la cuenta institucional. La API no toma el
   * destinatario de la base: es exactamente el que se escribió aquí.
   */
  async enviarInstitucional(): Promise<void> {
    if (!this.puedeEnviarInstitucional()) return;

    this.enviando.set(true);
    this.aviso.set(null);

    try {
      await firstValueFrom(
        this.http.post<unknown>(urlApi('/v1/mensajes/correo'), {
          destinatario: this.destinatario().trim(),
          asunto: this.asunto().trim(),
          cuerpo: this.mensaje().trim(),
        }),
      );
      this.aviso.set({
        tipo: 'exito',
        texto: 'Correo enviado desde la cuenta institucional.',
      });
    } catch (fallo) {
      this.aviso.set({ tipo: 'error', texto: this.mensajeDeEnvio(fallo) });
    } finally {
      this.enviando.set(false);
    }
  }

  private mensajeDeEnvio(fallo: unknown): string {
    const error = aErrorApi(fallo, 'No se pudo enviar el correo institucional.');
    if (error.estado === 503 || error.codigo === 'CONFIG_MISSING') {
      return 'Correo institucional no configurado.';
    }
    return error.message;
  }
}
