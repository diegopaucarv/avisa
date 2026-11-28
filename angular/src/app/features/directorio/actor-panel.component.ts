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
import { Router, RouterLink } from '@angular/router';
import { from, switchMap } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { normalizarColeccion, urlConParametros } from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { resolverUrlMedia } from '../../core/http/url-media';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { aFoto, esFotoPintable, fotoPrincipal, urlFoto, type Foto } from '../../dominio/medios';
import { BotonAccionComponent } from '../../shared/ui/boton-accion.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { esDialogoSuperior, salirModal } from '../../shared/ui/modal-salida';
import {
  aActorDirectorio,
  aCasosDeActor,
  aDatosPersonales,
  errorDeCorreo,
  errorDeDni,
  errorDeExpedienteOspa,
  errorDeRuc,
  errorDeTelefono,
  formatearFechaActor,
  FUNCIONES_ACTOR,
  MASCARA_CORREO,
  MASCARA_DNI,
  POSICIONAMIENTOS_ACTOR,
  regionesDerivadasDeCasos,
  SIN_DATO,
  TIPOS_ACTOR,
  type ActorDirectorio,
  type CasoVinculadoActor,
  type DatosPersonales,
  type MembresiaActor,
  type OpcionCatalogo,
} from './directorio.mapeo';
import { parsearFicha, PLANTILLA_FICHA } from './ficha-plantilla';

/**
 * Motivo que se envía con la solicitud de PII. La base lo registra en
 * `audit.datos_personales_acceso` antes de descifrar (principio de finalidad,
 * Ley 29733); por eso debe ser concreto y no un texto genérico de relleno.
 */
const MOTIVO_PII = 'Consulta de datos personales desde el directorio';

/**
 * Mismo tope que aplica `POST /api/v1/media` al contenido en bytes (2 MiB). Se
 * valida en el cliente para avisar antes de subir una imagen que el servidor
 * rechazará igualmente.
 */
const MAX_FOTO_BYTES = 2 * 1024 * 1024;

/**
 * Lee un archivo como data-URL (`data:image/png;base64,...`).
 *
 * La API de medios acepta tanto base64 puro como el prefijo data-URL, así que se
 * envía el resultado tal cual y el servidor se queda con el MIME del prefijo.
 */
