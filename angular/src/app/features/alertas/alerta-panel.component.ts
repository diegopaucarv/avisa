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
import { RIESGOS, formatearFechaCorta } from '../../dominio/mapeo';
import type { Riesgo } from '../../dominio/modelos';
import { IconoComponent } from '../../shared/ui/icono.component';
import { AdjuntosPanelComponent } from '../../shared/ui/adjuntos-panel.component';
import {
  TerritorioBuscadorComponent,
  type OpcionTerritorio,
} from '../../shared/ui/territorio-buscador.component';
import {
  ALCANCES_ALERTA,
  REGIONES_PERU,
  aJsonLineas,
  claveRiesgo,
  etiquetaEstado,
  geografiaAlerta,
  plantillaWhatsapp,
  tituloLimpio,
  type Alerta,
  type AlcanceAlerta,
  type AltaAlerta,
  type PatchAlerta,
} from './alerta.mapeo';
import { copiarAlPortapapeles } from './portapapeles';

/** Opción del selector de caso: código y título de `GET /api/v1/cases`. */
export type CasoOpcion = { codigo: string; titulo: string };

/** Modo con el que se abre el panel desde el listado. */
export type ModoPanelAlerta = 'ver' | 'editar' | 'historial';

type BorradorAlerta = {
  titulo: string;
  situacionActual: string;
  hechosRecientes: string;
  descripcionRiesgo: string;
  actoresClave: string;
  demandasInmediatas: string;
  accionesSugeridas: string;
};

type CampoBorrador = keyof BorradorAlerta;

type MetadatosAlerta = {
  riesgo: Riesgo | '';
  alcance: AlcanceAlerta | '';
  region: string;
  provincia: string;
  casoCode: string;
};

type CampoMetadatos = 'region' | 'provincia' | 'casoCode';

type BorradorAlta = {
  titulo: string;
  riesgo: Riesgo | '';
  alcance: AlcanceAlerta | '';
  region: string;
  provincia: string;
  casoCode: string;
  descripcionRiesgo: string;
  hechosRecientes: string;
  situacionActual: string;
  actoresClave: string;
  demandasInmediatas: string;
  accionesSugeridas: string;
};

type CampoAlta = Exclude<keyof BorradorAlta, 'riesgo' | 'alcance'>;

const BORRADOR_ALTA_VACIO: BorradorAlta = {
  titulo: '',
  riesgo: '',
  alcance: '',
  region: '',
  provincia: '',
  casoCode: '',
  descripcionRiesgo: '',
  hechosRecientes: '',
  situacionActual: '',
  actoresClave: '',
  demandasInmediatas: '',
  accionesSugeridas: '',
};

/** `undefined` = no cambió; `null` = se vació a propósito. */
function diferenciaTexto(valor: string, original: string | null): string | null | undefined {
  const limpio = valor.trim();
  if (limpio === (original ?? '').trim()) return undefined;
  return limpio ? limpio : null;
}

/** `Distrito · Provincia · Región` → provincia y región. */
function partesDeRuta(ruta: string | null | undefined): { provincia: string; region: string } {
  const partes = (ruta ?? '')
    .split('·')
    .map((parte) => parte.trim())
    .filter((parte) => parte.length > 0);
  return { provincia: partes[1] ?? '', region: partes[2] ?? '' };
}

/**
 * Panel lateral derecho de una alerta.
 *
 * Concentra la ficha y la edición. Los metadatos (riesgo, alcance geográfico,
 * caso vinculado y distrito) los puede editar cualquier perfil: viven en un
 * formulario siempre activo. El contenido narrativo sólo se abre con
 * «Modificar» y exige el permiso que decide la pantalla.
 *
 * No conoce HTTP: emite el `PatchAlerta` ya calculado o el `AltaAlerta`.
 */
