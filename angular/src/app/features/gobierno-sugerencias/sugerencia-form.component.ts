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

import { urlApi } from '../../core/config/entorno';
import {
  normalizarColeccion,
  paramsDePagina,
  urlConParametros,
  type Coleccion,
} from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { IconoComponent } from '../../shared/ui/icono.component';
import { salirModal } from '../../shared/ui/modal-salida';

import {
  ORIGENES_SUGERENCIA,
  aCasoOpcion,
  etiquetaOrigen,
  type CasoOpcion,
  type OpcionRegion,
  type OpcionesSugerencias,
  type Sugerencia,
} from './sugerencia.mapeo';

type FormularioSugerencia = {
  entidadTipo: string;
  regionId: string;
  territorioTexto: string;
  tipo: string;
  prioridad: string;
  estado: string;
  titulo: string;
  detalle: string;
  destinatario: string;
  unidad: string;
  responsableUsuarioId: string;
  responsableTexto: string;
  sustento: string;
  sustentoUri: string;
  origen: string;
  confianza: string;
  venceEn: string;
  decisionNota: string;
  motivoRechazo: string;
};

function formularioVacio(): FormularioSugerencia {
  return {
    entidadTipo: 'caso',
    regionId: '',
    territorioTexto: '',
    tipo: '',
    prioridad: '',
    estado: 'pendiente',
    titulo: '',
    detalle: '',
    destinatario: '',
    unidad: '',
    responsableUsuarioId: '',
    responsableTexto: '',
    sustento: '',
    sustentoUri: '',
    origen: 'persona',
    confianza: '',
    venceEn: '',
    decisionNota: '',
    motivoRechazo: '',
  };
}

function formularioDe(sugerencia: Sugerencia): FormularioSugerencia {
  return {
    entidadTipo: sugerencia.entidadTipo,
    regionId: sugerencia.regionId === null ? '' : String(sugerencia.regionId),
    territorioTexto: sugerencia.territorioTexto ?? '',
    tipo: sugerencia.tipoCodigo ?? '',
    prioridad: sugerencia.prioridad ?? '',
    estado: sugerencia.estadoCodigo ?? 'pendiente',
    titulo: sugerencia.titulo,
    detalle: sugerencia.detalle ?? '',
    destinatario: sugerencia.destinatario ?? '',
    unidad: sugerencia.unidad ?? '',
    responsableUsuarioId: sugerencia.responsableUsuarioId ?? '',
    responsableTexto: sugerencia.responsableTexto ?? '',
    sustento: sugerencia.sustento ?? '',
    sustentoUri: sugerencia.sustentoUri ?? '',
    origen: sugerencia.origen ?? 'persona',
    confianza: sugerencia.confianza === null ? '' : String(sugerencia.confianza),
    venceEn: sugerencia.venceEn ? sugerencia.venceEn.slice(0, 10) : '',
    decisionNota: sugerencia.decisionNota ?? '',
    motivoRechazo: sugerencia.motivoRechazo ?? '',
  };
}

function casoDe(sugerencia: Sugerencia): CasoOpcion | null {
  if (!sugerencia.casoCodigo) return null;
  return {
    id: sugerencia.casoId ?? '',
    codigo: sugerencia.casoCodigo,
    titulo: sugerencia.casoTitulo ?? 'Sin título',
    region: sugerencia.region,
  };
}

