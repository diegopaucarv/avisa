import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';

import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { IconoComponent } from '../../shared/ui/icono.component';
import {
  fechaDdMmAaaa,
  mensajeErrorAdmin,
  type ResumenAdmin,
} from './administracion.modelos';
import { AdministracionService } from './administracion.service';
import { CatalogosPanelComponent } from './catalogos-panel.component';
import { ConfiguracionPanelComponent } from './configuracion-panel.component';
import { ListaBlancaPanelComponent } from './lista-blanca-panel.component';
import { MigracionesPanelComponent } from './migraciones-panel.component';
import { UsuariosPanelComponent } from './usuarios-panel.component';

type PestanaAdmin =
  | 'usuarios'
  | 'catalogos'
  | 'lista-blanca'
  | 'configuracion'
  | 'migraciones';

const PESTANAS: readonly {
  valor: PestanaAdmin;
  etiqueta: string;
  icono: string;
}[] = [
  { valor: 'usuarios', etiqueta: 'Usuarios y roles', icono: 'actores' },
  { valor: 'catalogos', etiqueta: 'Catálogos', icono: 'cuadricula' },
  { valor: 'lista-blanca', etiqueta: 'Lista blanca', icono: 'documentos' },
  { valor: 'configuracion', etiqueta: 'Configuración', icono: 'ajustes' },
  { valor: 'migraciones', etiqueta: 'Migraciones', icono: 'actividad' },
];

/**
 * Administración del sistema.
 *
 * La pantalla entera está detrás del rol `administrador`: el gate se aplica
 * antes de pedir nada a la API, de modo que una sesión sin el rol vea un aviso
 * en lugar de datos parciales (la API responde 403 de todas formas).
 *
 * Cada pestaña es un componente propio que carga sus datos al montarse y avisa
 * con `(cambio)` cuando escribe algo, para refrescar las tarjetas de resumen.
 */
@Component({
  selector: 'app-administracion-page',
  imports: [
    IconoComponent,
    UsuariosPanelComponent,
    CatalogosPanelComponent,
    ListaBlancaPanelComponent,
    ConfiguracionPanelComponent,
    MigracionesPanelComponent,
  ],
  templateUrl: './administracion.page.html',
  styleUrl: './administracion.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdministracionPage {
  private readonly servicio = inject(AdministracionService);
  private readonly capacidades = inject(CapacidadesService);

  readonly esAdmin = this.capacidades.esAdmin;

  readonly pestanas = PESTANAS;
  readonly pestana = signal<PestanaAdmin>('usuarios');

  readonly resumen = signal<ResumenAdmin | null>(null);
  readonly cargandoResumen = signal(false);
  readonly errorResumen = signal<string | null>(null);

  /** Última migración aplicada, ya en `dd/mm/aaaa`. */
  readonly ultimaMigracion = computed(() =>
    fechaDdMmAaaa(this.resumen()?.migraciones.ultima),
  );

  constructor() {
    if (this.esAdmin()) void this.cargarResumen();
  }

  cambiarPestana(valor: PestanaAdmin): void {
    if (valor !== this.pestana()) this.pestana.set(valor);
  }

  /** Público: lo invocan las pestañas al escribir y el botón «Recargar». */
  async recargarResumen(): Promise<void> {
    await this.cargarResumen();
  }

  private async cargarResumen(): Promise<void> {
    if (!this.esAdmin() || this.cargandoResumen()) return;
    this.cargandoResumen.set(true);
    this.errorResumen.set(null);
    try {
      this.resumen.set(await this.servicio.resumen());
    } catch (fallo) {
      this.errorResumen.set(
        mensajeErrorAdmin(fallo, 'No se pudo cargar el resumen de administración.'),
      );
    } finally {
      this.cargandoResumen.set(false);
    }
  }
}
