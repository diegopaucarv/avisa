import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { GlosarioComponent } from '../../shared/ui/glosario.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import {
  ALCANCES,
  ESTADOS_COMPROMISO,
  ESTADOS_HITO,
  NIVELES_GOBIERNO,
  TIPOS_COMPROMISO,
  aCatalogosCompromiso,
  aDetalleCompromiso,
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
  nivelGobierno: string;
  estado: string;
  unidad: string;
  alcance: string;
  tematica: string;
  atiendeGenero: boolean;
  criteriosSmart: string;
  evidenciaUri: string;
};

type CampoTexto = Exclude<keyof FormularioCompromiso, 'atiendeGenero'>;

type FormularioHito = {
  descripcion: string;
  fecha: string;
  estado: EstadoHito;
};

type ResultadoCriterios = { ok: true; valor: unknown } | { ok: false };

function formularioVacio(): FormularioCompromiso {
  return {
    accion: '',
    fechaInicio: '',
    fechaVencimiento: '',
    tipo: 'Actividad',
    nivelGobierno: '',
    estado: 'Por iniciar',
    unidad: '',
    alcance: '',
    tematica: '',
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
    nivelGobierno: compromiso.nivelGobierno ?? '',
    estado: compromiso.estado,
    unidad: compromiso.unidad ?? '',
    alcance: compromiso.alcance ?? '',
    tematica: compromiso.tematica ?? '',
    atiendeGenero: compromiso.atiendeGenero,
    criteriosSmart: criterios,
    evidenciaUri: compromiso.evidenciaUri ?? '',
  };
}

function leerValor(evento: Event): string {
  return (evento.target as HTMLInputElement | HTMLSelectElement).value;
}

@Component({
  selector: 'app-compromiso-panel',
  imports: [IconoComponent, GlosarioComponent],
  templateUrl: './compromiso-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'cerrar()',
  },
  styles: `
    :host {
      display: contents;
    }
    .drawer-head h2 {
      margin: 0;
      font-size: 15px;
      line-height: 1.3;
      color: #1c2a38;
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
      font-size: 10px;
      color: #52677a;
    }
    .panel-aviso {
      margin: 6px 0 0;
      padding: 8px 10px;
      border: 1px solid #f0d9b5;
      border-radius: 6px;
      background: #fff8ec;
      color: #8a5a1f;
      font-size: 10px;
      line-height: 1.45;
    }
    .criterios {
      margin: 4px 0 0;
      padding: 8px;
      border: 1px solid #e6ecf1;
      border-radius: 6px;
      background: #fbfcfd;
      color: #52677a;
      font-size: 9.5px;
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
      font-size: 11px;
    }
    .panel-hito-form .form-field {
      padding: 0;
      border: 0;
      background: transparent;
    }
    .hito-estado {
      display: inline-flex;
    }
    .panel-campo-ancho {
      grid-column: 1 / -1;
    }
    .panel-check {
      display: flex;
      align-items: center;
      gap: 7px;
      color: #52677a;
      font-size: 10px;
    }
    .panel-permiso {
      margin: 0 auto 0 0;
      align-self: center;
    }
  `,
})
export class CompromisoPanelComponent {
  private readonly http = inject(HttpClient);
  readonly capacidades = inject(CapacidadesService);

  readonly compromiso = input.required<Compromiso>();

  readonly cerrado = output<void>();
  readonly actualizado = output<void>();
  readonly anular = output<void>();

  readonly estadosCompromiso: readonly string[] = ESTADOS_COMPROMISO;
  readonly estadosHito: readonly string[] = ESTADOS_HITO;
  readonly tiposCompromiso: readonly string[] = TIPOS_COMPROMISO;
  readonly nivelesGobierno: readonly string[] = NIVELES_GOBIERNO;
  readonly alcances: readonly string[] = ALCANCES;

  readonly editando = signal(false);
  readonly guardando = signal(false);
  readonly editError = signal<string | null>(null);
  readonly formulario = signal<FormularioCompromiso>(formularioVacio());

  readonly hitoNuevo = signal<FormularioHito>({
    descripcion: '',
    fecha: '',
    estado: 'Registrado',
  });
  readonly hitoGuardando = signal(false);
  readonly hitoCambiando = signal<string | null>(null);
  readonly hitosError = signal<string | null>(null);

  private readonly recurso = consulta<DetalleCompromiso>({
    fuente: () => {
      const id = this.compromiso().id;
      return id ? urlApi(`/v1/commitments/${encodeURIComponent(id)}`) : null;
    },
    esquema: aDetalleCompromiso,
  });

  private readonly catalogoRecurso = consulta<CatalogosCompromiso>({
    fuente: () => (this.editando() ? urlApi('/v1/catalogs') : null),
    esquema: aCatalogosCompromiso,
  });

  readonly detalle = this.recurso.valor;
  readonly estadoCarga = this.recurso.estado;
  readonly errorCarga = this.recurso.error;

  readonly cabecera = computed(() => this.detalle()?.compromiso ?? this.compromiso());

