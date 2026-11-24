import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { urlApi } from '../../core/config/entorno';
import { normalizarColeccion, urlConParametros } from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { aFoto, esFotoPintable, fotoPrincipal, type Foto } from '../../dominio/medios';
import { IconoComponent } from '../../shared/ui/icono.component';
import {
  aActorDirectorio,
  aDatosPersonales,
  errorDeDni,
  errorDeExpedienteOspa,
  errorDeRuc,
  formatearFechaDdMmAaaa,
  FUNCIONES_ACTOR,
  MASCARA_CORREO,
  MASCARA_DNI,
  nivelIdentificacionDe,
  POSICIONAMIENTOS_ACTOR,
  SIN_DATO,
  TIPOS_ACTOR,
  type ActorDirectorio,
  type DatosPersonales,
} from './directorio.mapeo';

/**
 * Motivo que se envía con la solicitud de PII. La base lo registra en
 * `audit.datos_personales_acceso` antes de descifrar (principio de finalidad,
 * Ley 29733); por eso debe ser concreto y no un texto genérico de relleno.
 */
const MOTIVO_PII = 'Consulta de datos personales desde el directorio';

const NIVELES_GOBIERNO = ['Nacional', 'Regional', 'Local', 'Empresa', 'Sociedad Civil'] as const;

type EstadoPii =
  | 'inactivo'
  | 'cargando'
  /** Los campos descifrados ya están en pantalla. */
  | 'listo'
  /** 200 con `tieneFicha: false`: el actor no tiene fila de datos personales. */
  | 'sin_ficha'
  /** 403: el rol no autoriza PII (no se ofrece reintento). */
  | 'prohibido'
  | 'error';
type CampoActorEdicion =
  | 'nombre'
  | 'abreviatura'
  | 'naturaleza'
  | 'tipo'
  | 'funcion'
  | 'posicionamiento'
  | 'cargo'
  | 'nivelGobierno'
  | 'categoria'
  | 'perfilDescripcion'
  | 'dni'
  | 'ruc'
  | 'expedienteOspa'
  | 'estadoOspa'
  | 'vigenciaDesde'
  | 'vigenciaHasta';
type ActorEdicion = Record<CampoActorEdicion, string> & { activo: boolean };

/**
 * Ficha lateral de un actor del directorio.
 *
 * Se abre al pulsar una fila; no navega. Toda la caracterización viene del
 * listado (`GET /api/v1/actors`) y se pinta al instante. Los datos personales
 * (DNI y teléfono) son la única excepción: se piden sólo al pulsar «Ver datos
 * personales», con un motivo explícito, y se descartan al cerrar el panel o
 * cambiar de actor. El correo de contacto del listado sí se muestra sin gate.
 *
 * No usa `consulta` para la PII a propósito: esa fachada cachea por URL y
 * conservaría la PII en memoria. Las fotos sí lo usan, porque son públicas.
 */
