import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, NavigationEnd, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';

import { AlcanceService } from '../../core/alcance/alcance.service';
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
  styles: `
    /*
     * El ámbito ocupa el lugar del antiguo indicador «Sistema operativo», que era
     * texto fijo sin dato. Ahora es un enlace real a Preferencias: necesita
     * hover, foco visible y un valor con más peso que la etiqueta.
     */
    .ambito-chip {
      gap: 6px;
      padding: 4px 9px;
      border-radius: 999px;
      font-size: 10.5px;
      text-decoration: none;
      transition: background-color 120ms ease;
    }

    .ambito-chip strong {
      color: var(--ink-2);
      font-weight: 700;
    }

    .ambito-chip:hover,
    .ambito-chip:focus-visible {
      background: rgba(36, 85, 162, 0.1);
    }

    .ambito-chip:focus-visible {
      outline: 3px solid #7aa2e8;
      outline-offset: 2px;
    }
  `,
})
export class ShellComponent {
  private readonly sesion = inject(SesionStore);
  private readonly capacidades = inject(CapacidadesService);
  private readonly router = inject(Router);
  private readonly atajos = inject(AtajosService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly alcance = inject(AlcanceService);

  readonly version = ENTORNO.version;
  readonly usuario = this.sesion.usuario;
  readonly roles = computed(() => this.capacidades.etiquetasRoles());

  /**
   * El mapa ya es la ventana principal, así que su propio filtro de ámbito
   * sustituye al chip de la cabecera: mostrarlo allí sería duplicar el control.
   */
  readonly enMapa = toSignal(
    this.router.events.pipe(
      filter((evento): evento is NavigationEnd => evento instanceof NavigationEnd),
      map((evento) => evento.urlAfterRedirects.startsWith('/mapa')),
      startWith(this.router.url.startsWith('/mapa')),
    ),
    { initialValue: this.router.url.startsWith('/mapa') },
  );

  /**
   * Ámbito que la interfaz está aplicando: el elegido en Preferencias o, en
   * «Sesión», el que entrega el inicio de sesión. No es un permiso: la RLS
   * decide qué datos llegan.
   */
  readonly ambitoEtiqueta = computed(() => {
    const preferido = this.alcance.preferido();
    if (preferido !== 'auto') return preferido;

    const regiones = this.usuario()?.regiones ?? [];
    if (regiones.length === 0) return 'Nacional';
    if (regiones.length === 1) return regiones[0];
    return `${regiones.length} regiones`;
  });

  readonly menuAbierto = signal(false);
  readonly perfilAbierto = signal(false);

  constructor() {
    this.destroyRef.onDestroy(this.atajos.instalar());
  }

  readonly enlacesTrabajo: EnlaceNav[] = [
    { etiqueta: 'Panorama territorial', ruta: '/mapa', icono: 'mapa' },
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