  readonly hitos = computed(() => this.cabecera().hitos);
  readonly proximoHito = computed(() => this.cabecera().proximoHito);
  readonly vencimiento = computed<ResolucionVencimiento>(() =>
    resolverVencimiento(this.cabecera()),
  );

  readonly puedeModificar = computed(() =>
    this.capacidades.puedeModificar(this.cabecera().clasificacion),
  );

  /** Anular exige, además de escritura sobre la clasificación, el privilegio de anulación. */
  readonly puedeAnular = computed(() => this.capacidades.puedeEliminar() && this.puedeModificar());

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
    if (!this.editando()) return null;
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

  readonly tematicasFormulario = computed<OpcionCatalogo[]>(() => {
    const base = this.catalogoRecurso.valor()?.tematicas ?? [];
    const actual = this.formulario().tematica.trim();
    if (!actual || base.some((opcion) => opcion.valor === actual)) return base;
    return [{ valor: actual, etiqueta: actual }, ...base];
  });

  cerrar(): void {
    this.cerrado.emit();
  }

  recargarDetalle(): void {
    this.recurso.recargar();
  }

  abrirEdicion(): void {
    if (!this.puedeModificar()) return;
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

  actualizarBooleano(evento: Event): void {
    const marcado = (evento.target as HTMLInputElement).checked;
    this.formulario.update((actual) => ({ ...actual, atiendeGenero: marcado }));
  }

  actualizarHito(campo: 'descripcion' | 'fecha', evento: Event): void {
    const valor = leerValor(evento);
    if (campo === 'descripcion') {
      this.hitoNuevo.update((actual) => ({ ...actual, descripcion: valor }));
      return;
    }
    this.hitoNuevo.update((actual) => ({ ...actual, fecha: valor }));
  }

  actualizarEstadoHitoNuevo(evento: Event): void {
    const valor = leerValor(evento);
    if (!this.esEstadoHito(valor)) return;
    this.hitoNuevo.update((actual) => ({ ...actual, estado: valor }));
  }

  async guardar(): Promise<void> {
    if (!this.puedeModificar()) {
      this.editError.set('No tiene permisos para modificar este compromiso.');
      return;
    }

    const form = this.formulario();
    const accion = form.accion.trim();
    if (!accion) {
      this.editError.set('La acción comprometida es obligatoria.');
      return;
    }

    const unidad = form.unidad.trim();
    if (!unidad) {
      this.editError.set('La unidad responsable es obligatoria.');
      return;
    }

    if (!(TIPOS_COMPROMISO as readonly string[]).includes(form.tipo)) {
      this.editError.set('El tipo de compromiso no es válido.');
      return;
    }

    if (!(ESTADOS_COMPROMISO as readonly string[]).includes(form.estado)) {
      this.editError.set('El estado del compromiso no es válido.');
      return;
    }

    const criterios = this.parsearCriterios(form.criteriosSmart);
    if (!criterios.ok) {
      this.editError.set('Los criterios SMART deben ser un objeto JSON válido.');
      return;
    }

    const id = this.cabecera().id;
    if (!id) {
      this.editError.set('El compromiso no tiene identificador.');
      return;
    }

    const cuerpo: Record<string, unknown> = {
      accion,
      tipo: form.tipo,
      estado: form.estado,
      unidad,
      nivelGobierno: form.nivelGobierno || null,
      alcance: form.alcance || null,
      tematica: form.tematica.trim() || null,
      atiendeGenero: form.atiendeGenero,
      criteriosSmart: criterios.valor,
      evidenciaUri: form.evidenciaUri.trim() || null,
      fechaVencimiento: form.fechaVencimiento.trim() || null,
    };

    if (form.fechaInicio.trim()) {
      cuerpo['fechaInicio'] = form.fechaInicio.trim();
    }

    this.guardando.set(true);
    this.editError.set(null);

    try {
      await firstValueFrom(
        this.http.patch<unknown>(urlApi(`/v1/commitments/${encodeURIComponent(id)}`), cuerpo),
      );
      this.editando.set(false);
      this.recurso.recargar();
      this.actualizado.emit();
    } catch (fallo) {
      this.editError.set(this.mensajeDeError(fallo));
    } finally {
      this.guardando.set(false);
    }
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

    this.hitoGuardando.set(true);
    this.hitosError.set(null);

    try {
      await firstValueFrom(
        this.http.post<unknown>(urlApi(`/v1/commitments/${encodeURIComponent(id)}/hitos`), cuerpo),
      );
      this.hitoNuevo.set({ descripcion: '', fecha: '', estado: 'Registrado' });
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

  fechaTexto(valor: string | null | undefined): string {
    return formatearFecha(valor);
  }

  /** «Regional» se muestra como GORE; el valor del catálogo no cambia. */
  nivelTexto(valor: string | null | undefined): string {
    return etiquetaNivelGobierno(valor ?? null);
  }

  esEnlace(uri: string | null): boolean {
    return uri ? /^https?:\/\//i.test(uri) : false;
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
      return `El servidor rechazó los datos (422): ${error.message} Revise la unidad, la temática, el alcance y las fechas.`;
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
