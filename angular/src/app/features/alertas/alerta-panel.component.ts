import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import type { ErrorApi } from '../../core/http/errores';
import { IconoComponent } from '../../shared/ui/icono.component';
import {
  TerritorioBuscadorComponent,
  type OpcionTerritorio,
} from '../../shared/ui/territorio-buscador.component';
import {
  PRIORIDADES_ALERTA,
  NIVELES_ALERTA,
  OPCIONES_NIVEL,
  PASO_APROBACION_DEFINITIVA,
  type AccionFlujo,
  type Alerta,
  type AltaAlerta,
  type OpcionPrioridadAlerta,
  type PatchAlerta,
  accionesDeFlujo,
  aJsonLineas,
  clavePrioridad as clavePrioridadDe,
  claseEstado as claseEstadoDe,
  etapaDeFlujo,
  formatearPlazo as formatearPlazoDe,
} from './alerta.mapeo';

type BorradorAlerta = {
  titulo: string;
  prioridad: string;
  nivel: string;
  situacionActual: string;
  hechosRecientes: string;
  descripcionRiesgo: string;
  accionesOaipcs: string;
  accionesSugeridas: string;
  casoCode: string;
};

type CampoBorrador = keyof BorradorAlerta;

type BorradorAlta = {
  titulo: string;
  prioridad: string;
  casoCode: string;
  descripcionRiesgo: string;
  hechosRecientes: string;
  situacionActual: string;
  accionesOaipcs: string;
};

type CampoAlta = keyof BorradorAlta;

const BORRADOR_ALTA_VACIO: BorradorAlta = {
  titulo: '',
  prioridad: '',
  casoCode: '',
  descripcionRiesgo: '',
  hechosRecientes: '',
  situacionActual: '',
  accionesOaipcs: '',
};

/** `undefined` = no cambió; `null` = se vació a propósito. */
function diferenciaTexto(valor: string, original: string | null): string | null | undefined {
  const limpio = valor.trim();
  if (limpio === (original ?? '').trim()) return undefined;
  return limpio ? limpio : null;
}

/**
 * Panel lateral derecho de una alerta.
 *
 * Reemplaza la navegación a otra vista: el listado queda detrás y el recorrido
 * de cinco pasos y la edición ocurren aquí. Es un diálogo modal (`role="dialog"`,
 * `aria-modal`), se cierra con Escape o con el fondo y encierra el foco con Tab.
 *
 * Sirve también de alta: `alerta === null` abre el formulario de registro en
 * lugar de la ficha. En ambos casos no conoce HTTP: emite el cuerpo ya armado
 * (alta) o el diff parcial y el paso de destino (edición).
 */