@Component({
  selector: 'app-sugerencia-form',
  imports: [IconoComponent],
  templateUrl: './sugerencia-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }
    .drawer-body {
      gap: 16px;
    }
    .panel-aviso {
      margin: 0;
      padding: 9px 11px;
      border: 1px solid #f1d3cf;
      border-radius: 7px;
      background: var(--red-pale);
      color: var(--red);
      font-size: 12.5px;
      line-height: 1.5;
    }
    .form-grupo {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 4px;
    }
    .form-grupo > h3 {
      margin: 0;
      font: 700 12px var(--font-display);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #7b8896;
    }
    .form-grupo + .form-grupo {
      border-top: 1px solid var(--line);
      padding-top: 14px;
    }
    .panel-campo-ancho {
      grid-column: 1 / -1;
    }
    .entidad-toggle {
      display: flex;
      gap: 8px;
    }
    .panel-caso-lista {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .panel-caso-opcion {
      width: 100%;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 3px 9px;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      text-align: left;
    }
    .panel-caso-opcion:hover {
      background: var(--canvas);
      border-color: #cdd8e2;
    }
    .panel-caso-codigo {
      font: 700 12.5px var(--font-sans);
      color: var(--blue);
      font-variant-numeric: tabular-nums;
    }
    .panel-caso-titulo {
      grid-column: 2;
      color: var(--ink-2);
      font-size: 12.5px;
    }
    .panel-caso-region {
      grid-column: 2;
      color: #8a96a0;
      font-size: 12px;
    }
    .panel-caso-elegido {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 9px 11px;
      border: 1px solid #cfe0f4;
      border-radius: 7px;
      background: var(--blue-pale);
    }
    .panel-caso-elegido-copia {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
  `,
})
export class SugerenciaFormComponent {
  private readonly http = inject(HttpClient);

  /** `null` abre el alta; una sugerencia abre la edición. */
  readonly sugerencia = input<Sugerencia | null>(null);
  readonly opciones = input<OpcionesSugerencias | null>(null);
  readonly regiones = input<readonly OpcionRegion[]>([]);

  readonly cerrado = output<void>();
  readonly guardado = output<void>();

  readonly esEdicion = computed(() => this.sugerencia() !== null);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly formulario = signal<FormularioSugerencia>(formularioVacio());

  readonly origenes = ORIGENES_SUGERENCIA as readonly string[];

  /** Caso elegido; en territorio queda `null`. */
  readonly casoElegido = signal<CasoOpcion | null>(null);
  readonly busquedaCaso = signal('');
  private temporizadorCaso?: ReturnType<typeof setTimeout>;

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly destruccion = inject(DestroyRef);
  private ultimaSugerenciaId = '';

  /** Búsqueda de casos; sólo consulta cuando hay texto y no hay caso elegido. */
  private readonly casosRecurso = consulta<Coleccion<CasoOpcion>>({
    fuente: () => {
      const texto = this.busquedaCaso().trim();
      if (!texto || this.casoElegido()) return null;
      return urlConParametros(urlApi('/v1/cases'), {
        ...paramsDePagina({ pagina: 1, tamano: 6 }),
        q: texto,
        sort: 'recent',
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aCasoOpcion) };
    },
  });

  readonly casosEncontrados = computed(() => this.casosRecurso.valor()?.elementos ?? []);
  readonly estadoCasos = this.casosRecurso.estado;
  readonly errorCasos = this.casosRecurso.error;

  readonly unidadesFormulario = computed<readonly { siglas: string; nombre: string | null }[]>(
    () => {
      const base = this.opciones()?.unidades ?? [];
      const actual = this.formulario().unidad.trim();
      if (!actual || base.some((unidad) => unidad.siglas === actual)) return base;
      return [{ siglas: actual, nombre: null }, ...base];
    },
  );

  readonly prioridadesFormulario = computed<readonly { codigo: string; orden: number | null }[]>(
    () => {
      const base = this.opciones()?.prioridades ?? [];
      const actual = this.formulario().prioridad.trim();
      if (!actual || base.some((prioridad) => prioridad.codigo === actual)) return base;
      return [...base, { codigo: actual, orden: null }];
    },
  );

  readonly tituloCabecera = computed(() =>
    this.esEdicion() ? (this.sugerencia()?.titulo ?? 'Sugerencia') : 'Registrar sugerencia',
  );

  readonly etiquetaCabecera = computed(() =>
    this.esEdicion() ? (this.sugerencia()?.codigo ?? '') : 'Nueva sugerencia',
  );

  constructor() {
    afterNextRender(() => this.panel()?.nativeElement.focus());

    // El formulario se rellena cuando cambia la sugerencia de entrada (alta o
    // edición). No se lee `formulario()` aquí para no reabrir el ciclo.
    effect(() => {
      const sugerencia = this.sugerencia();
      const clave = sugerencia?.id ?? 'nueva';
      if (clave === this.ultimaSugerenciaId) return;
      this.ultimaSugerenciaId = clave;
      this.formulario.set(sugerencia ? formularioDe(sugerencia) : formularioVacio());
      this.casoElegido.set(sugerencia ? casoDe(sugerencia) : null);
      this.busquedaCaso.set('');
      this.error.set(null);
    });

    const alEscape = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      this.cerrar();
    };
    document.addEventListener('keydown', alEscape);
    this.destruccion.onDestroy(() => {
      document.removeEventListener('keydown', alEscape);
      clearTimeout(this.temporizadorCaso);
    });
  }

  cerrar(): void {
    // La animación de salida se espera aquí, mientras los datos siguen intactos.
    salirModal(this.panel()?.nativeElement, () => this.cerrado.emit());
  }

  actualizar(campo: keyof FormularioSugerencia, evento: Event): void {
    const valor = (evento.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)
      .value;
    const siguiente: FormularioSugerencia = { ...this.formulario() };
    siguiente[campo] = valor;
    this.formulario.set(siguiente);
  }

  cambiarEntidad(tipo: 'caso' | 'territorio'): void {
    const siguiente: FormularioSugerencia = { ...this.formulario() };
    siguiente.entidadTipo = tipo;
    this.formulario.set(siguiente);
  }

  buscarCaso(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.casoElegido.set(null);
    clearTimeout(this.temporizadorCaso);
    this.temporizadorCaso = setTimeout(() => this.busquedaCaso.set(valor), 300);
  }

  elegirCaso(caso: CasoOpcion): void {
    if (!caso.codigo) return;
    this.casoElegido.set(caso);
    this.busquedaCaso.set('');
    this.error.set(null);
  }

  quitarCaso(): void {
    this.casoElegido.set(null);
    this.busquedaCaso.set('');
  }

  etiquetaOrigen(origen: string): string {
    return etiquetaOrigen(origen);
  }

  /** El selector de región compara contra el formulario, que guarda texto. */
  idTexto(valor: number): string {
    return String(valor);
  }

  guardar(): void {
    if (this.guardando()) return;

    const form = this.formulario();
    const titulo = form.titulo.trim();
    const entidadTipo = form.entidadTipo === 'caso' ? 'caso' : 'territorio';

    if (!titulo) {
      this.error.set('El título de la sugerencia es obligatorio.');
      return;
    }
    if (entidadTipo === 'caso' && !this.casoElegido()?.codigo) {
      this.error.set('Elija el caso afectado o cambie la entidad a territorio.');
      return;
    }
    if (entidadTipo === 'territorio' && !form.regionId && !form.territorioTexto.trim()) {
      this.error.set('Declare al menos una región o un territorio.');
      return;
    }
    if (form.estado === 'rechazada' && !form.motivoRechazo.trim()) {
      this.error.set('El motivo del rechazo es obligatorio para rechazar una sugerencia.');
      return;
    }

    const confianza = form.confianza.trim();
    if (confianza !== '') {
      const numero = Number(confianza);
      if (!Number.isFinite(numero) || numero < 0 || numero > 100) {
        this.error.set('La confianza debe ser un número entre 0 y 100.');
        return;
      }
    }

    const cuerpo: Record<string, unknown> = {
      entidadTipo,
      titulo,
      estado: form.estado || 'pendiente',
      detalle: form.detalle,
      destinatario: form.destinatario,
      unidad: form.unidad,
      responsableUsuarioId: form.responsableUsuarioId,
      responsableTexto: form.responsableTexto,
      sustento: form.sustento,
      sustentoUri: form.sustentoUri,
      origen: form.origen || 'persona',
      confianza: confianza === '' ? null : Number(confianza),
      venceEn: form.venceEn,
      decisionNota: form.decisionNota,
    };

    if (form.tipo) cuerpo['tipo'] = form.tipo;
    if (form.prioridad) cuerpo['prioridad'] = form.prioridad;

    if (entidadTipo === 'caso') {
      cuerpo['caso'] = this.casoElegido()?.codigo ?? '';
    } else {
      cuerpo['caso'] = '';
      cuerpo['region'] = form.regionId;
      cuerpo['territorioTexto'] = form.territorioTexto;
    }

    if (form.estado === 'rechazada') cuerpo['motivoRechazo'] = form.motivoRechazo.trim();

    const edicion = this.sugerencia();
    const peticion = edicion
      ? this.http.patch<unknown>(
          urlApi(`/v1/sugerencias/${encodeURIComponent(edicion.id)}`),
          cuerpo,
        )
      : this.http.post<unknown>(urlApi('/v1/sugerencias'), cuerpo);

    this.guardando.set(true);
    this.error.set(null);

    peticion.subscribe({
      next: () => {
        this.guardando.set(false);
        this.guardado.emit();
      },
      error: (fallo: unknown) => {
        this.guardando.set(false);
        this.error.set(aErrorApi(fallo).message);
      },
    });
  }

  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrar();
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
