import { HttpClient } from '@angular/common/http';
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

import { firstValueFrom } from 'rxjs';

import { RouterLink } from '@angular/router';

import { urlApi } from '../../core/config/entorno';
import { urlConParametros } from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { aErrorApi, type ErrorApi } from '../../core/http/errores';
import {
  RIESGOS,
  booleano,
  esRegistro,
  formatearFechaCorta,
  lista,
  texto,
} from '../../dominio/mapeo';
import type { Riesgo } from '../../dominio/modelos';
import { AdjuntosPanelComponent } from '../../shared/ui/adjuntos-panel.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { salirModal } from '../../shared/ui/modal-salida';
import {
  TerritorioBuscadorComponent,
  type OpcionTerritorio,
} from '../../shared/ui/territorio-buscador.component';
import { aOpciones } from '../casos/vincular-actor.component';
import type { ActorOpcion } from '../casos/vincular-actor.component';
import {
  ALCANCES_ALERTA,
  REGIONES_PERU,
  aJsonLineas,
  claveRiesgo,
  etiquetaEstado,
  etiquetaTriaje,
  geografiaAlerta,
  hechosComoLineas,
  tituloLimpio,
  type Alerta,
  type AlcanceAlerta,
  type AltaAlerta,
  type EstadoTriaje,
  type HechoLinea,
  type PatchAlerta,
} from './alerta.mapeo';
import {
  aDuplicadosAlerta,
  etiquetaCriterioAlerta,
  type CandidatoDuplicadoAlerta,
  type CriterioDuplicadoAlerta,
} from './alerta-duplicados.mapeo';
import { CasoComboboxComponent } from './caso-combobox.component';
import {
  casoVinculadoDesde,
  leerCasoVinculado,
  recordarCasoVinculado,
  type CasoVinculado,
} from './caso-vinculado';
import {
  PLANTILLA_ALERTA_TEMPRANA,
  alcanceDesdeAmbito,
  parsearPlantillaAlerta,
} from './alerta-plantilla';
import { copiarAlPortapapeles } from './portapapeles';

/** Opción del combobox de caso: código, título y subsector del caso. */
export type CasoOpcion = { codigo: string; titulo: string; subsector: string | null };

/** Actor del caso vinculado ya listo para la ficha. */
type ActorCasoVista = { nombre: string; detalle: string | null };

/** Demanda del caso vinculado ya lista para la ficha. */
type DemandaCasoVista = { descripcion: string; estado: string | null };

/** Modo con el que se abre el panel desde el listado. */
export type ModoPanelAlerta = 'ver' | 'editar';

/** Una fila editable de las listas del formulario. */
type Linea = { id: number; texto: string };

/** Campos del borrador que se editan como lista de filas con «＋». */
type CampoLinea =
  | 'situacionActual'
  | 'hechosRecientes'
  | 'descripcionRiesgo'
  | 'actoresClave'
  | 'accionesSugeridas';

/** Fila de «Demandas inmediatas»: organización solicitante + demanda. */
type DemandaBorrador = { id: number; organizacion: string; demanda: string };

/** Campos del borrador que siguen siendo texto o selección simple. */
type CampoAlta = 'titulo' | 'region' | 'provincia';

type BorradorAlta = {
  titulo: string;
  riesgo: Riesgo | '';
  alcance: AlcanceAlerta | '';
  region: string;
  provincia: string;
  casoCode: string;
  descripcionRiesgo: Linea[];
  hechosRecientes: Linea[];
  situacionActual: Linea[];
  actoresClave: Linea[];
  demandasInmediatas: DemandaBorrador[];
  accionesSugeridas: Linea[];
};

/**
 * Borrador vacío del alta.
 *
 * Es una fábrica y no una constante: las listas son mutables y compartir los
 * mismos arrays entre aperturas arrastraría las líneas de una alerta a la
 * siguiente.
 */
function borradorAltaVacio(): BorradorAlta {
  return {
    titulo: '',
    riesgo: '',
    alcance: '',
    region: '',
    provincia: '',
    casoCode: '',
    descripcionRiesgo: [],
    hechosRecientes: [],
    situacionActual: [],
    actoresClave: [],
    demandasInmediatas: [],
    accionesSugeridas: [],
  };
}

/** `undefined` = no cambió; `null` = se vació a propósito. */
function diferenciaTexto(valor: string, original: string | null): string | null | undefined {
  const limpio = valor.trim();
  if (limpio === (original ?? '').trim()) return undefined;
  return limpio ? limpio : null;
}

/**
 * Línea de «Actores clave» desde el Directorio:
 * «Nombre – Gremio/Institución, Cargo · Tel. 9xxxxxxxx», omitiendo lo que falta.
 */
function lineaActorDirectorio(actor: ActorOpcion): string {
  const organizacion = (actor.institucion ?? actor.tipo ?? '').trim();
  const cola = [organizacion, (actor.cargo ?? '').trim()].filter(Boolean).join(', ');
  const telefono = (actor.telefono ?? '').trim();
  const base = cola ? `${actor.nombre} – ${cola}` : actor.nombre;
  return telefono ? `${base} · Tel. ${telefono}` : base;
}

/** `Distrito · Provincia · Región` → provincia y región. */
function partesDeRuta(ruta: string | null | undefined): { provincia: string; region: string } {
  const partes = (ruta ?? '')
    .split('·')
    .map((parte) => parte.trim())
    .filter((parte) => parte.length > 0);
  return { provincia: partes[1] ?? '', region: partes[2] ?? '' };
}

/** Hecho tal como lo entrega `GET /v1/alerts/{id}/hechos`. */
type HechoApi = { id: string; fecha: string | null; descripcion: string };

/** Sobre de la lista de hechos con la marca de «ya inicializada». */
type HechosAlerta = { items: HechoApi[]; inicializada: boolean };

/** Hechos cargados, atados a la alerta concreta para no mezclar paneles. */
type HechosCargados = HechosAlerta & { alertaId: string };

/**
 * Fila editable de hechos. `id` es `null` mientras sólo existe en el borrador:
 * al guardar se crea con POST. Los valores «originales» permiten enviar sólo lo
 * que de verdad cambió.
 */
type HechoBorrador = {
  clave: number;
  id: string | null;
  fecha: string;
  descripcion: string;
  fechaOriginal: string;
  descripcionOriginal: string;
};

/** Motivo que viaja en la baja lógica de un hecho quitado desde el panel. */
const MOTIVO_QUITAR_HECHO = 'Hecho quitado desde el panel de la alerta.';

/** Una fila válida de la API; una sin id o sin descripción no se puede editar. */
function aHechoApi(bruto: unknown): HechoApi | null {
  if (!esRegistro(bruto)) return null;
  const id = texto(bruto, ['id']);
  const descripcion = texto(bruto, ['descripcion']);
  if (!id || !descripcion) return null;
  const fecha = texto(bruto, ['fecha']);
  return {
    id,
    fecha: fecha && fecha.length >= 10 ? fecha.slice(0, 10) : null,
    descripcion,
  };
}

function aHechosAlerta(bruto: unknown): HechosAlerta {
  const registro = esRegistro(bruto) ? bruto : {};
  const items: HechoApi[] = [];
  for (const crudo of lista(registro, ['items'])) {
    const hecho = aHechoApi(crudo);
    if (hecho) items.push(hecho);
  }
  return { items, inicializada: booleano(registro, ['inicializada']) };
}

/**
 * Hash estable y positivo por nombre de provincia.
 *
 * El buscador de territorio sólo reaplica `inicial` cuando cambia su `id`; como
 * la provincia se guarda por nombre, se deriva un id reproducible para forzar
 * el repinte cuando cambia (al sembrar la alerta o al elegir un distrito).
 */
