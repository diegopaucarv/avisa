import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { urlApi } from '../../core/config/entorno';
import { consulta } from '../../core/http/consulta';
import { esRegistro, leer, lista, texto } from '../../dominio/mapeo';
import { IconoComponent } from '../../shared/ui/icono.component';
import {
  TerritorioBuscadorComponent,
  type OpcionTerritorio,
} from './territorio-buscador.component';

/** Cuerpo de `POST /api/v1/cases`. El código lo emite el servidor. */
export type CuerpoCasoAlta = {
  titulo: string;
  regiones: string[];
  tematica?: string;
  subsector?: string;
  riesgo?: string;
  unidadResponsable?: string;
  resumen?: string;
  fechaInicio?: string;
  /** `core.distritos.id`: distrito principal del catálogo INEI. */
  distritoPrincipalId?: number;
  /** `territorio.lugares.id`: puerto, caleta o desembarcadero, no un distrito. */
  lugarId?: string;
};

/** Opción de un catálogo simple (`codigo` = valor que valida la API). */
type OpcionCatalogo = {
  valor: string;
  etiqueta: string;
};

/** Región del catálogo, con su alcance para derivar el del caso. */
type OpcionRegion = OpcionCatalogo & {
  alcanceId: number | null;
};

type AlcanceCatalogo = {
  id: number;
  etiqueta: string;
};

type CatalogosAlta = {
  regiones: OpcionRegion[];
  tematicas: OpcionCatalogo[];
  subsectores: OpcionCatalogo[];
  riesgos: OpcionCatalogo[];
  unidades: OpcionCatalogo[];
  alcances: AlcanceCatalogo[];
};

type BorradorCaso = {
  titulo: string;
  regiones: string[];
  tematica: string;
  subsector: string;
  riesgo: string;
  unidadResponsable: string;
  resumen: string;
  fechaInicio: string;
};

type CampoBorrador = Exclude<keyof BorradorCaso, 'regiones'>;

function opcionesDe(catalogo: Record<string, unknown>, clave: string): OpcionCatalogo[] {
  const opciones: OpcionCatalogo[] = [];
  for (const item of lista(catalogo, [clave])) {
    const fila = esRegistro(item) ? item : {};
    const valor = texto(fila, ['codigo', 'valor', 'nombre']);
    const etiqueta = texto(fila, ['etiqueta', 'nombre']) ?? valor;
    if (valor && etiqueta) opciones.push({ valor, etiqueta });
  }
  return opciones;
}

function numeroId(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isInteger(valor) ? valor : null;
  if (typeof valor === 'string' && valor.trim()) {
    const numero = Number(valor);
    return Number.isInteger(numero) ? numero : null;
  }
  return null;
}

/** `GET /api/v1/catalogs` reducido a los selects del alta. */
export function aCatalogosAlta(bruto: unknown): CatalogosAlta {
  const registro = esRegistro(bruto) ? bruto : {};
  const crudo = leer(registro, ['catalogs', 'catalogos']);
  const catalogo = esRegistro(crudo) ? crudo : {};

  const regiones: OpcionRegion[] = [];
  for (const item of lista(catalogo, ['regiones'])) {
    const fila = esRegistro(item) ? item : {};
    const valor = texto(fila, ['codigo', 'etiqueta', 'nombre']);
    const etiqueta = texto(fila, ['etiqueta', 'nombre']) ?? valor;
    if (valor && etiqueta) {
      regiones.push({ valor, etiqueta, alcanceId: numeroId(fila['alcance_id']) });
    }
  }

  const alcances: AlcanceCatalogo[] = [];
  for (const item of lista(catalogo, ['alcances'])) {
    const fila = esRegistro(item) ? item : {};
    const id = numeroId(fila['id']);
    const etiqueta = texto(fila, ['etiqueta', 'codigo']);
    if (id !== null && etiqueta) alcances.push({ id, etiqueta });
  }

  return {
    regiones,
    tematicas: opcionesDe(catalogo, 'tematicas'),
    subsectores: opcionesDe(catalogo, 'subsectores'),
    riesgos: opcionesDe(catalogo, 'nivelesRiesgo'),
    unidades: opcionesDe(catalogo, 'unidades'),
    alcances,
  };
}

const CATALOGOS_VACIOS: CatalogosAlta = {
  regiones: [],
  tematicas: [],
  subsectores: [],
  riesgos: [],
  unidades: [],
  alcances: [],
};

