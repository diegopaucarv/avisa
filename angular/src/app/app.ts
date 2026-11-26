import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { AvisoInactividadComponent } from './shared/ui/aviso-inactividad.component';
import { SwipeCerrarDirective } from './shared/ui/swipe-cerrar.directive';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AvisoInactividadComponent, SwipeCerrarDirective],
  template: '<router-outlet appSwipeCerrar /><app-aviso-inactividad />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
