import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import {
  TAMANO_PAGINA,
  normalizarColeccion,
  paramsDePagina,
  urlConParametros,
  type Coleccion,
} from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import {
  aFoto,
  esFotoPintable,
  fotoPrincipal,
  fotosPorEntidad,
  type Foto,
} from '../../dominio/medios';
import { BarraSeleccionComponent } from '../../shared/ui/barra-seleccion.component';
import { GaleriaFotosComponent } from '../../shared/ui/galeria-fotos.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { MapaLocalComponent } from '../../shared/ui/mapa-local.component';
import { salirModal } from '../../shared/ui/modal-salida';
import { OrdenTabla } from '../../shared/ui/orden-tabla';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import { SeleccionTabla } from '../../shared/ui/seleccion-tabla';
import {
  CeldaTablaDirectiva,
  TablaComponent,
  type ClicFila,
  type ColumnaTabla,
  type OrdenColumna,
} from '../../shared/ui/tabla.component';
import {
  aLocalDirectorio,
  contactoDeLocal,
  coordenadasDeLocal,
  enlaceMapaLocal,
  territorioDeLocal,
  ubicacionDeLocal,
  type LocalDirectorio,
} from './local.mapeo';
import { leerRiesgosMarkdown, parsearNotasLocal, unirRiesgos } from './local-notas';
import { parsearFicha } from './ficha-plantilla';

type FiltrosLocales = {
  q: string;
  /** La UI lo llama «disponible»; el backend filtra por la clave `activo`. */
  disponible: string;
  pagina: number;
  tamano: number;
};

const FILTROS_INICIALES: FiltrosLocales = {
  q: '',
  disponible: '',
  pagina: 1,
  tamano: TAMANO_PAGINA,
};

/**
 * Directorio · Locales.
 *
 * Sedes donde se reúnen los espacios de diálogo (Guía §8.2.5 y Anexo 16,
 * columna «Lugar»). Listado paginado en servidor (`GET /api/v1/locales`) con
 * búsqueda y filtro de disponibilidad, en la URL con `replaceUrl`.
 *
 * La tabla muestra código y nombre en la misma celda (código arriba, sin
 * recortar) y una columna de contacto que une responsable, teléfono y correo.
 * La ficha ordena código/disponible, título, foto y ubicación en una sola línea,
 * y desde ella se genera el mensaje de WhatsApp en una ventana propia.
 *
 * El contacto del local —dato operativo, no PII de actores— sólo se muestra a
 * los roles con `puedeVerPii()`.
 */
