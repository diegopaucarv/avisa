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

import { RouterLink } from '@angular/router';

import { urlApi } from '../../core/config/entorno';
import { consulta } from '../../core/http/consulta';
import { esRegistro, leer, lista, texto } from '../../dominio/mapeo';
import { IconoComponent } from '../../shared/ui/icono.component';
import { salirModal } from '../../shared/ui/modal-salida';
import {
  TerritorioBuscadorComponent,
  type OpcionTerritorio,
} from '../../shared/ui/territorio-buscador.component';

import {
  etiquetaCriterio as etiquetaDeCriterio,
  type DuplicadoCandidatoFila,
} from './duplicados.mapeo';

/** Cuerpo de `POST /api/v1/cases`. El código lo emite el servidor. */
export type CuerpoCasoAlta = {
  titulo: string;
  regiones: string[];
  subsector?: string;
  riesgo?: string;
  /** Texto libre: qué riesgo se observa hoy en el caso. */
  descripcionRiesgo?: string;
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

type CatalogosAlta = {
  regiones: OpcionCatalogo[];
  subsectores: OpcionCatalogo[];
  riesgos: OpcionCatalogo[];
  unidades: OpcionCatalogo[];
};

type BorradorCaso = {
  titulo: string;
  regiones: string[];
  subsector: string;
  riesgo: string;
  descripcionRiesgo: string;
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

/** `GET /api/v1/catalogs` reducido a los selects del alta. */
export function aCatalogosAlta(bruto: unknown): CatalogosAlta {
  const registro = esRegistro(bruto) ? bruto : {};
  const crudo = leer(registro, ['catalogs', 'catalogos']);
  const catalogo = esRegistro(crudo) ? crudo : {};

  return {
    regiones: opcionesDe(catalogo, 'regiones'),
    subsectores: opcionesDe(catalogo, 'subsectores'),
    riesgos: opcionesDe(catalogo, 'nivelesRiesgo'),
    unidades: opcionesDe(catalogo, 'unidades'),
  };
}

const CATALOGOS_VACIOS: CatalogosAlta = {
  regiones: [],
  subsectores: [],
  riesgos: [],
  unidades: [],
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
  imports: [RouterLink, IconoComponent, TerritorioBuscadorComponent],
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
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.7px;
      text-transform: uppercase;
    }

    .caso-panel-sub {
      margin: 4px 0 0;
      color: #647487;
      font-size: 13px;
      line-height: 1.5;
    }

    .caso-formulario {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* Rótulos del modal en mayúsculas (ajuste del 22 nov). */
    .form-label {
      text-transform: uppercase;
    }

    /*
     * Campos del alta sin recuadro: sólo rótulo tenue y valor, separados por
     * espacio del flujo del formulario. Los colores salen de variables de tema
     * para no romper el modo noche.
     */
    .form-campo {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .form-campo > span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    /*
     * Descripción del riesgo y nivel en la misma fila: el texto ocupa el ancho
     * disponible y el nivel queda a su derecha, como pide el diseño.
     */
    .fila-riesgo {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 190px;
      gap: 12px;
      align-items: start;
    }

    @media (max-width: 640px) {
      .fila-riesgo {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    .caso-formulario .form-input,
    .caso-formulario .form-select,
    .caso-formulario .form-textarea {
      border: 0;
      border-radius: 0;
      background: transparent;
      padding-left: 0;
      padding-right: 0;
      color: var(--ink);
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
      font-size: 13.5px;
      line-height: 1.4;
    }

    .caso-region-opcion input {
      flex: none;
      margin: 0;
    }

    /* «Nacional» no es una región más: cubre todo el país y anula la elección
       territorial, así que ocupa la fila entera y se distingue del resto. */
    .caso-region-nacional {
      grid-column: 1 / -1;
      padding: 4px 6px;
      border: 1px solid #dbe3ea;
      border-radius: 6px;
      background: rgba(100, 116, 135, 0.06);
      font-weight: 600;
    }

    /* Con «Nacional» marcado las regiones quedan inertes: se atenúan para que
       se vea que no cuentan. */
    .caso-region-opcion input:disabled ~ span {
      opacity: 0.45;
    }

    .caso-formulario-acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 2px;
    }

    /* Aviso de duplicados: se lee antes de confirmar, no después. */
    .duplicados-aviso {
      margin: 0 0 12px;
      padding: 11px 12px;
      border: 1px solid #e8d3a3;
      border-radius: 7px;
      background: #fdf8ec;
    }

    .duplicados-aviso h3 {
      margin: 0 0 3px;
      color: #7a5a16;
      font: 700 14px var(--font-display);
    }

    .duplicados-lista {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 10px 0 0;
      padding: 0;
      list-style: none;
    }

    .duplicado-item {
      padding: 8px 9px;
      border: 1px solid #e6e0cd;
      border-radius: 6px;
      background: #fff;
    }

    .duplicado-item.descartado {
      border-style: dashed;
      background: rgba(100, 116, 135, 0.05);
    }

    .duplicado-cabecera {
      display: flex;
      align-items: baseline;
      gap: 7px;
    }

    .duplicado-titulo {
      color: #22303f;
      font-size: 13.5px;
      line-height: 1.35;
    }

    .duplicado-meta {
      margin: 3px 0 0;
      color: #647487;
      font-size: 12.5px;
    }

    .duplicado-criterios {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin: 6px 0 0;
    }

    .duplicado-chip {
      padding: 1px 7px;
      border: 1px solid #e8d3a3;
      border-radius: 10px;
      background: #fff;
      color: #7a5a16;
      font-size: 11.5px;
      font-weight: 600;
    }

    .duplicado-item .button-secondary {
      margin-top: 7px;
    }
  `,
})
export class CasoPanelComponent {
  readonly guardando = input(false);
  readonly errorGuardado = input<string | null>(null);

  /**
   * Posibles duplicados del título/distrito en curso. El contenedor los pide
   * antes de confirmar; el panel sólo los muestra y permite descartarlos.
   */
  readonly duplicados = input<readonly DuplicadoCandidatoFila[]>([]);
  readonly verificando = input(false);
  /** Códigos de los candidatos ya marcados como «no es duplicado». */
  readonly descartes = input<readonly string[]>([]);
  readonly errorDuplicados = input<string | null>(null);

  readonly cerrar = output<void>();

  /** Cierra con la animación de salida y luego avisa al contenedor. */
  cerrarConSalida(): void {
    salirModal(this.panel()?.nativeElement, () => this.cerrar.emit());
  }
  readonly guardar = output<CuerpoCasoAlta>();
  /** Pide registrar que el candidato (por código) no es un duplicado. */
  readonly descartar = output<string>();

  readonly borrador = signal<BorradorCaso>({
    titulo: '',
    regiones: [],
    subsector: '',
    riesgo: '',
    descripcionRiesgo: '',
    unidadResponsable: '',
    resumen: '',
    fechaInicio: '',
  });
  readonly mensajeLocal = signal<string | null>(null);

  /**
   * Cobertura nacional: la API exige al menos una región y deriva el alcance de
   * ellas, así que «Nacional» se representa enviando todo el catálogo de
   * regiones (ver `guardarCambios`). La marca sólo vive en el formulario.
   */
  readonly nacional = signal(false);

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
  readonly subsectores = computed(() => this.catalogos().subsectores);
  readonly riesgos = computed(() => this.catalogos().riesgos);
  readonly unidades = computed(() => this.catalogos().unidades);
  readonly cargandoCatalogos = computed(() => this.catalogoRecurso.estado() === 'cargando');

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly buscadorTerritorio = viewChild(TerritorioBuscadorComponent);
  private readonly destruccion = inject(DestroyRef);

  /** Elemento que tenía el foco al abrir, para devolvérselo al cerrar. */
  private readonly focoPrevio =
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);

  constructor() {
    afterNextRender(() => this.panel()?.nativeElement.focus({ preventScroll: true }));

    // El panel se cierra con Escape, con el clic fuera o con la ✕: ya no hay
    // guarda por cambios escritos, que dejaría el alta sin salida rápida.
    const alEscape = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      this.cerrarConSalida();
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

  /**
   * Marcar «Nacional» limpia territorios y regiones: el alcance deja de venir
   * de una selección concreta. Desmarcarlo devuelve la elección a las regiones.
   */
  alternarNacional(evento: Event): void {
    const marcado = (evento.target as HTMLInputElement).checked;
    this.nacional.set(marcado);
    this.mensajeLocal.set(null);
    if (!marcado) return;

    // Limpia la ubicación elegida también en el buscador (mantiene su propio
    // estado visual); su `limpiar()` emite `elegido(null)`, que aquí no rearma
    // «Nacional» porque el handler sale antes con `!opcion`.
    this.buscadorTerritorio()?.limpiar();
    this.territorio.set(null);
    this.borrador.update((actual) => ({ ...actual, regiones: [] }));
  }

  /**
   * Texto del botón de envío. Con el aviso a la vista, el segundo envío confirma
   * el registro («Registrar igualmente»): nunca se envía dos veces sin avisar.
   */
  readonly textoEnviar = computed(() => {
    if (this.guardando()) return 'Registrando…';
    if (this.verificando()) return 'Verificando duplicados…';
    return this.duplicados().length > 0 ? 'Registrar igualmente' : 'Registrar caso';
  });

  etiquetaCriterio(criterio: DuplicadoCandidatoFila['coincidencias'][number]): string {
    return etiquetaDeCriterio(criterio);
  }

  estaDescartado(candidato: DuplicadoCandidatoFila): boolean {
    return this.descartes().includes(candidato.codigo);
  }

  alEnviarFormulario(evento: Event): void {
    evento.preventDefault();
    this.guardarCambios();
  }

  guardarCambios(): void {
    if (this.guardando() || this.verificando()) return;

    const borrador = this.borrador();
    const titulo = borrador.titulo.trim();
    if (!titulo) {
      this.mensajeLocal.set('El título del caso es obligatorio.');
      return;
    }

    if (!this.nacional() && borrador.regiones.length === 0) {
      this.mensajeLocal.set('Seleccione al menos una región o marque «Nacional».');
      return;
    }

    // El código no se pide ni se valida: lo emite `core.siguiente_codigo_caso`.
    // Los opcionales vacíos se omiten para que el servidor aplique su valor por
    // defecto en vez de recibir una cadena vacía (que rechazaría con 422).
    //
    // «Nacional» no se envía como tal: el alcance es derivado y la API rechaza
    // cualquier `alcance`/`alcanceId` (422 ALCANCE_DERIVADO) además de exigir
    // regiones. La única vía para que `core.alcance_caso` devuelva «Nacional»
    // es enviar regiones que cubran más de un alcance, así que se envía todo el
    // catálogo de regiones. Requiere confirmación de producto: el caso queda
    // vinculado a las 25 regiones.
    const regiones = this.nacional()
      ? this.regiones().map((region) => region.valor)
      : [...borrador.regiones];
    const cuerpo: CuerpoCasoAlta = {
      titulo,
      regiones,
    };
    if (borrador.subsector) cuerpo.subsector = borrador.subsector;
    if (borrador.riesgo) cuerpo.riesgo = borrador.riesgo;
    if (borrador.descripcionRiesgo.trim()) {
      cuerpo.descripcionRiesgo = borrador.descripcionRiesgo.trim();
    }
    if (borrador.unidadResponsable) cuerpo.unidadResponsable = borrador.unidadResponsable;
    if (borrador.resumen.trim()) cuerpo.resumen = borrador.resumen.trim();
    if (borrador.fechaInicio) cuerpo.fechaInicio = borrador.fechaInicio;

    const territorio = this.territorio();
    if (territorio?.tipo === 'distrito') cuerpo.distritoPrincipalId = territorio.id;
    if (territorio?.tipo === 'lugar') cuerpo.lugarId = territorio.id;

    this.mensajeLocal.set(null);
    this.guardar.emit(cuerpo);
  }

  alTecla(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFoco(evento);
  }

  /** El clic fuera cierra; arrastrar dentro del contenido no. */
  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrarConSalida();
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

    // Elegir un territorio concreto implica alcance territorial: se deja de
    // estar en «Nacional» para que la selección de regiones vuelva a mandar.
    this.nacional.set(false);

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
