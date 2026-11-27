import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';

import { AlcanceService, type AlcancePreferido } from '../../core/alcance/alcance.service';
import { SesionStore } from '../../core/auth/sesion.store';
import { type DensidadPreferida, type TemaPreferido } from '../../core/http/preferencias.service';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { TemaService } from '../../core/tema/tema.service';
import { ALCANCES, esRegistro } from '../../dominio/mapeo';
import { AccionesPreferenciaService } from '../../shared/ui/acciones-preferencia.service';
import { describir } from '../../shared/ui/descriptor-entidad';
import { IconoComponent } from '../../shared/ui/icono.component';

/** Mismas categorías que agrupa la bandeja de notificaciones. */
type CategoriaAviso = 'Alerta' | 'Compromiso' | 'Documento' | 'Caso';
type PreferenciasAviso = Record<CategoriaAviso, boolean>;

const CLAVE_AVISOS = 'avisa-notificaciones';

/**
 * Un aviso por tipo de entidad. La etiqueta y el icono no se escriben aquí:
 * salen del descriptor único (`shared/ui/descriptor-entidad`), de modo que
 * «Documentos» o «Casos» se vean igual que en el resto de la aplicación.
 */
const AVISOS: readonly {
  clave: CategoriaAviso;
  tipo: string;
  pista: string;
}[] = [
  { clave: 'Alerta', tipo: 'alerta', pista: 'Avisos de alertas tempranas.' },
  { clave: 'Compromiso', tipo: 'compromiso', pista: 'Avisos de compromisos e hitos.' },
  { clave: 'Documento', tipo: 'documento', pista: 'Avisos sobre documentos del expediente.' },
  { clave: 'Caso', tipo: 'caso', pista: 'Avisos sobre casos y su riesgo.' },
];

function capitalizar(valor: string): string {
  return valor ? valor.charAt(0).toUpperCase() + valor.slice(1) : valor;
}

/** Sólo referencia visual: la preferencia no tiene respaldo real todavía. */
const TAMANOS = [25, 50, 100] as const;

function leer(clave: string, plataforma: object): string | null {
  if (!isPlatformBrowser(plataforma)) return null;
  try {
    return window.localStorage.getItem(clave);
  } catch {
    return null;
  }
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
 * Tema y densidad tienen **una sola fuente de verdad**: `PreferenciasService`
 * (señal + persistencia en `core.usuario_preferencia`) y `TemaService`, que
 * traduce esa señal a `data-theme` / `data-density` en `<html>`. Esta pantalla
 * no guarda copias propias ni escribe atributos: al pulsar una opción el cambio
 * se aplica y se persiste en la cuenta.
 *
 * El ámbito predeterminado y los avisos siguen en `localStorage`: la API no
 * valida esas claves (`tamanoPagina`, `tema`, `densidad`, `zonaHoraria`), así
 * que se guardan con «Guardar preferencias» y se declara su alcance. El tamaño
 * de página no se guarda: ningún listado lo lee.
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
      font-size: 12px;
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
  private readonly alcanceServicio = inject(AlcanceService);
  private readonly temaServicio = inject(TemaService);
  private readonly accionesServicio = inject(AccionesPreferenciaService);

  readonly usuario = this.sesion.usuario;
  readonly tamanos = TAMANOS;

  /** Preferencia declarada (`claro|oscuro|auto`); la guarda el servidor. */
  readonly tema = computed<TemaPreferido>(() => this.temaServicio.preferencia());
  /** Densidad vigente (`comoda|compacta`); también vive en el servidor. */
  readonly densidad = computed<DensidadPreferida>(() => this.temaServicio.densidad());
  /** El botón de acción pinta texto en vez de icono cuando está activo. */
  readonly accionesConTexto = this.accionesServicio.conTexto;

  /**
   * Copia editable del ámbito: el panel sólo lo consolida al guardar, igual
   * que los avisos. Parte del valor compartido que ya usa el chip del shell.
   */
  readonly alcance = signal<AlcancePreferido>(this.alcanceServicio.preferido());
  readonly avisos = signal<PreferenciasAviso>(avisosIniciales(this.plataforma));

  readonly avisosDisponibles = AVISOS.map((aviso) => {
    const descriptor = describir(aviso.tipo);
    return {
      clave: aviso.clave,
      etiqueta: capitalizar(descriptor.plural),
      pista: aviso.pista,
      icono: descriptor.icono,
    };
  });

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

  async cambiarTema(tema: TemaPreferido): Promise<void> {
    if (this.tema() === tema) return;
    this.olvidarAviso();
    try {
      await this.temaServicio.fijarTema(tema);
    } catch {
      this.guardado.set(false);
      this.mensaje.set(
        'No se pudo guardar el tema en tu cuenta. El servidor rechazó el cambio y se mantiene la preferencia anterior.',
      );
    }
  }

  async cambiarDensidad(densidad: DensidadPreferida): Promise<void> {
    if (this.densidad() === densidad) return;
    this.olvidarAviso();
    try {
      await this.temaServicio.fijarDensidad(densidad);
    } catch {
      this.guardado.set(false);
      this.mensaje.set(
        'No se pudo guardar la densidad en tu cuenta. El servidor rechazó el cambio y se mantiene la preferencia anterior.',
      );
    }
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

  alternarAccionesTexto(): void {
    this.accionesServicio.alternar();
  }

  /**
   * Consolida lo que no vive en el servidor: el ámbito y los avisos. Tema y
   * densidad ya se guardaron al elegirlos, así que no se reescriben aquí.
   */
  guardar(): void {
    if (!isPlatformBrowser(this.plataforma)) return;

    // `fijar` escribe la misma clave y actualiza el chip del shell al instante.
    this.alcanceServicio.fijar(this.alcance());

    try {
      window.localStorage.setItem(CLAVE_AVISOS, JSON.stringify(this.avisos()));
    } catch {
      this.guardado.set(false);
      this.mensaje.set(
        'No se pudieron guardar los avisos: el navegador rechazó el almacenamiento local.',
      );
      return;
    }

    this.guardado.set(true);
    this.mensaje.set(
      'Preferencias guardadas. El tema y la densidad se guardan en tu cuenta; el ámbito y los avisos, en este navegador.',
    );
  }

  cerrarAviso(): void {
    this.mensaje.set(null);
  }

  private olvidarAviso(): void {
    this.mensaje.set(null);
    this.guardado.set(false);
  }
}
