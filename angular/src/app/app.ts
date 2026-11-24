import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { AvisoInactividadComponent } from './shared/ui/aviso-inactividad.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AvisoInactividadComponent],
  template: '<router-outlet /><app-aviso-inactividad />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