@Component({
  selector: 'app-actor-panel',
  imports: [IconoComponent],
  templateUrl: './actor-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }

    /* El drawer global mide 600 px; la ficha se lee mejor algo más estrecha. */
    .drawer {
      width: min(560px, 100%);
    }

    /* El cuerpo cede el alto justo para que el pie quede anclado abajo. */
    .drawer-body {
      flex: 1 1 auto;
      min-height: 0;
    }

    /* Cabecera: foto cuadrada pequeña + identidad, sin insignias. */
    .panel-cabecera {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .panel-foto {
      display: grid;
      flex: none;
      width: 64px;
      height: 64px;
      place-items: center;
      overflow: hidden;
      border-radius: 8px;
      background: #eef2f6;
      color: #607284;
      font: 700 20px/1 var(--font-display);
    }

    .panel-foto img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .panel-identidad {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .panel-identidad h2 {
      overflow: hidden;
      margin: 0;
      color: #1c2a38;
      font: 700 17px/1.3 var(--font-display);
      text-overflow: ellipsis;
    }

    /* Cargo y organización: máximo dos líneas cada uno. */
    .panel-linea {
      display: -webkit-box;
      overflow: hidden;
      color: #647487;
      font-size: 12.5px;
      line-height: 1.35;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
    }

    /* Estado de baja lógica: ámbar, nunca verde (no es «cumplido»). */
    .panel-inactivo {
      color: #aa6a11;
      font-weight: 700;
    }

    /* Valor restringido por PII: máscara, no un hueco ni una cifra inventada. */
    .panel-enmascarado {
      color: #97a1aa;
      letter-spacing: 0.08em;
    }

    /* Dos columnas: contacto a la izquierda, organización y región a la derecha. */
    .panel-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px 20px;
      border-bottom: 1px solid #eef2f6;
      padding-bottom: 14px;
    }

    .panel-col {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-width: 0;
    }

    .panel-campo {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .panel-etiqueta {
      color: #97a1aa;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .panel-valor {
      color: #465a6c;
      font-size: 13px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .panel-dato {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .panel-dato .panel-valor {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .boton-copiar {
      flex: none;
      padding: 2px 6px;
      border: 1px solid #dce3e8;
      border-radius: 5px;
      background: #fff;
      color: #526577;
      font-size: 11.5px;
      line-height: 1.4;
      cursor: pointer;
    }

    .boton-copiar:hover {
      background: #f5f7f8;
    }

    .panel-seccion {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .panel-seccion h3 {
      margin: 0;
      color: #7b8896;
      font: 700 11px var(--font-display);
      letter-spacing: 0.6px;
      text-transform: uppercase;
    }

    .panel-perfil {
      margin: 0;
      color: #52677a;
      font-size: 13px;
      line-height: 1.65;
      white-space: pre-line;
    }

    .panel-nota {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      margin: 0;
      color: #7d8b98;
      font-size: 12px;
      line-height: 1.5;
    }

    .panel-nota app-icono {
      margin-top: 1px;
      color: #96a3af;
    }

    .panel-pii {
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: flex-start;
    }

    .panel-pii-boton {
      min-height: 30px;
      padding: 0 10px;
    }

    .panel-error {
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

    .panel-error p {
      margin: 0;
    }

    .panel-vacio {
      margin: 0;
      color: #a0aab3;
      font-size: 13px;
      font-style: italic;
    }

    /* Posicionamiento: un color por valor del catálogo. */
    .panel-posicionamiento {
      display: inline-flex;
      width: max-content;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
    }

    .panel-posicionamiento::before {
      content: '';
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentcolor;
    }

    .pos-dialogante {
      background: #edf6f0;
      color: #2f7a52;
    }

    .pos-legitimante {
      background: #eef2fb;
      color: #31599f;
    }

    .pos-conflictivo {
      background: #fdeceb;
      color: #b03a2e;
    }

    .pos-sin {
      background: #f0f3f5;
      color: #657684;
    }

    /* Pie: «Agregar a lista temporal» a la izquierda, Cerrar/Editar a la derecha. */
    .panel-pie {
      align-items: center;
      justify-content: space-between;
    }

    .panel-pie-acciones {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Formulario de edición por bloques numerados. */
    .actor-editor {
      display: grid;
      gap: 16px;
    }

    .actor-bloque {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid #eef2f6;
    }

    .actor-bloque h3 {
      grid-column: 1 / -1;
      margin: 0;
      color: #33475b;
      font: 700 11.5px var(--font-display);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .actor-bloque .ancho {
      grid-column: 1 / -1;
    }

    .actor-bloque label {
      display: grid;
      gap: 5px;
      color: #596c7e;
      font-size: 12.5px;
      font-weight: 600;
    }

    .actor-bloque input:not([type='checkbox']),
    .actor-bloque select,
    .actor-bloque textarea {
      width: 100%;
      min-height: 34px;
      padding: 7px 9px;
      border: 1px solid #dce3e8;
      border-radius: 6px;
      background: #fff;
      color: #33475b;
      font: inherit;
      font-weight: 400;
    }

    .actor-bloque input:disabled,
    .actor-bloque select:disabled {
      background: #f5f7f8;
      color: #8a98a5;
      cursor: not-allowed;
    }

    .actor-bloque textarea {
      resize: vertical;
    }

    .actor-pista {
      color: #97a1aa;
      font-size: 11.5px;
      font-weight: 400;
    }

    .actor-estado {
      display: flex !important;
      align-items: center;
      gap: 8px !important;
    }

    .actor-editor-acciones {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    @media (max-width: 520px) {
      .panel-grid,
      .actor-bloque {
        grid-template-columns: 1fr;
      }

      .actor-bloque h3,
      .actor-bloque .ancho {
        grid-column: 1;
      }
    }
  `,
})
export class ActorPanelComponent {
  readonly actor = input<ActorDirectorio | null>(null);
  /** Abre la ficha directamente en modo edición (acción «Editar» de la tabla). */
  readonly editarInicial = input(false);
  /** Indica si el actor ya está en la lista temporal, para alternar la etiqueta. */
  readonly enLista = input(false);

  readonly cerrar = output<void>();
  readonly actualizado = output<ActorDirectorio>();
  readonly alternarLista = output<void>();
  /** El contenedor abre el panel de baja lógica con el motivo. */
  readonly solicitarBaja = output<void>();
  /** El contenedor restaura el actor (activo = true). */
  readonly solicitarRestaurar = output<void>();

  private readonly http = inject(HttpClient);
  private readonly capacidades = inject(CapacidadesService);
  private readonly destruccion = inject(DestroyRef);

  /** El botón de PII sólo existe si el rol tiene el permiso. */
  readonly puedeVerPii = this.capacidades.puedeVerPii;
  readonly puedeEditar = computed(() =>
    this.capacidades.puedeModificar(this.actor()?.clasificacion),
  );
  readonly tiposActor = TIPOS_ACTOR;
  readonly funcionesActor = FUNCIONES_ACTOR;
  readonly posicionamientos = POSICIONAMIENTOS_ACTOR;
  readonly nivelesGobierno = NIVELES_GOBIERNO;

  readonly editando = signal(false);
  readonly guardandoEdicion = signal(false);
  readonly errorEdicion = signal<string | null>(null);
  readonly borrador = signal<ActorEdicion>({
    nombre: '',
    abreviatura: '',
    naturaleza: 'persona',
    tipo: '',
    funcion: '',
    posicionamiento: '',
    cargo: '',
    nivelGobierno: '',
    categoria: '',
    perfilDescripcion: '',
    dni: '',
    ruc: '',
    expedienteOspa: '',
    estadoOspa: '',
    vigenciaDesde: '',
    vigenciaHasta: '',
    activo: true,
  });

  readonly estadoPii = signal<EstadoPii>('inactivo');
  readonly errorPii = signal<string | null>(null);
  readonly datos = signal<DatosPersonales | null>(null);

  /** Valor copiado recientemente, para confirmar la acción. */
  readonly copiado = signal<string | null>(null);
  private temporizadorCopiado?: ReturnType<typeof setTimeout>;

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** Fotografía principal del actor; `null` pinta las iniciales. */
  private readonly media = consulta<Foto[]>({
    fuente: () => {
      const id = this.actor()?.id;
      if (!id) return null;
      return urlConParametros(urlApi('/v1/media'), {
        entidadTipo: 'actor',
        entidadId: id,
        pageSize: '1',
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return coleccion.elementos.map(aFoto).filter(esFotoPintable);
    },
  });

  readonly foto = computed(() => fotoPrincipal(this.media.valor() ?? []));

  readonly iniciales = computed(() => {
    const nombre = this.actor()?.nombre ?? '';
    return nombre
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((parte) => parte[0]?.toUpperCase() ?? '')
      .join('');
  });

  /** `true` cuando el DNI y el teléfono auditados ya están en pantalla. */
  readonly piiVisible = computed(() => this.estadoPii() === 'listo');

  /**
   * `true` cuando la UI sabe que no hay PII que mostrar por falta de permiso:
   * el rol no puede descifrar o la API respondió 403. Se distingue de «sin
   * dato», que es una fila existente con el campo vacío.
   */
  readonly sinAutorizacionPii = computed(
    () => !this.puedeVerPii() || this.estadoPii() === 'prohibido',
  );

  /** Organización: la ficha muestra RUC y OSPA en lugar de membresía. */
  readonly esOrganizacion = computed(() => this.actor()?.naturaleza === 'Organización');

  readonly nivelIdentificacion = computed(() =>
    nivelIdentificacionDe(this.actor()?.nivelIdentificacion),
  );

  readonly vigenciaDesdeTexto = computed(() => formatearFechaDdMmAaaa(this.actor()?.vigenciaDesde));
  readonly vigenciaHastaTexto = computed(() => formatearFechaDdMmAaaa(this.actor()?.vigenciaHasta));

  /** Correo de una organización: contacto institucional público del listado. */
  readonly correoOrganizacion = computed(() =>
    this.esOrganizacion() ? (this.actor()?.email ?? null) : null,
  );

  readonly correoContacto = computed(() => this.datos()?.email ?? null);
  readonly telefonoContacto = computed(() => this.datos()?.telefono ?? null);

  /** Texto de dato ausente y máscara, expuestos a la plantilla. */
  readonly sinDato = SIN_DATO;
  readonly mascaraDni = MASCARA_DNI;
  readonly mascaraCorreo = MASCARA_CORREO;

  /** `dd/mm/aaaa` de una fecha ISO; `null` si no se reconoce. */
  fechaDe(valor: string | null | undefined): string | null {
    return formatearFechaDdMmAaaa(valor);
  }

  /** Clase de color del posicionamiento; `sin` cuando la base no lo declara. */
  readonly clasePosicionamiento = computed(() => {
    const valor = (this.actor()?.posicionamiento ?? '').toLowerCase();
    if (valor.includes('dialogante')) return 'pos-dialogante';
    if (valor.includes('legitimante')) return 'pos-legitimante';
    if (valor.includes('conflictivo')) return 'pos-conflictivo';
    return 'pos-sin';
  });

  /** Elemento que tenía el foco al abrir, para devolvérselo al cerrar. */
  private readonly focoPrevio =
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);

  /** Identificador de la ficha cuyos datos personales se están mostrando. */
  private actorVigente: string | null = null;
  /** Evita reabrir la edición en cada recálculo del efecto. */
  private edicionForzadaAplicada = false;

  constructor() {
    afterNextRender(() => this.panel()?.nativeElement.focus());

    // Al cambiar de fila se descarta cualquier PII del actor anterior: la ficha
    // no debe arrastrar datos de una selección previa.
    effect(() => {
      const id = this.actor()?.id ?? null;
      if (id === this.actorVigente) return;
      this.actorVigente = id;
      this.reiniciarPii();
    });

    // «Editar» desde la tabla abre la ficha ya en modo edición.
    effect(() => {
      const quiereEditar = this.editarInicial();
      if (!quiereEditar) {
        this.edicionForzadaAplicada = false;
        return;
      }
      const actor = this.actor();
      if (!actor || this.edicionForzadaAplicada || !this.puedeEditar()) return;
      this.edicionForzadaAplicada = true;
      this.iniciarEdicion();
    });

    // Escape cierra el panel aunque el foco se haya ido a un bloque de texto.
    const alEscape = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      this.cerrar.emit();
    };
    document.addEventListener('keydown', alEscape);

    this.destruccion.onDestroy(() => {
      document.removeEventListener('keydown', alEscape);
      clearTimeout(this.temporizadorCopiado);
      this.focoPrevio?.focus?.();
      this.reiniciarPii();
    });
  }

  iniciarEdicion(): void {
    const actor = this.actor();
    if (!actor || !this.puedeEditar()) return;
    this.borrador.set({
      nombre: actor.nombre,
      abreviatura: actor.abreviatura ?? '',
      naturaleza: actor.naturaleza === 'Organización' ? 'organizacion' : 'persona',
      tipo: actor.tipo ?? '',
      funcion: actor.funcion ?? '',
      posicionamiento: actor.posicionamiento ?? '',
      cargo: actor.cargo ?? '',
      nivelGobierno: actor.nivelGobierno ?? '',
      categoria: actor.categoria ?? '',
      perfilDescripcion: actor.perfil ?? '',
      // El DNI sólo se precarga cuando ya se descifró con motivo: escribir a
      // ciegas sobre el campo no debe borrar el valor cifrado existente.
      dni: this.piiVisible() ? (this.datos()?.dni ?? '') : '',
      ruc: actor.ruc ?? '',
      expedienteOspa: actor.expedienteOspa ?? '',
      estadoOspa: actor.estadoOspa ?? '',
      vigenciaDesde: actor.vigenciaDesde ?? '',
      vigenciaHasta: actor.vigenciaHasta ?? '',
      activo: actor.activo,
    });
    this.errorEdicion.set(null);
    this.editando.set(true);
  }

  cancelarEdicion(): void {
    this.errorEdicion.set(null);
    this.editando.set(false);
  }

  actualizarTexto(campo: CampoActorEdicion, evento: Event): void {
    const valor = (evento.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)
      .value;
    this.borrador.update((actual) => ({ ...actual, [campo]: valor }));
  }

  actualizarActivo(evento: Event): void {
    this.borrador.update((actual) => ({
      ...actual,
      activo: (evento.target as HTMLInputElement).checked,
    }));
  }

  guardarEdicion(evento: Event): void {
    evento.preventDefault();
    const actor = this.actor();
    const draft = this.borrador();
    if (!actor || !this.puedeEditar() || this.guardandoEdicion()) return;
    if (!draft.nombre.trim()) {
      this.errorEdicion.set('El nombre del actor es obligatorio.');
      return;
    }

    const esOrganizacion = draft.naturaleza === 'organizacion';

    // El DNI sólo viaja si hay autorización PII y el usuario escribió uno: un
    // campo vacío no debe borrar el valor cifrado almacenado.
    const dni = draft.dni.trim();
    if (dni) {
      if (!this.piiVisible() || !this.puedeVerPii()) {
        this.errorEdicion.set('Solicite «Ver datos personales» antes de editar el DNI.');
        return;
      }
      const error = errorDeDni(dni);
      if (error) {
        this.errorEdicion.set(error);
        return;
      }
    }

    const ruc = draft.ruc.trim();
    if (esOrganizacion && ruc) {
      const error = errorDeRuc(ruc);
      if (error) {
        this.errorEdicion.set(error);
        return;
      }
    }

    const expedienteError = errorDeExpedienteOspa(draft.expedienteOspa);
    if (esOrganizacion && expedienteError) {
      this.errorEdicion.set(expedienteError);
      return;
    }

    if (esOrganizacion && draft.vigenciaDesde && draft.vigenciaHasta) {
      if (draft.vigenciaHasta < draft.vigenciaDesde) {
        this.errorEdicion.set('La vigencia OSPA no puede terminar antes de empezar.');
        return;
      }
    }

    this.guardandoEdicion.set(true);
    this.errorEdicion.set(null);

    // `activo` no viaja por la edición: la baja y la restauración tienen su
    // propio flujo con motivo y auditoría (panel de anulación).
    const payload: Record<string, unknown> = {
      nombre: draft.nombre,
      abreviatura: draft.abreviatura || null,
      cargo: draft.cargo || null,
      categoria: draft.categoria || null,
      perfilDescripcion: draft.perfilDescripcion || null,
      nivelGobierno: draft.nivelGobierno.replace(/ /g, '_') || null,
      tipo: draft.tipo || undefined,
      funcion: draft.funcion || undefined,
      posicionamiento: draft.posicionamiento || null,
    };

    if (dni) payload['dni'] = dni;

    if (esOrganizacion) {
      payload['ruc'] = ruc || null;
      payload['expedienteOspa'] = draft.expedienteOspa.trim() || null;
      payload['estadoOspa'] = draft.estadoOspa.trim() || null;
      payload['vigenciaDesde'] = draft.vigenciaDesde || null;
      payload['vigenciaHasta'] = draft.vigenciaHasta || null;
    }

    this.http
      .patch<unknown>(urlApi(`/v1/actors/${encodeURIComponent(actor.id)}`), payload)
      .pipe(takeUntilDestroyed(this.destruccion))
      .subscribe({
        next: (respuesta) => {
          this.actualizado.emit(aActorDirectorio(respuesta));
          this.editando.set(false);
          this.guardandoEdicion.set(false);
        },
        error: (fallo: unknown) => {
          this.errorEdicion.set(aErrorApi(fallo).message);
          this.guardandoEdicion.set(false);
        },
      });
  }

  /**
   * Pide DNI, correo y teléfonos. Nunca se llama al cargar la ficha: sólo desde
   * el botón, y una sola vez por pulsación (el estado `cargando` frena el doble
   * envío para no duplicar el registro de auditoría).
   */
  solicitarPii(): void {
    const ficha = this.actor();
    if (!ficha?.id) return;

    if (!this.puedeVerPii()) {
      this.estadoPii.set('prohibido');
      this.errorPii.set('Su rol no permite ver datos personales.');
      return;
    }

    if (this.estadoPii() === 'cargando') return;

    this.estadoPii.set('cargando');
    this.errorPii.set(null);
    this.datos.set(null);

    const url = urlConParametros(urlApi(`/v1/actors/${encodeURIComponent(ficha.id)}/pii`), {
      motivo: MOTIVO_PII,
    });

    this.http
      .get<unknown>(url)
      .pipe(takeUntilDestroyed(this.destruccion))
      .subscribe({
        next: (bruto) => {
          const datos = aDatosPersonales(bruto);
          this.datos.set(datos);
          // «sin ficha» no es un error ni «sin autorización»: el actor existe y
          // su rol alcanza, pero no registró datos personales.
          this.estadoPii.set(datos.tieneFicha ? 'listo' : 'sin_ficha');
        },
        error: (fallo: unknown) => {
          const error = aErrorApi(fallo);
          this.datos.set(null);

          if (error.esProhibido) {
            // Sin reintento automático: insistir sólo repetiría el 403.
            this.errorPii.set('Su rol no permite ver datos personales.');
            this.estadoPii.set('prohibido');
            return;
          }

          this.errorPii.set(error.message);
          this.estadoPii.set('error');
        },
      });
  }

  /** Descarta lo mostrado sin cerrar el panel; un nuevo acceso vuelve a auditarse. */
  ocultarPii(): void {
    this.reiniciarPii();
  }

  /** Copia al portapapeles y confirma el valor copiado durante un instante. */
  copiar(valor: string | null | undefined, evento?: Event): void {
    evento?.stopPropagation();
    if (!valor) return;

    void navigator.clipboard?.writeText(valor);
    this.copiado.set(valor);
    clearTimeout(this.temporizadorCopiado);
    this.temporizadorCopiado = setTimeout(() => this.copiado.set(null), 1600);
  }

  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrar.emit();
  }

  alTecla(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFoco(evento);
  }

  private reiniciarPii(): void {
    this.datos.set(null);
    this.errorPii.set(null);
    this.estadoPii.set('inactivo');
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
