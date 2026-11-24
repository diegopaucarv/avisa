import { HttpClient } from '@angular/common/http';
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
import { firstValueFrom } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import {
  normalizarColeccion,
  paramsDePagina,
  urlConParametros,
  type Coleccion,
} from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { aCaso } from '../../dominio/mapeo';
import type { Caso } from '../../dominio/modelos';
import { GlosarioComponent } from '../../shared/ui/glosario.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import {
  ALCANCES,
  CLASIFICACIONES_ALCANCE,
  ESTADOS_COMPROMISO,
  ESTADOS_HITO,
  ETIQUETA_ASUMIDO_MINISTRO,
  FORMAS_VERBALES,
  NIVELES_GOBIERNO,
  TIPOS_COMPROMISO,
  aCatalogosCompromiso,
  aCompromiso,
  aDetalleCompromiso,
  etiquetaClasificacionAlcance,
  etiquetaFormalVerbal,
  etiquetaNivelGobierno,
  formatearFecha,
  resolverVencimiento,
  type CatalogosCompromiso,
  type Compromiso,
  type DetalleCompromiso,
  type EstadoHito,
  type Hito,
  type OpcionCatalogo,
  type ResolucionVencimiento,
} from './compromiso.mapeo';

type FormularioCompromiso = {
  accion: string;
  fechaInicio: string;
  fechaVencimiento: string;
  tipo: string;
  clasificacionAlcance: string;
  formalVerbal: string;
  asumidoMinistro: boolean;
  nivelGobierno: string;
  estado: string;
  unidad: string;
  alcance: string;
  atiendeGenero: boolean;
  criteriosSmart: string;
  evidenciaUri: string;
};

type CampoTexto = Exclude<keyof FormularioCompromiso, 'atiendeGenero' | 'asumidoMinistro'>;

type FormularioHito = {
  descripcion: string;
  fecha: string;
  estado: EstadoHito;
  responsableTexto: string;
};

type ResultadoCriterios = { ok: true; valor: unknown } | { ok: false };

function formularioVacio(): FormularioCompromiso {
  return {
    accion: '',
    fechaInicio: '',
    fechaVencimiento: '',
    tipo: 'Actividad',
    clasificacionAlcance: '',
    formalVerbal: '',
    asumidoMinistro: false,
    nivelGobierno: '',
    estado: 'Por iniciar',
    unidad: '',
    alcance: '',
    atiendeGenero: false,
    criteriosSmart: '',
    evidenciaUri: '',
  };
}

function formularioDe(compromiso: Compromiso): FormularioCompromiso {
  let criterios = '';
  if (compromiso.criteriosSmart !== null && compromiso.criteriosSmart !== undefined) {
    try {
      criterios = JSON.stringify(compromiso.criteriosSmart, null, 2);
    } catch {
      criterios = '';
    }
  }

  return {
    accion: compromiso.accion,
    fechaInicio: compromiso.fechaInicio ?? '',
    fechaVencimiento: compromiso.fechaVencimiento ?? '',
    tipo: compromiso.tipo,
    clasificacionAlcance: compromiso.clasificacionAlcance ?? '',
    formalVerbal: compromiso.formalVerbal ?? '',
    asumidoMinistro: compromiso.asumidoMinistro,
    nivelGobierno: compromiso.nivelGobierno ?? '',
    estado: compromiso.estado,
    unidad: compromiso.unidad ?? '',
    alcance: compromiso.alcance ?? '',
    atiendeGenero: compromiso.atiendeGenero,
    criteriosSmart: criterios,
    evidenciaUri: compromiso.evidenciaUri ?? '',
  };
}

function leerValor(evento: Event): string {
  return (evento.target as HTMLInputElement | HTMLSelectElement).value;
}

/** Cabecera de relleno mientras no existe compromiso (modo alta). */
const COMPROMISO_VACIO: Compromiso = aCompromiso({});

