import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { SesionStore } from '../../core/auth/sesion.store';
import { ErrorApi } from '../../core/http/errores';
import { IconoComponent } from '../../shared/ui/icono.component';

@Component({
  selector: 'app-acceso',
  imports: [ReactiveFormsModule, IconoComponent],
  templateUrl: './acceso.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccesoPage {
  private readonly sesion = inject(SesionStore);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);

  readonly formulario = this.fb.nonNullable.group({
    dni: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(12)]],
    password: ['', [Validators.required]],
  });

  readonly enviando = signal(false);
  readonly error = signal('');

  /**
   * El cierre por inactividad llega como `?motivo=inactividad`. Se consulta al
   * montar la página: en ese momento la sesión ya está cerrada y el valor no
   * cambia en caliente.
   */
  readonly sesionExpirada = this.ruta.snapshot.queryParamMap.get('motivo') === 'inactividad';

  soloDigitos(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const limpio = entrada.value.replace(/\D/g, '');
    if (limpio !== entrada.value) {
      entrada.value = limpio;
      this.formulario.controls.dni.setValue(limpio);
    }
  }

  async enviar(): Promise<void> {
    this.error.set('');

    const dni = this.formulario.controls.dni.value.trim();
    const password = this.formulario.controls.password.value;

    if (dni.length < 8 || !password) {
      this.error.set('Ingresa un DNI válido y tu contraseña.');
      return;
    }

    this.enviando.set(true);
    try {
      await this.sesion.iniciarSesion(dni, password);
      const volver = this.ruta.snapshot.queryParamMap.get('volver');
      await this.router.navigateByUrl(volver && volver.startsWith('/') ? volver : '/');
    } catch (fallo) {
      this.error.set(fallo instanceof ErrorApi ? fallo.message : 'No se pudo iniciar sesión.');
    } finally {
      this.enviando.set(false);
    }
  }
}
