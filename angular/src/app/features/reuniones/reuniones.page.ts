import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

type Canal = 'whatsapp' | 'correo';

/**
 * Gestión de reuniones.
 *
 * La base no tiene reuniones registradas (`core.reuniones_dialogo` está vacía),
 * así que el listado declara el vacío en vez de inventar filas. Lo que sí es
 * funcional es el envío del mensaje: el compositor arma enlaces `wa.me` y
 * `mailto:` con el destinatario que escribe la persona usuaria, sin tomar
 * contactos de fichas ni suponer a quién corresponde el mensaje.
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
              El mensaje se envía desde su WhatsApp o su cliente de correo. No se toman contactos de
              fichas: escriba el destinatario.
            </p>
          </div>
        </div>

        <div class="compositor">
          <div class="segmented" role="group" aria-label="Canal de envío">
            <button
              type="button"
              [attr.aria-pressed]="canal() === 'whatsapp'"
              (click)="canal.set('whatsapp')"
            >
              WhatsApp
            </button>
            <button
              type="button"
              [attr.aria-pressed]="canal() === 'correo'"
              (click)="canal.set('correo')"
            >
              Correo
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

          @if (canal() === 'correo') {
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
            } @else {
              <a
                class="button-primary"
                [class.deshabilitado]="!listo()"
                [attr.href]="listo() ? enlaceCorreo() : null"
              >
                Abrir correo
              </a>
            }
          </div>
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

    .compositor {
      display: grid;
      gap: 12px;
      max-width: 640px;
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

    .deshabilitado {
      opacity: 0.5;
      pointer-events: none;
    }
  `,
})
export class ReunionesPage {
  readonly canal = signal<Canal>('whatsapp');
  readonly destinatario = signal('');
  readonly asunto = signal('Convocatoria a reunión de diálogo');
  readonly mensaje = signal('');

  readonly listo = computed(
    () => this.destinatario().trim().length > 0 && this.mensaje().trim().length > 0,
  );

  readonly enlaceWhatsApp = computed(() => {
    const telefono = this.destinatario().replace(/[^\d]/g, '');
    return `https://wa.me/${telefono}?text=${encodeURIComponent(this.mensaje().trim())}`;
  });

  readonly enlaceCorreo = computed(() => {
    const asunto = encodeURIComponent(this.asunto().trim());
    const cuerpo = encodeURIComponent(this.mensaje().trim());
    return `mailto:${this.destinatario().trim()}?subject=${asunto}&body=${cuerpo}`;
  });
}
