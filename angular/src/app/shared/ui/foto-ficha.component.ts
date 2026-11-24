import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

/**
 * Fotografía de una ficha del directorio.
 *
 * `foto_url` guarda enlaces externos (hoy, Google Drive) que sirven la imagen
 * directamente con `Content-Type: image/*`, así que se pinta con `<img>` en vez
 * de mostrar la URL como texto. Si la imagen no carga se avisa y se mantiene el
 * enlace al original.
 */
@Component({
  selector: 'app-foto-ficha',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="foto">
      @if (fallo()) {
        <p class="foto-fallo" role="status">
          No se pudo cargar la imagen; el original sigue disponible en el enlace.
        </p>
      } @else {
        <img
          [src]="src()"
          [alt]="alt()"
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
          (error)="marcarFallo()"
        />
      }
      <figcaption>
        <a [href]="src()" target="_blank" rel="noopener">Abrir original</a>
      </figcaption>
    </figure>
  `,
  styles: `
    :host {
      display: block;
    }

    .foto {
      display: flex;
      flex-direction: column;
      gap: 5px;
      margin: 0;
    }

    .foto img {
      display: block;
      width: 100%;
      max-height: 240px;
      object-fit: cover;
      border: 1px solid #e6ecf1;
      border-radius: 8px;
      background: #f6f8fa;
    }

    .foto-fallo {
      margin: 0;
      padding: 9px 11px;
      border: 1px dashed #dfe6ec;
      border-radius: 8px;
      background: #fafcfd;
      color: #8d99a6;
      font-size: 12.5px;
      line-height: 1.5;
    }

    figcaption {
      font-size: 12px;
    }

    figcaption a {
      color: #2f6fb0;
    }
  `,
})
export class FotoFichaComponent {
  readonly src = input.required<string>();
  readonly alt = input('');

  /**
   * `src` que falló: guardar el valor, y no un booleano, hace que el error no se
   * arrastre al abrir la ficha de otro registro.
   */
  private readonly srcFallido = signal<string | null>(null);
  readonly fallo = computed(() => this.srcFallido() === this.src());

  marcarFallo(): void {
    this.srcFallido.set(this.src());
  }
}
