import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';

import { SesionStore } from '../../core/auth/sesion.store';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { ALCANCES, esRegistro } from '../../dominio/mapeo';
import type { Alcance } from '../../dominio/modelos';
import { IconoComponent } from '../../shared/ui/icono.component';

type Tema = 'claro' | 'oscuro';
type Densidad = 'comoda' | 'compacta';

/**
 * `auto` significa «el ámbito que entregue la sesión»: la pantalla no impone un
 * alcance que todavía nadie aplica.
 */
type AlcancePreferido = Alcance | 'auto';

/** Mismas categorías que agrupa la bandeja de notificaciones. */
type CategoriaAviso = 'Alerta' | 'Compromiso' | 'Documento' | 'Caso';
type PreferenciasAviso = Record<CategoriaAviso, boolean>;

/** Misma clave que lee el script de `index.html` antes del primer pintado. */
const CLAVE_TEMA = 'avisa-theme';
const CLAVE_DENSIDAD = 'avisa-density';
const CLAVE_ALCANCE = 'avisa-alcance';
const CLAVE_AVISOS = 'avisa-notificaciones';

const AVISOS_DISPONIBLES: readonly {
  clave: CategoriaAviso;
  etiqueta: string;
  pista: string;
  icono: string;
}[] = [
  {
    clave: 'Alerta',
    etiqueta: 'Alertas',
    pista: 'Avisos de alertas tempranas.',
    icono: 'alertas',
  },
  {
    clave: 'Compromiso',
    etiqueta: 'Compromisos',
    pista: 'Avisos de compromisos e hitos.',
    icono: 'compromisos',
  },
  {
    clave: 'Documento',
    etiqueta: 'Documentos',
    pista: 'Avisos sobre documentos del expediente.',
    icono: 'documentos',
  },
  {
    clave: 'Caso',
    etiqueta: 'Casos',
    pista: 'Avisos sobre casos y su riesgo.',
    icono: 'casos',
  },
];

/** Sólo referencia visual: la preferencia no tiene respaldo real todavía. */
const TAMANOS = [25, 50, 100] as const;

/**
 * Lectura defensiva de `localStorage`.
 *
 * Puede fallar por modo privado, por políticas del navegador o porque no hay
 * DOM (SSR); en cualquiera de esos casos la preferencia simplemente cae a su
 * valor por defecto y la página sigue funcionando.
 */
function leer(clave: string, plataforma: object): string | null {
  if (!isPlatformBrowser(plataforma)) return null;
  try {
    return window.localStorage.getItem(clave);
  } catch {
    return null;
  }
}

/**
 * Tema inicial. Se respeta lo guardado por esta pantalla; si viene de
 * `index.html` (que admite `system`) o todavía no hay nada, se deduce del
 * atributo ya aplicado al documento y, como último recurso, del sistema.
 */
function temaInicial(plataforma: object): Tema {
  const guardado = leer(CLAVE_TEMA, plataforma);
  if (guardado === 'dark') return 'oscuro';
  if (guardado === 'light') return 'claro';
  if (!isPlatformBrowser(plataforma)) return 'claro';

  const aplicado = document.documentElement.dataset['theme'];
  if (aplicado === 'dark') return 'oscuro';
  if (aplicado === 'light') return 'claro';

  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
  } catch {
    return 'claro';
  }
}

function densidadInicial(plataforma: object): Densidad {
  return leer(CLAVE_DENSIDAD, plataforma) === 'compacta' ? 'compacta' : 'comoda';
}

function esAlcance(valor: unknown): valor is Alcance {
  return typeof valor === 'string' && (ALCANCES as readonly string[]).includes(valor);
}

function alcanceInicial(plataforma: object): AlcancePreferido {
  const guardado = leer(CLAVE_ALCANCE, plataforma);
  return esAlcance(guardado) ? guardado : 'auto';
}

/** Los avisos se guardan como un único objeto JSON; todo lo desconocido cae en «activado». */
function avisosIniciales(plataforma: object): PreferenciasAviso {
  const porDefecto: PreferenciasAviso = {
    Alerta: true,
    Compromiso: true,
    Documento: true,
    Caso: true,
  };

  const guardado = leer(CLAVE_AVISOS, plataforma);
  if (!guardado) return porDefecto;

  try {
    const bruto: unknown = JSON.parse(guardado);
    if (!esRegistro(bruto)) return porDefecto;
    return {
      Alerta: bruto['Alerta'] !== false,
      Compromiso: bruto['Compromiso'] !== false,
      Documento: bruto['Documento'] !== false,
      Caso: bruto['Caso'] !== false,
    };
  } catch {
    return porDefecto;
  }
}

/**
 * Preferencias del usuario.
 *
 * No hay perfil persistido en la base ni endpoint de preferencias: el tema, la
 * densidad, el ámbito predeterminado y las opciones de notificación se guardan
 * en `localStorage` de este navegador con la misma mecánica (una clave por
 * preferencia). El tema reutiliza el mecanismo real de la aplicación
 * (`data-theme` en `<html>`, clave `avisa-theme`) y la densidad usa el atributo
 * `data-density` que ya estiliza `global.css`. El tamaño de página no se
 * guarda: ningún listado lo lee.
 */