@Component({
  selector: 'app-locales',
  imports: [
    IconoComponent,
    MapaLocalComponent,
    PaginacionComponent,
    BarraSeleccionComponent,
    GaleriaFotosComponent,
    TablaComponent,
    CeldaTablaDirectiva,
  ],
  templateUrl: './locales.page.html',
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

    /* El nombre ocupa media tabla: dos líneas y sin recorte del texto. */
    .local-nombre {
      display: flex;
      flex-direction: column;
      gap: 2px;
      width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font-family: inherit;
      text-align: left;
      cursor: pointer;
    }

    .local-codigo {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .local-titulo {
      color: inherit;
      font-weight: 600;
      line-height: 1.35;
      white-space: normal;
      overflow-wrap: anywhere;
    }

    .tabla-foto {
      display: block;
      width: 32px;
      height: 32px;
      object-fit: cover;
      border-radius: 6px;
      background: #f6f8fa;
    }

    .local-actualizando {
      margin: 0;
      color: #8d99a6;
      font-size: 12px;
    }

    .drawer {
      width: min(560px, 100%);
    }

    .ficha-cabecera {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    .ficha-etiqueta {
      margin: 0;
      color: #8a98a5;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.7px;
      text-transform: uppercase;
    }

    .ficha-badges {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }

    .ficha-disponible {
      background: #edf4ef;
      color: #557a64;
    }

    .ficha-no-disponible {
      background: #fff3e5;
      color: #a6732d;
    }

    .whatsapp-boton {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      width: 100%;
    }

    .ficha-foto {
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 176px;
      border-radius: 10px;
      background: #f4f7f9;
      overflow: hidden;
    }

    .ficha-foto img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .ficha-foto-vacia {
      color: #a0aab3;
      font-size: 12.5px;
      font-style: italic;
    }

    .ficha-seccion {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .ficha-seccion h3 {
      margin: 0;
      color: #33475b;
      font: 700 12px var(--font-display);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .ficha-datos {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px 16px;
      margin: 0;
    }

    .ficha-datos > div {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    /* La fotografía ocupa las columnas de la cuadrícula, no una sola. */
    .ficha-datos > div.ficha-ancho {
      grid-column: 1 / -1;
    }

    .ficha-datos dt {
      color: #97a1aa;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .ficha-datos dd {
      margin: 0;
      color: #465a6c;
      font-size: 13px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .ficha-responsable + .ficha-responsable {
      padding-top: 8px;
      border-top: 1px solid #eef2f6;
    }

    .ficha-recomendacion {
      margin: 0;
      color: #52677a;
      font-size: 13px;
      line-height: 1.65;
      white-space: pre-line;
    }

    .ficha-mapa {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      align-self: flex-start;
      margin-top: 2px;
      padding: 6px 12px;
      border-radius: 8px;
      background: #eef4f9;
      color: #2f5d86;
      font-size: 12.5px;
      font-weight: 600;
      text-decoration: none;
    }

    .ficha-mapa:hover {
      background: #e2edf6;
    }

    .ficha-riesgos {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .ficha-riesgo {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .ficha-riesgo h4 {
      margin: 0;
      color: #52677a;
      font-size: 12px;
      font-weight: 700;
    }

    .ficha-lista {
      display: flex;
      flex-direction: column;
      gap: 3px;
      margin: 0;
      padding-left: 18px;
      color: #465a6c;
      font-size: 13px;
      line-height: 1.5;
    }

    .ficha-texto-completo {
      margin-top: 4px;
    }

    .ficha-texto-completo summary {
      cursor: pointer;
      color: #2f5d86;
      font-size: 12.5px;
      font-weight: 600;
    }

    .ficha-texto-completo[open] summary {
      margin-bottom: 6px;
    }

    .ficha-vacio {
      margin: 0;
      color: #a0aab3;
      font-size: 13px;
      font-style: italic;
    }

    .ficha-nota {
      margin: 0;
      color: #8d99a6;
      font-size: 12.5px;
      line-height: 1.5;
    }

    .celda-contacto {
      display: block;
      white-space: normal;
      overflow-wrap: anywhere;
      line-height: 1.4;
    }

    .sin-dato {
      color: var(--muted);
      font-style: italic;
    }

    /* ── Ventana «mensaje para WhatsApp» ─────────────────────────────────── */

    .modal-scrim {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .modal {
      display: flex;
      flex-direction: column;
      width: min(900px, 100%);
      max-height: calc(100vh - 40px);
      border-radius: 14px;
      background: #fff;
      box-shadow: 0 24px 60px rgb(16 28 40 / 28%);
      overflow: hidden;
    }

    .modal-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 18px 20px 14px;
      border-bottom: 1px solid #e8edf1;
    }

    .modal-cabecera {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .modal-icono {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border-radius: 9px;
      background: #e6f7ef;
      color: #1f7a58;
    }

    .modal-head h2 {
      margin: 0;
      color: #1a2b3e;
      font-size: 16px;
      font-weight: 700;
    }

    .modal-subtitulo {
      margin: 3px 0 0;
      color: #647487;
      font-size: 12.5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .modal-cuerpo {
      display: grid;
      grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
      gap: 16px;
      padding: 16px 20px;
      overflow-y: auto;
    }

    .modal-foto,
    .modal-mensaje {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }

    .modal-etiqueta,
    .modal-sintaxis {
      color: #647487;
      font-size: 11.5px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .modal-foto-caja {
      display: flex;
      flex: 1;
      align-items: center;
      justify-content: center;
      min-height: 260px;
      border-radius: 10px;
      background: #f4f7f9;
      overflow: hidden;
    }

    .modal-foto-caja img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .modal-mensaje-cabecera {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .whatsapp-texto {
      width: 100%;
      flex: 1;
      min-height: 240px;
      padding: 12px 14px;
      border: 1px solid #e0e6ec;
      border-radius: 10px;
      background: #f9fbfd;
      color: #1a2b3e;
      font:
        500 13px/22px ui-monospace,
        'SFMono-Regular',
        'Menlo',
        'Consolas',
        monospace;
      resize: vertical;
    }

    .whatsapp-texto:focus {
      outline: 2px solid #c9d8ea;
      outline-offset: 1px;
      background: #fff;
    }

    .modal-nota {
      margin: 0;
      color: #97a1aa;
      font-size: 11.5px;
    }

    .modal-pie {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 14px 20px;
      border-top: 1px solid #e8edf1;
      background: #fafbfc;
    }

    .modal-pie-grupo {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .modal-pie button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .modal-aviso {
      flex-basis: 100%;
      margin: 0;
      color: #2f6f52;
      font-size: 12.5px;
    }

    @media (max-width: 860px) {
      .modal-cuerpo {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    @media (max-width: 720px) {
      .view-body {
        padding: 18px 16px 40px;
      }
    }
  `,
})
export class LocalesPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destruccion = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly capacidades = inject(CapacidadesService);

  /** El contacto del local sólo se pinta si el rol puede ver datos personales. */
  readonly puedeVerPii = this.capacidades.puedeVerPii;

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({
        q: params.get('q') ?? '',
        disponible: params.get('activo') ?? '',
        pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
        tamano: Math.min(
          100,
          Math.max(1, Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA),
        ),
      })),
    ),
    { initialValue: FILTROS_INICIALES },
  );

  readonly filtros = computed(() => this.parametros());

  private readonly listado = consulta<Coleccion<LocalDirectorio>>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/locales'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        q: filtros.q,
        activo: filtros.disponible,
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aLocalDirectorio) };
    },
  });

  readonly locales = computed(() => this.listado.valor()?.elementos ?? []);
  readonly total = computed(() => this.listado.valor()?.total ?? 0);

  /** Selección de la tabla (página visible) para exportar. */
  readonly seleccion = new SeleccionTabla();

  /** Ids marcados, en una referencia estable para `app-tabla`. */
  readonly idsSeleccionados = computed(() => this.seleccion.lista());

  /** Orden local de la página visible. */
  readonly orden = new OrdenTabla<LocalDirectorio>();

  /**
   * Columnas del listado. El nombre va primero porque `app-tabla` reserva
   * 200 px a la celda que nombra la fila; con la foto delante, la miniatura de
   * 32 px estiraría toda la columna.
   */
  readonly columnas: readonly ColumnaTabla[] = [
    { clave: 'nombre', titulo: 'Nombre', ancho: '32%', ordenable: true },
    { clave: 'foto', titulo: 'Foto', ancho: '52px' },
    {
      clave: 'region',
      titulo: 'Región',
      ordenable: true,
      formato: (valor) => (valor ? String(valor) : '—'),
    },
    {
      clave: 'distrito',
      titulo: 'Distrito',
      ordenable: true,
      formato: (valor) => (valor ? String(valor) : '—'),
    },
    { clave: 'contacto', titulo: 'Contacto', ordenable: true },
    {
      clave: 'proyector',
      titulo: 'Proyector',
      ordenable: true,
      acceso: (fila) => (fila as unknown as LocalDirectorio).tieneProyector,
      formato: (valor) => this.siNo(valor as boolean | null),
    },
    {
      clave: 'computo',
      titulo: 'Cómputo',
      ordenable: true,
      acceso: (fila) => (fila as unknown as LocalDirectorio).tieneEquiposComputo,
      formato: (valor) => this.siNo(valor as boolean | null),
    },
    {
      clave: 'audio',
      titulo: 'Audio',
      ordenable: true,
      acceso: (fila) => (fila as unknown as LocalDirectorio).tieneAudioMicro,
      formato: (valor) => this.siNo(valor as boolean | null),
    },
    {
      clave: 'disponible',
      titulo: 'Disponible',
      ordenable: true,
      formato: (valor) => (valor ? 'Sí' : 'No'),
    },
  ];

  /** Orden que pinta `app-tabla`; la página ordena con `OrdenTabla`. */
  readonly ordenTabla = computed<OrdenColumna | null>(() => {
    const clave = this.orden.columna();
    return clave ? { clave, direccion: this.orden.direccion() } : null;
  });

  private readonly accesores: Record<string, (fila: LocalDirectorio) => unknown> = {
    nombre: (fila) => fila.nombre,
    region: (fila) => fila.region,
    distrito: (fila) => fila.distrito,
    contacto: (fila) => contactoDeLocal(fila),
    proyector: (fila) => fila.tieneProyector,
    computo: (fila) => fila.tieneEquiposComputo,
    audio: (fila) => fila.tieneAudioMicro,
    disponible: (fila) => fila.disponible,
  };

  readonly filasVisibles = computed(() => this.orden.ordenar(this.locales(), this.accesores));

  alCambiarOrden(cambio: OrdenColumna | null): void {
    const clave = cambio?.clave ?? this.orden.columna();
    if (clave) this.orden.alternar(clave);
  }

  /** Refleja en `SeleccionTabla` lo que marca la tabla (barra de selección). */
  alCambiarSeleccion(ids: readonly string[]): void {
    // Un local sin id real llega como `#índice`: no se puede exportar.
    const marcadas = new Set(ids.filter((id) => !!id && !id.startsWith('#')));
    for (const id of this.seleccion.lista()) {
      if (!marcadas.has(id)) this.seleccion.alternar(id);
    }
    for (const id of marcadas) {
      if (!this.seleccion.esta(id)) this.seleccion.alternar(id);
    }
  }

  alClicFila(evento: ClicFila): void {
    this.abrir(evento.fila as unknown as LocalDirectorio);
  }

  idsVisibles(): string[] {
    return this.locales()
      .map((local) => local.id)
      .filter((id): id is string => !!id);
  }

  /** Fotos de la página visible en una sola petición (`entidadIds`). */
  private readonly fotosPagina = consulta<Map<string, Foto[]>>({
    fuente: () => {
      const ids = this.idsVisibles();
      if (ids.length === 0) return null;
      return urlConParametros(urlApi('/v1/media'), {
        entidadTipo: 'local',
        entidadIds: ids.join(','),
        pageSize: '200',
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return fotosPorEntidad(coleccion.elementos.map(aFoto).filter(esFotoPintable));
    },
  });

  readonly fotosPorLocal = computed(() => this.fotosPagina.valor() ?? new Map<string, Foto[]>());

  /** Foto principal del local; `null` = sin foto registrada. */
  fotoDe(localId: string): Foto | null {
    return fotoPrincipal(this.fotosPorLocal().get(localId) ?? []);
  }

  readonly estado = this.listado.estado;
  readonly error = this.listado.error;

  /** Local cuya ficha está abierta en el panel lateral. */
  readonly seleccionado = signal<LocalDirectorio | null>(null);

  /** Notas estructuradas de la recomendación del local abierto. */
  readonly notasSeleccionado = computed(() =>
    parsearNotasLocal(this.seleccionado()?.recomendacion),
  );

  /** Riesgos leídos de las secciones markdown de la recomendación. */
  private readonly riesgosMarkdown = computed(() =>
    leerRiesgosMarkdown(this.seleccionado()?.recomendacion),
  );

  /**
   * Riesgos que pinta la ficha. Accesibilidad y ventilación unen las notas
   * estructuradas con el parseo markdown sin repetir texto normalizado; «otros»
   * sale sólo del markdown porque «Otras observaciones» no son riesgos.
   */
  readonly riesgosSeleccionado = computed(() => {
    const notas = this.notasSeleccionado();
    const markdown = this.riesgosMarkdown();

    return {
      accesibilidad: unirRiesgos(notas.accesibilidad, markdown.accesibilidad),
      ventilacion: unirRiesgos(notas.ventilacion, markdown.ventilacion),
      otros: markdown.otros,
    };
  });

  /** Coordenadas exactas del local abierto; `null` si no hay ninguna. */
  readonly coordenadasSeleccionado = computed(() => {
    const local = this.seleccionado();
    return local ? coordenadasDeLocal(local) : null;
  });

  /**
   * Campos de la ficha de texto que no son columnas del local (ámbito, dirección
   * y enlace de mapa cuando faltan en la tabla). Reutiliza el mismo parser que la
   * ficha del actor.
   */
  readonly complementariosSeleccionado = computed(() =>
    parsearFicha(this.seleccionado()?.recomendacion),
  );

  /** Hay una URL de mapa sólo en la ficha y no en `ubicacion_ref`. */
  readonly enlaceMapaFicha = computed(() => {
    const local = this.seleccionado();
    const enlace = this.complementariosSeleccionado().enlaceMapa;
    if (!local || !enlace) return null;
    return enlace === enlaceMapaLocal(local) ? null : enlace;
  });

  /** El local abierto no tiene riesgos de ningún tipo declarados. */
  readonly sinRiesgos = computed(() => {
    const riesgos = this.riesgosSeleccionado();
    return (
      riesgos.accesibilidad.length === 0 &&
      riesgos.ventilacion.length === 0 &&
      riesgos.otros.length === 0
    );
  });

  /** Hay evaluación estructurada: se ofrece el texto completo como respaldo. */
  readonly textoCompletoVisible = computed(() => {
    const local = this.seleccionado();
    const notas = this.notasSeleccionado();
    return Boolean(
      local?.recomendacion && !notas.textoLibre && local.recomendacion !== notas.evaluacion,
    );
  });

  /** Local de la ventana de WhatsApp; `null` = ventana cerrada. */
  readonly whatsappLocal = signal<LocalDirectorio | null>(null);

  /** Texto editable del mensaje de WhatsApp. */
  readonly mensajeWhatsapp = signal('');

  /** Aviso de copia en la ventana de WhatsApp; vacío si no hubo. */
  readonly avisoCopia = signal<string | null>(null);

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly whatsappDialogo = viewChild<ElementRef<HTMLElement>>('whatsappDialogo');

  /** Elemento que tenía el foco al abrir, para devolvérselo al cerrar. */
  private focoPrevio: HTMLElement | null = null;

  /** Elemento que abrió la ventana de WhatsApp, para devolverle el foco. */
  private focoWhatsapp: HTMLElement | null = null;

  private temporizadorBusqueda?: ReturnType<typeof setTimeout>;

  constructor() {
    this.destruccion.onDestroy(() => clearTimeout(this.temporizadorBusqueda));

    if (typeof document !== 'undefined') {
      const alEscape = (evento: KeyboardEvent): void => {
        if (evento.key !== 'Escape') return;

        if (this.whatsappLocal()) {
          evento.preventDefault();
          this.cerrarWhatsapp();
          return;
        }

        if (!this.seleccionado()) return;
        evento.preventDefault();
        this.cerrarPanel();
      };
      document.addEventListener('keydown', alEscape);
      this.destruccion.onDestroy(() => document.removeEventListener('keydown', alEscape));
    }
  }

  abrir(local: LocalDirectorio): void {
    const estabaCerrado = this.seleccionado() === null;
    if (estabaCerrado && typeof document !== 'undefined') {
      const activo = document.activeElement;
      this.focoPrevio = activo instanceof HTMLElement ? activo : null;
    }

    this.seleccionado.set(local);
    afterNextRender(() => this.panel()?.nativeElement.focus({ preventScroll: true }), {
      injector: this.injector,
    });
  }

  cerrarPanel(): void {
    if (this.seleccionado() === null) return;

    // El panel se desmonta en el acto: el mensaje no debe esperar animación.
    this.cerrarWhatsappAhora();
    this.seleccionado.set(null);
    const previo = this.focoPrevio;
    this.focoPrevio = null;
    afterNextRender(() => previo?.focus(), { injector: this.injector });
  }

  buscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizadorBusqueda);
    this.temporizadorBusqueda = setTimeout(() => {
      void this.actualizar({ q: valor, pagina: 1 });
    }, 300);
  }

  cambiarDisponible(evento: Event): void {
    void this.actualizar({ disponible: (evento.target as HTMLSelectElement).value, pagina: 1 });
  }

  cambiarPagina(pagina: number): void {
    void this.actualizar({ pagina });
  }

  cambiarTamano(tamano: number): void {
    void this.actualizar({ tamano, pagina: 1 });
  }

  limpiar(): void {
    clearTimeout(this.temporizadorBusqueda);
    this.cerrarPanel();
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {},
      replaceUrl: true,
    });
  }

  recargar(): void {
    this.listado.recargar();
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  /** Booleano anulable → «Sí»/«No»/«—», sin afirmar lo que la base no dice. */
  siNo(valor: boolean | null): string {
    if (valor === null) return '—';
    return valor ? 'Sí' : 'No';
  }

  /** Contacto unido del local (responsable · teléfono · correo). */
  contacto(local: LocalDirectorio): string | null {
    return contactoDeLocal(local);
  }

  /** Dirección, distrito, provincia y región en una sola línea. */
  ubicacion(local: LocalDirectorio): string | null {
    return ubicacionDeLocal(local);
  }

  /** Distrito, provincia y región, sin la dirección (que tiene su propia línea). */
  territorio(local: LocalDirectorio): string | null {
    return territorioDeLocal(local);
  }

  /** Enlace a Google Maps: URL de referencia o búsqueda por dirección. */
  enlaceMapa(local: LocalDirectorio): string | null {
    return enlaceMapaLocal(local);
  }

  /** Abre la ventana con el mensaje de WhatsApp ya generado. */
  abrirWhatsapp(local: LocalDirectorio): void {
    if (typeof document !== 'undefined') {
      const activo = document.activeElement;
      this.focoWhatsapp = activo instanceof HTMLElement ? activo : null;
    }

    this.avisoCopia.set(null);
    this.mensajeWhatsapp.set(this.mensajeDeWhatsapp(local));
    this.whatsappLocal.set(local);
    afterNextRender(() => this.whatsappDialogo()?.nativeElement.focus({ preventScroll: true }), {
      injector: this.injector,
    });
  }

  /** Cierra la ventana de WhatsApp con la animación de salida. */
  cerrarWhatsapp(): void {
    if (this.whatsappLocal() === null) return;
    salirModal(this.whatsappDialogo()?.nativeElement, () => this.cerrarWhatsappAhora());
  }

  private cerrarWhatsappAhora(): void {
    if (this.whatsappLocal() === null) return;

    this.whatsappLocal.set(null);
    this.avisoCopia.set(null);
    const previo = this.focoWhatsapp;
    this.focoWhatsapp = null;
    afterNextRender(() => previo?.focus(), { injector: this.injector });
  }

  editarMensaje(evento: Event): void {
    this.mensajeWhatsapp.set((evento.target as HTMLTextAreaElement).value);
    this.avisoCopia.set(null);
  }

  async copiarMensaje(): Promise<void> {
    const texto = this.mensajeWhatsapp();

    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      this.avisoCopia.set('No se pudo copiar. Seleccione el texto y use Ctrl + C.');
      return;
    }

    try {
      await navigator.clipboard.writeText(texto);
      this.avisoCopia.set('Mensaje copiado al portapapeles para WhatsApp.');
    } catch {
      this.avisoCopia.set('No se pudo copiar. Seleccione el texto y use Ctrl + C.');
    }
  }

  compartirWhatsapp(): void {
    if (typeof window === 'undefined') return;
    const url = `https://wa.me/?text=${encodeURIComponent(this.mensajeWhatsapp())}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  descargarFoto(local: LocalDirectorio): void {
    const foto = this.fotoDe(local.id);
    if (!foto || typeof document === 'undefined') return;

    const enlace = document.createElement('a');
    enlace.href = foto.url;
    enlace.download = (local.codigo || local.nombre).trim().replace(/\s+/g, '-').toLowerCase();
    enlace.rel = 'noopener';
    enlace.click();
  }

  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrarPanel();
  }

  alFondoWhatsapp(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrarWhatsapp();
  }

  alTecla(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFoco(evento, this.panel()?.nativeElement);
  }

  alTeclaWhatsapp(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFoco(evento, this.whatsappDialogo()?.nativeElement);
  }

  /** La ventana abierta es modal: Tab y Shift+Tab ciclan dentro de ella. */
  private atraparFoco(evento: KeyboardEvent, contenedor: HTMLElement | undefined): void {
    if (!contenedor) return;

    const enfocables = Array.from(
      contenedor.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    );

    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    if (!primero || !ultimo) return;

    const activo = typeof document === 'undefined' ? null : document.activeElement;

    if (!evento.shiftKey && activo === ultimo) {
      evento.preventDefault();
      primero.focus();
      return;
    }

    if (evento.shiftKey && (activo === primero || !contenedor.contains(activo))) {
      evento.preventDefault();
      ultimo.focus();
    }
  }

  /**
   * Mensaje de WhatsApp con la sintaxis del mockup: negritas `*`, emojis y sin
   * líneas vacías para los datos que la base no registra.
   */
  private mensajeDeWhatsapp(local: LocalDirectorio): string {
    const lineas: string[] = [`📍 *LOCAL | ${local.nombre.toUpperCase()}*`];

    if (local.codigo) lineas.push(`*Código:* ${local.codigo}`);
    lineas.push(`*Disponible:* ${local.disponible ? 'Sí' : 'No'}`);

    const ubicacion = ubicacionDeLocal(local);
    if (ubicacion) lineas.push(`*Ubicación:* ${ubicacion}`);
    if (local.ubicacionRef) lineas.push(`*Referencia:* ${local.ubicacionRef}`);

    const condiciones: string[] = [];
    if (local.aforo !== null) condiciones.push(`✅ Aforo: ${local.aforo} personas`);
    if (local.ingresos) condiciones.push(`✅ Accesos: ${local.ingresos}`);
    condiciones.push(...this.equipamiento('Proyector / pantalla', local.tieneProyector));
    condiciones.push(...this.equipamiento('Equipos de cómputo', local.tieneEquiposComputo));
    condiciones.push(...this.equipamiento('Audio y micrófonos', local.tieneAudioMicro));

    if (condiciones.length > 0) lineas.push('*Condiciones del local:*', ...condiciones);

    if (local.recomendacion) lineas.push(`🟡 *EVALUACIÓN:* ${local.recomendacion}`);

    const contacto = this.puedeVerPii() ? contactoDeLocal(local) : null;
    if (contacto) lineas.push(`*Contacto:* ${contacto}`);

    return lineas.join('\n');
  }

  /** Línea ✅/❌ del equipamiento; vacía cuando la base no registra el dato. */
  private equipamiento(etiqueta: string, valor: boolean | null): string[] {
    if (valor === null) return [];
    return [`${valor ? '✅' : '❌'} ${etiqueta}`];
  }

  private actualizar(cambios: Partial<FiltrosLocales>): void {
    const siguiente = { ...this.parametros(), ...cambios };

    this.cerrarPanel();

    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        q: siguiente.q || null,
        activo: siguiente.disponible || null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
