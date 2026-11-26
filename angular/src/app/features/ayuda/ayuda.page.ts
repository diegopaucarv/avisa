import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';

import { IconoComponent } from '../../shared/ui/icono.component';
import { SECCIONES_AYUDA, type SeccionAyuda } from './ayuda.contenido';

/** Minúsculas y sin diacríticos: «Crítica» y «critica» deben coincidir. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Ayuda y criterios (consulta normativa).
 *
 * No llama a la API: el contenido vive en `ayuda.contenido.ts` y se filtra en
 * el cliente. Cada sección y cada entrada conserva un `id` estable para que el
 * índice funcione con anclas.
 */
@Component({
  selector: 'app-ayuda',
  imports: [IconoComponent],
  templateUrl: './ayuda.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    .view-body {
      display: flex;
      flex-direction: column;
      gap: 14px;
      width: 100%;
      max-width: 1420px;
      margin: 0 auto;
      padding: 27px 34px 50px;
      box-sizing: border-box;
    }

    .view-head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }



    /* El estilo global de .help-nav sólo cubre button; aquí el índice son anclas. */
    .help-nav a {
      padding: 6px 8px;
      border-radius: 6px;
      color: var(--muted);
      font-size: 13px;
      text-decoration: none;
    }

    .help-nav a:hover,
    .help-nav a:focus-visible {
      color: var(--blue);
      text-decoration: underline;
    }

    .help-section .help-fuente {
      margin: 0 0 8px;
      color: var(--muted);
      font-size: 12px;
    }

    @media (max-width: 720px) {
      .view-body {
        padding: 18px 16px 40px;
      }
    }
  `,
})
export class AyudaPage {
  readonly secciones = SECCIONES_AYUDA;

  readonly busqueda = signal('');

  /** Filtro local: por título de sección o por cualquier texto de la entrada. */
  readonly seccionesFiltradas = computed<SeccionAyuda[]>(() => {
    const consulta = normalizar(this.busqueda().trim());
    if (!consulta) return [...SECCIONES_AYUDA];

    return SECCIONES_AYUDA.map((seccion) => {
      if (normalizar(seccion.titulo).includes(consulta)) return seccion;

      const entradas = seccion.entradas.filter((entrada) => {
        const texto = [entrada.termino, entrada.definicion, ...(entrada.detalles ?? [])].join(' ');
        return normalizar(texto).includes(consulta);
      });

      return entradas.length ? { ...seccion, entradas } : null;
    }).filter((seccion): seccion is SeccionAyuda => seccion !== null);
  });

  readonly totalEntradas = computed(() =>
    this.seccionesFiltradas().reduce((total, seccion) => total + seccion.entradas.length, 0),
  );

  buscar(evento: Event): void {
    this.busqueda.set((evento.target as HTMLInputElement).value);
  }

  limpiar(): void {
    this.busqueda.set('');
  }
}
