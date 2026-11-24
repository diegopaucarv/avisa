import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';

import { AlcanceService, esAlcance } from '../../core/alcance/alcance.service';
import type { AlcancePreferido } from '../../core/alcance/alcance.service';
import { AtajosService } from '../../core/atajos/atajos.service';
import { SesionStore } from '../../core/auth/sesion.store';
import { ENTORNO } from '../../core/config/entorno';
import { NotificacionesService } from '../../core/http/notificaciones.service';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { ALCANCES } from '../../dominio/mapeo';
import { IconoComponent } from '../../shared/ui/icono.component';

type EnlaceNav = {
  etiqueta: string;
  ruta: string;
  icono: string;
  grupo: string;
  exacto?: boolean;
  soloSiPuedeEliminar?: boolean;
  /** Sólo se dibuja para el rol `administrador`. */
  soloSiEsAdmin?: boolean;
};

/**
 * Menú lateral único. El orden del arreglo es el orden de la barra y los
 * grupos se forman por contigüidad, de modo que no hay dos listas que puedan
 * desincronizarse. Los rótulos de grupo van en mayúsculas porque
 * `.sidebar-label` no aplica `text-transform`.
 *
 * «Casos» vive en Prevención porque la gestión del caso es el trabajo
 * preventivo; el panorama territorial queda como la puerta de entrada
 * geográfica y enlaza al listado ya filtrado por región.
 */
const ENLACES_NAV: readonly EnlaceNav[] = [
  {
    grupo: 'PANORAMA TERRITORIAL',
    etiqueta: 'Panorama territorial',
    ruta: '/mapa',
    icono: 'mapa',
  },
  {
    grupo: 'PANORAMA TERRITORIAL',
    etiqueta: 'Dashboard analítico',
    ruta: '/dashboard',
    icono: 'analisis',
  },
  { grupo: 'PREVENCIÓN', etiqueta: 'Casos', ruta: '/casos', icono: 'casos' },
  {
    grupo: 'PREVENCIÓN',
    etiqueta: 'Alertas tempranas',
    ruta: '/alertas',
    icono: 'alertas',
  },
  {
    grupo: 'PREVENCIÓN',
    etiqueta: 'Bandeja RED-RADAR',
    ruta: '/red-radar',
    icono: 'alertas',
  },
  {
    grupo: 'PREVENCIÓN',
    etiqueta: 'Matriz de conflictividad',
    ruta: '/matriz-conflictividad',
    icono: 'casos',
  },
  {
    grupo: 'PREVENCIÓN',
    etiqueta: 'Clima social',
    ruta: '/clima-social',
    icono: 'analisis',
  },
  {
    grupo: 'INTERVENCIÓN',
    etiqueta: 'Reuniones',
    ruta: '/reuniones',
    icono: 'reloj',
  },
  {
    grupo: 'INTERVENCIÓN',
    etiqueta: 'Resultados',
    ruta: '/resultados',
    icono: 'check',
  },
  {
    grupo: 'SEGUIMIENTO',
    etiqueta: 'Compromisos',
    ruta: '/compromisos',
    icono: 'compromisos',
  },
  {
    grupo: 'GESTIÓN DE IYC',
    etiqueta: 'Reporte de actividad',
    ruta: '/reportes',
    icono: 'actividad',
  },
  {
    grupo: 'GESTIÓN DE IYC',
    etiqueta: 'Documentos',
    ruta: '/documentos',
    icono: 'documentos',
  },
  {
    grupo: 'GESTIÓN DE IYC',
    etiqueta: 'Gobierno y sugerencias',
    ruta: '/gobierno-sugerencias',
    icono: 'analisis',
  },
  {
    grupo: 'GESTIÓN DE IYC',
    etiqueta: 'Exportaciones',
    ruta: '/exportaciones',
    icono: 'documentos',
  },
  {
    grupo: 'DIRECTORIOS',
    etiqueta: 'Actores',
    ruta: '/directorio/personas',
    icono: 'actores',
  },
  {
    grupo: 'DIRECTORIOS',
    etiqueta: 'Organizaciones',
    ruta: '/directorio/organizaciones',
    icono: 'organizaciones',
  },
  {
    grupo: 'DIRECTORIOS',
    etiqueta: 'Autoridades y agentes',
    ruta: '/directorio/autoridades',
    icono: 'instituciones',
  },
  {
    grupo: 'DIRECTORIOS',
    etiqueta: 'Auditorios',
    ruta: '/directorio/locales',
    icono: 'mapa',
  },
  {
    grupo: 'MI ESPACIO',
    etiqueta: 'Resumen operativo',
    ruta: '/resumen',
    icono: 'cuadricula',
  },
  {
    grupo: 'MI ESPACIO',
    etiqueta: 'Bandeja de trabajo',
    ruta: '/bandeja',
    icono: 'bandeja',
  },
  {
    grupo: 'MI ESPACIO',
    etiqueta: 'Archivo',
    ruta: '/archivo',
    icono: 'archivo',
    soloSiPuedeEliminar: true,
  },
  {
    grupo: 'ADMINISTRACIÓN',
    etiqueta: 'Administración',
    ruta: '/administracion',
    icono: 'ajustes',
    soloSiEsAdmin: true,
  },
  {
    grupo: 'ADMINISTRACIÓN',
    etiqueta: 'Consola ETL',
    ruta: '/administracion/etl',
    icono: 'actividad',
    soloSiEsAdmin: true,
  },
];

