import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
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

    /*
     * El nombre institucional es mucho más largo que «Producción · OAIPCS».
     * La marca no debe empujar ni envolver la barra: se recorta con puntos
     * suspensivos y, en anchos cortos, se usa la forma abreviada. Por debajo de
     * 760 px la regla global ya oculta este elemento small.
     */
    .header-brand {
      min-width: 0;
    }

    .brand-org {
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .brand-org-corta {
      display: none;
    }

    .header-right {
      flex: none;
    }

    .registrar-wrap {
      position: relative;
    }

    .registrar-trigger {
      min-height: 34px;
      padding: 0 11px;
      border: 1px solid #2455a2;
      border-radius: 6px;
      background: #2455a2;
      color: #fff;
      font: 600 10px/1 var(--font-sans);
      white-space: nowrap;
    }

    .registrar-trigger:hover,
    .registrar-trigger[aria-expanded='true'] {
      background: #1d427f;
    }

    .registrar-panel {
      position: absolute;
      z-index: 50;
      top: calc(100% + 9px);
      right: 0;
      width: min(280px, calc(100vw - 24px));
      padding: 7px;
      border: 1px solid #e1e7ed;
      border-radius: 9px;
      background: #fff;
      box-shadow: 0 12px 30px rgb(23 40 58 / 16%);
    }

    .registrar-titulo {
      margin: 0;
      padding: 7px 9px 5px;
      color: #8a98a5;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .registrar-separador {
      height: 1px;
      margin: 6px 4px;
      background: #edf0f2;
    }

    .registrar-opcion {
      display: flex;
      width: 100%;
      min-height: 36px;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 0 9px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #33475b;
      font-size: 11px;
      text-align: left;
      cursor: pointer;
    }

    .registrar-opcion:hover:not(:disabled),
    .registrar-opcion:focus-visible:not(:disabled) {
      background: #f0f5fb;
      color: #1d427f;
    }

    .registrar-opcion:disabled {
      color: #9ca8b3;
      cursor: not-allowed;
    }

    .registrar-ayuda {
      color: #99a4ad;
      font-size: 9px;
    }

    @media (max-width: 620px) {
      .registrar-trigger {
        width: 34px;
        padding: 0;
        overflow: hidden;
        font-size: 0;
      }

      .registrar-trigger::before {
        content: '+';
        font-size: 20px;
      }
    }

    @media (max-width: 1120px) {
      .brand-org-largo {
        display: none;
      }

      .brand-org-corta {
        display: inline;
      }
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

  private readonly urlActual = toSignal(
    this.router.events.pipe(
      filter((evento): evento is NavigationEnd => evento instanceof NavigationEnd),
      map((evento) => evento.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly puedeRegistrar = this.capacidades.puedeEditar;
  readonly registrarAbierto = signal(false);
  readonly codigoCasoActual = computed(() => {
    const coincidencia = this.urlActual().match(/^\/casos\/([^/?#]+)/);
    if (!coincidencia) return null;
    try {
      const codigo = decodeURIComponent(coincidencia[1]);
      return codigo === 'sin-caso' ? null : codigo;
    } catch {
      return null;
    }
  });

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
    { etiqueta: 'Portada', ruta: '/directorio', icono: 'cuadricula' },
    { etiqueta: 'Actores', ruta: '/directorio/actores', icono: 'actores' },
    { etiqueta: 'Organizaciones', ruta: '/directorio/organizaciones', icono: 'organizaciones' },
    { etiqueta: 'Instituciones', ruta: '/directorio/instituciones', icono: 'instituciones' },
    { etiqueta: 'Auditorios', ruta: '/directorio/locales', icono: 'mapa' },
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

  alternarRegistrar(): void {
    this.registrarAbierto.update((abierto) => !abierto);
  }

  abrirRegistro(tipo: 'caso' | 'alerta' | 'demanda' | 'compromiso' | 'documento'): void {
    this.registrarAbierto.set(false);
    this.perfilAbierto.set(false);
    if (!this.puedeRegistrar()) return;

    if (tipo === 'demanda') {
      const codigo = this.codigoCasoActual();
      if (!codigo) return;
      void this.router.navigate(['/casos', codigo], { queryParams: { registrar: tipo } });
      return;
    }

    const rutas = {
      caso: '/casos',
      alerta: '/alertas',
      compromiso: '/compromisos',
      documento: '/documentos',
    } as const;
    void this.router.navigate([rutas[tipo]], { queryParams: { registrar: tipo } });
  }

  @HostListener('document:click')
  cerrarRegistrarAlHacerClicFuera(): void {
    this.registrarAbierto.set(false);
  }

  @HostListener('document:keydown.escape', ['$event'])
  cerrarRegistrarConEscape(evento: Event): void {
    if (!this.registrarAbierto()) return;
    evento.preventDefault();
    this.registrarAbierto.set(false);
  }

  cerrarSesion(): void {
    this.perfilAbierto.set(false);
    this.sesion.cerrarSesion();
    void this.router.navigateByUrl('/acceso');
  }
}
