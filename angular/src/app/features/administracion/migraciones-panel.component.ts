import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';

import { IconoComponent } from '../../shared/ui/icono.component';
import {
  fechaHoraDdMmAaaa,
  mensajeErrorAdmin,
  type MigracionItem,
} from './administracion.modelos';
import { AdministracionService } from './administracion.service';

/**
 * Bitácora de migraciones (`core.migracion_log`).
 *
 * Sólo lectura: el registro lo escribe el aplicador de migraciones, no la UI.
 */
@Component({
  selector: 'app-admin-migraciones-panel',
  imports: [IconoComponent],
  templateUrl: './migraciones-panel.component.html',
  styleUrl: './administracion.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MigracionesPanelComponent {
  private readonly servicio = inject(AdministracionService);

  readonly items = signal<MigracionItem[]>([]);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  /** Helper expuesto a la plantilla. */
  readonly fechaHora = fechaHoraDdMmAaaa;

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      this.items.set(await this.servicio.migraciones());
    } catch (fallo) {
      this.error.set(
        mensajeErrorAdmin(fallo, 'No se pudo cargar la bitácora de migraciones.'),
      );
    } finally {
      this.cargando.set(false);
    }
  }
}