@Component({
  selector: 'app-preferencias',
  imports: [IconoComponent],
  templateUrl: './preferencias.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    .view-body {
      display: flex;
      flex-direction: column;
      gap: 14px;
      width: 100%;
      max-width: 1420px;
      margin: 0 auto;
      padding: 27px 34px 50px;
      box-sizing: border-box;
    }

    .view-head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .view-head h1 {
      margin: 0;
      color: var(--ink);
      font: 700 22px/1.3 var(--font-display);
      letter-spacing: -0.65px;
    }

    .view-subtitle {
      max-width: 760px;
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.6;
    }

    .pref-layout {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.9fr);
      gap: 13px;
      align-items: start;
    }

    .pref-col {
      display: flex;
      flex-direction: column;
      gap: 13px;
      min-width: 0;
    }

    .pref-hint {
      color: var(--muted);
      font-size: 9.5px;
    }

    /* Corrige el gris tenue de .detail-section > p (gana por encapsulación). */
    .pref-note {
      color: var(--muted);
    }

    /* .inline-notice sólo tiene variante de éxito; el fallo usa la paleta de rojo. */
    .inline-notice-error {
      border-color: var(--red);
      background: var(--red-pale);
      color: var(--red);
    }

    /* El control de ámbito conserva su ancho natural y puede partirse en
       pantallas estrechas; .segmented no envuelve por sí solo. */
    .pref-scope {
      align-self: flex-start;
      flex-wrap: wrap;
    }

    .pref-size-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    @media (max-width: 900px) {
      .pref-layout {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 720px) {
      .view-body {
        padding: 18px 16px 40px;
      }
    }
  `,
})
export class PreferenciasPage {
  private readonly plataforma = inject(PLATFORM_ID);
  private readonly sesion = inject(SesionStore);
  private readonly capacidades = inject(CapacidadesService);

  readonly usuario = this.sesion.usuario;
  readonly tamanos = TAMANOS;

  readonly tema = signal<Tema>(temaInicial(this.plataforma));
  readonly densidad = signal<Densidad>(densidadInicial(this.plataforma));
  readonly alcance = signal<AlcancePreferido>(alcanceInicial(this.plataforma));
  readonly avisos = signal<PreferenciasAviso>(avisosIniciales(this.plataforma));

  readonly avisosDisponibles = AVISOS_DISPONIBLES;
  readonly opcionesAlcance: readonly { valor: AlcancePreferido; etiqueta: string }[] = [
    { valor: 'auto', etiqueta: 'Sesión' },
    ...ALCANCES.map((alcance) => ({ valor: alcance, etiqueta: alcance })),
  ];

  readonly mensaje = signal<string | null>(null);
  readonly guardado = signal(false);

  readonly rolesTexto = computed(() => {
    const etiquetas = this.capacidades.etiquetasRoles();
    return etiquetas.length ? etiquetas.join(' · ') : 'Sin roles asignados';
  });

  readonly regionesTexto = computed(() => {
    const regiones = this.usuario()?.regiones ?? [];
    return regiones.length ? regiones.join(' · ') : 'Sin regiones asignadas';
  });

  constructor() {
    // La densidad no tiene bootstrap en `index.html`: se aplica al entrar.
    this.aplicarDensidad(this.densidad());
  }

  cambiarTema(tema: Tema): void {
    if (this.tema() === tema) return;
    this.tema.set(tema);
    this.olvidarAviso();
  }

  cambiarDensidad(densidad: Densidad): void {
    if (this.densidad() === densidad) return;
    this.densidad.set(densidad);
    this.olvidarAviso();
  }

  cambiarAlcance(alcance: AlcancePreferido): void {
    if (this.alcance() === alcance) return;
    this.alcance.set(alcance);
    this.olvidarAviso();
  }

  alternarAviso(categoria: CategoriaAviso): void {
    this.avisos.update((actuales) => {
      const siguiente: PreferenciasAviso = { ...actuales };
      siguiente[categoria] = !siguiente[categoria];
      return siguiente;
    });
    this.olvidarAviso();
  }

  /** Guarda las claves reales y aplica el resultado sin recargar la página. */
  guardar(): void {
    if (!isPlatformBrowser(this.plataforma)) return;

    const resuelto = this.tema() === 'oscuro' ? 'dark' : 'light';

    try {
      window.localStorage.setItem(CLAVE_TEMA, resuelto);
      window.localStorage.setItem(CLAVE_DENSIDAD, this.densidad());
      window.localStorage.setItem(CLAVE_ALCANCE, this.alcance());
      window.localStorage.setItem(CLAVE_AVISOS, JSON.stringify(this.avisos()));
    } catch {
      this.guardado.set(false);
      this.mensaje.set(
        'No se pudieron guardar las preferencias: el navegador rechazó el almacenamiento local.',
      );
      return;
    }

    const root = document.documentElement;
    root.dataset['theme'] = resuelto;
    root.dataset['themePreference'] = resuelto;
    root.style.colorScheme = resuelto;
    this.aplicarDensidad(this.densidad());

    this.guardado.set(true);
    this.mensaje.set('Preferencias guardadas en este navegador.');
  }

  cerrarAviso(): void {
    this.mensaje.set(null);
  }

  private olvidarAviso(): void {
    this.mensaje.set(null);
    this.guardado.set(false);
  }

  private aplicarDensidad(densidad: Densidad): void {
    if (!isPlatformBrowser(this.plataforma)) return;
    const root = document.documentElement;
    if (densidad === 'compacta') {
      root.dataset['density'] = 'compacta';
    } else {
      delete root.dataset['density'];
    }
  }
}
