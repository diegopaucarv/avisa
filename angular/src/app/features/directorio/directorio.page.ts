import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { IconoComponent } from '../../shared/ui/icono.component';

/**
 * Directorio · portada visual (item 108).
 *
 * Tres accesos con ícono y botón. Cada uno lleva a su matriz, que sigue en su
 * propia ruta: la portada reordena la entrada, no reescribe el CRUD. Los enlaces
 * directos a las matrices —incluido `/directorio/actores?q=…` de la ficha del
 * caso— siguen funcionando sin pasar por aquí.
 */
@Component({
  selector: 'app-directorio',
  imports: [RouterLink, IconoComponent],
  templateUrl: './directorio.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    .view-body {
      display: flex;
      flex-direction: column;
      gap: 18px;
      width: 100%;
      max-width: 1420px;
      margin: 0 auto;
      padding: 27px 34px 50px;
      box-sizing: border-box;
    }

    .view-head h1 {
      margin: 0;
      color: #1a2b3e;
      font: 700 22px/1.3 var(--font-display);
      letter-spacing: -0.65px;
    }

    .view-subtitle {
      max-width: 760px;
      margin: 6px 0 0;
      color: #7b8896;
      font-size: 11px;
      line-height: 1.6;
    }

    .directorio-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
    }

    .directorio-card {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 168px;
      padding: 18px 16px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fff;
      color: inherit;
      text-decoration: none;
      transition:
        border-color 0.15s ease,
        box-shadow 0.15s ease,
        transform 0.15s ease;
    }

    .directorio-card:hover,
    .directorio-card:focus-visible {
      border-color: var(--blue);
      box-shadow: 0 8px 22px rgba(35, 56, 77, 0.1);
      transform: translateY(-1px);
      outline: none;
    }

    .directorio-icono {
      width: 42px;
      height: 42px;
      display: grid;
      place-items: center;
      border-radius: 10px;
      background: var(--blue-pale);
      color: var(--blue);
    }

    .directorio-copy {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .directorio-copy strong {
      color: #1c2a38;
      font: 700 15px/1.25 var(--font-display);
    }

    .directorio-copy span {
      color: #7b8896;
      font-size: 10.5px;
      line-height: 1.5;
    }

    .directorio-boton {
      margin-top: auto;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--blue-dark);
      font-size: 10.5px;
      font-weight: 700;
    }

    @media (max-width: 720px) {
      .view-body {
        padding: 18px 16px 40px;
      }
    }
  `,
})
export class DirectorioPage {
  readonly accesos = [
    {
      etiqueta: 'Personas',
      ruta: '/directorio/personas',
      icono: 'actores',
      descripcion:
        'Personas vinculadas a los casos, con su perfil de diálogo y galería fotográfica.',
    },
    {
      etiqueta: 'Organizaciones',
      ruta: '/directorio/organizaciones',
      icono: 'organizaciones',
      descripcion: 'Organizaciones sociales, gremiales y entidades públicas del territorio.',
    },
    {
      etiqueta: 'Locales',
      ruta: '/directorio/locales',
      icono: 'mapa',
      descripcion: 'Sedes de reunión por región, con aforo y contacto del local.',
    },
  ] as const;
}