@Component({
  selector: 'app-alerta-panel',
  imports: [IconoComponent, TerritorioBuscadorComponent],
  templateUrl: './alerta-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }

    /* El drawer global mide 600 px; la ficha necesita algo más de aire. */
    .drawer {
      width: min(640px, 100%);
    }

    .alerta-panel-cabecera {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    .alerta-panel-codigo {
      margin: 0;
      color: #8a98a5;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.7px;
      text-transform: uppercase;
    }


    .alerta-panel-badges {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
    }

    .alerta-prioridad--critica {
      background: #f9ecea;
      color: #a84f49;
    }
    .alerta-prioridad--urgente {
      background: #fff3e5;
      color: #a6732d;
    }
    .alerta-prioridad--temprana {
      background: #eef3fa;
      color: #4a6b93;
    }
    .alerta-prioridad--seguimiento {
      background: #f0f3f5;
      color: #657684;
    }
    .alerta-prioridad--sin-prioridad {
      background: #f6f7f8;
      color: #8b97a1;
    }

    .alerta-plazo {
      background: #f0f3f5;
      color: #657684;
    }
    .alerta-plazo--sin {
      background: #f6f7f8;
      color: #8b97a1;
    }

    .alerta-nivel {
      background: #eef3fa;
      color: #4a6b93;
    }

    .alerta-grave {
      background: #f9ecea;
      color: #a84f49;
      font-weight: 700;
    }

    .alerta-panel-cuerpo {
      gap: 16px;
    }

    .alerta-seccion {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .alerta-seccion h3 {
      margin: 0;
      color: #33475b;
      font: 700 13px var(--font-display);
    }

    .alerta-texto {
      margin: 0;
      color: #52677a;
      font-size: 13px;
      line-height: 1.65;
      white-space: pre-line;
    }

    .alerta-nota {
      margin: 0;
      color: #8d99a6;
      font-size: 12.5px;
      line-height: 1.5;
    }

    .alerta-vacio {
      margin: 0;
      color: #a0aab3;
      font-size: 13px;
      font-style: italic;
    }

    .alerta-aviso {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0;
      padding: 8px 10px;
      border-radius: 6px;
      background: #edf6f0;
      color: #52806a;
      font-size: 13px;
    }

    .alerta-aviso span {
      flex: 1;
      min-width: 0;
      line-height: 1.5;
    }

    .alerta-deshacer {
      flex-shrink: 0;
      height: auto;
      padding: 2px 8px;
      font-size: 12px;
    }

    .alerta-confirmacion {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 4px;
      padding: 10px 12px;
      border: 1px solid #e6e0cf;
      border-radius: 8px;
      background: #fdfaf1;
    }

    .alerta-confirmacion-titulo {
      margin: 0;
      color: #7d6a35;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.6px;
      text-transform: uppercase;
    }

    .alerta-error {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
      border: 1px solid #f0d9d5;
      border-radius: 6px;
      background: #fdf6f5;
      color: #a3402f;
      font-size: 13px;
    }
    .alerta-error p {
      margin: 0;
    }

    .alerta-etapa {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: 0;
      color: #465a6c;
      font-size: 13px;
    }

    .alerta-etapa-estado {
      padding: 2px 7px;
      border-radius: 10px;
      background: #eef3fa;
      color: #4a6b93;
      font-size: 12px;
      font-weight: 600;
    }

    .alerta-acciones {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 2px;
    }

    .alerta-accion {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      height: auto;
      padding: 8px 10px;
      text-align: left;
      white-space: normal;
    }

    .alerta-accion small {
      color: #8d99a6;
      font-size: 12px;
      font-weight: 400;
      line-height: 1.4;
    }

    .alerta-formulario {
      display: flex;
      flex-direction: column;
      gap: 11px;
      padding-top: 12px;
      border-top: 1px solid #eef2f6;
    }

    .alerta-formulario .form-textarea {
      min-height: 68px;
    }

    .alerta-formulario-acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .alerta-datos {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px 16px;
      margin: 0;
    }

    .alerta-datos > div {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .alerta-datos dt {
      color: #97a1aa;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .alerta-datos dd {
      margin: 0;
      color: #465a6c;
      font-size: 13px;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }

    .alerta-lista {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0;
      padding-left: 16px;
      color: #52677a;
      font-size: 13px;
      line-height: 1.5;
    }

    .alerta-alta-ayuda {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }

    .alerta-alta-formulario {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .alerta-alta-plazo {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin: 0;
      padding: 7px 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--canvas);
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
    }

    .alerta-alta-plazo strong {
      color: var(--ink);
      font-weight: 700;
    }

    .alerta-alta-grave {
      padding: 1px 7px;
      border-radius: 10px;
      background: var(--red-pale);
      color: var(--red);
      font-size: 12px;
      font-weight: 700;
    }

    .alerta-alta-catalogo {
      margin: 0;
      color: var(--muted);
      font-size: 12.5px;
      line-height: 1.4;
    }
  `,
})
export class AlertaPanelComponent {
  readonly alerta = input<Alerta | null>(null);
  readonly cargando = input(false);
  readonly errorCarga = input<ErrorApi | null>(null);
  readonly puedeModificar = input(false);
  readonly guardando = input(false);
  readonly errorGuardado = input<string | null>(null);
  readonly aviso = input<string | null>(null);
  /** Paso al que se puede volver tras un cambio exitoso; `null` oculta «Deshacer». */
  readonly pasoDeshacer = input<number | null>(null);
  /** Código del caso con el que se presiembra el alta (pantalla filtrada por caso). */
  readonly casoInicial = input('');
  /** Prioridades de `GET /api/v1/catalogs` → `catalogs.prioridadesAlerta`. */
  readonly prioridadesCatalogo = input<readonly OpcionPrioridadAlerta[]>([]);
  readonly cargandoPrioridades = input(false);
  readonly errorPrioridades = input<ErrorApi | null>(null);

  readonly cerrar = output<void>();
  readonly reintentar = output<void>();
  readonly guardar = output<PatchAlerta>();
  readonly registrar = output<AltaAlerta>();
  readonly accion = output<number>();
  readonly deshacer = output<void>();

  readonly prioridades = PRIORIDADES_ALERTA;
  readonly niveles = NIVELES_ALERTA;

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly botonConfirmar = viewChild<ElementRef<HTMLButtonElement>>('botonConfirmar');
  private readonly destruccion = inject(DestroyRef);

  /** Elemento que tenía el foco al abrir, para devolvérselo al cerrar. */
  private readonly focoPrevio =
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);

  readonly editando = signal(false);
  readonly borrador = signal<BorradorAlerta | null>(null);
  readonly borradorAlta = signal<BorradorAlta>(BORRADOR_ALTA_VACIO);
  /**
   * Distrito elegido en el alta. Se guarda aparte del borrador porque el
   * buscador emite un objeto y `BorradorAlta` sólo guarda texto de campos
   * nativos.
   */
  readonly distritoAlta = signal<OpcionTerritorio | null>(null);
  /**
   * Distrito de la alerta en edición. Se siembra con el que ya está guardado para
   * que el buscador no arranque vacío; cualquier edición de texto lo invalida
   * (el componente emite `null`) para que lo guardado no contradiga lo visible.
   */
  readonly distritoEdicion = signal<OpcionTerritorio | null>(null);
  /**
   * El usuario ya confirmó guardar un distrito distinto del caso. Sin esto, el
   * formulario pide la confirmación explícita en vez de pisar la diferencia.
   */
  readonly divergenciaAceptada = signal(false);
  readonly mensajeLocal = signal<string | null>(null);

  /** Acción de aprobación elegida que espera confirmación explícita (item 23). */
  readonly aprobacionPendiente = signal<AccionFlujo | null>(null);

  readonly formulario = computed(() => (this.editando() ? this.borrador() : null));

  /** `alerta === null` significa alta. */
  readonly esAlta = computed(() => this.alerta() === null);

  /** Semilla del buscador en edición: el distrito ya guardado. */
  readonly inicialDistritoEdicion = computed(() => {
    const distrito = this.distritoEdicion();
    if (distrito?.tipo !== 'distrito') return null;
    return { id: distrito.id, nombre: distrito.nombre, ruta: distrito.ruta };
  });

  /** Distrito que se enviaría al guardar; `null` si la caja no tiene uno válido. */
  readonly distritoEdicionId = computed(() => {
    const distrito = this.distritoEdicion();
    return distrito?.tipo === 'distrito' ? distrito.id : null;
  });

  /**
   * Hay diferencia cuando ambos lados declaran distrito y no es el mismo. Es
   * información, no error: la alerta puede ocurrir en otro punto del territorio
   * que el expediente (una movilización en Lima por un proyecto en Chilca).
   */
  readonly distritoDivergente = computed(() => {
    const alerta = this.alerta();
    const id = this.distritoEdicionId();
    return Boolean(
      alerta &&
      this.editando() &&
      id !== null &&
      alerta.casoDistritoId !== null &&
      id !== alerta.casoDistritoId,
    );
  });

  /** Semilla del buscador en el alta: se ofrece el distrito del caso, si lo hay. */
  readonly distritoDelCaso = computed(() => {
    const alerta = this.alerta();
    if (!alerta || alerta.casoDistritoId === null || !alerta.casoDistrito) return null;
    return {
      id: alerta.casoDistritoId,
      nombre: alerta.casoDistrito,
      ruta: alerta.casoDistritoRuta ?? alerta.casoDistrito,
    };
  });

  /**
   * Prioridades del alta: el catálogo manda; si aún no llegó (o falló) se cae al
   * vocabulario congelado, que `createAlert` resuelve por `normalizar_ref`.
   */
  readonly opcionesPrioridad = computed<readonly OpcionPrioridadAlerta[]>(() => {
    const catalogo = this.prioridadesCatalogo();
    if (catalogo.length > 0) return catalogo;
    return PRIORIDADES_ALERTA.map((prioridad) => ({
      valor: prioridad,
      etiqueta: prioridad,
      slaHoras: null,
      grave: false,
    }));
  });

  readonly prioridadElegida = computed(() => {
    const valor = this.borradorAlta().prioridad;
    return this.opcionesPrioridad().find((opcion) => opcion.valor === valor) ?? null;
  });

  readonly etapa = computed(() => {
    const alerta = this.alerta();
    return alerta ? etapaDeFlujo(alerta.pasoActual) : null;
  });

  readonly acciones = computed<readonly AccionFlujo[]>(() => {
    const alerta = this.alerta();
    return alerta ? accionesDeFlujo(alerta.pasoActual) : [];
  });

  constructor() {
    afterNextRender(() => this.panel()?.nativeElement.focus());

    // Escape cierra el panel aunque el foco se haya ido a un bloque de texto.
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

    // Tras un guardado correcto el contenedor publica un aviso: el formulario se
    // cierra para mostrar lo ya persistido en lugar del borrador.
    effect(() => {
      if (this.aviso()) {
        this.editando.set(false);
        this.borrador.set(null);
        this.aprobacionPendiente.set(null);
      }
    });

    // La confirmación pertenece a la alerta y a su paso actual: si cambia la
    // fila o el paso, no se arrastra el diálogo anterior.
    let firmaAbierta: string | null = null;
    effect(() => {
      const alerta = this.alerta();
      const firma = alerta ? `${alerta.id}:${alerta.pasoActual}` : null;
      if (firma === firmaAbierta) return;
      firmaAbierta = firma;
      this.aprobacionPendiente.set(null);
    });

    // Al aparecer la confirmación, el foco va al botón que la resuelve.
    effect(() => {
      if (!this.aprobacionPendiente()) return;
      this.botonConfirmar()?.nativeElement.focus();
    });

    // El alta se siembra limpia y con el caso del contexto, si lo hay.
    effect(() => {
      if (!this.esAlta()) return;
      this.borradorAlta.set({ ...BORRADOR_ALTA_VACIO, casoCode: this.casoInicial().trim() });
      this.distritoAlta.set(null);
      this.mensajeLocal.set(null);
    });
  }

  formatearPlazo(horas: number | null): string {
    return formatearPlazoDe(horas);
  }

  clavePrioridad(prioridad: Alerta['prioridad']): string {
    return clavePrioridadDe(prioridad);
  }

  claseEstado(estado: string): string {
    return claseEstadoDe(estado);
  }

  porcentaje(valor: number | null): string {
    return valor === null ? '—' : `${Math.round(valor * 100)} %`;
  }

  /**
   * La aprobación definitiva no se envía al pulsar la acción: se pide
   * confirmación en línea con el código, el título y el responsable.
   */
  elegirAccion(transicion: AccionFlujo): void {
    if (transicion.paso === PASO_APROBACION_DEFINITIVA) {
      this.aprobacionPendiente.set(transicion);
      return;
    }
    this.aprobacionPendiente.set(null);
    this.accion.emit(transicion.paso);
  }

  cancelarConfirmacion(): void {
    if (this.guardando()) return;
    this.aprobacionPendiente.set(null);
  }

  confirmarAprobacion(): void {
    const aprobacion = this.aprobacionPendiente();
    if (!aprobacion || this.guardando() || !this.puedeModificar()) return;
    this.accion.emit(aprobacion.paso);
    this.aprobacionPendiente.set(null);
  }

  iniciarEdicion(): void {
    const alerta = this.alerta();
    if (!alerta) return;

    this.borrador.set({
      titulo: alerta.titulo ?? '',
      prioridad: alerta.prioridad ?? '',
      nivel: alerta.nivel ?? '',
      situacionActual: alerta.situacionActual ?? '',
      hechosRecientes: alerta.hechosRecientes ?? '',
      descripcionRiesgo: alerta.descripcionRiesgo ?? '',
      accionesOaipcs: alerta.accionesOaipcs ?? '',
      accionesSugeridas: alerta.accionesSugeridas.join('\n'),
      casoCode: alerta.casoCodigo ?? '',
    });
    this.distritoEdicion.set(
      alerta.distritoId !== null && alerta.distrito
        ? {
            tipo: 'distrito',
            id: alerta.distritoId,
            nombre: alerta.distrito,
            region: '',
            ruta: alerta.distritoRuta ?? alerta.distrito,
          }
        : null,
    );
    this.divergenciaAceptada.set(false);
    this.mensajeLocal.set(null);
    this.editando.set(true);
  }

  cancelarEdicion(): void {
    this.editando.set(false);
    this.borrador.set(null);
    this.distritoEdicion.set(null);
    this.divergenciaAceptada.set(false);
    this.mensajeLocal.set(null);
  }

  campo(clave: CampoBorrador, evento: Event): void {
    const objetivo = evento.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const valor = objetivo.value;
    this.borrador.update((actual) => (actual ? { ...actual, [clave]: valor } : actual));
  }

  campoAlta(clave: CampoAlta, evento: Event): void {
    const objetivo = evento.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const valor = objetivo.value;
    this.borradorAlta.update((actual) => ({ ...actual, [clave]: valor }));
  }

  alElegirDistrito(opcion: OpcionTerritorio | null): void {
    this.distritoAlta.set(opcion);
  }

  alElegirDistritoEdicion(opcion: OpcionTerritorio | null): void {
    this.distritoEdicion.set(opcion);
    this.divergenciaAceptada.set(false);
    this.mensajeLocal.set(null);
  }

  /**
   * Copia el distrito principal del caso al formulario. Es un botón y no una
   * herencia silenciosa: en la base hay alertas que ocurren en otro territorio
   * que el expediente y ese dato no se debe perder.
   */
  usarDistritoDelCaso(): void {
    const caso = this.distritoDelCaso();
    if (!caso) return;
    this.distritoEdicion.set({
      tipo: 'distrito',
      id: caso.id,
      nombre: caso.nombre,
      region: '',
      ruta: caso.ruta,
    });
    this.divergenciaAceptada.set(false);
    this.mensajeLocal.set('Distrito fijado al del caso. Guarde para aplicarlo.');
  }

  /** Acepta la diferencia actual para que el guardado no vuelva a preguntar. */
  mantenerDistritoDeLaAlerta(): void {
    this.divergenciaAceptada.set(true);
    this.mensajeLocal.set('Se conservará el distrito de la alerta, distinto del caso.');
  }

  alEnviarAlta(evento: Event): void {
    evento.preventDefault();
    this.guardarAlta();
  }

  /**
   * Alta: sólo se valida lo que `createAlert` exige (título y prioridad). Los
   * opcionales vacíos se omiten para que el repositorio aplique sus valores por
   * defecto (`visibilidad` interna, `pasoActual` 1).
   */
  guardarAlta(): void {
    if (!this.puedeModificar() || this.guardando()) return;

    const borrador = this.borradorAlta();
    const titulo = borrador.titulo.trim();
    if (!titulo) {
      this.mensajeLocal.set('El título es obligatorio para registrar la alerta.');
      return;
    }

    const prioridad = borrador.prioridad.trim();
    if (!prioridad) {
      this.mensajeLocal.set('La prioridad es obligatoria para registrar la alerta.');
      return;
    }

    const cuerpo: AltaAlerta = { titulo, prioridad };

    // El buscador está restringido a distritos: `core.alertas_tempranas` no
    // tiene lugares operativos y un lugar no se puede degradar a un distrito.
    const distrito = this.distritoAlta();
    if (distrito?.tipo === 'distrito') cuerpo.distritoId = distrito.id;

    const casoCode = borrador.casoCode.trim();
    if (casoCode) cuerpo.casoCode = casoCode;

    const descripcion = borrador.descripcionRiesgo.trim();
    if (descripcion) cuerpo.descripcionRiesgo = descripcion;

    const hechos = borrador.hechosRecientes.trim();
    if (hechos) cuerpo.hechosRecientes = hechos;

    const situacion = borrador.situacionActual.trim();
    if (situacion) cuerpo.situacionActual = situacion;

    const acciones = borrador.accionesOaipcs.trim();
    if (acciones) cuerpo.accionesOaipcs = acciones;

    this.mensajeLocal.set(null);
    this.registrar.emit(cuerpo);
  }

  alEnviarFormulario(evento: Event): void {
    evento.preventDefault();
    this.guardarCambios();
  }

  guardarCambios(): void {
    const alerta = this.alerta();
    const borrador = this.borrador();
    if (!alerta || !borrador) return;

    const cambios: PatchAlerta = {};

    const titulo = borrador.titulo.trim();
    if (titulo && titulo !== (alerta.titulo ?? '')) cambios.titulo = titulo;

    if (borrador.prioridad !== (alerta.prioridad ?? '')) {
      cambios.prioridad = borrador.prioridad || null;
    }

    // El repositorio resuelve el nivel por `codigo_legado` o por `nombre`; se
    // envía el código heredado porque no depende del rename de la migración 14.
    const nivelActual =
      alerta.nivelCodigo ??
      OPCIONES_NIVEL.find((opcion) => opcion.etiqueta === alerta.nivel)?.valor ??
      '';
    const nivelElegido =
      OPCIONES_NIVEL.find((opcion) => opcion.etiqueta === borrador.nivel)?.valor ?? '';
    if (nivelElegido !== nivelActual) cambios.nivel = nivelElegido || null;

    const situacion = diferenciaTexto(borrador.situacionActual, alerta.situacionActual);
    if (situacion !== undefined) cambios.situacionActual = situacion;

    const hechos = diferenciaTexto(borrador.hechosRecientes, alerta.hechosRecientes);
    if (hechos !== undefined) cambios.hechosRecientes = hechos;

    const descripcion = diferenciaTexto(borrador.descripcionRiesgo, alerta.descripcionRiesgo);
    if (descripcion !== undefined) cambios.descripcionRiesgo = descripcion;

    const acciones = diferenciaTexto(borrador.accionesOaipcs, alerta.accionesOaipcs);
    if (acciones !== undefined) cambios.accionesOaipcs = acciones;

    const sugeridas = aJsonLineas(borrador.accionesSugeridas.split('\n'));
    const sugeridasPrevias = alerta.accionesSugeridas.length ? alerta.accionesSugeridas : null;
    if ((sugeridas ?? []).join('\n') !== (sugeridasPrevias ?? []).join('\n')) {
      cambios.accionesSugeridas = sugeridas;
    }

    const caso = borrador.casoCode.trim();
    if (caso !== (alerta.casoCodigo ?? '')) cambios.casoCode = caso || null;

    const distritoNuevo = this.distritoEdicionId();
    if (distritoNuevo !== alerta.distritoId) {
      // `null` limpia el distrito; un id lo fija. Ausente en el cuerpo = sin
      // cambio, y así el repositorio puede heredar el del caso sin pisarlo.
      if (
        !this.divergenciaAceptada() &&
        distritoNuevo !== null &&
        alerta.casoDistritoId !== null &&
        distritoNuevo !== alerta.casoDistritoId
      ) {
        const nombreNuevo = this.distritoEdicion()?.nombre ?? 'el elegido';
        this.mensajeLocal.set(
          `El distrito de la alerta (${nombreNuevo}) no coincide con el del caso (${alerta.casoDistrito}). Use «Usar el del caso» o confirme con «Mantener el de la alerta».`,
        );
        return;
      }
      cambios.distritoId = distritoNuevo;
    }

    if (Object.keys(cambios).length === 0) {
      this.mensajeLocal.set('No hay cambios que guardar.');
      return;
    }

    this.mensajeLocal.set(null);
    this.guardar.emit(cambios);
  }

  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrar.emit();
  }

  alTecla(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFoco(evento);
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