@Component({
  selector: 'app-alerta-panel',
  imports: [IconoComponent, TerritorioBuscadorComponent, AdjuntosPanelComponent],
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
      margin: 0;
      color: #8a98a5;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
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
      gap: 6px;
    }

    .alerta-geografia {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 999px;
      background: #eef3fa;
      color: #4a6b93;
      font-size: 11.5px;
      font-weight: 700;
    }

    .alerta-trazabilidad {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px 16px;
      padding: 10px 12px;
      border: 1px solid #e8edf1;
      border-radius: 9px;
      background: #f9fbfd;
      font-size: 12.5px;
      color: #526577;
    }

    .alerta-trazabilidad b {
      color: #17283a;
      font-weight: 700;
    }

    .alerta-trazabilidad button {
      margin-left: auto;
    }

    .alerta-seccion {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 14px 15px;
      border: 1px solid #e8edf1;
      border-radius: 11px;
      background: #fff;
    }

    .alerta-seccion h3 {
      margin: 0;
      color: #1a2b3e;
      font-size: 12.5px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
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

    .bloque-metadatos {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px 15px;
      border: 1px solid #e8edf1;
      border-radius: 11px;
      background: #f9fbfd;
    }

    .bloque-metadatos h3 {
      margin: 0;
      color: #1a2b3e;
      font-size: 12.5px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .rejilla-dos {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .rejilla-metadatos {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 10px;
    }

    .acciones-form {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }

    .plantilla-mensaje {
      width: 100%;
      min-height: 240px;
      padding: 12px 14px;
      border: 1px solid #e0e6ec;
      border-radius: 10px;
      background: #f9fbfd;
      color: #17283a;
      font:
        500 12.5px/21px ui-monospace,
        'SFMono-Regular',
        'Menlo',
        'Consolas',
        monospace;
      white-space: pre-wrap;
      resize: vertical;
    }

    .plantilla-mensaje[readonly] {
      cursor: default;
    }

    .plantilla-mensaje:focus {
      outline: 2px solid #c9d8ea;
      outline-offset: 1px;
      background: #fff;
    }

    .herramientas-plantilla {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .conmutador {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #33475b;
      font-size: 12.5px;
      font-weight: 600;
    }

    .historial {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .historial li {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 8px 10px;
      border: 1px solid #eef2f6;
      border-radius: 8px;
      background: #fff;
    }

    .historial .historial-autor {
      color: #17283a;
      font-size: 13px;
      font-weight: 700;
    }

    .historial .historial-meta {
      color: #8b97a1;
      font-size: 12px;
    }

    .aviso-copia {
      margin: 0;
      color: #2f6f52;
      font-size: 12.5px;
    }

    @media (max-width: 620px) {
      .rejilla-dos,
      .rejilla-metadatos {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class AlertaPanelComponent {
  readonly alerta = input<Alerta | null>(null);
  readonly cargando = input(false);
  readonly errorCarga = input<ErrorApi | null>(null);
  /** Permiso para editar el contenido narrativo (los metadatos no lo exigen). */
  readonly puedeModificar = input(false);
  readonly guardando = input(false);
  readonly errorGuardado = input<string | null>(null);
  readonly aviso = input<string | null>(null);
  readonly modoInicial = input<ModoPanelAlerta>('ver');
  /** Código del caso con el que se presiembra el alta. */
  readonly casoInicial = input('');
  /** Casos disponibles para el selector «Caso vinculado». */
  readonly casos = input<readonly CasoOpcion[]>([]);

  readonly cerrar = output<void>();
  readonly reintentar = output<void>();
  readonly guardar = output<PatchAlerta>();
  readonly registrar = output<AltaAlerta>();

  readonly riesgos = RIESGOS;
  readonly alcances = ALCANCES_ALERTA;
  readonly regiones = REGIONES_PERU;

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly destruccion = inject(DestroyRef);

  /** Elemento que tenía el foco al abrir, para devolvérselo al cerrar. */
  private readonly focoPrevio =
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);

  readonly editando = signal(false);
  readonly verHistorial = signal(false);
  readonly borrador = signal<BorradorAlerta | null>(null);
  readonly metadatos = signal<MetadatosAlerta>({
    riesgo: '',
    alcance: '',
    region: '',
    provincia: '',
    casoCode: '',
  });
  readonly distritoMetadatos = signal<OpcionTerritorio | null>(null);
  readonly borradorAlta = signal<BorradorAlta>(BORRADOR_ALTA_VACIO);
  readonly distritoAlta = signal<OpcionTerritorio | null>(null);
  readonly mensaje = signal('');
  readonly editarPlantilla = signal(false);
  readonly avisoCopia = signal<string | null>(null);
  readonly mensajeLocal = signal<string | null>(null);

  readonly formulario = computed(() => (this.editando() ? this.borrador() : null));

  /** `alerta === null` significa alta. */
  readonly esAlta = computed(() => this.alerta() === null);

  /** Semilla del buscador en edición: el distrito ya guardado. */
  readonly inicialDistritoMetadatos = computed(() => {
    const distrito = this.distritoMetadatos();
    if (distrito?.tipo !== 'distrito') return null;
    return { id: distrito.id, nombre: distrito.nombre, ruta: distrito.ruta };
  });

  readonly inicialDistritoAlta = computed(() => {
    const distrito = this.distritoAlta();
    if (distrito?.tipo !== 'distrito') return null;
    return { id: distrito.id, nombre: distrito.nombre, ruta: distrito.ruta };
  });

  constructor() {
    afterNextRender(() => this.panel()?.nativeElement.focus());

    this.destruccion.onDestroy(() => this.focoPrevio?.focus?.());
  }

    // Tras un guardado correcto se cierra el modo edición para mostrar lo ya persistido.
    effect(() => {
      if (!this.aviso()) return;
      this.editando.set(false);
      this.borrador.set(null);
      this.editarPlantilla.set(false);
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
        this.verHistorial.set(false);
        return;
      }
      this.sembrar(alerta);
      this.editando.set(modo === 'editar');
      this.verHistorial.set(modo === 'historial');
    });

    // El alta se siembra limpia y con el caso del contexto, si lo hay.
    effect(() => {
      if (!this.esAlta()) return;
      this.borradorAlta.set({ ...BORRADOR_ALTA_VACIO, casoCode: this.casoInicial().trim() });
      this.distritoAlta.set(null);
      this.mensajeLocal.set(null);
    });
  }

  private sembrar(alerta: Alerta): void {
    this.metadatos.set({
      riesgo: alerta.riesgo,
      alcance: alerta.alcance,
      region: alerta.region ?? '',
      provincia: alerta.provincia ?? '',
      casoCode: alerta.casoCodigo ?? '',
    });
    this.distritoMetadatos.set(
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
    this.borrador.set(null);
    this.mensaje.set(alerta.plantillaWhatsapp ?? plantillaWhatsapp(alerta));
    this.editarPlantilla.set(false);
    this.avisoCopia.set(null);
    this.mensajeLocal.set(null);
  }

  /* ---------------------------------------------------------------------- *
   * Presentación
   * ---------------------------------------------------------------------- */

  tituloVisible(alerta: Alerta): string {
    return tituloLimpio(alerta.titulo) || alerta.codigo || 'Alerta sin título';
  }

  geografia(alerta: Alerta): string {
    return geografiaAlerta(alerta);
  }

  estadoVisible(alerta: Alerta): string {
    return etiquetaEstado(alerta.estado);
  }

  claseRiesgo(riesgo: Riesgo): string {
    return `status-badge risk-${claveRiesgo(riesgo)}`;
  }

  fecha(valor: string | null): string {
    return formatearFechaCorta(valor);
  }

  /* ---------------------------------------------------------------------- *
   * Metadatos (siempre editables)
   * ---------------------------------------------------------------------- */

  cambiarRiesgo(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value as Riesgo;
    this.metadatos.update((actual) => ({ ...actual, riesgo: valor }));
    this.mensajeLocal.set(null);
  }

  cambiarAlcance(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value as AlcanceAlerta;
    this.metadatos.update((actual) => ({ ...actual, alcance: valor }));
    if (valor === 'Nacional') {
      this.distritoMetadatos.set(null);
      this.metadatos.update((actual) => ({ ...actual, region: '', provincia: '' }));
    } else if (valor === 'Región') {
      this.distritoMetadatos.set(null);
    }
    this.mensajeLocal.set(null);
  }

  campoMetadatos(clave: CampoMetadatos, evento: Event): void {
    const valor = (evento.target as HTMLInputElement | HTMLSelectElement).value;
    this.metadatos.update((actual) => ({ ...actual, [clave]: valor }));
    this.mensajeLocal.set(null);
  }

  alElegirDistritoMetadatos(opcion: OpcionTerritorio | null): void {
    const distrito = opcion?.tipo === 'distrito' ? opcion : null;
    this.distritoMetadatos.set(distrito);
    if (distrito) {
      const partes = partesDeRuta(distrito.ruta);
      this.metadatos.update((actual) => ({
        ...actual,
        region: distrito.region || partes.region || actual.region,
        provincia: partes.provincia || actual.provincia,
      }));
    }
    this.mensajeLocal.set(null);
  }

  guardarMetadatos(): void {
    const alerta = this.alerta();
    if (!alerta) return;

    const metadatos = this.metadatos();
    const cambios: PatchAlerta = {};

    if (metadatos.riesgo && metadatos.riesgo !== alerta.riesgo) {
      cambios.riesgo = metadatos.riesgo;
    }

    if (metadatos.alcance && metadatos.alcance !== alerta.alcance) {
      cambios.alcance = metadatos.alcance;
    }

    const region = metadatos.region.trim() || null;
    if (region !== (alerta.region ?? null)) cambios.region = region;

    const provincia = metadatos.provincia.trim() || null;
    if (provincia !== (alerta.provincia ?? null)) cambios.provincia = provincia;

    const caso = metadatos.casoCode.trim() || null;
    if (caso !== (alerta.casoCodigo ?? null)) cambios.casoCode = caso;

    const distrito = this.distritoMetadatos();
    const distritoId = distrito?.tipo === 'distrito' ? distrito.id : null;
    if (distritoId !== alerta.distritoId) cambios.distritoId = distritoId;

    if (Object.keys(cambios).length === 0) {
      this.mensajeLocal.set('No hay cambios en los metadatos.');
      return;
    }

    this.mensajeLocal.set(null);
    this.guardar.emit(cambios);
  }

  /* ---------------------------------------------------------------------- *
   * Contenido narrativo
   * ---------------------------------------------------------------------- */

  iniciarEdicion(): void {
    const alerta = this.alerta();
    if (!alerta || !this.puedeModificar()) return;

    this.borrador.set({
      titulo: alerta.titulo ?? '',
      situacionActual: alerta.situacionActual ?? '',
      hechosRecientes: alerta.hechosRecientes ?? '',
      descripcionRiesgo: alerta.descripcionRiesgo ?? '',
      actoresClave: alerta.actoresClave.join('\n'),
      demandasInmediatas: alerta.demandasInmediatas.join('\n'),
      accionesSugeridas: alerta.accionesSugeridas.join('\n'),
    });
    this.mensajeLocal.set(null);
    this.editando.set(true);
  }

  cancelarEdicion(): void {
    this.editando.set(false);
    this.borrador.set(null);
    this.mensajeLocal.set(null);
  }

  campo(clave: CampoBorrador, evento: Event): void {
    const objetivo = evento.target as HTMLInputElement | HTMLTextAreaElement;
    const valor = objetivo.value;
    this.borrador.update((actual) => (actual ? { ...actual, [clave]: valor } : actual));
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

    const titulo = diferenciaTexto(borrador.titulo, alerta.titulo);
    if (titulo !== undefined) cambios.titulo = titulo;

    const situacion = diferenciaTexto(borrador.situacionActual, alerta.situacionActual);
    if (situacion !== undefined) cambios.situacionActual = situacion;

    const hechos = diferenciaTexto(borrador.hechosRecientes, alerta.hechosRecientes);
    if (hechos !== undefined) cambios.hechosRecientes = hechos;

    const descripcion = diferenciaTexto(borrador.descripcionRiesgo, alerta.descripcionRiesgo);
    if (descripcion !== undefined) cambios.descripcionRiesgo = descripcion;

    const actores = aJsonLineas(borrador.actoresClave.split('\n'));
    if ((actores ?? []).join('\n') !== alerta.actoresClave.join('\n')) {
      cambios.actoresClave = actores;
    }

    const demandas = aJsonLineas(borrador.demandasInmediatas.split('\n'));
    if ((demandas ?? []).join('\n') !== alerta.demandasInmediatas.join('\n')) {
      cambios.demandasInmediatas = demandas;
    }

    const sugeridas = aJsonLineas(borrador.accionesSugeridas.split('\n'));
    if ((sugeridas ?? []).join('\n') !== alerta.accionesSugeridas.join('\n')) {
      cambios.accionesSugeridas = sugeridas;
    }

    if (Object.keys(cambios).length === 0) {
      this.mensajeLocal.set('No hay cambios que guardar.');
      return;
    }

    this.mensajeLocal.set(null);
    this.guardar.emit(cambios);
  }

  alternarHistorial(): void {
    this.verHistorial.update((valor) => !valor);
  }

  /* ---------------------------------------------------------------------- *
   * Plantilla de WhatsApp
   * ---------------------------------------------------------------------- */

  campoMensaje(evento: Event): void {
    const area = evento.target as HTMLTextAreaElement;
    this.mensaje.set(area.value);
    this.avisoCopia.set(null);
  }

  alternarPlantilla(): void {
    if (!this.editarPlantilla() && !this.puedeModificar()) return;
    this.editarPlantilla.update((valor) => !valor);
  }

  regenerarMensaje(): void {
    const alerta = this.alerta();
    if (!alerta) return;
    this.mensaje.set(plantillaWhatsapp(alerta));
    this.avisoCopia.set(null);
  }

  async copiarMensaje(): Promise<void> {
    const ok = await copiarAlPortapapeles(this.mensaje());
    this.avisoCopia.set(
      ok
        ? 'Mensaje copiado al portapapeles.'
        : 'No se pudo copiar. Seleccione el texto y use Ctrl + C.',
    );
  }

  guardarPlantilla(): void {
    this.guardar.emit({ plantillaWhatsapp: this.mensaje().trim() || null });
  }

  /* ---------------------------------------------------------------------- *
   * Alta
   * ---------------------------------------------------------------------- */

  campoAlta(clave: CampoAlta, evento: Event): void {
    const objetivo = evento.target as HTMLInputElement | HTMLTextAreaElement;
    const valor = objetivo.value;
    this.borradorAlta.update((actual) => ({ ...actual, [clave]: valor }));
    this.mensajeLocal.set(null);
  }

  cambiarRiesgoAlta(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value as Riesgo;
    this.borradorAlta.update((actual) => ({ ...actual, riesgo: valor }));
  }

  cambiarAlcanceAlta(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value as AlcanceAlerta;
    this.borradorAlta.update((actual) => ({ ...actual, alcance: valor }));
    if (valor !== 'Distrito') this.distritoAlta.set(null);
    if (valor === 'Nacional') {
      this.borradorAlta.update((actual) => ({ ...actual, region: '', provincia: '' }));
    }
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
  }

  alEnviarAlta(evento: Event): void {
    evento.preventDefault();
    this.guardarAlta();
  }

  guardarAlta(): void {
    if (!this.puedeModificar() || this.guardando()) return;

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

    const descripcion = borrador.descripcionRiesgo.trim();
    if (descripcion) cuerpo.descripcionRiesgo = descripcion;

    const hechos = borrador.hechosRecientes.trim();
    if (hechos) cuerpo.hechosRecientes = hechos;

    const situacion = borrador.situacionActual.trim();
    if (situacion) cuerpo.situacionActual = situacion;

    const actores = aJsonLineas(borrador.actoresClave.split('\n'));
    if (actores) cuerpo.actoresClave = actores;

    const demandas = aJsonLineas(borrador.demandasInmediatas.split('\n'));
    if (demandas) cuerpo.demandasInmediatas = demandas;

    const sugeridas = aJsonLineas(borrador.accionesSugeridas.split('\n'));
    if (sugeridas) cuerpo.accionesSugeridas = sugeridas;

    this.mensajeLocal.set(null);
    this.registrar.emit(cuerpo);
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
