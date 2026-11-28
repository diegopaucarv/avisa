import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  viewChild,
} from '@angular/core';

import { IconoComponent } from '../../shared/ui/icono.component';
import { salirModal } from '../../shared/ui/modal-salida';
import { ImportacionService } from './importacion.service';
import { TIPOS_IMPORTACION, tiposPorGrupo } from './importacion.tipos';

/** Filas de detalle que se dibujan; el resto se cuenta. */
const LIMITE_VISIBLE = 40;

/**
 * Panel de importación.
 *
 * Es un asistente de cuatro pasos en una sola pantalla: tipo de hoja, contenido,
 * previsualización con rechazos y aplicación. Se cierra con Escape, con el clic
 * fuera o con la ✕ desde cualquier paso: el estado del asistente vive en
 * `ImportacionService`, así que cerrar no pierde lo ya revisado.
 *
 * El shell lo abre con un tipo concreto desde el menú «Importar» sin pasarle
 * nada.
 */
@Component({
  selector: 'app-importar-panel',
  imports: [IconoComponent],
  templateUrl: './importar-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .importar-cuerpo {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .importar-tipo {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .importar-tipo select {
      height: 36px;
      padding: 0 9px;
      border: 1px solid #e0e5e9;
      border-radius: 6px;
      background: #fff;
      color: #33465a;
      font-size: 13px;
    }

    .importar-descripcion,
    .importar-nota,
    .importar-limite {
      margin: 0;
      color: #647487;
      font-size: 12.5px;
      line-height: 1.55;
    }

    .importar-nota {
      padding: 7px 9px;
      border-left: 3px solid #cfdae6;
      background: #f7f9fb;
      border-radius: 0 6px 6px 0;
    }

    .importar-archivo {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      font-size: 12.5px;
      color: #8d99a6;
    }

    .importar-archivo input[type='file'] {
      max-width: 100%;
      font-size: 12.5px;
    }

    .importar-pegado {
      width: 100%;
      min-height: 120px;
      padding: 8px 10px;
      border: 1px solid #e0e5e9;
      border-radius: 6px;
      font-family: var(--font-mono, monospace);
      font-size: 12.5px;
      line-height: 1.5;
      resize: vertical;
      box-sizing: border-box;
    }

    .importar-acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .importar-resumen {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 16px;
      margin: 0;
      font-size: 12.5px;
      color: #5f7180;
    }

    .importar-resumen b {
      color: #33465a;
      font-variant-numeric: tabular-nums;
    }

    .importar-subtitulo {
      margin: 4px 0 0;
      color: #465a6c;
      font-size: 12.5px;
      font-weight: 700;
    }

    .importar-columnas {
      margin: 0;
      color: #647487;
      font-size: 12px;
      line-height: 1.5;
    }

    .tabla-importar {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    .tabla-importar th,
    .tabla-importar td {
      padding: 5px 6px;
      border-bottom: 1px solid #eef2f6;
      text-align: left;
      vertical-align: top;
    }

    .tabla-importar th {
      color: #8a98a5;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .tabla-importar td.codigo {
      color: #8a98a5;
      font-family: var(--font-mono, monospace);
      font-size: 11px;
      white-space: nowrap;
    }

    /* Rótulo de tabla para lectores de pantalla, sin pintarse. */
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
      border: 0;
    }

    .avance {
      margin: 0;
      color: #315b91;
      font-size: 12.5px;
    }
  `,
})
export class ImportarPanelComponent {
  readonly importacion = inject(ImportacionService);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly destruccion = inject(DestroyRef);

  constructor() {
    // Escape cierra el asistente aunque el foco esté en un campo del paso actual.
    const alEscape = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      this.cerrar();
    };
    document.addEventListener('keydown', alEscape);
    this.destruccion.onDestroy(() => document.removeEventListener('keydown', alEscape));
  }

  readonly grupos = tiposPorGrupo();
  readonly tipos = TIPOS_IMPORTACION;
  readonly limiteVisible = LIMITE_VISIBLE;

  readonly totalValidas = computed(() => this.importacion.validacion()?.validas.length ?? 0);
  readonly rechazos = computed(
    () => this.importacion.validacion()?.rechazos.slice(0, LIMITE_VISIBLE) ?? [],
  );
  readonly rechazosRestantes = computed(() =>
    Math.max(0, (this.importacion.validacion()?.rechazos.length ?? 0) - LIMITE_VISIBLE),
  );
  readonly errores = computed(
    () => this.importacion.resultado()?.errores.slice(0, LIMITE_VISIBLE) ?? [],
  );
  readonly erroresRestantes = computed(() =>
    Math.max(0, (this.importacion.resultado()?.errores.length ?? 0) - LIMITE_VISIBLE),
  );
  readonly advertencias = computed(
    () => this.importacion.resultado()?.advertencias.slice(0, LIMITE_VISIBLE) ?? [],
  );
  readonly advertenciasRestantes = computed(() =>
    Math.max(0, (this.importacion.resultado()?.advertencias.length ?? 0) - LIMITE_VISIBLE),
  );

  /** Rótulo del botón que ejecuta la estrategia del tipo elegido. */
  readonly etiquetaAccion = computed(() => {
    const tipo = this.importacion.tipo();
    const total = this.totalValidas();

    switch (tipo.estrategia) {
      case 'padron':
        return `Descargar padrón (${total})`;
      case 'delegar':
        return 'Abrir el importador de matriz';
      default:
        return total === 1 ? 'Importar 1 registro' : `Importar ${total} registros`;
    }
  });

  readonly ayudaColumnas = computed(() =>
    this.importacion.tipo().columnas.map((columna) => ({
      rotulo: columna.rotulo,
      obligatoria: columna.obligatoria === true,
      ayuda: columna.ayuda ?? '',
    })),
  );

  alElegirTipo(evento: Event): void {
    this.importacion.cambiarTipo((evento.target as HTMLSelectElement).value);
  }

  alElegirArchivo(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const archivo = entrada.files?.[0];
    if (archivo) void this.importacion.elegirArchivo(archivo);
    // Permite volver a elegir el mismo archivo tras corregirlo.
    entrada.value = '';
  }

  alEscribir(evento: Event): void {
    this.importacion.escribir((evento.target as HTMLTextAreaElement).value);
  }

  cerrar(): void {
    // El estado vive en el servicio; se espera la salida para que la animación
    // se vea antes de que el shell desmonte el panel.
    salirModal(this.panel()?.nativeElement, () => this.importacion.cerrar());
  }

  /** El clic fuera cierra; arrastrar dentro del contenido no. */
  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrar();
  }
}