function leerArchivoBase64(archivo: File): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onerror = () => rechazar(new Error('No se pudo leer la imagen.'));
    lector.onload = () => {
      const resultado = lector.result;
      if (typeof resultado !== 'string') {
        rechazar(new Error('No se pudo leer la imagen.'));
        return;
      }
      resolver(resultado);
    };
    lector.readAsDataURL(archivo);
  });
}

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
  | 'region'
  | 'organizacion'
  | 'perfilDescripcion'
  | 'dni'
  | 'telefono'
  | 'email'
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
  imports: [IconoComponent, BotonAccionComponent, RouterLink],
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

    .panel-cabecera-acciones {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
    }

    .panel-foto {
      position: relative;
      display: grid;
      flex: none;
      width: 128px;
      height: 128px;
      place-items: center;
      overflow: hidden;
      border-radius: 10px;
      background: #eef2f6;
      color: #607284;
      font: 700 38px/1 var(--font-display);
    }

    /* Lápiz sobre la foto: sólo existe en edición, para elegir un archivo. */
    .panel-foto-editar {
      position: absolute;
      right: 6px;
      bottom: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      padding: 0;
      border: 1px solid rgb(255 255 255 / 80%);
      border-radius: 50%;
      background: rgb(17 32 45 / 72%);
      color: #fff;
      cursor: pointer;
    }

    .panel-foto-editar:hover {
      background: rgb(17 32 45 / 88%);
    }

    .panel-foto-editar:focus-visible {
      outline: 2px solid #3576c5;
      outline-offset: 2px;
    }

    /* El input real queda oculto: lo dispara el lápiz. */
    .foto-input {
      display: none;
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

    .panel-pista {
      font-size: 12px;
      color: #8b97a1;
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
      /* Texto largo de lectura: se justifica para que el bloque no quede
         desparejo, pero se conserva pre-line para respetar los saltos. */
      text-align: justify;
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

    /* Pie: sólo «Agregar/Quitar de la lista de asistencia» a la izquierda. */
    .panel-pie {
      align-items: center;
      justify-content: space-between;
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

    .actor-pista-acciones {
      display: flex;
      gap: 8px;
      margin-top: 6px;
    }

    .actor-pista-acciones button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12.5px;
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

    /* Combobox de organización: cabecera y pie fijos; la lista es la que hace scroll. */
    .combo-org-campo {
      min-width: 0;
    }

    .combo-org-etiqueta {
      display: block;
      margin-bottom: 5px;
      color: #596c7e;
      font-size: 12.5px;
      font-weight: 600;
    }

    .combo-org {
      position: relative;
      min-width: 0;
    }

    .combo-org-disparador {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
      min-height: 34px;
      padding: 6px 9px;
      border: 1px solid #dce3e8;
      border-radius: 6px;
      background: #fff;
      color: #33475b;
      font: inherit;
      font-weight: 400;
      text-align: left;
      cursor: pointer;
    }

    .combo-org-disparador:hover {
      border-color: #1f5597;
    }

    .combo-org-valor {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }

    .combo-org-panel {
      position: absolute;
      right: 0;
      left: 0;
      z-index: 40;
      display: flex;
      flex-direction: column;
      max-height: 320px;
      margin-top: 4px;
      padding: 6px;
      border: 1px solid #dce5ef;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 12px 32px rgb(25 45 68 / 14%);
    }

    .combo-org-buscador {
      display: flex;
      flex: none;
      align-items: center;
      gap: 6px;
      padding: 5px 7px;
      border: 1px solid #e0e6ec;
      border-radius: 6px;
      background: #f9fbfd;
      color: #8b97a1;
    }

    .combo-org-buscador input {
      flex: 1;
      min-width: 0;
      border: 0;
      background: transparent;
      color: #17283a;
      font: inherit;
      font-size: 13px;
      outline: none;
    }

    /* Altura máxima fija con scroll: el pie con «Añadir nueva» queda siempre a la vista. */
    .combo-org-lista {
      flex: 1 1 auto;
      min-height: 0;
      max-height: 220px;
      overflow-y: auto;
      margin: 4px 0 0;
      padding: 0;
      list-style: none;
    }

    .combo-org-opcion {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
      padding: 6px 8px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #17283a;
      font: inherit;
      font-size: 13px;
      text-align: left;
      cursor: pointer;
    }

    .combo-org-opcion-lectura {
      cursor: default;
    }

    .combo-org-opcion:hover,
    .combo-org-opcion.combo-org-resaltado {
      background: #eef3fa;
    }

    /* En lectura las filas no son elegibles: sin realce de hover que engañe. */
    .combo-org-opcion-lectura:hover {
      background: transparent;
    }

    .combo-org-opcion-lectura.combo-org-resaltado {
      background: #eef3fa;
    }

    .combo-org-opcion[aria-selected='true'] {
      background: #e3edf9;
    }

    .combo-org-nombre {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .combo-org-abrev {
      flex: none;
      color: #8b97a1;
      font-size: 11.5px;
      font-weight: 600;
    }

    .combo-org-vacio {
      padding: 8px 6px;
      color: #99a3aa;
      font-size: 12.5px;
      font-style: italic;
    }

    .combo-org-pie {
      flex: none;
      margin-top: 4px;
      padding-top: 4px;
      border-top: 1px solid #eef2f6;
    }

    .combo-org-nueva {
      width: 100%;
      padding: 7px 8px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #1f5597;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
    }

    .combo-org-nueva:hover {
      background: #eef3fa;
    }

    /* Casos vinculados: enlace a la ficha del caso, en la sección de actores. */
    .panel-casos {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .panel-caso {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 6px 8px;
      border: 1px solid #eef2f6;
      border-radius: 6px;
      color: inherit;
      text-decoration: none;
    }

    .panel-caso:hover {
      border-color: #cddbe9;
      background: #f8fafc;
    }

    .panel-caso-codigo {
      flex: none;
      color: #8b97a1;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
    }

    .panel-caso-nombre {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      color: #33475b;
      font-size: 13px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .panel-caso-region {
      flex: none;
      color: #7d8b98;
      font-size: 11.5px;
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
  /** Membresías vigentes de la persona, provistas por la tabla del directorio. */
  readonly membresias = input<MembresiaActor[]>([]);
  /** Regiones del catálogo territorial para el select de la edición. */
  readonly regiones = input<OpcionCatalogo[]>([]);
  /** Abre la ficha directamente en modo edición (acción «Editar» de la tabla). */
  readonly editarInicial = input(false);
  /** Indica si el actor ya está en la lista de asistencia, para alternar la etiqueta. */
  readonly enLista = input(false);

  readonly cerrar = output<void>();

  /** Cierra con la animación de salida y luego avisa al contenedor. */
  cerrarConSalida(): void {
    salirModal(this.panel()?.nativeElement, () => this.cerrar.emit());
  }
  readonly actualizado = output<ActorDirectorio>();
  readonly alternarLista = output<void>();
  /** El contenedor abre el panel de baja lógica con el motivo. */
  readonly solicitarBaja = output<void>();
  /** El contenedor restaura el actor (activo = true). */
  readonly solicitarRestaurar = output<void>();

  private readonly http = inject(HttpClient);
  private readonly capacidades = inject(CapacidadesService);
  private readonly router = inject(Router);
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
    region: '',
    organizacion: '',
    perfilDescripcion: '',
    dni: '',
    telefono: '',
    email: '',
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

  /** Confirmación efímera de «Copiar plantilla» en la ficha en edición. */
  readonly plantillaCopiada = signal(false);
  private temporizadorPlantilla?: ReturnType<typeof setTimeout>;

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

  readonly foto = computed(() => {
    const principal = fotoPrincipal(this.media.valor() ?? []);
    if (!principal) return null;
    // `aFoto` ya resuelve la ruta relativa contra `apiBase`, pero se refuerza
    // aquí para que la foto cargue aunque el medio llegue sin resolver desde
    // otra fuente. Con una URL absoluta o `data:`/`blob:` es un no-op.
    const resuelta = resolverUrlMedia(principal.url);
    // `urlFoto` prefiere el binario de `/api/v1/media/<id>/contenido` cuando el
    // medio lo declara (`tieneContenido`), que es la fuente fiable de la imagen.
    return { ...principal, url: urlFoto({ ...principal, url: resuelta }) };
  });

  readonly iniciales = computed(() => {
    const nombre = this.actor()?.nombre ?? '';
    return nombre
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((parte) => parte[0]?.toUpperCase() ?? '')
      .join('');
  });

  /* ------------------------------------------------------------------ */
  /* Organización: buscador de organizaciones del directorio             */
  /* ------------------------------------------------------------------ */

  /** Desplegable de organizaciones abierto (en lectura y en edición). */
  readonly comboOrgAbierto = signal(false);
  /** Texto visible del buscador, sin debounce. */
  readonly comboOrgBusqueda = signal('');
  /** Término ya debounced que alimenta la consulta. */
  private readonly comboOrgTermino = signal('');
  /** Índice resaltado para el recorrido con flechas. */
  readonly comboOrgIndice = signal(-1);
  private temporizadorOrg?: ReturnType<typeof setTimeout>;

  /**
   * Organizaciones del directorio para el combobox. Se consulta al abrir (no
   * antes) para no pedir el listado en cada ficha; `q` filtra en servidor con el
   * mismo endpoint del directorio de organizaciones.
   */
  private readonly organizacionesCombo = consulta<ActorDirectorio[]>({
    fuente: () => {
      if (!this.comboOrgAbierto()) return null;
      return urlConParametros(urlApi('/v1/actors'), {
        naturaleza: 'organizacion',
        q: this.comboOrgTermino(),
        pageSize: '25',
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return coleccion.elementos.map(aActorDirectorio).filter((org) => !!org.id);
    },
  });

  /** Opciones visibles ahora mismo en el combobox. */
  readonly orgOpciones = computed(() => this.organizacionesCombo.valor() ?? []);
  readonly orgCargando = computed(() => this.organizacionesCombo.estado() === 'cargando');

  /* ------------------------------------------------------------------ */
  /* Casos en los que participa el actor                                 */
  /* ------------------------------------------------------------------ */

  private readonly casosVinculados = consulta<CasoVinculadoActor[]>({
    fuente: () => {
      const id = this.actor()?.id;
      return id ? urlApi(`/v1/actors/${encodeURIComponent(id)}/casos`) : null;
    },
    esquema: aCasosDeActor,
  });

  readonly casos = computed(() => this.casosVinculados.valor() ?? []);

  /**
   * Regiones de los casos del actor. La ficha las muestra sólo cuando el actor
   * no declara región: es un dato derivado, nunca una región asignada.
   */
  readonly regionesDerivadas = computed(() => regionesDerivadasDeCasos(this.casos()));
  readonly regionDerivadaTexto = computed(() => this.regionesDerivadas().join(', '));

  alternarComboOrganizacion(): void {
    if (this.comboOrgAbierto()) {
      this.cerrarComboOrganizacion();
      return;
    }
    clearTimeout(this.temporizadorOrg);
    this.comboOrgBusqueda.set('');
    this.comboOrgTermino.set('');
    this.comboOrgIndice.set(0);
    this.comboOrgAbierto.set(true);
  }

  cerrarComboOrganizacion(): void {
    clearTimeout(this.temporizadorOrg);
    this.comboOrgAbierto.set(false);
    this.comboOrgBusqueda.set('');
    this.comboOrgTermino.set('');
    this.comboOrgIndice.set(-1);
  }

  alBuscarOrganizacion(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.comboOrgBusqueda.set(valor);
    clearTimeout(this.temporizadorOrg);
    this.temporizadorOrg = setTimeout(() => {
      this.comboOrgTermino.set(valor.trim());
      this.comboOrgIndice.set(0);
    }, 250);
  }

  /**
   * Teclado del combobox: flechas para recorrer, Enter para elegir (sólo en
   * edición) y Escape para cerrar la lista sin cerrar la ficha. El
   * `stopPropagation` evita que el atajo global del panel cierre el drawer.
   */
  alTeclaOrganizacion(evento: KeyboardEvent): void {
    if (evento.key === 'Escape') {
      if (this.comboOrgAbierto()) {
        evento.stopPropagation();
        this.cerrarComboOrganizacion();
      }
      return;
    }

    if (!this.comboOrgAbierto()) return;
    const total = this.orgOpciones().length;
    if (total === 0) return;

    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault();
      const paso = evento.key === 'ArrowDown' ? 1 : -1;
      this.comboOrgIndice.set((this.comboOrgIndice() + paso + total) % total);
      return;
    }

    if (evento.key === 'Enter' && this.editando()) {
      const org = this.orgOpciones()[this.comboOrgIndice()];
      if (org) {
        evento.preventDefault();
        this.elegirOrganizacion(org);
      }
    }
  }

  /** Elige una organización del directorio para la membresía del actor. */
  elegirOrganizacion(org: ActorDirectorio): void {
    if (!this.editando()) return;
    this.borrador.update((actual) => ({ ...actual, organizacion: org.nombre }));
    this.cerrarComboOrganizacion();
  }

  /** Pie del combo: el alta de organización la abre la pantalla de organizaciones. */
  irNuevaOrganizacion(): void {
    this.cerrarComboOrganizacion();
    void this.router.navigate(['/directorio/organizaciones'], {
      queryParams: { alta: 'organizacion' },
    });
  }

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

  /**
   * `true` cuando el tipo elegido es «Actor público». El nivel de gobierno
   * (Nacional/Regional/Local) sólo se pregunta a las instituciones públicas:
   * un actor social o privado no se adscribe a un nivel estatal.
   */
  readonly esTipoPublico = computed(() => {
    const clave = (this.borrador().tipo || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    return clave === 'actor publico';
  });

  readonly vigenciaDesdeTexto = computed(() => formatearFechaActor(this.actor()?.vigenciaDesde));
  readonly vigenciaHastaTexto = computed(() => formatearFechaActor(this.actor()?.vigenciaHasta));

  /** Correo de una organización: contacto institucional público del listado. */
  readonly correoOrganizacion = computed(() =>
    this.esOrganizacion() ? (this.actor()?.email ?? null) : null,
  );

  readonly correoContacto = computed(() => this.datos()?.email ?? null);
  readonly telefonoContacto = computed(() => this.datos()?.telefono ?? null);

  /**
   * Datos que sólo viven en la descripción libre (plantilla markdown de
   * `docs/plantilla-ficha-actor.md`). El actor no tiene columnas para ellos.
   */
  readonly datosFicha = computed(() => parsearFicha(this.actor()?.perfil));

  /**
   * Filas de «Datos complementarios» con etiqueta y valor. Se omite «Cantidad
   * de afiliados» cuando la organización ya la trae de la base
   * (`numero_integrantes`), para no repetir el mismo número dos veces.
   */
  readonly complementarios = computed(() => {
    const datos = this.datosFicha();
    const filas: { etiqueta: string; valor: string | null }[] = [
      { etiqueta: 'Artes de pesca', valor: datos.artesDePesca },
      { etiqueta: 'Inscripción en PRODUCE', valor: datos.inscripcionProduce },
      { etiqueta: 'Vigencia de poder actual', valor: datos.vigenciaPoder },
      { etiqueta: 'Registros públicos', valor: datos.registrosPublicos },
      { etiqueta: 'Ámbito de acción', valor: datos.ambito },
      { etiqueta: 'Cantidad de afiliados', valor: datos.cantidadAfiliados },
      {
        etiqueta: 'Cantidad de organizaciones afiliadas',
        valor: datos.cantidadOrganizacionesAfiliadas,
      },
      { etiqueta: 'Capacidad de ordenar', valor: datos.capacidadOrdenar },
      { etiqueta: 'Cargo público o político', valor: datos.cargoPublico },
      { etiqueta: 'Cercanía a PRODUCE', valor: datos.cercaniaProduce },
      { etiqueta: 'Declaraciones en redes', valor: datos.declaracionesRedes },
      { etiqueta: 'Edad', valor: datos.edad },
    ];

    return this.actor()?.numeroIntegrantes != null
      ? filas.filter((fila) => fila.etiqueta !== 'Cantidad de afiliados')
      : filas;
  });

  /** Sólo se pinta la sección si la ficha siguió la plantilla en algún campo. */
  readonly hayComplementarios = computed(() =>
    this.complementarios().some((fila) => fila.valor !== null),
  );

  /** Texto de dato ausente y máscara, expuestos a la plantilla. */
  readonly sinDato = SIN_DATO;
  readonly mascaraDni = MASCARA_DNI;
  readonly mascaraCorreo = MASCARA_CORREO;

  /** Aviso tras elegir una imagen para la ficha. */
  readonly avisoFoto = signal<string | null>(null);
  private readonly fotoInput = viewChild<ElementRef<HTMLInputElement>>('fotoInput');

  abrirSelectorFoto(): void {
    this.avisoFoto.set(null);
    this.fotoInput()?.nativeElement.click();
  }

  /**
   * Sube la fotografía elegida desde el lápiz de la cabecera.
   *
   * El archivo se lee como data-URL (igual que `AdjuntosService.subir`) y se
   * envía como `contenido` base64 a `POST /api/v1/media`; la API lo decodifica,
   * calcula el hash y deja la fila servible por `/api/v1/media/<id>/contenido`.
   * Al terminar se invalida la consulta de medios para que la cabecera pinte la
   * foto nueva sin recargar la página.
   */
  alSeleccionarFoto(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const archivo = entrada.files?.[0] ?? null;
    entrada.value = '';
    if (!archivo) return;

    const actor = this.actor();
    if (!actor || !this.puedeEditar()) return;

    if (!archivo.type.startsWith('image/')) {
      this.avisoFoto.set('El archivo debe ser una imagen (JPG, PNG o WebP).');
      return;
    }
    if (archivo.size > MAX_FOTO_BYTES) {
      this.avisoFoto.set('La imagen supera el máximo de 2 MB.');
      return;
    }

    this.avisoFoto.set('Subiendo la fotografía…');
    from(leerArchivoBase64(archivo))
      .pipe(
        switchMap((contenido) =>
          this.http.post<unknown>(urlApi('/v1/media'), {
            entidadTipo: 'actor',
            entidadId: actor.id,
            rol: 'principal',
            esPrincipal: true,
            contenido,
            mime: archivo.type || null,
          }),
        ),
        takeUntilDestroyed(this.destruccion),
      )
      .subscribe({
        next: () => {
          this.avisoFoto.set('Fotografía actualizada.');
          this.media.recargar();
        },
        error: (fallo: unknown) => {
          this.avisoFoto.set(aErrorApi(fallo).message);
        },
      });
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
    afterNextRender(() => this.panel()?.nativeElement.focus({ preventScroll: true }));

    // Escape cierra la ficha aunque el foco esté en un campo de texto. La guarda
    // de pila evita cerrarla cuando la anulación o el alta están encima.
    const alEscape = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return;
      if (!esDialogoSuperior(this.panel()?.nativeElement)) return;
      evento.preventDefault();
      this.cerrarConSalida();
    };
    document.addEventListener('keydown', alEscape);

    // Al cambiar de fila se descarta cualquier PII del actor anterior: la ficha
    // no debe arrastrar datos de una selección previa.
    effect(() => {
      const id = this.actor()?.id ?? null;
      if (id === this.actorVigente) return;
      this.actorVigente = id;
      this.reiniciarPii();
      this.cerrarComboOrganizacion();
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

    // El panel se cierra con Escape, con el clic fuera o con la ✕.
    this.destruccion.onDestroy(() => {
      clearTimeout(this.temporizadorCopiado);
      clearTimeout(this.temporizadorPlantilla);
      clearTimeout(this.temporizadorOrg);
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
      region: actor.region ?? '',
      organizacion: actor.organizacionAncla ?? '',
      perfilDescripcion: actor.perfil ?? '',
      // El DNI sólo se precarga cuando ya se descifró con motivo: escribir a
      // ciegas sobre el campo no debe borrar el valor cifrado existente.
      dni: this.piiVisible() ? (this.datos()?.dni ?? '') : '',
      // Teléfono y correo se precargan sólo con PII descifrada (o el correo
      // institucional del listado); vacío significa «no lo cambie».
      telefono: this.datos()?.telefono ?? '',
      email: this.datos()?.email ?? this.correoOrganizacion() ?? '',
      ruc: actor.ruc ?? '',
      expedienteOspa: actor.expedienteOspa ?? '',
      estadoOspa: actor.estadoOspa ?? '',
      vigenciaDesde: actor.vigenciaDesde ?? '',
      vigenciaHasta: actor.vigenciaHasta ?? '',
      activo: actor.activo,
    });
    this.errorEdicion.set(null);
    this.avisoFoto.set(null);
    this.editando.set(true);
    // El DNI sólo se edita con la PII descifrada. Al abrir la edición se pide una
    // sola vez: si el rol no autoriza no se hace ninguna llamada y el campo queda
    // deshabilitado, como antes.
    this.asegurarPiiParaEdicion();
  }

  cancelarEdicion(): void {
    this.errorEdicion.set(null);
    this.avisoFoto.set(null);
    this.editando.set(false);
  }

  /**
   * Pide la PII al abrir la edición, en lugar de exigir el botón «Ver datos
   * personales» (retirado). Cada apertura que llega a la API deja su fila en
   * `audit.datos_personales_acceso`, así que el registro de quién consultó qué
   * se mantiene. No reintenta cuando el rol no autoriza ni cuando ya se cargó.
   */
  private asegurarPiiParaEdicion(): void {
    if (!this.puedeVerPii()) return;
    const estado = this.estadoPii();
    if (estado === 'inactivo' || estado === 'error') this.solicitarPii();
  }

  /**
   * Completa el borrador con la PII recién descifrada. Sólo rellena campos
   * vacíos: no pisa lo que el usuario ya escribió mientras llegaba la respuesta.
   */
  private completarBorradorConPii(datos: DatosPersonales): void {
    if (!this.editando()) return;
    this.borrador.update((actual) => ({
      ...actual,
      dni: actual.dni || datos.dni || '',
      telefono: actual.telefono || datos.telefono || '',
      email: actual.email || datos.email || '',
    }));
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
        this.errorEdicion.set(
          'El DNI aún no se descifró; espere un momento y vuelva a intentarlo.',
        );
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

    const telefono = draft.telefono.trim();
    if (telefono) {
      const error = errorDeTelefono(telefono);
      if (error) {
        this.errorEdicion.set(error);
        return;
      }
    }

    const email = draft.email.trim();
    if (email) {
      const error = errorDeCorreo(email);
      if (error) {
        this.errorEdicion.set(error);
        return;
      }
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
      perfilDescripcion: draft.perfilDescripcion || null,
      nivelGobierno: draft.nivelGobierno.replace(/ /g, '_') || null,
      tipo: draft.tipo || undefined,
      funcion: draft.funcion || undefined,
      posicionamiento: draft.posicionamiento || null,
    };

    // La región sólo viaja si de verdad cambió. Si el catálogo territorial no
    // cargó, el select queda vacío; enviarlo entonces borraría el valor guardado.
    const region = draft.region.trim();
    if (region !== (actor.region ?? '').trim()) {
      payload['region'] = region || null;
    }

    // La organización de una persona es su membresía vigente: sólo se envía si
    // cambió, para no cerrar y reabrir el vínculo en cada guardado. Las
    // organizaciones no tienen membresía propia, así que no la mandan.
    if (!esOrganizacion) {
      const organizacion = draft.organizacion.trim();
      if (organizacion !== (actor.organizacionAncla ?? '').trim()) {
        payload['organizacion'] = organizacion || null;
      }
    }

    if (dni) payload['dni'] = dni;
    // Un campo vacío no borra el valor cifrado almacenado: sólo se envía lo escrito.
    if (telefono) payload['telefono'] = telefono;
    if (email) payload['email'] = email;

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
   * Pide DNI, correo y teléfonos. Se llama al abrir la edición (una sola vez por
   * apertura) y no al cargar la ficha, para no auditar cada consulta del
   * directorio. El estado `cargando` frena el doble envío.
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
          this.completarBorradorConPii(datos);
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

  /** Copia al portapapeles y confirma el valor copiado durante un instante. */
  copiar(valor: string | null | undefined, evento?: Event): void {
    evento?.stopPropagation();
    if (!valor) return;

    void navigator.clipboard?.writeText(valor);
    this.copiado.set(valor);
    clearTimeout(this.temporizadorCopiado);
    this.temporizadorCopiado = setTimeout(() => this.copiado.set(null), 1600);
  }

  /**
   * Copia la plantilla de ficha (la que el parser realmente interpreta) para
   * que el usuario la pegue y rellene los valores entre paréntesis.
   */
  copiarPlantillaFicha(): void {
    void navigator.clipboard?.writeText(PLANTILLA_FICHA);
    this.plantillaCopiada.set(true);
    clearTimeout(this.temporizadorPlantilla);
    this.temporizadorPlantilla = setTimeout(() => this.plantillaCopiada.set(false), 1600);
  }

  alTecla(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFoco(evento);
  }

  /** El clic fuera cierra; arrastrar dentro del contenido no. */
  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrarConSalida();
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
