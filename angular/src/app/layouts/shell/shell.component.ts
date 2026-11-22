import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AtajosService } from '../../core/atajos/atajos.service';
import { SesionStore } from '../../core/auth/sesion.store';
import { ENTORNO } from '../../core/config/entorno';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { IconoComponent } from '../../shared/ui/icono.component';

type EnlaceNav = { etiqueta: string; ruta: string; icono: string };

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconoComponent],
  templateUrl: './shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent {
  private readonly sesion = inject(SesionStore);
  private readonly capacidades = inject(CapacidadesService);
  private readonly router = inject(Router);
  private readonly atajos = inject(AtajosService);
  private readonly destroyRef = inject(DestroyRef);

  readonly version = ENTORNO.version;
  readonly usuario = this.sesion.usuario;
  readonly roles = computed(() => this.capacidades.etiquetasRoles());

  readonly menuAbierto = signal(false);
  readonly perfilAbierto = signal(false);

  constructor() {
    this.destroyRef.onDestroy(this.atajos.instalar());
  }

  readonly enlacesTrabajo: EnlaceNav[] = [
    { etiqueta: 'Resumen operativo', ruta: '/resumen', icono: 'cuadricula' },
    { etiqueta: 'Bandeja de trabajo', ruta: '/bandeja', icono: 'bandeja' },
  ];

  readonly enlacesSeguimiento: EnlaceNav[] = [
    { etiqueta: 'Casos', ruta: '/casos', icono: 'casos' },
    { etiqueta: 'Alertas tempranas', ruta: '/alertas', icono: 'alertas' },
    { etiqueta: 'Compromisos', ruta: '/compromisos', icono: 'compromisos' },
    { etiqueta: 'Documentos', ruta: '/documentos', icono: 'documentos' },
    { etiqueta: 'Reportes', ruta: '/reportes', icono: 'actividad' },
  ];

  /** La papelera sólo se muestra a quien puede anular y restaurar. */
  readonly puedeVerPapelera = this.capacidades.puedeEliminar;

  readonly enlacesPapelera: EnlaceNav[] = [
    { etiqueta: 'Papelera', ruta: '/papelera', icono: 'papelera' },
  ];

  readonly enlacesDirectorio: EnlaceNav[] = [
    { etiqueta: 'Actores', ruta: '/directorio/actores', icono: 'actores' },
    { etiqueta: 'Organizaciones', ruta: '/directorio/organizaciones', icono: 'organizaciones' },
    { etiqueta: 'Instituciones', ruta: '/directorio/instituciones', icono: 'instituciones' },
    { etiqueta: 'Locales', ruta: '/directorio/locales', icono: 'mapa' },
  ];

  readonly iniciales = computed(() => {
    const nombre = this.usuario()?.nombre?.trim() ?? '';
    if (!nombre) return '··';
    const partes = nombre.split(/\s+/).filter(Boolean);
    const primera = partes[0]?.[0] ?? '';
    const segunda = partes.length > 1 ? (partes[1]?.[0] ?? '') : '';
    return `${primera}${segunda}`.toUpperCase();
  });

  readonly saludo = computed(() => {
    const nombre = this.usuario()?.nombre?.trim() ?? '';
    const primerNombre = nombre.split(/\s+/)[0] ?? '';
    return primerNombre ? `Buenos días, ${primerNombre}` : 'Buenos días';
  });

  alternarMenu(): void {
    this.menuAbierto.update((abierto) => !abierto);
  }

  alternarPerfil(): void {
    this.perfilAbierto.update((abierto) => !abierto);
  }

  cerrarSesion(): void {
    this.perfilAbierto.set(false);
    this.sesion.cerrarSesion();
    void this.router.navigateByUrl('/acceso');
  }
}