/**
 * Panel lateral de alta de un caso.
 *
 * Mismo patrón que `EventoPanelComponent` y `DemandaPanelComponent`: diálogo
 * modal (`role="dialog"`, `aria-modal`), cierre con Escape o con el fondo, foco
 * encerrado con Tab y devuelto al disparador al cerrar. No conoce HTTP: valida
 * el borrador y emite el cuerpo; el contenedor decide el `POST`.
 *
 * El código del caso y el alcance no son campos: el primero lo emite el
 * servidor y el segundo se deriva de las regiones.
 */
@Component({
  selector: 'app-caso-panel',
  imports: [IconoComponent, TerritorioBuscadorComponent],
  templateUrl: './caso-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }

    .caso-panel-cabecera {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    .caso-panel-codigo {
      margin: 0;
      color: #8a98a5;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.7px;
      text-transform: uppercase;
    }

    .drawer-head h2 {
      margin: 0;
      color: #1c2a38;
      font: 700 16px/1.35 var(--font-display);
    }

    .caso-panel-sub {
      margin: 4px 0 0;
      color: #647487;
      font-size: 10.5px;
      line-height: 1.5;
    }

    .caso-formulario {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .caso-regiones {
      margin: 0;
      padding: 0;
      border: 0;
      min-width: 0;
    }

    .caso-regiones-lista {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 4px 10px;
      max-height: 190px;
      overflow-y: auto;
      padding: 6px 8px;
      border: 1px solid #dbe3ea;
      border-radius: 6px;
      background: #fff;
      text-align: left;
    }

    .caso-region-opcion {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #22303f;
      font-size: 11.5px;
      line-height: 1.4;
    }

    .caso-region-opcion input {
      flex: none;
      margin: 0;
    }

    .caso-alcance {
      margin: 0;
      padding: 8px 10px;
      border: 1px dashed #dbe3ea;
      border-radius: 6px;
      background: rgba(100, 116, 135, 0.06);
      color: #47566a;
      font-size: 12px;
      font-weight: 600;
      text-align: center;
    }

    .caso-formulario-acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 2px;
    }
  `,
})
export class CasoPanelComponent {
  readonly guardando = input(false);
  readonly errorGuardado = input<string | null>(null);

  readonly cerrar = output<void>();
  readonly guardar = output<CuerpoCasoAlta>();

  readonly borrador = signal<BorradorCaso>({
    titulo: '',
    regiones: [],
    tematica: '',
    subsector: '',
    riesgo: '',
    unidadResponsable: '',
    resumen: '',
    fechaInicio: '',
  });
  readonly mensajeLocal = signal<string | null>(null);

  /**
   * Ubicación elegida: distrito del INEI o lugar operativo. Se guarda aparte
   * del borrador de texto porque son dos tipos distintos y el payload los
   * envía a columnas distintas (`distrito_principal_id` vs `core.caso_lugares`).
   */
  readonly territorio = signal<OpcionTerritorio | null>(null);

  private readonly catalogoRecurso = consulta<CatalogosAlta>({
    fuente: () => urlApi('/v1/catalogs'),
    esquema: aCatalogosAlta,
  });

  private readonly catalogos = computed(() => this.catalogoRecurso.valor() ?? CATALOGOS_VACIOS);

  readonly regiones = computed(() => this.catalogos().regiones);
  readonly tematicas = computed(() => this.catalogos().tematicas);
  readonly subsectores = computed(() => this.catalogos().subsectores);
  readonly riesgos = computed(() => this.catalogos().riesgos);
  readonly unidades = computed(() => this.catalogos().unidades);
  readonly cargandoCatalogos = computed(() => this.catalogoRecurso.estado() === 'cargando');

  /**
   * Alcance derivado, de sólo lectura. Replica `core.alcance_caso`: un único
   * alcance entre las regiones elegidas toma su nombre; alcances distintos
   * pasan a `Nacional`. Sin regiones no hay alcance.
   */
  readonly alcanceDerivado = computed(() => {
    const elegidas = this.borrador().regiones;
    if (elegidas.length === 0) return '—';

    const porNombre = new Map(this.regiones().map((region) => [region.valor, region]));
    const alcances = new Set<number>();
    for (const nombre of elegidas) {
      const alcanceId = porNombre.get(nombre)?.alcanceId;
      if (alcanceId !== null && alcanceId !== undefined) alcances.add(alcanceId);
    }

    if (alcances.size === 0) return '—';
    if (alcances.size > 1) return 'Nacional';

    const [unico] = [...alcances];
    return this.catalogos().alcances.find((alcance) => alcance.id === unico)?.etiqueta ?? '—';
  });

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly destruccion = inject(DestroyRef);

  /** Elemento que tenía el foco al abrir, para devolvérselo al cerrar. */
  private readonly focoPrevio =
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);

  constructor() {
    afterNextRender(() => this.panel()?.nativeElement.focus());

    // Escape cierra el panel aunque el foco esté dentro de un campo de texto.
    const alEscape = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      this.cerrar.emit();
    };
    document.addEventListener('keydown', alEscape);
    this.destruccion.onDestroy(() => {
      document.removeEventListener('keydown', alEscape);
      this.focoPrevio?.focus?.();
    });
  }

  campo(clave: CampoBorrador, evento: Event): void {
    const objetivo = evento.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const valor = objetivo.value;
    this.borrador.update((actual) => ({ ...actual, [clave]: valor }));
    this.mensajeLocal.set(null);
  }

  estaRegion(valor: string): boolean {
    return this.borrador().regiones.includes(valor);
  }

  alternarRegion(valor: string, evento: Event): void {
    const marcado = (evento.target as HTMLInputElement).checked;
    this.borrador.update((actual) => ({
      ...actual,
      regiones: marcado
        ? [...actual.regiones, valor]
        : actual.regiones.filter((region) => region !== valor),
    }));
    this.mensajeLocal.set(null);
  }

  alEnviarFormulario(evento: Event): void {
    evento.preventDefault();
    this.guardarCambios();
  }

  guardarCambios(): void {
    if (this.guardando()) return;

    const borrador = this.borrador();
    const titulo = borrador.titulo.trim();
    if (!titulo) {
      this.mensajeLocal.set('El título del caso es obligatorio.');
      return;
    }

    if (borrador.regiones.length === 0) {
      this.mensajeLocal.set('Seleccione al menos una región.');
      return;
    }

    // `core.casos.tematica_id` es NOT NULL y el catálogo no tiene un valor
    // «sin clasificar»: el alta se detiene aquí en vez de esperar un 422.
    if (!borrador.tematica) {
      this.mensajeLocal.set('Seleccione la temática.');
      return;
    }

    // El código no se pide ni se valida: lo emite `core.siguiente_codigo_caso`.
    // Los opcionales vacíos se omiten para que el servidor aplique su valor por
    // defecto en vez de recibir una cadena vacía (que rechazaría con 422).
    const cuerpo: CuerpoCasoAlta = {
      titulo,
      regiones: [...borrador.regiones],
    };
    cuerpo.tematica = borrador.tematica;
    if (borrador.subsector) cuerpo.subsector = borrador.subsector;
    if (borrador.riesgo) cuerpo.riesgo = borrador.riesgo;
    if (borrador.unidadResponsable) cuerpo.unidadResponsable = borrador.unidadResponsable;
    if (borrador.resumen.trim()) cuerpo.resumen = borrador.resumen.trim();
    if (borrador.fechaInicio) cuerpo.fechaInicio = borrador.fechaInicio;

    const territorio = this.territorio();
    if (territorio?.tipo === 'distrito') cuerpo.distritoPrincipalId = territorio.id;
    if (territorio?.tipo === 'lugar') cuerpo.lugarId = territorio.id;

    this.mensajeLocal.set(null);
    this.guardar.emit(cuerpo);
  }

  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrar.emit();
  }

  alTecla(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFoco(evento);
  }

  /**
   * Elegir un distrito marca su región si no estaba: un caso no debería quedar
   * con un distrito de una región que no figura entre las regiones del
   * expediente, y exigir que se marque a mano invita al descuadre.
   */
  alElegirTerritorio(opcion: OpcionTerritorio | null): void {
    this.territorio.set(opcion);
    this.mensajeLocal.set(null);
    if (!opcion) return;

    const region = opcion.region.trim();
    if (!region || this.borrador().regiones.includes(region)) return;
    this.borrador.update((actual) => ({
      ...actual,
      regiones: [...actual.regiones, region],
    }));
  }

  /** El panel es modal: Tab y Shift+Tab ciclan dentro de él. */
  private atraparFoco(evento: KeyboardEvent): void {
    const panel = this.panel()?.nativeElement;
    if (!panel) return;

    const enfocables = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    );

    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    if (!primero || !ultimo) return;

    const activo = document.activeElement;

    if (!evento.shiftKey && activo === ultimo) {
      evento.preventDefault();
      primero.focus();
      return;
    }

    if (evento.shiftKey && (activo === primero || !panel.contains(activo))) {
      evento.preventDefault();
      ultimo.focus();
    }
  }
}
