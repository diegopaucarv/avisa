import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Subscription } from 'rxjs';

import {
  AdjuntosService,
  MAX_ADJUNTO_BYTES,
  type Adjunto,
  type EntidadAdjunto,
} from '../../core/http/adjuntos.service';
import { aErrorApi } from '../../core/http/errores';
import { formatearFechaHora } from '../formato-fecha';

/**
 * Panel de adjuntos reutilizable.
 *
 * Se monta en cualquier ficha con la entidad dueña:
 * `<app-adjuntos-panel entidadTipo="alerta" [entidadId]="alerta().id" />`.
 * El binario lo sirve `GET /api/v1/adjuntos/:id`; la lista blanca y el límite
 * de 20 MB los impone la API, no esta pantalla.
 */
@Component({
  selector: 'app-adjuntos-panel',
  templateUrl: './adjuntos-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    .adjuntos {
      border: 1px solid var(--line, #e6ebef);
      border-radius: 10px;
      background: var(--paper, #fff);
      padding: 14px 16px;
    }

    .adjuntos-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }

    h3 {
      margin: 0;
      color: var(--ink, #17283a);
      font: 700 14px/1.2 var(--font-display, system-ui);
    }

    .cuenta {
      margin-left: 6px;
      padding: 1px 7px;
      border-radius: 999px;
      background: var(--blue-pale, #eaf1fb);
      color: var(--blue-dark, #1d427f);
      font-size: 11.5px;
      font-variant-numeric: tabular-nums;
    }

    .nota {
      margin: 0;
      color: var(--muted, #778797);
      font-size: 13px;
      line-height: 1.5;
    }

    .error {
      margin: 0 0 8px;
      padding: 7px 10px;
      border-left: 3px solid var(--red, #ad4d46);
      background: var(--red-pale, #fbeceb);
      color: var(--red, #ad4d46);
      font-size: 12.5px;
    }

    .lista {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .lista li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      border-top: 1px solid var(--line, #e6ebef);
    }

    .lista li:first-child {
      border-top: 0;
    }

    .nombre {
      min-width: 0;
      flex: 1 1 180px;
      overflow: hidden;
      color: var(--ink-2, #33475b);
      font-size: 13px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .meta {
      color: var(--muted, #778797);
      font-size: 11.5px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .acciones {
      display: flex;
      gap: 4px;
    }

    .acciones button,
    .adjuntar {
      min-height: 28px;
      padding: 0 9px;
      border: 1px solid var(--line, #e6ebef);
      border-radius: 7px;
      background: var(--paper, #fff);
      color: var(--blue-dark, #1d427f);
      font: 600 12px/1 var(--font-body, system-ui);
      cursor: pointer;
    }

    .acciones button:hover,
    .adjuntar:hover {
      background: var(--blue-pale, #eaf1fb);
    }

    .acciones button:focus-visible,
    .adjuntar:focus-visible {
      outline: 2px solid var(--blue, #2455a2);
      outline-offset: 1px;
    }

    .adjuntar {
      border-color: var(--blue, #2455a2);
      background: var(--blue, #2455a2);
      color: #fff;
    }

    .adjuntar:disabled {
      opacity: 0.6;
      cursor: progress;
    }

    .oculto {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `,
})
export class AdjuntosPanelComponent {
  readonly entidadTipo = input.required<EntidadAdjunto>();
  readonly entidadId = input.required<string>();
  readonly titulo = input('Adjuntos');
  readonly editable = input(true);

  private readonly servicio = inject(AdjuntosService);
  private readonly destroyRef = inject(DestroyRef);
  private suscripcion?: Subscription;

  readonly adjuntos = signal<Adjunto[]>([]);
  readonly cargando = signal(false);
  readonly subiendo = signal(false);
  readonly error = signal<string | null>(null);

  readonly aceptados =
    '.pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,.docx,.xlsx,.pptx';

  constructor() {
    effect(() => {
      const tipo = this.entidadTipo();
      const id = this.entidadId();
      if (!tipo || !id) return;
      this.cargar(tipo, id);
    });

    this.destroyRef.onDestroy(() => this.suscripcion?.unsubscribe());
  }

  alSeleccionar(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const archivo = entrada.files?.[0] ?? null;
    entrada.value = '';
    if (!archivo) return;

    if (archivo.size > MAX_ADJUNTO_BYTES) {
      this.error.set('El archivo supera el máximo de 20 MB.');
      return;
    }

    this.error.set(null);
    this.subiendo.set(true);
    this.servicio
      .subir(this.entidadTipo(), this.entidadId(), archivo)
      .subscribe({
        next: (adjunto) => {
          this.adjuntos.update((lista) => [adjunto, ...lista]);
          this.subiendo.set(false);
        },
        error: (fallo: unknown) => {
          this.error.set(aErrorApi(fallo, 'No se pudo subir el adjunto.').message);
          this.subiendo.set(false);
        },
      });
  }

  async descargar(adjunto: Adjunto): Promise<void> {
    this.error.set(null);
    try {
      await this.servicio.descargar(adjunto);
    } catch (fallo) {
      this.error.set(aErrorApi(fallo, 'No se pudo descargar el adjunto.').message);
    }
  }

  eliminar(adjunto: Adjunto): void {
    const motivo = window.prompt(
      'Motivo para eliminar el adjunto',
      'Adjunto retirado desde la ficha',
    );
    if (!motivo || !motivo.trim()) return;

    this.error.set(null);
    this.servicio.eliminar(adjunto.id, motivo.trim()).subscribe({
      next: () => {
        this.adjuntos.update((lista) => lista.filter((item) => item.id !== adjunto.id));
      },
      error: (fallo: unknown) => {
        this.error.set(aErrorApi(fallo, 'No se pudo eliminar el adjunto.').message);
      },
    });
  }

  tamano(adjunto: Adjunto): string {
    const bytes = adjunto.tamanoBytes;
    if (bytes === null) return 'tamaño sin declarar';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) {
      return `${new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 }).format(bytes / 1024)} kB`;
    }
    return `${new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
  }

  fecha(valor: string): string {
    return formatearFechaHora(valor);
  }

  private cargar(tipo: EntidadAdjunto, id: string): void {
    this.suscripcion?.unsubscribe();
    this.cargando.set(true);
    this.error.set(null);

    this.suscripcion = this.servicio.listar(tipo, id).subscribe({
      next: (items) => {
        this.adjuntos.set(items);
        this.cargando.set(false);
      },
      error: (fallo: unknown) => {
        this.adjuntos.set([]);
        this.error.set(aErrorApi(fallo, 'No se pudieron cargar los adjuntos.').message);
        this.cargando.set(false);
      },
    });
  }
}