const CLAVE_MENU_COLAPSADO = 'avisa-menu-colapsado';

/** Estado guardado del ancho del menú; sin almacenamiento, arranca expandido. */
function leerMenuColapsado(): boolean {
  try {
    return localStorage.getItem(CLAVE_MENU_COLAPSADO) === '1';
  } catch {
    return false;
  }
}

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconoComponent],
  templateUrl: './shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /*
     * Globo de avisos sin leer sobre la campana. Es puramente informativo:
     * el número lo calcula el servidor y se corta en «99+».
     */
    .header-icon-button {
      position: relative;
    }

    .header-badge {
      position: absolute;
      top: -4px;
      right: -6px;
      min-width: 17px;
      height: 17px;
      padding: 0 4px;
      border-radius: 9px;
      background: var(--red, #c0392b);
      color: #fff;
      font-size: 10.5px;
      font-weight: 700;
      line-height: 17px;
      text-align: center;
      letter-spacing: 0;
    }

    /*
     * El ámbito ocupa el lugar del antiguo indicador «Sistema operativo», que era
     * texto fijo sin dato. Es un disparador de menú: necesita hover, estado
     * abierto, foco visible y un valor con más peso que la etiqueta.
     */
    .ambito-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 36px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--paper, #fff);
      color: var(--ink-2);
      font-size: 14.5px;
      font-weight: 600;
      transition:
        background-color 120ms ease,
        border-color 120ms ease;
    }

    .ambito-chip strong {
      color: var(--ink);
      font-weight: 700;
    }

    .ambito-chip:hover,
    .ambito-chip:focus-visible,
    .ambito-chip[aria-expanded='true'] {
      border-color: var(--blue);
      background: var(--blue-pale, #eef4fd);
    }

    .ambito-chip:focus-visible {
      outline: 3px solid #7aa2e8;
      outline-offset: 2px;
    }

    /*
     * La marca es el acceso a la ventana principal. El enlace envuelve el icono
     * y el nombre; el nombre institucional queda fuera para que su recorte por
     * puntos suspensivos no dependa del área de clic.
     */
    .brand-home {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      border-radius: 8px;
      color: inherit;
      text-decoration: none;
    }

    .brand-home:hover .brand-symbol {
      background: #1d427f;
    }

    .brand-home:focus-visible {
      outline: 3px solid #7aa2e8;
      outline-offset: 3px;
    }

    .ambito-wrap {
      position: relative;
    }

    .ambito-trigger {
      border: 0;
      background: transparent;
      font-family: inherit;
      cursor: pointer;
    }

    .ambito-panel {
      width: min(240px, calc(100vw - 24px));
    }

    .ambito-opcion {
      min-height: 32px;
    }

    .ambito-opcion[aria-checked='true'] {
      background: #eaf1fb;
      color: #1d427f;
      font-weight: 700;
    }

    .ambito-nota {
      margin: 4px 2px 0;
      padding: 7px 9px 1px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 14px;
      line-height: 1.4;
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
      min-height: 36px;
      padding: 0 14px;
      border: 1px solid var(--blue);
      border-radius: 8px;
      background: var(--blue);
      color: #fff;
      font: 600 14.5px/1 var(--font-body);
      white-space: nowrap;
    }

    .registrar-trigger:hover,
    .registrar-trigger[aria-expanded='true'] {
      background: var(--blue-dark);
      border-color: var(--blue-dark);
    }

    .registrar-panel {
      position: absolute;
      z-index: 50;
      top: calc(100% + 9px);
      right: 0;
      width: min(280px, calc(100vw - 24px));
      padding: 7px;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: var(--paper, #fff);
      box-shadow: 0 12px 30px rgb(23 40 58 / 16%);
    }

    .registrar-titulo {
      margin: 0;
      padding: 7px 9px 5px;
      color: var(--muted);
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .registrar-separador {
      height: 1px;
      margin: 6px 4px;
      background: var(--line);
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
      color: var(--ink-2);
      font-size: 14.5px;
      text-align: left;
      cursor: pointer;
    }

    .registrar-opcion:hover:not(:disabled),
    .registrar-opcion:focus-visible:not(:disabled) {
      background: var(--blue-pale, #f0f5fb);
      color: var(--blue-dark);
    }

    .registrar-opcion:disabled {
      color: var(--muted);
      cursor: not-allowed;
    }

    .registrar-ayuda {
      color: var(--muted);
      font-size: 14px;
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

    /*
     * En móvil el chip conserva el acceso con sólo el icono; el valor sigue
     * disponible en title y aria-label. La regla global oculta
     * .system-status, así que aquí se recupera la visibilidad.
     */
    @media (max-width: 760px) {
      .ambito-chip {
        display: flex;
        width: 32px;
        height: 32px;
        padding: 0;
        justify-content: center;
      }

      .ambito-etiqueta,
      .ambito-flecha {
        display: none;
      }
    }

    /* Por debajo de 380 px el chip ya no cabe junto a los demás iconos. */
    @media (max-width: 380px) {
      .ambito-wrap {
        display: none;
      }
    }

    /*
     * Anclado a la derecha del chip, el panel se saldría por el borde
     * izquierdo cuando la fila de iconos ocupa espacio; en pantallas
     * estrechas se centra sobre el chip.
     */
    @media (max-width: 430px) {
      .ambito-panel {
        right: auto;
        left: 50%;
        transform: translateX(-50%);
      }
    }

    .profile-menu-link {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 9px;
      border-radius: 7px;
      color: var(--ink-2);
      font-size: 14.5px;
      font-weight: 600;
      text-decoration: none;
    }

    .profile-menu-link:hover {
      background: var(--blue-pale, #f0f5fb);
      color: var(--blue-dark);
    }

    .profile-menu-separador {
      height: 1px;
      margin: 5px 4px;
      background: var(--line);
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
  private readonly notificaciones = inject(NotificacionesService);

  /** Avisos sin leer para el globo de la campana. */
  readonly avisosSinLeer = this.notificaciones.etiqueta;

  readonly version = ENTORNO.version;
  readonly usuario = this.sesion.usuario;
  readonly roles = computed(() => this.capacidades.etiquetasRoles());

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
  readonly ambitoAbierto = signal(false);
  readonly alcances = ALCANCES;

  private readonly ambitoTrigger = viewChild<ElementRef<HTMLButtonElement>>('ambitoTrigger');
  private readonly ambitoPanel = viewChild<ElementRef<HTMLElement>>('ambitoPanel');

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

  /** `alcance` tal como llega en la URL; `null` = sin parámetro. */
  private readonly alcanceParam = computed(() => {
    const consulta = this.urlActual().split('?')[1] ?? '';
    return new URLSearchParams(consulta).get('alcance');
  });

  /**
   * Ámbito que la interfaz está aplicando: manda la URL (panorama y lista de
   * Casos), después la preferencia y, en «Sesión», el que entrega el inicio de
   * sesión. No es un permiso: la RLS decide qué datos llegan.
   */
  readonly ambitoEtiqueta = computed(() => {
    const parametro = this.alcanceParam();
    if (parametro === 'todos') return 'Todos';
    if (esAlcance(parametro)) return parametro;

    const preferido = this.alcance.preferido();
    if (preferido !== 'auto') return preferido;

    const regiones = this.usuario()?.regiones ?? [];
    if (regiones.length === 0) return 'Nacional';
    if (regiones.length === 1) return regiones[0];
    return `${regiones.length} regiones`;
  });

  /** Opción marcada en el menú: la URL si la fija y, si no, la preferencia. */
  readonly ambitoSeleccionado = computed<AlcancePreferido>(() => {
    const parametro = this.alcanceParam();
    if (parametro === 'todos') return 'auto';
    if (esAlcance(parametro)) return parametro;
    return this.alcance.preferido();
  });

  readonly menuAbierto = signal(false);
  readonly menuColapsado = signal(leerMenuColapsado());
  readonly perfilAbierto = signal(false);

  constructor() {
    this.destroyRef.onDestroy(this.atajos.instalar());
  }

  /**
   * Enlaces que la sesión puede ver. La papelera depende de la capacidad de
   * anular y restaurar; el resto es común.
   */
  readonly enlacesVisibles = computed(() =>
    ENLACES_NAV.filter(
      (enlace) =>
        (!enlace.soloSiPuedeEliminar || this.capacidades.puedeEliminar()) &&
        (!enlace.soloSiEsAdmin || this.capacidades.esAdmin()),
    ),
  );

  /** Grupos por contigüidad: el orden del arreglo define la barra. */
  readonly grupos = computed(() => {
    const grupos: Array<{ etiqueta: string; enlaces: EnlaceNav[] }> = [];
    for (const enlace of this.enlacesVisibles()) {
      const ultimo = grupos[grupos.length - 1];
      if (ultimo && ultimo.etiqueta === enlace.grupo) {
        ultimo.enlaces.push(enlace);
      } else {
        grupos.push({ etiqueta: enlace.grupo, enlaces: [enlace] });
      }
    }
    return grupos;
  });

  /** La papelera sólo se muestra a quien puede anular y restaurar. */
  readonly puedeVerPapelera = this.capacidades.puedeEliminar;

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

  /** Colapsa el menú a íconos en escritorio y recuerda la elección. */
  alternarColapso(): void {
    const colapsado = !this.menuColapsado();
    this.menuColapsado.set(colapsado);
    try {
      localStorage.setItem(CLAVE_MENU_COLAPSADO, colapsado ? '1' : '0');
    } catch {
      // Sin almacenamiento la preferencia dura lo que la sesión.
    }
  }

  alternarPerfil(): void {
    this.perfilAbierto.update((abierto) => !abierto);
  }

  alternarRegistrar(): void {
    this.ambitoAbierto.set(false);
    this.registrarAbierto.update((abierto) => !abierto);
  }

  alternarAmbito(): void {
    this.registrarAbierto.set(false);
    const abrir = !this.ambitoAbierto();
    this.ambitoAbierto.set(abrir);
    if (abrir) {
      // El panel se pinta después del cambio de señal; el foco entra al siguiente turno.
      setTimeout(() => this.enfocarOpcionAmbito(), 0);
    }
  }

  /**
   * Teclado del menú de ámbito: flechas circulares, Inicio/Fin, Escape cierra
   * y devuelve el foco al disparador, y Tab cierra sin interferir con el foco.
   */
  navegarAmbito(evento: KeyboardEvent): void {
    const opciones = this.opcionesAmbito();
    if (opciones.length === 0) return;

    const actual = opciones.indexOf(document.activeElement as HTMLButtonElement);

    switch (evento.key) {
      case 'ArrowDown':
        evento.preventDefault();
        opciones[(actual + 1) % opciones.length]?.focus();
        break;
      case 'ArrowUp':
        evento.preventDefault();
        opciones[(actual <= 0 ? opciones.length : actual) - 1]?.focus();
        break;
      case 'Home':
        evento.preventDefault();
        opciones[0]?.focus();
        break;
      case 'End':
        evento.preventDefault();
        opciones[opciones.length - 1]?.focus();
        break;
      case 'Escape':
        evento.preventDefault();
        this.ambitoAbierto.set(false);
        this.enfocarDisparadorAmbito();
        break;
      case 'Tab':
        this.ambitoAbierto.set(false);
        break;
      default:
        break;
    }
  }

  private opcionesAmbito(): HTMLButtonElement[] {
    const panel = this.ambitoPanel()?.nativeElement;
    if (!panel) return [];
    return Array.from(panel.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
  }

  /** Abre el menú con la opción marcada enfocada; si no hay, la primera. */
  private enfocarOpcionAmbito(): void {
    const opciones = this.opcionesAmbito();
    if (opciones.length === 0) return;
    const marcada = opciones.findIndex((opcion) => opcion.getAttribute('aria-checked') === 'true');
    opciones[marcada >= 0 ? marcada : 0]?.focus();
  }

  private enfocarDisparadorAmbito(): void {
    this.ambitoTrigger()?.nativeElement.focus();
  }

  /**
   * Fija la preferencia y, en las pantallas que aceptan `alcance` en la URL
   * (panorama y lista de Casos), lo aplica en el acto sin perder el resto de
   * filtros. `todos` es la limpieza explícita de «Sesión».
   */
  elegirAmbito(valor: AlcancePreferido): void {
    this.alcance.fijar(valor);
    this.ambitoAbierto.set(false);

    const camino = (this.urlActual().split('?')[0] ?? '/').replace(/\/+$/, '') || '/';
    if (camino !== '/mapa' && camino !== '/casos') return;

    void this.router.navigate(camino.split('/').filter(Boolean), {
      queryParams: { alcance: valor === 'auto' ? 'todos' : valor },
      queryParamsHandling: 'merge',
    });
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
  cerrarPanelesAlHacerClicFuera(): void {
    this.registrarAbierto.set(false);
    this.ambitoAbierto.set(false);
  }

  @HostListener('document:keydown.escape', ['$event'])
  cerrarPanelesConEscape(evento: Event): void {
    if (!this.registrarAbierto() && !this.ambitoAbierto()) return;
    evento.preventDefault();
    const cerrabaAmbito = this.ambitoAbierto();
    this.registrarAbierto.set(false);
    this.ambitoAbierto.set(false);
    // Sólo Escape devuelve el foco; un clic fuera no debe robarlo.
    if (cerrabaAmbito) this.enfocarDisparadorAmbito();
  }

  cerrarSesion(): void {
    this.perfilAbierto.set(false);
    this.sesion.cerrarSesion();
    void this.router.navigateByUrl('/acceso');
  }
}
