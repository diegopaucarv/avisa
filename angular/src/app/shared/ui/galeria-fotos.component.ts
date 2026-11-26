import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';

import { urlApi } from '../../core/config/entorno';
import { normalizarColeccion, urlConParametros } from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';

import {
  aFoto,
  esFotoPintable,
  fotoPrincipal,
  type Foto,
  type MedioEntidadTipo,
} from '../../dominio/medios';

/**
 * Galería fotográfica de una entidad del directorio (actor, organización o
 * local).
 *
 * Carga sus propias fotos de `GET /api/v1/media` a partir de `entidadTipo` +
 * `entidadId`, así que insertarla en una ficha no obliga a tocar el componente
 * que la hospeda. Admite más de una foto por entidad: la principal arriba y las
 * demás como miniaturas seleccionables.
 *
 * Sin fotos se declara «Sin fotografías»; no se siembra ninguna imagen.
 */
@Component({
  selector: 'app-galeria-fotos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (cargando()) {
      <p class="galeria-estado" role="status">Cargando fotografías…</p>
    } @else if (error(); as fallo) {
      <p class="galeria-estado" role="alert">
        No se pudieron cargar las fotografías. {{ fallo.message }}
      </p>
    } @else if (fotos().length === 0) {
      <p class="galeria-vacia">Sin fotografías.</p>
    } @else if (activa(); as foto) {
      <figure class="galeria-principal">
        <img
          [src]="foto.url"
          [alt]="foto.alt || foto.titulo || 'Fotografía'"
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
        />
        <figcaption>
          @if (foto.titulo) {
            <strong>{{ foto.titulo }}</strong>
          }
          @if (foto.credito) {
            <span>{{ foto.credito }}</span>
          }
          @if (!foto.titulo && !foto.credito) {
            <a [href]="foto.url" target="_blank" rel="noopener">Abrir original</a>
          }
        </figcaption>
      </figure>

      @if (fotos().length > 1) {
        <div class="galeria-miniaturas" role="group" aria-label="Miniaturas de la galería">
          @for (miniatura of fotos(); track miniatura.id) {
            <button
              type="button"
              [attr.aria-pressed]="miniatura.id === foto.id"
              [attr.aria-label]="'Ver la fotografía ' + (miniatura.titulo || miniatura.id)"
              (click)="seleccionar(miniatura)"
            >
              <img
                [src]="miniatura.url"
                [alt]="miniatura.alt || miniatura.titulo || 'Miniatura'"
                loading="lazy"
                decoding="async"
                referrerpolicy="no-referrer"
              />
            </button>
          }
        </div>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .galeria-estado,
    .galeria-vacia {
      margin: 0;
      color: #8d99a6;
      font-size: 12.5px;
      line-height: 1.5;
    }

    .galeria-vacia {
      padding: 9px 11px;
      border: 1px dashed #dfe6ec;
      border-radius: 8px;
      background: #fafcfd;
    }

    .galeria-principal {
      display: flex;
      flex-direction: column;
      gap: 5px;
      margin: 0;
    }

    .galeria-principal img {
      display: block;
      width: 100%;
      max-height: 260px;
      object-fit: cover;
      border: 1px solid #e6ecf1;
      border-radius: 8px;
      background: #f6f8fa;
    }

    .galeria-principal figcaption {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      color: #52677a;
      font-size: 12px;
    }

    .galeria-principal figcaption strong {
      color: #33475b;
    }

    .galeria-principal figcaption a {
      color: #2f6fb0;
    }

    .galeria-miniaturas {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .galeria-miniaturas button {
      width: 56px;
      height: 56px;
      padding: 0;
      overflow: hidden;
      border: 2px solid transparent;
      border-radius: 7px;
      background: #f6f8fa;
      cursor: pointer;
    }

    .galeria-miniaturas button[aria-pressed='true'] {
      border-color: #2f6fb0;
    }

    .galeria-miniaturas img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
})
export class GaleriaFotosComponent {
  readonly entidadTipo = input.required<MedioEntidadTipo>();
  readonly entidadId = input.required<string>();

  private readonly recurso = consulta<readonly Foto[]>({
    fuente: () => {
      const tipo = this.entidadTipo();
      const id = this.entidadId();
      if (!tipo || !id) return null;
      return urlConParametros(urlApi('/v1/media'), {
        entidadTipo: tipo,
        entidadId: id,
        pageSize: '100',
        tamano: '100',
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return coleccion.elementos.map(aFoto).filter(esFotoPintable);
    },
  });

  readonly fotos = computed(() => this.recurso.valor() ?? []);
  readonly cargando = computed(() => this.recurso.estado() === 'cargando');
  readonly error = this.recurso.error;

  /** Foto que ocupa el marco principal; la primera, salvo que se elija otra. */
  private readonly elegidaId = signal<string | null>(null);

  readonly activa = computed(() => {
    const principal = fotoPrincipal(this.fotos());
    if (!principal) return null;
    const elegida = this.elegidaId();
    if (!elegida) return principal;
    return this.fotos().find((foto) => foto.id === elegida) ?? principal;
  });

  seleccionar(foto: Foto): void {
    this.elegidaId.set(foto.id);
  }
}
