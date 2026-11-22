import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import { IconoComponent } from "./icono.component";

/**
 * Marcador honesto para las pantallas que aún no se han portado.
 *
 * No simula datos ni botones: sólo declara el estado y qué falta. Se sustituye
 * pantalla por pantalla en la fase de paridad.
 */
@Component({
  selector: "app-en-migracion",
  imports: [IconoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="view-body">
      <div class="empty-state" role="status">
        <span class="environment-mark">
          <app-icono nombre="actividad" [tamano]="16" />
        </span>
        <strong>{{ titulo() }}</strong>
        <p>{{ descripcion() }}</p>
      </div>
    </section>
  `,
})
export class EnMigracionComponent {
  readonly titulo = input.required<string>();
  readonly descripcion = input<string>(
    "Pantalla en migración desde la interfaz anterior. Sin datos simulados.",
  );
}
