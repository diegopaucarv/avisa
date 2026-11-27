import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Iconos en SVG inline, con los mismos trazos que `lucide` usa en la UI React.
 *
 * Se guardan como listas de `d` para poder recorrerlas con `@for` y evitar
 * `innerHTML` (que obligaría a confiar en el saneador). Trazo 1,8 y viewBox
 * 24×24: idénticos al original.
 */
const TRAZOS: Record<string, readonly string[]> = {
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  cerrar: ['M18 6 6 18', 'M6 6l12 12'],
  'chevron-abajo': ['m6 9 6 6 6-6'],
  'chevron-derecha': ['m9 18 6-6-6-6'],
  'chevron-izquierda': ['m15 18-6-6 6-6'],
  cuadricula: ['M3 3h18v18H3z', 'M3 12h18', 'M12 3v18'],
  bandeja: [
    'M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z',
    'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2',
    'M9 14l2 2 4-4',
  ],
  casos: [
    'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z',
  ],
  alertas: [
    'M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.7 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.5 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z',
    'M12 8v4',
    'M12 16h.01',
  ],
  compromisos: [
    'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z',
    'M14 2v4a2 2 0 0 0 2 2h4',
    'M16 13H8',
    'M16 17H8',
    'M10 9H8',
  ],
  documentos: [
    'M15 2H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V6z',
    'M14 2v4a2 2 0 0 0 2 2h4',
    'M18 22h1a2 2 0 0 0 2-2V9',
  ],
  actores: [
    'M18 21a8 8 0 0 0-16 0',
    'M10 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10',
    'M22 20c0-3.4-2-6.5-4-8a5 5 0 0 0-.5-8.3',
  ],
  organizaciones: [
    'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18',
    'M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2',
    'M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2',
    'M10 6h4',
    'M10 10h4',
    'M10 14h4',
    'M10 18h4',
  ],
  instituciones: [
    'M3 22h18',
    'M6 18v-7',
    'M10 18v-7',
    'M14 18v-7',
    'M18 18v-7',
    'M12 2 3.5 6.2c-.5.2-.5.8 0 1h17c.5-.2.5-.8 0-1z',
  ],
  mapa: [
    'M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0',
    'M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  ],
  analisis: ['M3 3v18h18', 'M18 17V9', 'M13 17V5', 'M8 17v-3'],
  papelera: [
    'M3 6h18',
    'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
    'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
    'M10 11v6',
    'M14 11v6',
  ],
  archivo: [
    'M3 3h18a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
    'M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8',
    'M10 12h4',
  ],
  ayuda: [
    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20',
    'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3',
    'M12 17h.01',
  ],
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20', 'M12 16v-4', 'M12 8h.01'],
  ajustes: [
    'M20 7h-9',
    'M14 17H5',
    'M17 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
    'M7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  ],
  actividad: ['M22 12h-4l-3 9L9 3l-3 9H2'],
  buscar: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16', 'M21 21l-4.3-4.3'],
  salir: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  escudo: [
    'M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.7 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.5 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z',
    'm9 12 2 2 4-4',
  ],
  candado: ['M3 10h18v12H3z', 'M7 10V7a5 5 0 0 1 10 0v3', 'M12 15v2'],
  campana: [
    'M10.3 21a2 2 0 0 0 3.4 0',
    'M3.3 15.3A1 1 0 0 0 4 17h16a1 1 0 0 0 .7-1.7C19.4 14 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.4 6-2.7 7.3',
  ],
  reloj: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20', 'M12 6v6l4 2'],
  alerta: [
    'M12 9v4',
    'M12 17h.01',
    'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  ],
  check: ['M20 6 9 17l-5-5'],
  carpeta: [
    'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z',
  ],
  ojo: [
    'M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0',
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  ],
  lapiz: [
    'M21.17 6.83a2.83 2.83 0 0 0-4-4L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z',
    'm15 5 4 4',
  ],
  copiar: [
    'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
    'M20 8H10a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2z',
  ],
  'reloj-mas': ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20', 'M12 8v8', 'M8 12h8'],
  menos: ['M5 12h14'],
  pin: [
    'M12 17v5',
    'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
  ],
  punto: [],
};

@Component({
  selector: 'app-icono',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="tamano()"
      [attr.height]="tamano()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="grosor()"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      @for (trazo of trazos(); track $index) {
        <path [attr.d]="trazo" />
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      line-height: 0;
    }
  `,
})
export class IconoComponent {
  readonly nombre = input.required<string>();
  readonly tamano = input<number>(17);
  readonly grosor = input<number>(1.8);

  readonly trazos = computed(() => TRAZOS[this.nombre()] ?? TRAZOS['punto']);
}