@Component({
  selector: 'app-compromiso-panel',
  imports: [IconoComponent, GlosarioComponent],
  templateUrl: './compromiso-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }
    .panel-badges {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .drawer-body {
      flex: 1;
      min-height: 0;
    }
    .drawer-body .detail-section {
      padding: 14px 0;
      border-top: 1px solid #eef2f6;
    }
    .drawer-body .detail-section:first-of-type {
      padding-top: 0;
      border-top: 0;
    }
    .panel-fecha {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: 10px 0 4px;
    }
    .panel-linea {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 12px;
      font-size: 12.5px;
      color: #52677a;
    }
    .panel-aviso {
      margin: 6px 0 0;
      padding: 8px 10px;
      border: 1px solid #f0d9b5;
      border-radius: 6px;
      background: #fff8ec;
      color: #8a5a1f;
      font-size: 12.5px;
      line-height: 1.45;
    }
    .criterios {
      margin: 4px 0 0;
      padding: 8px;
      border: 1px solid #e6ecf1;
      border-radius: 6px;
      background: #fbfcfd;
      color: #52677a;
      font-size: 12px;
      white-space: pre-wrap;
      overflow-x: auto;
    }
    .panel-hito-form {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px dashed #e2e8ee;
    }
    .panel-hito-form h4 {
      margin: 0;
      color: #3c4a59;
      font-size: 13px;
    }
    .panel-hito-form .form-field {
      padding: 0;
      border: 0;
      background: transparent;
    }
    .hito-estado {
      display: inline-flex;
    }
    .hito-responsable {
      display: inline-flex;
    }
    .hito-responsable-input {
      min-width: 160px;
      max-width: 220px;
      height: 26px;
      padding: 0 8px;
      font-size: 13px;
    }
    .panel-campo-ancho {
      grid-column: 1 / -1;
    }
    .panel-check {
      display: flex;
      align-items: center;
      gap: 7px;
      color: #52677a;
      font-size: 12.5px;
    }
    .panel-permiso {
      margin: 0 auto 0 0;
      align-self: center;
    }
    .panel-caso-lista {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 8px 0 0;
      padding: 0;
      list-style: none;
    }
    .panel-caso-opcion {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      text-align: left;
      cursor: pointer;
    }
    .panel-caso-opcion:hover {
      border-color: var(--blue);
      background: #fafcfe;
    }
    .panel-caso-codigo {
      color: var(--ink);
      font-size: 12.5px;
      font-weight: 700;
    }
    .panel-caso-titulo {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .panel-caso-region {
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.4px;
      text-transform: uppercase;
    }
    .panel-caso-elegido {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fbfcfd;
    }
    .panel-caso-elegido-copia {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }
  `,
})
export class CompromisoPanelComponent {
  private readonly http = inject(HttpClient);
  readonly capacidades = inject(CapacidadesService);

  readonly compromiso = input<Compromiso | null>(null);

  readonly cerrado = output<void>();
  readonly actualizado = output<void>();
  readonly creado = output<void>();
  readonly anular = output<void>();

  readonly estadosCompromiso: readonly string[] = ESTADOS_COMPROMISO;
  readonly estadosHito: readonly string[] = ESTADOS_HITO;
  readonly tiposCompromiso: readonly string[] = TIPOS_COMPROMISO;
  readonly nivelesGobierno: readonly string[] = NIVELES_GOBIERNO;
  readonly clasificacionesAlcance = CLASIFICACIONES_ALCANCE;
  readonly formasVerbales = FORMAS_VERBALES;
  readonly etiquetaAsumidoMinistro = ETIQUETA_ASUMIDO_MINISTRO;

  readonly editando = signal(false);
  readonly guardando = signal(false);
  readonly editError = signal<string | null>(null);
  readonly formulario = signal<FormularioCompromiso>(formularioVacio());

  /** Búsqueda del caso en el alta; se confirma con `casoElegido`. */
  readonly busquedaCaso = signal('');
  readonly casoElegido = signal<Caso | null>(null);
  private temporizadorCaso?: ReturnType<typeof setTimeout>;

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly destruccion = inject(DestroyRef);

  /** Elemento que tenía el foco al abrir, para devolvérselo al cerrar. */
  private readonly focoPrevio =
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);

  readonly hitoNuevo = signal<FormularioHito>({
    descripcion: '',
    fecha: '',
    estado: 'Registrado',
    responsableTexto: '',
  });
  readonly hitoGuardando = signal(false);
  readonly hitoCambiando = signal<string | null>(null);
  readonly hitosError = signal<string | null>(null);

  private readonly recurso = consulta<DetalleCompromiso>({
    fuente: () => {
      const id = this.compromiso()?.id;
      return id ? urlApi(`/v1/commitments/${encodeURIComponent(id)}`) : null;
    },
    esquema: aDetalleCompromiso,
  });

  private readonly catalogoRecurso = consulta<CatalogosCompromiso>({
    fuente: () => (this.compromiso() !== null || this.editando() ? urlApi('/v1/catalogs') : null),
    esquema: aCatalogosCompromiso,
  });

  /** Casos para el alta; sólo se consulta en modo alta. */
  private readonly casosRecurso = consulta<Coleccion<Caso>>({
    fuente: () => {
      if (this.compromiso() !== null) return null;
      return urlConParametros(urlApi('/v1/cases'), {
        ...paramsDePagina({ pagina: 1, tamano: 8 }),
        q: this.busquedaCaso(),
        sort: 'recent',
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aCaso) };
    },
  });

  readonly casosEncontrados = computed(() => this.casosRecurso.valor()?.elementos ?? []);
  readonly estadoCasos = this.casosRecurso.estado;
  readonly errorCasos = this.casosRecurso.error;

  readonly detalle = this.recurso.valor;
  readonly estadoCarga = this.recurso.estado;
  readonly errorCarga = this.recurso.error;

  readonly modoAlta = computed(() => this.compromiso() === null);
  readonly formularioVisible = computed(() => this.modoAlta() || this.editando());

  readonly cabecera = computed<Compromiso>(
    () => this.detalle()?.compromiso ?? this.compromiso() ?? COMPROMISO_VACIO,
  );

  readonly hitos = computed(() => this.cabecera().hitos);
  readonly proximoHito = computed(() => this.cabecera().proximoHito);
  readonly vencimiento = computed<ResolucionVencimiento>(() =>
    resolverVencimiento(this.cabecera()),
  );

  readonly puedeModificar = computed(() =>
    this.modoAlta()
      ? this.capacidades.puedeEditar()
      : this.capacidades.puedeModificar(this.cabecera().clasificacion),
  );

  /** Anular exige, además de escritura sobre la clasificación, el privilegio de anulación. */
  readonly puedeAnular = computed(
    () => !this.modoAlta() && this.capacidades.puedeEliminar() && this.puedeModificar(),
  );

  readonly criteriosJson = computed<string | null>(() => {
    const valor = this.cabecera().criteriosSmart;
    if (valor === null || valor === undefined) return null;
    try {
      return JSON.stringify(valor, null, 2);
    } catch {
      return null;
    }
  });

  /**
   * Aviso visible mientras se edita: sin fecha manual y sin próximo hito del
   * que derivarla, el compromiso se guardará sin vencimiento. No se inventa
   * ninguna fecha; el aviso es la única barrera.
   */
  readonly avisoFecha = computed<string | null>(() => {
    if (!this.formularioVisible() || this.modoAlta()) return null;
    if (this.formulario().fechaVencimiento.trim()) return null;
    if (this.proximoHito()?.fecha) return null;
    return 'Sin fecha de vencimiento manual ni próximo hito con fecha: el compromiso se guardará sin vencimiento. Añada una fecha manual si desea fijarlo.';
  });

  readonly unidadesFormulario = computed<OpcionCatalogo[]>(() => {
    const base = this.catalogoRecurso.valor()?.unidades ?? [];
    const actual = this.formulario().unidad.trim();
    if (!actual || base.some((opcion) => opcion.valor === actual)) return base;
    return [{ valor: actual, etiqueta: actual }, ...base];
  });

  readonly alcancesFormulario = computed<OpcionCatalogo[]>(() => {
    const base = this.catalogoRecurso.valor()?.alcances ?? [];
    if (base.length > 0) return base;
    return ALCANCES.map((valor) => ({ valor, etiqueta: valor }));
  });

  constructor() {
    afterNextRender(() => this.panel()?.nativeElement.focus());

    // Escape cierra el panel aunque el foco esté dentro de un campo de texto.
    const alEscape = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      this.cerrar();
    };
    document.addEventListener('keydown', alEscape);
    this.destruccion.onDestroy(() => {
      document.removeEventListener('keydown', alEscape);
      clearTimeout(this.temporizadorCaso);
      this.focoPrevio?.focus?.();
    });
  }

  cerrar(): void {
    this.cerrado.emit();
  }

  /** En el alta cancela el panel; en edición sólo descarta el formulario. */
  cancelar(): void {
    if (this.modoAlta()) {
      this.cerrar();
      return;
    }
    this.cancelarEdicion();
  }

  buscarCaso(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.casoElegido.set(null);
    clearTimeout(this.temporizadorCaso);
    this.temporizadorCaso = setTimeout(() => this.busquedaCaso.set(valor), 300);
  }

  elegirCaso(caso: Caso): void {
    if (!caso.codigo) return;
    this.casoElegido.set(caso);
    this.busquedaCaso.set('');
    this.editError.set(null);
  }

  quitarCaso(): void {
    this.casoElegido.set(null);
    this.busquedaCaso.set('');
  }

  recargarDetalle(): void {
    this.recurso.recargar();
  }

  abrirEdicion(): void {
    if (this.modoAlta() || !this.puedeModificar()) return;
    this.formulario.set(formularioDe(this.cabecera()));
    this.editError.set(null);
    this.editando.set(true);
  }

  cancelarEdicion(): void {
    this.editando.set(false);
    this.editError.set(null);
  }

  actualizarTexto(campo: CampoTexto, evento: Event): void {
    const valor = leerValor(evento);
    this.formulario.update((actual) => {
      const siguiente = { ...actual };
      siguiente[campo] = valor;
      return siguiente;
    });
  }

  actualizarBooleano(campo: 'atiendeGenero' | 'asumidoMinistro', evento: Event): void {
    const marcado = (evento.target as HTMLInputElement).checked;
    this.formulario.update((actual) =>
      campo === 'atiendeGenero'
        ? { ...actual, atiendeGenero: marcado }
        : { ...actual, asumidoMinistro: marcado },
    );
  }

  actualizarHito(campo: 'descripcion' | 'fecha' | 'responsableTexto', evento: Event): void {
    const valor = leerValor(evento);
    if (campo === 'descripcion') {
      this.hitoNuevo.update((actual) => ({ ...actual, descripcion: valor }));
      return;
    }
    if (campo === 'fecha') {
      this.hitoNuevo.update((actual) => ({ ...actual, fecha: valor }));
      return;
    }
    this.hitoNuevo.update((actual) => ({ ...actual, responsableTexto: valor }));
  }

  actualizarEstadoHitoNuevo(evento: Event): void {
    const valor = leerValor(evento);
    if (!this.esEstadoHito(valor)) return;
    this.hitoNuevo.update((actual) => ({ ...actual, estado: valor }));
  }

  async guardar(): Promise<void> {
    if (!this.puedeModificar()) {
      this.editError.set(
        this.modoAlta()
          ? 'No tiene permisos para registrar compromisos.'
          : 'No tiene permisos para modificar este compromiso.',
      );
      return;
    }

    const form = this.formulario();
    const accion = form.accion.trim();
    if (!accion) {
      this.editError.set('La acción comprometida es obligatoria.');
      return;
    }

    if (this.modoAlta()) {
      const caso = this.casoElegido();
      if (!caso?.codigo) {
        this.editError.set('Seleccione el caso al que pertenece el compromiso.');
        return;
      }
    } else {
      if (!form.unidad.trim()) {
        this.editError.set('La unidad responsable es obligatoria.');
        return;
      }

      if (!(ESTADOS_COMPROMISO as readonly string[]).includes(form.estado)) {
        this.editError.set('El estado del compromiso no es válido.');
        return;
      }

      if (!this.cabecera().id) {
        this.editError.set('El compromiso no tiene identificador.');
        return;
      }
    }

    if (!(TIPOS_COMPROMISO as readonly string[]).includes(form.tipo)) {
      this.editError.set('El tipo de compromiso no es válido.');
      return;
    }

    const criterios = this.parsearCriterios(form.criteriosSmart);
    if (!criterios.ok) {
      this.editError.set('Los criterios SMART deben ser un objeto JSON válido.');
      return;
    }

    this.guardando.set(true);
    this.editError.set(null);

    let creado = false;

    try {
      if (this.modoAlta()) {
        await firstValueFrom(
          this.http.post<unknown>(urlApi('/v1/commitments'), this.cuerpoAlta(criterios.valor)),
        );
        creado = true;
      } else {
        const id = this.cabecera().id;
        const cuerpo: Record<string, unknown> = {
          accion,
          tipo: form.tipo,
          clasificacionAlcance: form.clasificacionAlcance || null,
          formalVerbal: form.formalVerbal || null,
          asumidoMinistro: form.asumidoMinistro,
          estado: form.estado,
          unidad: form.unidad.trim(),
          nivelGobierno: form.nivelGobierno || null,
          alcance: form.alcance || null,
          atiendeGenero: form.atiendeGenero,
          criteriosSmart: criterios.valor,
          evidenciaUri: form.evidenciaUri.trim() || null,
          fechaVencimiento: form.fechaVencimiento.trim() || null,
        };

        if (form.fechaInicio.trim()) {
          cuerpo['fechaInicio'] = form.fechaInicio.trim();
        }

        await firstValueFrom(
          this.http.patch<unknown>(urlApi(`/v1/commitments/${encodeURIComponent(id)}`), cuerpo),
        );
        this.editando.set(false);
        this.recurso.recargar();
        this.actualizado.emit();
      }
    } catch (fallo) {
      this.editError.set(this.modoAlta() ? aErrorApi(fallo).message : this.mensajeDeError(fallo));
    } finally {
      this.guardando.set(false);
    }

    if (creado) this.creado.emit();
  }

  /**
   * Cuerpo de `POST /api/v1/commitments`. El servidor exige `accion` y una
   * referencia de caso, genera el código y deriva el estado inicial
   * (`Por iniciar`), así que no se envía `estado`. Sólo viajan los campos con
   * valor y los que `createCommitment` lee de verdad.
   */
  private cuerpoAlta(criterios: unknown): Record<string, unknown> {
    const form = this.formulario();
    const caso = this.casoElegido();
    const cuerpo: Record<string, unknown> = {
      casoCode: caso?.codigo ?? '',
      accion: form.accion.trim(),
      tipo: form.tipo,
      atiendeGenero: form.atiendeGenero,
      asumidoMinistro: form.asumidoMinistro,
    };

    const unidad = form.unidad.trim();
    if (unidad) cuerpo['unidad'] = unidad;
    if (form.clasificacionAlcance) cuerpo['clasificacionAlcance'] = form.clasificacionAlcance;
    if (form.formalVerbal) cuerpo['formalVerbal'] = form.formalVerbal;
    if (form.nivelGobierno) cuerpo['nivelGobierno'] = form.nivelGobierno;
    if (form.alcance) cuerpo['alcance'] = form.alcance;

    const evidenciaUri = form.evidenciaUri.trim();
    if (evidenciaUri) cuerpo['evidenciaUri'] = evidenciaUri;

    const fechaInicio = form.fechaInicio.trim();
    if (fechaInicio) cuerpo['fechaInicio'] = fechaInicio;

    const fechaVencimiento = form.fechaVencimiento.trim();
    if (fechaVencimiento) cuerpo['fechaVencimiento'] = fechaVencimiento;

    if (criterios !== null) cuerpo['criteriosSmart'] = criterios;

    return cuerpo;
  }

  async anadirHito(): Promise<void> {
    if (!this.puedeModificar()) {
      this.hitosError.set('No tiene permisos para modificar este compromiso.');
      return;
    }

    const form = this.hitoNuevo();
    const descripcion = form.descripcion.trim();
    if (!descripcion) {
      this.hitosError.set('La descripción del hito es obligatoria.');
      return;
    }

    const id = this.cabecera().id;
    if (!id) {
      this.hitosError.set('El compromiso no tiene identificador.');
      return;
    }

    const cuerpo: Record<string, unknown> = {
      descripcion,
      estado: form.estado,
    };
    if (form.fecha.trim()) cuerpo['fecha'] = form.fecha.trim();
    if (form.responsableTexto.trim()) {
      cuerpo['responsableTexto'] = form.responsableTexto.trim();
    }

    this.hitoGuardando.set(true);
    this.hitosError.set(null);

    try {
      await firstValueFrom(
        this.http.post<unknown>(urlApi(`/v1/commitments/${encodeURIComponent(id)}/hitos`), cuerpo),
      );
      this.hitoNuevo.set({
        descripcion: '',
        fecha: '',
        estado: 'Registrado',
        responsableTexto: '',
      });
      this.recurso.recargar();
      this.actualizado.emit();
    } catch (fallo) {
      this.hitosError.set(this.mensajeDeError(fallo));
    } finally {
      this.hitoGuardando.set(false);
    }
  }

  async cambiarEstadoHito(hito: Hito, evento: Event): Promise<void> {
    const select = evento.target as HTMLSelectElement;
    const nuevo = select.value;

    if (!this.esEstadoHito(nuevo) || nuevo === hito.estado) return;

    if (!this.puedeModificar()) {
      select.value = hito.estado;
      this.hitosError.set('No tiene permisos para modificar este compromiso.');
      return;
    }

    const id = this.cabecera().id;
    if (!id) {
      select.value = hito.estado;
      this.hitosError.set('El compromiso no tiene identificador.');
      return;
    }

    this.hitoCambiando.set(hito.id);
    this.hitosError.set(null);

    try {
      await firstValueFrom(
        this.http.patch<unknown>(
          urlApi(`/v1/commitments/${encodeURIComponent(id)}/hitos/${encodeURIComponent(hito.id)}`),
          { estado: nuevo },
        ),
      );
      this.recurso.recargar();
      this.actualizado.emit();
    } catch (fallo) {
      select.value = hito.estado;
      this.hitosError.set(this.mensajeDeError(fallo));
    } finally {
      this.hitoCambiando.set(null);
    }
  }

  async cambiarResponsableHito(hito: Hito, evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const nuevo = input.value.trim();
    const actual = (hito.responsableTexto ?? '').trim();

    if (nuevo === actual) return;

    if (!this.puedeModificar()) {
      input.value = actual;
      this.hitosError.set('No tiene permisos para modificar este compromiso.');
      return;
    }

    const id = this.cabecera().id;
    if (!id) {
      input.value = actual;
      this.hitosError.set('El compromiso no tiene identificador.');
      return;
    }

    this.hitoCambiando.set(hito.id);
    this.hitosError.set(null);

    try {
      await firstValueFrom(
        this.http.patch<unknown>(
          urlApi(`/v1/commitments/${encodeURIComponent(id)}/hitos/${encodeURIComponent(hito.id)}`),
          { responsableTexto: nuevo || null },
        ),
      );
      this.recurso.recargar();
      this.actualizado.emit();
    } catch (fallo) {
      input.value = actual;
      this.hitosError.set(this.mensajeDeError(fallo));
    } finally {
      this.hitoCambiando.set(null);
    }
  }

  fechaTexto(valor: string | null | undefined): string {
    return formatearFecha(valor);
  }

  /**
   * Los códigos de hito son largos (`CS-..._COMP001_H001`); la línea de tiempo
   * muestra sólo el sufijo (`H001`) para no romper la lectura.
   */
  codigoHito(codigo: string | null | undefined): string {
    const limpio = (codigo ?? '').trim();
    if (!limpio) return 'Hito';
    const partes = limpio.split('_');
    const sufijo = partes[partes.length - 1] ?? limpio;
    return /^H\d+$/i.test(sufijo) ? sufijo.toUpperCase() : limpio;
  }

  /** «Regional» se muestra como GORE; el valor del catálogo no cambia. */
  nivelTexto(valor: string | null | undefined): string {
    return etiquetaNivelGobierno(valor ?? null);
  }

  /** Item 16: etiqueta legible de la clasificación de alcance. */
  clasificacionAlcanceTexto(valor: string | null | undefined): string {
    return etiquetaClasificacionAlcance(valor);
  }

  /** Item 16: etiqueta legible del carácter formal o verbal. */
  formalVerbalTexto(valor: string | null | undefined): string {
    return etiquetaFormalVerbal(valor);
  }

  esAlcanceConocido(valor: string): boolean {
    return this.alcancesFormulario().some((opcion) => opcion.valor === valor);
  }

  esEnlace(uri: string | null): boolean {
    return uri ? /^https?:\/\//i.test(uri) : false;
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

  private esEstadoHito(valor: string): valor is EstadoHito {
    return (ESTADOS_HITO as readonly string[]).includes(valor);
  }

  private parsearCriterios(textoCrudo: string): ResultadoCriterios {
    const limpio = textoCrudo.trim();
    if (!limpio) return { ok: true, valor: null };

    try {
      const valor: unknown = JSON.parse(limpio);
      if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
        return { ok: false };
      }
      return { ok: true, valor };
    } catch {
      return { ok: false };
    }
  }

  private mensajeDeError(fallo: unknown): string {
    const error = aErrorApi(fallo);
    if (error.esProhibido) {
      return 'No tiene permisos para modificar este compromiso (403).';
    }
    if (error.estado === 422) {
      return `El servidor rechazó los datos (422): ${error.message} Revise la unidad, el alcance y las fechas.`;
    }
    if (error.estado === 404) {
      return 'El compromiso ya no existe; actualice el listado.';
    }
    if (error.esNoAutorizado) {
      return 'La sesión expiró. Vuelva a iniciar sesión.';
    }
    return error.message;
  }
}