function claveProvincia(nombre: string): number {
  let hash = 0;
  for (let i = 0; i < nombre.length; i += 1) {
    hash = (hash * 31 + nombre.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) || 1;
}

/**
 * Panel lateral derecho de una alerta.
 *
 * Concentra la ficha y el registro. La ficha es de sólo lectura salvo por
 * «Modificar contenido», que abre el mismo formulario del alta ya prellenado.
 *
 * No conoce HTTP de escritura: emite el `PatchAlerta` ya calculado o el
 * `AltaAlerta`. Sólo lee el Directorio de actores (búsqueda) y el caso vinculado
 * (`GET /cases/{codigo}`), ambos para mostrar datos que no vienen en la alerta.
 */
@Component({
  selector: 'app-alerta-panel',
  imports: [
    IconoComponent,
    RouterLink,
    TerritorioBuscadorComponent,
    AdjuntosPanelComponent,
    CasoComboboxComponent,
  ],
  templateUrl: './alerta-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }

    .drawer {
      width: min(680px, 100%);
    }

    .alerta-cabecera {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }

    .alerta-codigo {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 4px 10px;
      margin: 0;
      color: #8a98a5;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .alerta-modificacion {
      color: #8a98a5;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: normal;
      text-transform: none;
    }

    .alerta-titulo {
      margin: 0;
      color: #17283a;
      font-size: 17px;
      font-weight: 700;
      line-height: 1.35;
      letter-spacing: -0.2px;
    }

    .alerta-insignias {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 6px;
      color: #64748b;
      font-size: 12.5px;
    }

    .alerta-geografia {
      color: #64748b;
      font-weight: 400;
    }

    .alerta-fecha {
      color: #8b97a1;
    }

    /* Sólo color: el encabezado no pinta la píldora de \`status-badge\`. */
    .alerta-riesgo {
      background: transparent;
      font-weight: 700;
    }

    /* Doble selector para vencer la píldora de \`global.css\`. */
    .alerta-riesgo.risk-bajo {
      background: transparent;
      color: #1f5597;
    }

    .alerta-riesgo.risk-medio {
      background: transparent;
      color: #b8860b;
    }

    .alerta-riesgo.risk-alto {
      background: transparent;
      color: #d9661f;
    }

    .alerta-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px 15px;
      border: 1px solid #e8edf1;
      border-radius: 11px;
      background: #fff;
    }

    .alerta-form h3 {
      margin: 0;
      color: #1a2b3e;
      font-size: 12.5px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    /* Seis secciones: el título va fuera de la caja. */
    .alerta-seccion {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .alerta-seccion-titulo {
      margin: 0;
      color: #1a2b3e;
      font-size: 12.5px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .alerta-seccion-cuerpo {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 14px 15px;
      border: 1px solid #e8edf1;
      border-radius: 11px;
      background: #fff;
    }

    .alerta-seccion p {
      margin: 0;
      color: #33475b;
      font-size: 13.5px;
      line-height: 1.6;
      white-space: pre-wrap;
    }

    .alerta-seccion ul {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0;
      padding-left: 18px;
      color: #33475b;
      font-size: 13.5px;
      line-height: 1.55;
    }

    .alerta-vacio {
      color: #99a3aa;
      font-style: italic;
    }

    /*
      Hechos en sólo lectura: fecha a la izquierda y relato a la derecha, con
      sangría francesa. En grid el texto largo se queda en su columna y no
      vuelve a caer bajo la fecha.
    */
    .hechos-lista {
      display: flex;
      flex-direction: column;
      gap: 7px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .hechos-lista li {
      display: grid;
      grid-template-columns: auto 1fr;
      column-gap: 6px;
      color: #33475b;
      font-size: 13.5px;
      line-height: 1.55;
    }

    /* Sin fecha el texto ocupa las dos columnas: si no, la rejilla lo comprime
       en la columna «auto» y el párrafo queda en una tira estrecha. */
    .hecho-texto:only-child {
      grid-column: 1 / -1;
    }

    .hecho-fecha {
      font-weight: 700;
      white-space: nowrap;
    }

    .hecho-texto {
      font-weight: 400;
    }

    /*
      Hechos editables: fecha, descripción y quitar en una rejilla. Las columnas
      usan minmax(0, …) para que un texto largo no ensanche la fila.
    */
    .hecho-fila {
      display: grid;
      grid-template-columns: minmax(0, 150px) minmax(0, 1fr) auto;
      gap: 6px;
      align-items: start;
    }

    .hecho-fila input,
    .hecho-fila textarea {
      min-width: 0;
    }

    .hecho-fila textarea {
      min-height: 38px;
      resize: vertical;
    }

    /* Subtítulos internos del bloque «Caso vinculado» (sólo lectura). */
    .caso-subtitulo {
      margin: 0;
      color: #1a2b3e;
      font-size: 11.5px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    /* Estado de la demanda heredada del caso, en gris y sin competir con el texto. */
    .demanda-estado {
      color: #99a3aa;
      font-size: 12px;
    }

    /* Listas con «＋» del formulario. */
    .bloque-lista {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      border: 1px solid #e6ecf1;
      border-radius: 7px;
      background: #fbfcfd;
    }

    .bloque-lista > .form-label {
      text-align: center;
    }

    .linea-fila {
      display: flex;
      align-items: flex-start;
      gap: 6px;
    }

    .linea-fila textarea {
      flex: 1;
      min-width: 0;
      min-height: 38px;
      resize: vertical;
    }

    /* Demandas: organización arriba, demanda debajo y quitar a la derecha. */
    .demanda-fila {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 6px;
      align-items: start;
    }

    .demanda-fila input,
    .demanda-fila textarea {
      grid-column: 1;
      min-width: 0;
    }

    .demanda-fila textarea {
      min-height: 38px;
      resize: vertical;
    }

    .demanda-fila .icon-button {
      grid-column: 2;
      grid-row: 1 / span 2;
    }

    .alerta-agregar {
      align-self: flex-start;
      padding: 5px 10px;
      border: 1px dashed #c8d6e4;
      border-radius: 7px;
      background: #fff;
      color: #1f5597;
      font: inherit;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
    }

    .alerta-agregar:hover {
      border-color: #1f5597;
    }

    /* Reporte pegado: bloque plegable para no cargar el formulario. */
    .reporte-pegado {
      padding: 8px 10px;
      border: 1px dashed #c8d6e4;
      border-radius: 8px;
      background: #fbfcfd;
    }

    .reporte-pegado summary {
      cursor: pointer;
      color: #1f5597;
      font-size: 12.5px;
      font-weight: 600;
    }

    .reporte-pegado .form-field {
      margin-top: 8px;
    }

    .reporte-acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }

    .actor-acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .actor-buscador {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
      border: 1px solid #e6ecf1;
      border-radius: 8px;
      background: #fff;
    }

    .actor-buscador-input {
      display: flex;
      align-items: center;
      gap: 8px;
      height: var(--search-alto);
      padding: 0 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--paper);
      color: var(--muted);
    }

    .actor-buscador-input:focus-within {
      border-color: var(--blue);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue) 22%, transparent);
    }

    .actor-buscador-input input {
      flex: 1;
      min-width: 0;
      border: 0;
      background: transparent;
      color: var(--ink);
      font: inherit;
      font-size: 13px;
      outline: none;
    }

    .actor-resultados {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 200px;
      overflow-y: auto;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .actor-opcion {
      display: flex;
      flex-direction: column;
      gap: 2px;
      width: 100%;
      padding: 7px 9px;
      border: 1px solid #e8edf1;
      border-radius: 7px;
      background: #fbfcfd;
      text-align: left;
      font: inherit;
      cursor: pointer;
    }

    .actor-opcion:hover {
      border-color: #1f5597;
    }

    .actor-nombre {
      color: #17283a;
      font-size: 13px;
      font-weight: 600;
    }

    .actor-meta {
      color: #8b97a1;
      font-size: 11.5px;
    }

    /* Trazabilidad: fila discreta al final del panel. */
    .alerta-traza {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 8px;
      padding: 8px 2px 0;
      border-top: 1px solid #eef2f6;
      color: #64748b;
      font-size: 12px;
    }

    .alerta-traza b {
      color: #33475b;
      font-weight: 700;
    }

    .alerta-traza-boton {
      margin-left: auto;
      padding: 0;
      border: 0;
      background: none;
      color: #1f5597;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    .alerta-traza-boton:hover {
      text-decoration: underline;
    }

    /* Aviso de duplicados del alta: se lee antes de registrar, no lo bloquea. */
    .duplicados-aviso {
      margin: 4px 0 10px;
      padding: 11px 12px;
      border: 1px solid #e8d3a3;
      border-radius: 8px;
      background: #fdf8ec;
    }

    .duplicados-aviso h3 {
      margin: 0 0 3px;
      color: #7a5a16;
      font: 700 13.5px var(--font-display, inherit);
    }

    .duplicados-aviso .form-hint {
      margin: 2px 0 0;
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

    .duplicado-cabecera {
      display: flex;
      align-items: baseline;
      gap: 7px;
    }

    .duplicado-codigo {
      color: #7a5a16;
      font: 700 12.5px var(--font-body, inherit);
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

    /* Triaje en la ficha: sólo se pinta cuando hay fila de triaje. */
    .triaje-estado {
      display: inline-block;
      padding: 2px 9px;
      border-radius: 999px;
      background: #f1ede1;
      color: #7a5a16;
      font-size: 12px;
      font-weight: 700;
    }

    .triaje-estado.triaje-duplicada {
      background: #eef3fa;
      color: #4a6b93;
    }

    .rejilla-dos {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .acciones-form {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }

    @media (max-width: 620px) {
      .rejilla-dos {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class AlertaPanelComponent {
  readonly alerta = input<Alerta | null>(null);
  readonly cargando = input(false);
  readonly errorCarga = input<ErrorApi | null>(null);
  /** Permiso para registrar y para modificar el contenido de una alerta. */
  readonly puedeModificar = input(false);
  /**
   * Sólo lectura: la ficha se abre siempre en modo consulta (nunca el alta) y
   * esconde las acciones de escritura. La usa el expediente para ver la alerta
   * vinculada sin salir del caso.
   */
  readonly soloLectura = input(false);
  readonly guardando = input(false);
  readonly errorGuardado = input<string | null>(null);
  readonly aviso = input<string | null>(null);
  readonly modoInicial = input<ModoPanelAlerta>('ver');
  /** Código del caso con el que se presiembra el alta. */
  readonly casoInicial = input('');
  /** Casos disponibles para el combobox «Caso vinculado». */
  readonly casos = input<readonly CasoOpcion[]>([]);

  readonly cerrar = output<void>();

  /** Cierra con la animación de salida y luego avisa al contenedor. */
  cerrarConSalida(): void {
    salirModal(this.panel()?.nativeElement, () => this.cerrar.emit());
  }
  readonly reintentar = output<void>();
  readonly guardar = output<PatchAlerta>();
  readonly registrar = output<AltaAlerta>();
  /** «Enviar por WhatsApp»: el contenedor abre la ventana de mensajería. */
  readonly whatsapp = output<Alerta>();

  readonly riesgos = RIESGOS;
  readonly alcances = ALCANCES_ALERTA;
  readonly regiones = REGIONES_PERU;

  private readonly http = inject(HttpClient);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly destruccion = inject(DestroyRef);

  /** Elemento que tenía el foco al abrir, para devolvérselo al cerrar. */
  private readonly focoPrevio =
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);

  readonly editando = signal(false);
  readonly borradorAlta = signal<BorradorAlta>(borradorAltaVacio());
  readonly distritoAlta = signal<OpcionTerritorio | null>(null);
  readonly mensajeLocal = signal<string | null>(null);

  /**
   * Aviso de alertas parecidas en el alta. Es advisory: informa y nunca bloquea
   * el registro. Se consulta con debounce mientras se escribe el título o se
   * elige el distrito.
   */
  readonly duplicadosAlta = signal<readonly CandidatoDuplicadoAlerta[]>([]);
  readonly verificandoDuplicados = signal(false);
  readonly errorDuplicados = signal<string | null>(null);
  private timerDuplicados: ReturnType<typeof setTimeout> | null = null;
  private turnoDuplicados = 0;

  /** Texto del botón de registro: con candidatos a la vista, confirma explícito. */
  readonly textoRegistrar = computed(() => {
    if (this.guardando()) return 'Registrando…';
    return this.duplicadosAlta().length > 0 ? 'Registrar igualmente' : 'Registrar alerta';
  });

  /** Texto del reporte pegado para repartirlo en el borrador. */
  readonly reportePegado = signal('');
  /** Aviso del bloque «Pegar reporte completo» (éxito o «no se reconoció»). */
  readonly reporteAviso = signal<string | null>(null);

  /**
   * «Situación actual» es un solo campo de texto: se muestra el borrador unido
   * por saltos de línea aunque por dentro siga siendo una lista de líneas.
   */
  readonly textoSituacion = computed(() =>
    this.borradorAlta()
      .situacionActual.map((linea) => linea.texto)
      .join('\n'),
  );

  /**
   * «Hechos recientes» del texto heredado, ya separados en fecha y descripción.
   *
   * Es el **respaldo** para alertas cuya tabla `core.alerta_hechos` aún no tiene
   * filas: el texto guardado puede traer la fecha pegada al relato (`13.06 – …`)
   * y el parser replica las migraciones 79 y 80, con la fecha de reporte como
   * contexto para resolver los `dd.mm` sin año. Cuando hay filas, manda la lista
   * del servidor.
   */
  readonly hechosLegibles = computed<readonly HechoLinea[]>(() => {
    const alerta = this.alerta();
    if (!alerta) return [];
    return hechosComoLineas(alerta.hechosRecientes, alerta.fechaReporte);
  });

  /**
   * Hechos de la ficha en sólo lectura. Con filas en la tabla mandan ellas; si la
   * alerta nunca se inicializó se usa el texto heredado; y si ya se inicializó y
   * se quitaron todos, no se muestra nada (no se resucita el texto viejo).
   */
  readonly hechosVisibles = computed<readonly HechoLinea[]>(() => {
    const alerta = this.alerta();
    if (!alerta) return [];
    const cargado = this.hechosDe(alerta);
    if (cargado) {
      if (cargado.items.length > 0) {
        return cargado.items.map((item) => ({ fecha: item.fecha, texto: item.descripcion }));
      }
      if (cargado.inicializada) return [];
    }
    return this.hechosLegibles();
  });

  /** Filas editables de hechos en el formulario de una alerta existente. */
  readonly hechosBorrador = signal<HechoBorrador[]>([]);
  readonly guardandoHechos = signal(false);
  readonly errorHechos = signal<string | null>(null);

  /** Hechos leídos para la alerta abierta; `null` hasta que responde la API. */
  private readonly hechosServidor = signal<HechosCargados | null>(null);
  /** Ids que la alerta tenía en la base al abrir la edición. */
  private readonly hechosOriginales = signal<readonly string[]>([]);
  /** `true` en cuanto el usuario agrega, edita o quita un hecho. */
  private readonly hechosTocados = signal(false);

  private secuenciaHecho = 0;
  private turnoHechos = 0;

  /** Búsqueda en el Directorio de actores para «Elegir del directorio». */
  readonly buscandoActor = signal(false);
  readonly consultaActor = signal('');
  readonly resultadosActor = signal<readonly ActorOpcion[]>([]);
  readonly buscandoDirectorio = signal(false);
  readonly errorActor = signal<string | null>(null);

  /** `alerta === null` significa alta; en sólo lectura nunca se da de alta. */
  readonly esAlta = computed(() => !this.soloLectura() && this.alerta() === null);

  /** El formulario se muestra en el alta y también al modificar una alerta. */
  readonly esFormulario = computed(() => this.esAlta() || this.editando());

  /** Código del caso vinculado, sólo mientras la ficha está en modo lectura. */
  private readonly codigoCaso = computed(() => {
    if (this.esFormulario()) return null;
    const codigo = this.alerta()?.casoCodigo?.trim();
    return codigo ? codigo : null;
  });

  /** `true` si el detalle ya entregó datos del caso y no hace falta pedirlo. */
  private readonly casoEmbebido = computed(() => {
    const alerta = this.alerta();
    if (!alerta) return false;
    return !!alerta.casoResumen || alerta.casoActores.length > 0 || alerta.casoDemandas.length > 0;
  });

  /**
   * Datos de lectura del caso vinculado. El detalle de la alerta ya trae el
   * resumen, los actores y las demandas; `GET /cases/{codigo}` queda como
   * respaldo para respuestas antiguas que no los incluyan. Se recuerda en una
   * caché acotada para no repetir la lectura al reabrir la misma alerta.
   */
  private readonly casoVinculadoRecurso = consulta<CasoVinculado>({
    fuente: () => {
      const codigo = this.codigoCaso();
      if (!codigo || this.casoEmbebido() || leerCasoVinculado(codigo)) return null;
      return urlApi(`/v1/cases/${encodeURIComponent(codigo)}`);
    },
    esquema: casoVinculadoDesde,
  });

  /** Caso vinculado visible; `null` mientras carga, si falla o no hay caso. */
  readonly casoVinculado = computed(() => {
    const codigo = this.codigoCaso();
    if (!codigo) return null;
    const cargado = this.casoVinculadoRecurso.valor();
    if (cargado?.codigo === codigo) return cargado;
    return leerCasoVinculado(codigo);
  });
  readonly cargandoCaso = computed(() => this.casoVinculadoRecurso.estado() === 'cargando');
  readonly errorCaso = this.casoVinculadoRecurso.error;

  /** Título del caso: el heredado en la alerta o el del respaldo. */
  readonly casoTituloVisible = computed(
    () => this.alerta()?.casoTitulo ?? this.casoVinculado()?.titulo ?? null,
  );

  /** Resumen del caso: el heredado en la alerta o el del respaldo. */
  readonly casoResumenVisible = computed(
    () => this.alerta()?.casoResumen ?? this.casoVinculado()?.resumen ?? null,
  );

  /** Actores del caso, recortados a nombre + cargo/rol para la ficha. */
  readonly casoActoresVisibles = computed<readonly ActorCasoVista[]>(() => {
    const alerta = this.alerta();
    if (alerta?.casoActores.length) {
      return alerta.casoActores.map((actor) => ({
        nombre: actor.nombre,
        detalle:
          [actor.cargo, actor.rol].filter((valor): valor is string => !!valor).join(' · ') || null,
      }));
    }
    return (this.casoVinculado()?.actores ?? []).map((nombre) => ({ nombre, detalle: null }));
  });

  /** Demandas del caso, con su estado cuando el detalle lo trae. */
  readonly casoDemandasVisibles = computed<readonly DemandaCasoVista[]>(() => {
    const alerta = this.alerta();
    if (alerta?.casoDemandas.length) {
      return alerta.casoDemandas.map((demanda) => ({
        descripcion: demanda.descripcion,
        estado: demanda.estado,
      }));
    }
    return (this.casoVinculado()?.demandas ?? []).map((descripcion) => ({
      descripcion,
      estado: null,
    }));
  });

  readonly inicialDistritoAlta = computed(() => {
    const distrito = this.distritoAlta();
    if (distrito?.tipo !== 'distrito') return null;
    return { id: distrito.id, nombre: distrito.nombre, ruta: distrito.ruta };
  });

  /**
   * Provincia del borrador para el buscador. `app-territorio-buscador` no tiene
   * un modo provincia propio: se busca un distrito y se guarda su provincia. El
   * id es un hash estable del nombre para que el componente reaplique la
   * etiqueta cuando el valor cambie (al sembrar o al elegir un distrito).
   */
  readonly inicialProvinciaAlta = computed(() => {
    const provincia = this.borradorAlta().provincia.trim();
    if (!provincia) return null;
    return { id: claveProvincia(provincia), nombre: provincia, ruta: provincia };
  });

  private secuenciaLinea = 0;
  private timerActor: ReturnType<typeof setTimeout> | null = null;
  private turnoActor = 0;

  constructor() {
    afterNextRender(() => this.panel()?.nativeElement.focus({ preventScroll: true }));

    this.destruccion.onDestroy(() => {
      this.focoPrevio?.focus?.();
      if (this.timerActor) clearTimeout(this.timerActor);
      if (this.timerDuplicados) clearTimeout(this.timerDuplicados);
    });

    // Tras un guardado correcto se cierra el formulario para mostrar lo ya persistido.
    effect(() => {
      if (!this.aviso()) return;
      this.editando.set(false);
      this.cerrarBuscadorActor();
    });

    // El caso leído se recuerda para no volver a pedirlo al reabrir la alerta.
    effect(() => {
      const caso = this.casoVinculadoRecurso.valor();
      if (caso) recordarCasoVinculado(caso);
    });

    // Siembra por alerta y modo. La firma evita reescribir lo que el usuario está
    // editando mientras la misma alerta sigue abierta.
    let firma: string | null = null;
    effect(() => {
      const alerta = this.alerta();
      const modo = this.modoInicial();
      const actual = alerta ? `${alerta.id}:${modo}` : null;
      if (actual === firma) return;
      firma = actual;
      if (!alerta) {
        this.editando.set(false);
        return;
      }
      this.sembrar(alerta);
      // El modo «editar» sólo aplica si el perfil puede modificar el contenido
      // y la ficha no está abierta en sólo lectura.
      this.editando.set(!this.soloLectura() && modo === 'editar' && this.puedeModificar());
    });

    // El alta se siembra limpia y con el caso del contexto, si lo hay. Nunca
    // pisa el formulario de una alerta existente que se está modificando.
    effect(() => {
      if (!this.esAlta()) return;
      this.borradorAlta.set({ ...borradorAltaVacio(), casoCode: this.casoInicial().trim() });
      this.distritoAlta.set(null);
      this.mensajeLocal.set(null);
      this.limpiarDuplicados();
    });

    // Cuando responden los hechos del servidor se reemplazan las filas del
    // borrador, siempre que el usuario aún no las haya tocado. Cubre el caso de
    // abrir en modo «editar» antes de que llegue la API: sin esto, guardar las
    // filas sembradas desde el texto crearía duplicados en la tabla.
    effect(() => {
      const cargado = this.hechosServidor();
      const alerta = this.alerta();
      if (!cargado || !alerta || cargado.alertaId !== alerta.id) return;
      if (!this.editando() || this.hechosTocados()) return;
      this.sembrarHechos(alerta);
    });
  }

  /**
   * Prellena el borrador del formulario con la alerta abierta. Sirve tanto para
   * abrir en modo «editar» como para «Modificar contenido».
   */
  private sembrar(alerta: Alerta): void {
    this.borradorAlta.set({
      titulo: alerta.titulo ?? '',
      riesgo: alerta.riesgo,
      alcance: alerta.alcance,
      region: alerta.region ?? '',
      provincia: alerta.provincia ?? '',
      casoCode: alerta.casoCodigo ?? '',
      situacionActual: this.lineasDesdeTexto(alerta.situacionActual),
      hechosRecientes: this.lineasDesdeTexto(alerta.hechosRecientes),
      descripcionRiesgo: this.lineasDesdeTexto(alerta.descripcionRiesgo),
      actoresClave: this.lineasDesdeArray(alerta.actoresClave),
      demandasInmediatas: this.demandasDesdeArray(alerta.demandasInmediatas),
      accionesSugeridas: this.lineasDesdeArray(alerta.accionesSugeridas),
    });
    this.distritoAlta.set(
      alerta.distritoId !== null && alerta.distrito
        ? {
            tipo: 'distrito',
            id: alerta.distritoId,
            nombre: alerta.distrito,
            region: alerta.region ?? '',
            ruta: alerta.distritoRuta ?? alerta.distrito,
          }
        : null,
    );
    this.sembrarHechos(alerta);
    this.cerrarBuscadorActor();
    this.mensajeLocal.set(null);
  }

  /* ---------------------------------------------------------------------- *
   * Presentación
   * ---------------------------------------------------------------------- */

  tituloVisible(alerta: Alerta): string {
    // `tituloLimpio` ya quita el 🔔 del prefijo «🔔 REPORTE DE ALERTA TEMPRANA |»;
    // el `replace` cubre un 🔔 inicial suelto para que el emoji no se duplique.
    const base =
      tituloLimpio(alerta.titulo)
        .replace(/^🔔\s*/u, '')
        .trim() ||
      alerta.codigo ||
      'Alerta sin título';
    return `🔔 ${base}`;
  }

  geografia(alerta: Alerta): string {
    return geografiaAlerta(alerta);
  }

  /**
   * Rótulo del estado en la ficha. Sólo aquí «Pendiente de revisión» se lee
   * como «Pendiente de aprobación»: en la tabla del listado se mantiene el
   * rótulo corto de `etiquetaEstado`.
   */
  estadoVisible(alerta: Alerta): string {
    if (alerta.estado === 'Pendiente de revisión') return 'Pendiente de aprobación';
    return etiquetaEstado(alerta.estado);
  }

  /** «Alto» → «alto»; se usa en el encabezado («Riesgo alto»). */
  etiquetaRiesgo(riesgo: Riesgo): string {
    switch (riesgo) {
      case 'Alto':
        return 'alto';
      case 'Medio':
        return 'moderado';
      default:
        return 'bajo';
    }
  }

  /**
   * Clases del texto de riesgo del encabezado. Sin `status-badge`: aquí no se
   * pinta píldora, sólo color.
   */
  claseRiesgoTexto(riesgo: Riesgo): string {
    return `alerta-riesgo risk-${claveRiesgo(riesgo)}`;
  }

  fecha(valor: string | null): string {
    return formatearFechaCorta(valor);
  }

  /* ---------------------------------------------------------------------- *
   * Formulario: campos simples
   * ---------------------------------------------------------------------- */

  campoAlta(clave: CampoAlta, evento: Event): void {
    const objetivo = evento.target as HTMLInputElement | HTMLSelectElement;
    const valor = objetivo.value;
    this.borradorAlta.update((actual) => ({ ...actual, [clave]: valor }));
    this.mensajeLocal.set(null);
    if (clave === 'titulo') this.programarDuplicados();
  }

  cambiarRiesgoAlta(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value as Riesgo;
    this.borradorAlta.update((actual) => ({ ...actual, riesgo: valor }));
    this.mensajeLocal.set(null);
  }

  cambiarAlcanceAlta(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value as AlcanceAlerta;
    this.borradorAlta.update((actual) => ({ ...actual, alcance: valor }));
    if (valor !== 'Distrito') this.distritoAlta.set(null);
    if (valor === 'Nacional') {
      this.borradorAlta.update((actual) => ({ ...actual, region: '', provincia: '' }));
    }
    this.mensajeLocal.set(null);
    this.programarDuplicados();
  }

  alElegirDistritoAlta(opcion: OpcionTerritorio | null): void {
    const distrito = opcion?.tipo === 'distrito' ? opcion : null;
    this.distritoAlta.set(distrito);
    if (distrito) {
      const partes = partesDeRuta(distrito.ruta);
      this.borradorAlta.update((actual) => ({
        ...actual,
        region: distrito.region || partes.region || actual.region,
        provincia: partes.provincia || actual.provincia,
      }));
    }
    this.mensajeLocal.set(null);
    this.programarDuplicados();
  }

  /**
   * El buscador de territorio no ofrece provincias sueltas: se elige un distrito
   * de la provincia buscada y se guarda su provincia. Sin selección se limpia.
   */
  alElegirProvinciaAlta(opcion: OpcionTerritorio | null): void {
    const distrito = opcion?.tipo === 'distrito' ? opcion : null;
    const provincia = distrito
      ? (distrito.provincia ?? '').trim() || partesDeRuta(distrito.ruta).provincia
      : '';
    this.borradorAlta.update((actual) => ({
      ...actual,
      provincia,
      region: distrito?.region || actual.region,
    }));
    this.mensajeLocal.set(null);
  }

  cambiarCasoAlta(codigo: string): void {
    this.borradorAlta.update((actual) => ({ ...actual, casoCode: codigo }));
    this.mensajeLocal.set(null);
  }

  /**
   * Programa (con debounce) la consulta de duplicados del alta. Correr la
   * comprobación en cada tecla castigaría a la API; 400 ms basta para no
   * consultar mientras se escribe.
   */
  private programarDuplicados(): void {
    if (!this.esAlta()) return;
    if (this.timerDuplicados) clearTimeout(this.timerDuplicados);
    this.timerDuplicados = setTimeout(() => {
      this.timerDuplicados = null;
      this.consultarDuplicados();
    }, 400);
  }

  /** Descarta la consulta en vuelo y el aviso visible (al cerrar o reiniciar el alta). */
  private limpiarDuplicados(): void {
    if (this.timerDuplicados) {
      clearTimeout(this.timerDuplicados);
      this.timerDuplicados = null;
    }
    this.turnoDuplicados += 1;
    this.duplicadosAlta.set([]);
    this.verificandoDuplicados.set(false);
    this.errorDuplicados.set(null);
  }

  /**
   * Consulta `GET /v1/alerts/duplicados` con el título y el distrito en curso.
   *
   * Se dispara con el título de 12 caracteres o más, o con un distrito elegido
   * (aunque el título sea corto). La API exige un título no vacío, así que sin
   * título no se consulta: sólo se limpia el aviso anterior.
   */
  private consultarDuplicados(): void {
    if (!this.esAlta()) return;

    const titulo = this.borradorAlta().titulo.trim();
    const distrito = this.distritoAlta();
    const distritoId = distrito?.tipo === 'distrito' ? distrito.id : null;

    if (!titulo || (titulo.length < 12 && distritoId === null)) {
      this.turnoDuplicados += 1;
      this.duplicadosAlta.set([]);
      this.verificandoDuplicados.set(false);
      this.errorDuplicados.set(null);
      return;
    }

    const turno = ++this.turnoDuplicados;
    this.verificandoDuplicados.set(true);
    this.errorDuplicados.set(null);

    const url = urlConParametros(urlApi('/v1/alerts/duplicados'), { titulo, distritoId });

    this.http.get<unknown>(url).subscribe({
      next: (bruto) => {
        if (turno !== this.turnoDuplicados) return;
        this.verificandoDuplicados.set(false);
        this.duplicadosAlta.set(aDuplicadosAlerta(bruto).candidatos);
      },
      error: () => {
        if (turno !== this.turnoDuplicados) return;
        // El aviso es advisory: un fallo no impide registrar la alerta.
        this.verificandoDuplicados.set(false);
        this.errorDuplicados.set('No se pudieron verificar alertas parecidas.');
      },
    });
  }

  /** Rótulo legible del estado de triaje (la ficha sólo lo usa en lectura). */
  triajeLegible(estado: EstadoTriaje | null): string {
    return estado ? etiquetaTriaje(estado) : '';
  }

  /** Rótulo del criterio de similitud de un candidato a duplicado. */
  etiquetaCriterio(criterio: CriterioDuplicadoAlerta): string {
    return etiquetaCriterioAlerta(criterio);
  }

  /* ---------------------------------------------------------------------- *
   * Formulario: listas con «＋»
   * ---------------------------------------------------------------------- */

  agregarLinea(campo: CampoLinea): void {
    this.actualizarLineas(campo, (lineas) => [...lineas, this.nuevaLinea('')]);
  }

  /**
   * Edita «Situación actual» como un único texto. Se guarda en una sola línea
   * del borrador (contrato interno `Linea[]`), reutilizando su id para no
   * forzar el repintado del textarea en cada pulsación.
   */
  editarSituacion(evento: Event): void {
    const valor = (evento.target as HTMLTextAreaElement).value;
    const actual = this.borradorAlta();
    const id = actual.situacionActual[0]?.id ?? this.nuevaLinea('').id;
    this.borradorAlta.set({ ...actual, situacionActual: [{ id, texto: valor }] });
    this.mensajeLocal.set(null);
  }

  quitarLinea(campo: CampoLinea, id: number): void {
    this.actualizarLineas(campo, (lineas) => lineas.filter((linea) => linea.id !== id));
  }

  editarLinea(campo: CampoLinea, id: number, evento: Event): void {
    const texto = (evento.target as HTMLTextAreaElement).value;
    this.actualizarLineas(campo, (lineas) =>
      lineas.map((linea) => (linea.id === id ? { ...linea, texto } : linea)),
    );
  }

  /* ------------------------------- Demandas ------------------------------ */

  agregarDemanda(): void {
    this.secuenciaLinea += 1;
    const nueva: DemandaBorrador = {
      id: this.secuenciaLinea,
      organizacion: '',
      demanda: '',
    };
    this.borradorAlta.update((actual) => ({
      ...actual,
      demandasInmediatas: [...actual.demandasInmediatas, nueva],
    }));
    this.mensajeLocal.set(null);
  }

  quitarDemanda(id: number): void {
    this.borradorAlta.update((actual) => ({
      ...actual,
      demandasInmediatas: actual.demandasInmediatas.filter((fila) => fila.id !== id),
    }));
    this.mensajeLocal.set(null);
  }

  editarDemanda(id: number, campo: 'organizacion' | 'demanda', evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.borradorAlta.update((actual) => ({
      ...actual,
      demandasInmediatas: actual.demandasInmediatas.map((fila) =>
        fila.id === id ? { ...fila, [campo]: valor } : fila,
      ),
    }));
    this.mensajeLocal.set(null);
  }

  /* -------------------------------- Hechos ------------------------------- */

  agregarHecho(): void {
    this.secuenciaHecho += 1;
    this.hechosBorrador.update((filas) => [
      ...filas,
      {
        clave: this.secuenciaHecho,
        id: null,
        fecha: '',
        descripcion: '',
        fechaOriginal: '',
        descripcionOriginal: '',
      },
    ]);
    this.hechosTocados.set(true);
    this.mensajeLocal.set(null);
  }

  editarHecho(clave: number, campo: 'fecha' | 'descripcion', evento: Event): void {
    const valor = (evento.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.hechosBorrador.update((filas) =>
      filas.map((fila) => (fila.clave === clave ? { ...fila, [campo]: valor } : fila)),
    );
    this.hechosTocados.set(true);
    this.mensajeLocal.set(null);
  }

  quitarHecho(clave: number): void {
    this.hechosBorrador.update((filas) => filas.filter((fila) => fila.clave !== clave));
    this.hechosTocados.set(true);
    this.mensajeLocal.set(null);
  }

  /* ---------------------------------------------------------------------- *
   * Reporte de alerta pegado
   * ---------------------------------------------------------------------- */

  editarReporte(evento: Event): void {
    this.reportePegado.set((evento.target as HTMLTextAreaElement).value);
    this.reporteAviso.set(null);
  }

  async copiarPlantillaAlerta(): Promise<void> {
    const copiado = await copiarAlPortapapeles(PLANTILLA_ALERTA_TEMPRANA);
    this.reporteAviso.set(
      copiado
        ? 'Plantilla copiada al portapapeles.'
        : 'No se pudo copiar la plantilla; copie el texto manualmente.',
    );
  }

  /**
   * Reparte el reporte pegado en los campos del borrador.
   *
   * En el alta los hechos se guardan como texto (`hechosRecientes`), con la
   * fecha en formato compacto para que `partirHecho` la recupere al releer. En
   * la edición se vierten en la tabla de hechos y se marcan como tocados para
   * que se persistan al guardar.
   */
  aplicarReporte(): void {
    const datos = parsearPlantillaAlerta(this.reportePegado());
    if (!datos) {
      this.reporteAviso.set(
        'No se reconoció un reporte de alerta en el texto. Revise que incluya el título o las secciones.',
      );
      return;
    }

    const alcance = alcanceDesdeAmbito(datos.ambito);
    const enAlta = this.esAlta();

    this.borradorAlta.update((actual) => ({
      ...actual,
      titulo: datos.titulo ?? actual.titulo,
      alcance: alcance ?? actual.alcance,
      situacionActual: datos.situacionActual.map((linea) => this.nuevaLinea(linea)),
      descripcionRiesgo: datos.riesgos.map((linea) => this.nuevaLinea(linea)),
      actoresClave: datos.actores.map((linea) => this.nuevaLinea(linea)),
      demandasInmediatas: datos.demandas.map((fila) => {
        this.secuenciaLinea += 1;
        return { id: this.secuenciaLinea, organizacion: fila.organizacion, demanda: fila.demanda };
      }),
      accionesSugeridas: datos.acciones.map((linea) => this.nuevaLinea(linea)),
      hechosRecientes: enAlta
        ? datos.hechos.map((hecho) =>
            this.nuevaLinea(
              hecho.fecha ? `${formatearFechaCorta(hecho.fecha)} — ${hecho.texto}` : hecho.texto,
            ),
          )
        : actual.hechosRecientes,
    }));

    if (!enAlta) {
      this.hechosBorrador.set(
        datos.hechos.map((hecho) => {
          this.secuenciaHecho += 1;
          return {
            clave: this.secuenciaHecho,
            id: null,
            fecha: hecho.fecha ?? '',
            descripcion: hecho.texto,
            fechaOriginal: '',
            descripcionOriginal: '',
          };
        }),
      );
      this.hechosTocados.set(true);
    }

    this.reporteAviso.set(
      `Reporte aplicado: ${datos.situacionActual.length} de situación, ${datos.hechos.length} hechos, ` +
        `${datos.actores.length} actores, ${datos.demandas.length} demandas, ` +
        `${datos.riesgos.length} riesgos y ${datos.acciones.length} acciones.`,
    );
    this.mensajeLocal.set(null);
    this.programarDuplicados();
  }

  private actualizarLineas(campo: CampoLinea, transformar: (lineas: Linea[]) => Linea[]): void {
    const actual = this.borradorAlta();
    const lineas = transformar(actual[campo]);
    this.borradorAlta.set({
      ...actual,
      situacionActual: campo === 'situacionActual' ? lineas : actual.situacionActual,
      hechosRecientes: campo === 'hechosRecientes' ? lineas : actual.hechosRecientes,
      descripcionRiesgo: campo === 'descripcionRiesgo' ? lineas : actual.descripcionRiesgo,
      actoresClave: campo === 'actoresClave' ? lineas : actual.actoresClave,
      accionesSugeridas: campo === 'accionesSugeridas' ? lineas : actual.accionesSugeridas,
    });
    this.mensajeLocal.set(null);
  }

  private nuevaLinea(texto: string): Linea {
    this.secuenciaLinea += 1;
    return { id: this.secuenciaLinea, texto };
  }

  private lineasDesdeTexto(valor: string | null): Linea[] {
    return (valor ?? '')
      .split('\n')
      .map((linea) => linea.trim())
      .filter((linea) => linea.length > 0)
      .map((linea) => this.nuevaLinea(linea));
  }

  private lineasDesdeArray(valores: readonly string[]): Linea[] {
    return valores
      .map((valor) => valor.trim())
      .filter((valor) => valor.length > 0)
      .map((valor) => this.nuevaLinea(valor));
  }

  /**
   * «Organización: demanda» → dos campos. Sin dos puntos, todo el texto queda
   * como demanda y la organización vacía, para no inventar un solicitante.
   */
  private demandasDesdeArray(valores: readonly string[]): DemandaBorrador[] {
    return valores
      .map((valor) => valor.trim())
      .filter((valor) => valor.length > 0)
      .map((valor) => {
        this.secuenciaLinea += 1;
        const corte = valor.indexOf(':');
        if (corte > 0) {
          return {
            id: this.secuenciaLinea,
            organizacion: valor.slice(0, corte).trim(),
            demanda: valor.slice(corte + 1).trim(),
          };
        }
        return { id: this.secuenciaLinea, organizacion: '', demanda: valor };
      });
  }

  /**
   * Vuelve a «Organización: demanda» sólo con lo que haya. Antes de este cambio
   * el borrador guardaba líneas sueltas; el repositorio sigue recibiendo un
   * arreglo de textos, así que el contrato con la API no cambia.
   */
  private textoDesdeDemandas(demandas: readonly DemandaBorrador[]): string[] | null {
    const lineas = demandas
      .map((fila) => {
        const organizacion = fila.organizacion.trim();
        const demanda = fila.demanda.trim();
        if (organizacion && demanda) return `${organizacion}: ${demanda}`;
        return demanda || organizacion;
      })
      .filter((linea) => linea.length > 0);
    return lineas.length ? lineas : null;
  }

  private textoDesdeLineas(lineas: readonly Linea[]): string {
    return lineas
      .map((linea) => linea.texto.trim())
      .filter((texto) => texto.length > 0)
      .join('\n');
  }

  private jsonDesdeLineas(lineas: readonly Linea[]): string[] | null {
    return aJsonLineas(lineas.map((linea) => linea.texto));
  }

  /* ---------------------------------------------------------------------- *
   * Actores clave desde el Directorio
   *
   * AVISO: `core.alertas_tempranas.actores_clave` es `jsonb` de texto libre y
   * la API no escribe `core.alertas_actores`, así que no hay FK. Convertirlo en
   * vínculo real exigiría escribir `core.alertas_actores` (sólo roles
   * `sectorista`/`administrador`) y los permisos `crear`/`pii` al dar de alta
   * actores. Por eso aquí se sigue guardando texto libre.
   * ---------------------------------------------------------------------- */

  alternarBuscadorActor(): void {
    if (this.buscandoActor()) {
      this.cerrarBuscadorActor();
      return;
    }
    this.buscandoActor.set(true);
    this.errorActor.set(null);
  }

  cerrarBuscadorActor(): void {
    if (this.timerActor) {
      clearTimeout(this.timerActor);
      this.timerActor = null;
    }
    this.buscandoActor.set(false);
    this.consultaActor.set('');
    this.resultadosActor.set([]);
    this.buscandoDirectorio.set(false);
    this.errorActor.set(null);
  }

  alBuscarActor(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.consultaActor.set(valor);
    this.errorActor.set(null);
    if (this.timerActor) clearTimeout(this.timerActor);

    const consulta = valor.trim();
    if (consulta.length < 2) {
      this.resultadosActor.set([]);
      this.buscandoDirectorio.set(false);
      return;
    }

    this.buscandoDirectorio.set(true);
    this.timerActor = setTimeout(() => this.buscarActorEnDirectorio(consulta), 300);
  }

  private buscarActorEnDirectorio(consulta: string): void {
    const turno = ++this.turnoActor;
    const url = urlApi(`/v1/actors?q=${encodeURIComponent(consulta)}&pageSize=20`);

    this.http.get<unknown>(url).subscribe({
      next: (bruto) => {
        if (turno !== this.turnoActor) return;
        this.resultadosActor.set(aOpciones(bruto));
        this.buscandoDirectorio.set(false);
      },
      error: () => {
        if (turno !== this.turnoActor) return;
        this.resultadosActor.set([]);
        this.buscandoDirectorio.set(false);
        this.errorActor.set('No se pudo consultar el Directorio de actores.');
      },
    });
  }

  /**
   * Añade una línea de «Actores clave» a partir del Directorio, con la forma
   * «Nombre – Gremio/Institución, Cargo · Tel. 9xxxxxxxx». Los fragmentos que
   * faltan se omiten; el teléfono sólo entra si el actor lo tiene.
   */
  elegirActorDirectorio(actor: ActorOpcion): void {
    this.actualizarLineas('actoresClave', (lineas) => [
      ...lineas,
      this.nuevaLinea(lineaActorDirectorio(actor)),
    ]);
    this.cerrarBuscadorActor();
  }

  /** Añade una línea vacía editable, sin pasar por el Directorio. */
  escribirActorNuevo(): void {
    this.agregarLinea('actoresClave');
    this.cerrarBuscadorActor();
  }

  /* ---------------------------------------------------------------------- *
   * Guardado
   * ---------------------------------------------------------------------- */

  alEnviarAlta(evento: Event): void {
    evento.preventDefault();
    void this.guardarAlta();
  }

  async guardarAlta(): Promise<void> {
    if (!this.puedeModificar() || this.guardando() || this.guardandoHechos()) return;

    const borrador = this.borradorAlta();
    const titulo = borrador.titulo.trim();
    if (!titulo) {
      this.mensajeLocal.set('El título es obligatorio para registrar la alerta.');
      return;
    }

    if (!borrador.riesgo) {
      this.mensajeLocal.set('El nivel de riesgo es obligatorio.');
      return;
    }

    if (!borrador.alcance) {
      this.mensajeLocal.set('El alcance geográfico es obligatorio.');
      return;
    }

    if (this.esAlta()) {
      const cuerpo: AltaAlerta = {
        titulo,
        riesgo: borrador.riesgo,
        alcance: borrador.alcance,
      };

      const distrito = this.distritoAlta();
      if (distrito?.tipo === 'distrito') cuerpo.distritoId = distrito.id;

      const caso = borrador.casoCode.trim();
      if (caso) cuerpo.casoCode = caso;

      const region = borrador.region.trim();
      if (region) cuerpo.region = region;

      const provincia = borrador.provincia.trim();
      if (provincia) cuerpo.provincia = provincia;

      const descripcion = this.textoDesdeLineas(borrador.descripcionRiesgo);
      if (descripcion) cuerpo.descripcionRiesgo = descripcion;

      const hechos = this.textoDesdeLineas(borrador.hechosRecientes);
      if (hechos) cuerpo.hechosRecientes = hechos;

      const situacion = this.textoDesdeLineas(borrador.situacionActual);
      if (situacion) cuerpo.situacionActual = situacion;

      const actores = this.jsonDesdeLineas(borrador.actoresClave);
      if (actores) cuerpo.actoresClave = actores;

      const demandas = this.textoDesdeDemandas(borrador.demandasInmediatas);
      if (demandas) cuerpo.demandasInmediatas = demandas;

      const sugeridas = this.jsonDesdeLineas(borrador.accionesSugeridas);
      if (sugeridas) cuerpo.accionesSugeridas = sugeridas;

      this.mensajeLocal.set(null);
      this.registrar.emit(cuerpo);
      return;
    }

    const alerta = this.alerta();
    if (!alerta) return;

    const patch = this.patchDesdeBorrador(alerta, borrador, titulo);
    const hayHechos = this.hayCambiosHechos();

    if (Object.keys(patch).length === 0 && !hayHechos) {
      this.mensajeLocal.set('No hay cambios que guardar.');
      return;
    }

    this.mensajeLocal.set(null);

    // Los hechos se escriben uno a uno; si alguno falla no se emite el PATCH para
    // no dejar la ficha a medias entre dos estados.
    if (hayHechos) {
      try {
        await this.persistirHechos(alerta.id);
      } catch (fallo) {
        this.errorHechos.set(aErrorApi(fallo).message);
        return;
      }
    }

    if (Object.keys(patch).length > 0) {
      this.guardar.emit(patch);
      return;
    }

    // Sólo se guardaron hechos: no hay PATCH que emitir, pero sí que cerrar el
    // formulario para mostrar la ficha ya persistida.
    this.editando.set(false);
    this.mensajeLocal.set('Hechos guardados.');
  }

  /** `PatchAlerta` con sólo las claves cuyo valor difiere de la alerta abierta. */
  private patchDesdeBorrador(alerta: Alerta, borrador: BorradorAlta, titulo: string): PatchAlerta {
    const patch: PatchAlerta = {};

    const tituloCambio = diferenciaTexto(titulo, alerta.titulo);
    if (tituloCambio !== undefined) patch.titulo = tituloCambio;

    if (borrador.riesgo && borrador.riesgo !== alerta.riesgo) patch.riesgo = borrador.riesgo;
    if (borrador.alcance && borrador.alcance !== alerta.alcance) {
      patch.alcance = borrador.alcance;
    }

    const region = diferenciaTexto(borrador.region, alerta.region);
    if (region !== undefined) patch.region = region;

    const provincia = diferenciaTexto(borrador.provincia, alerta.provincia);
    if (provincia !== undefined) patch.provincia = provincia;

    const caso = diferenciaTexto(borrador.casoCode, alerta.casoCodigo);
    if (caso !== undefined) patch.casoCode = caso;

    const distrito = this.distritoAlta();
    const distritoId = distrito?.tipo === 'distrito' ? distrito.id : null;
    if (distritoId !== alerta.distritoId) patch.distritoId = distritoId;

    const situacion = diferenciaTexto(
      this.textoDesdeLineas(borrador.situacionActual),
      alerta.situacionActual,
    );
    if (situacion !== undefined) patch.situacionActual = situacion;

    const descripcion = diferenciaTexto(
      this.textoDesdeLineas(borrador.descripcionRiesgo),
      alerta.descripcionRiesgo,
    );
    if (descripcion !== undefined) patch.descripcionRiesgo = descripcion;

    const actores = this.jsonDesdeLineas(borrador.actoresClave);
    if ((actores ?? []).join('\n') !== alerta.actoresClave.join('\n')) {
      patch.actoresClave = actores;
    }

    const demandas = this.textoDesdeDemandas(borrador.demandasInmediatas);
    if ((demandas ?? []).join('\n') !== alerta.demandasInmediatas.join('\n')) {
      patch.demandasInmediatas = demandas;
    }

    const sugeridas = this.jsonDesdeLineas(borrador.accionesSugeridas);
    if ((sugeridas ?? []).join('\n') !== alerta.accionesSugeridas.join('\n')) {
      patch.accionesSugeridas = sugeridas;
    }

    return patch;
  }

  /* ---------------------------------------------------------------------- *
   * Hechos: lectura y persistencia
   * ---------------------------------------------------------------------- */

  /** Hechos cargados, sólo si pertenecen a la alerta indicada. */
  private hechosDe(alerta: Alerta): HechosCargados | null {
    const cargado = this.hechosServidor();
    return cargado && cargado.alertaId === alerta.id ? cargado : null;
  }

  private hechoDesdeApi(hecho: HechoApi): HechoBorrador {
    this.secuenciaHecho += 1;
    const fecha = hecho.fecha ?? '';
    return {
      clave: this.secuenciaHecho,
      id: hecho.id,
      fecha,
      descripcion: hecho.descripcion,
      fechaOriginal: fecha,
      descripcionOriginal: hecho.descripcion,
    };
  }

  /**
   * Siembra el borrador de hechos. Con filas del servidor manda la tabla; si la
   * alerta nunca se inicializó se parte del texto heredado (se migra en el
   * primer guardado de hechos); si ya se inicializó y está vacía, no se inventa
   * nada. En todos los casos se pide/refresca la lista propia.
   */
  private sembrarHechos(alerta: Alerta): void {
    const cargado = this.hechosDe(alerta);
    const filas =
      cargado && cargado.items.length > 0
        ? cargado.items.map((hecho) => this.hechoDesdeApi(hecho))
        : cargado?.inicializada
          ? []
          : this.hechosDesdeTexto(alerta);

    this.hechosBorrador.set(filas);
    this.hechosOriginales.set(
      filas.filter((fila) => fila.id !== null).map((fila) => fila.id as string),
    );
    this.hechosTocados.set(false);
    this.errorHechos.set(null);
    this.cargarHechos(alerta.id);
  }

  /** Relato heredado → filas sin id, que se crearán al guardar. */
  private hechosDesdeTexto(alerta: Alerta): HechoBorrador[] {
    return hechosComoLineas(alerta.hechosRecientes, alerta.fechaReporte).map((hecho) => {
      this.secuenciaHecho += 1;
      const fecha = hecho.fecha ?? '';
      return {
        clave: this.secuenciaHecho,
        id: null,
        fecha,
        descripcion: hecho.texto,
        fechaOriginal: '',
        descripcionOriginal: '',
      };
    });
  }

  /** `true` si el usuario tocó hechos y el resultado difiere de lo persistido. */
  private hayCambiosHechos(): boolean {
    if (!this.hechosTocados()) return false;

    const conservados = new Set(
      this.hechosBorrador()
        .map((fila) => fila.id)
        .filter((id): id is string => id !== null),
    );
    if (this.hechosOriginales().some((id) => !conservados.has(id))) return true;

    return this.hechosBorrador().some((fila) =>
      fila.id === null
        ? fila.descripcion.trim().length > 0
        : fila.descripcion.trim() !== fila.descripcionOriginal ||
          (fila.fecha || '') !== fila.fechaOriginal,
    );
  }

  /**
   * Aplica los cambios de hechos contra la API: baja lógica de los quitados,
   * alta de los nuevos y edición de los que cambiaron. Cada petición recompone
   * `hechos_recientes` en el servidor; al terminar se recarga la lista propia.
   */
  private async persistirHechos(alertaId: string): Promise<void> {
    this.guardandoHechos.set(true);
    this.errorHechos.set(null);

    const lista = urlApi(`/v1/alerts/${encodeURIComponent(alertaId)}/hechos`);
    const urlHecho = (hechoId: string) =>
      urlApi(`/v1/alerts/${encodeURIComponent(alertaId)}/hechos/${encodeURIComponent(hechoId)}`);

    try {
      const filas = this.hechosBorrador();

      const vacia = filas.find((fila) => fila.id !== null && !fila.descripcion.trim());
      if (vacia) {
        throw new Error('La descripción de un hecho no puede quedar vacía.');
      }

      const conservados = new Set(
        filas.map((fila) => fila.id).filter((id): id is string => id !== null),
      );
      const quitados = this.hechosOriginales().filter((id) => !conservados.has(id));

      for (const id of quitados) {
        try {
          await firstValueFrom(
            this.http.delete(urlHecho(id), { body: { motivo: MOTIVO_QUITAR_HECHO } }),
          );
        } catch (fallo) {
          // Un 404 significa que ya no estaba (p. ej. reintento tras un fallo
          // parcial): la baja ya está aplicada y no debe bloquear el resto.
          if (aErrorApi(fallo).estado !== 404) throw fallo;
        }
      }

      const resultantes: HechoBorrador[] = [];
      for (const fila of filas) {
        const descripcion = fila.descripcion.trim();

        if (fila.id === null) {
          // Una fila recién agregada y vacía se descarta: no es un hecho.
          if (!descripcion) continue;
          const creado = aHechoApi(
            await firstValueFrom(
              this.http.post<unknown>(lista, { fecha: fila.fecha || null, descripcion }),
            ),
          );
          const aplicada = this.filaActualizada(fila, creado, descripcion);
          resultantes.push(aplicada);
          // Se refleja en el borrador al instante: si una escritura posterior
          // falla, el reintento no vuelve a crear la misma fila.
          this.reemplazarFila(aplicada);
          continue;
        }

        const cambia =
          descripcion !== fila.descripcionOriginal || (fila.fecha || '') !== fila.fechaOriginal;
        if (!cambia) {
          resultantes.push(fila);
          continue;
        }

        const guardado = aHechoApi(
          await firstValueFrom(
            this.http.patch<unknown>(urlHecho(fila.id), {
              fecha: fila.fecha || null,
              descripcion,
            }),
          ),
        );
        const aplicada = this.filaActualizada(fila, guardado, descripcion);
        resultantes.push(aplicada);
        this.reemplazarFila(aplicada);
      }

      this.hechosBorrador.set(resultantes);
      this.hechosOriginales.set(
        resultantes.filter((fila) => fila.id !== null).map((fila) => fila.id as string),
      );
      this.hechosTocados.set(false);
      this.cargarHechos(alertaId, true);
    } finally {
      this.guardandoHechos.set(false);
    }
  }

  /** Refleja en el borrador lo que devolvió la API y fija los valores «originales». */
  private filaActualizada(
    fila: HechoBorrador,
    guardado: HechoApi | null,
    descripcion: string,
  ): HechoBorrador {
    const fecha = guardado?.fecha ?? (fila.fecha || null);
    return {
      ...fila,
      id: guardado?.id ?? fila.id,
      fecha: fecha ?? '',
      descripcion: guardado?.descripcion ?? descripcion,
      fechaOriginal: fecha ?? '',
      descripcionOriginal: guardado?.descripcion ?? descripcion,
    };
  }

  private reemplazarFila(actualizada: HechoBorrador): void {
    this.hechosBorrador.update((filas) =>
      filas.map((fila) => (fila.clave === actualizada.clave ? actualizada : fila)),
    );
  }

  /**
   * Lectura de hechos. `forzar` se usa tras una escritura: la lista del panel
   * debe reflejar lo que quedó en la base aunque el id no haya cambiado.
   */
  private cargarHechos(alertaId: string, forzar = false): void {
    if (!forzar && this.hechosServidor()?.alertaId === alertaId) return;

    const turno = ++this.turnoHechos;
    const url = urlApi(`/v1/alerts/${encodeURIComponent(alertaId)}/hechos`);

    this.http.get<unknown>(url).subscribe({
      next: (bruto) => {
        if (turno !== this.turnoHechos) return;
        this.hechosServidor.set({ ...aHechosAlerta(bruto), alertaId });
      },
      error: () => {
        if (turno !== this.turnoHechos) return;
        // Sin lista se conserva el texto heredado como respaldo.
        this.hechosServidor.set(null);
      },
    });
  }

  /* ---------------------------------------------------------------------- *
   * Contenido narrativo
   * ---------------------------------------------------------------------- */

  /** «Modificar contenido» reutiliza el formulario del alta ya prellenado. */
  iniciarEdicion(): void {
    const alerta = this.alerta();
    if (!alerta || this.soloLectura() || !this.puedeModificar()) return;

    this.sembrar(alerta);
    this.editando.set(true);
  }

  cancelarEdicion(): void {
    this.editando.set(false);
    this.cerrarBuscadorActor();
    this.errorHechos.set(null);
    this.mensajeLocal.set(null);
  }

  /** El panel no arma el mensaje: sólo pide a la página que abra la ventana. */
  enviarWhatsapp(): void {
    const alerta = this.alerta();
    if (alerta) this.whatsapp.emit(alerta);
  }

  /* ---------------------------------------------------------------------- *
   * Diálogo
   * ---------------------------------------------------------------------- */

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
