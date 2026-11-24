import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { urlConParametros } from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import {
  COLUMNAS_TABLERO,
  ETIQUETAS_COLUMNA,
  ETIQUETAS_TIPO,
  OPCIONES_FILTRO,
  claseFechaLimite,
  claseRiesgo,
  claseTipo,
  claveTarjeta,
  etiquetaFechaLimite,
  fechaTexto,
  normalizarCompletitud,
  normalizarFiltroTipo,
  normalizarTablero,
  responsableDe,
  rutaEntidad,
  tieneResponsable,
  type CambiosTarjeta,
  type CandidatoTablero,
  type ClaveColumna,
  type CompletitudColumna,
  type FiltroTipoTablero,
  type TarjetaTablero,
} from './bandeja.mapeo';
import { BandejaService } from './bandeja.service';

type FormularioTarjeta = {
  asignacionTexto: string;
  responsableTexto: string;
  fechaLimite: string;
  pospuestoHasta: string;
  motivoPosposicion: string;
};

function formularioVacio(): FormularioTarjeta {
  return {
    asignacionTexto: '',
    responsableTexto: '',
    fechaLimite: '',
    pospuestoHasta: '',
    motivoPosposicion: '',
  };
}

/**
 * Bandeja de trabajo como tablero (Kanban).
 *
 * Cuatro columnas persistidas en `core.tablero_tarjeta` (`backlog`, `en_curso`,
 * `en_espera`, `hecho`). Cada tarjeta muestra los datos de la entidad dueña
 * resueltos por la API y permite moverla y editar responsable, asignación,
 * fecha límite y posposición; el servidor guarda el cambio y deja el evento de
 * historial. Los registros que todavía no tienen tarjeta se listan debajo y se
 * incorporan al tablero con el primer movimiento (upsert).
 *
 * No hay arrastre: el mockup no lo dibuja, así que se usan botones de columna.
 * La completitud no se calcula aquí: llega del endpoint dedicado.
 */
@Component({
  selector: 'app-bandeja',
  imports: [IconoComponent, ExportarMenuComponent, RouterLink],
  templateUrl: './bandeja.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    /* Tablero ------------------------------------------------------- */

    .tablero {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      align-items: start;
    }

    .tablero-col {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
      padding: 10px 10px 12px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #f8fafb;
    }

    .tablero-col-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .tablero-col-head h2 {
      margin: 0;
      color: var(--ink);
      font: 700 12px/1.3 var(--font-display);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .tablero-col-count {
      min-width: 22px;
      padding: 1px 7px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #fff;
      color: var(--muted);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      text-align: center;
    }

    .tablero-col-meta {
      margin: 0;
      color: var(--muted);
      font-size: 10.5px;
      line-height: 1.4;
    }

    .tablero-col-vacio {
      margin: 0;
      padding: 14px 8px;
      border: 1px dashed #dfe4ea;
      border-radius: 8px;
      color: #97a3b0;
      font-size: 11px;
      text-align: center;
    }

    /* Tarjeta ------------------------------------------------------- */

    .tarjeta {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px;
      border: 1px solid #dfe4ea;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 1px 1px rgba(17, 32, 45, 0.04);
    }

    .tarjeta-top {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .tag {
      display: inline-block;
      padding: 1px 7px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      font-size: 10px;
      white-space: nowrap;
    }

    .tag.tipo-alerta {
      border-color: #f3c3bd;
      background: #fdf1ef;
      color: var(--red);
    }

    .tag.tipo-compromiso {
      border-color: #f5d6b3;
      background: #fdf6ec;
      color: #8a5a00;
    }

    .tag.tipo-demanda {
      border-color: #cddcef;
      background: #eaf1f8;
      color: #2455a2;
    }

    .tag.tipo-caso {
      border-color: #c9e3d5;
      background: #eef7f2;
      color: var(--green);
    }

    .tag.r-alto {
      border-color: #f3c3bd;
      background: #fdf1ef;
      color: var(--red);
    }

    .tag.r-moderado {
      border-color: #f5d6b3;
      background: #fdf6ec;
      color: #ad741d;
    }

    .tag.r-bajo {
      border-color: #c9e3d5;
      background: #eef7f2;
      color: var(--green);
    }

    .tarjeta-titulo {
      margin: 0;
      color: var(--ink);
      font: 600 12.5px/1.35 var(--font-display);
      overflow-wrap: anywhere;
    }

    .tarjeta-code {
      margin: 0;
      color: #8995a0;
      font-size: 10.5px;
      overflow-wrap: anywhere;
    }

    .tarjeta-code code {
      padding: 0 3px;
      border-radius: 3px;
      background: #eef1f4;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10px;
    }

    .tarjeta-asignacion {
      margin: 0;
      color: var(--ink-2);
      font-size: 11px;
      line-height: 1.4;
    }

    .tarjeta-datos {
      display: flex;
      flex-direction: column;
      gap: 3px;
      margin: 0;
    }

    .tarjeta-datos > div {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }

    .tarjeta-datos dt {
      color: #97a3b0;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .tarjeta-datos dd {
      margin: 0;
      color: var(--ink-2);
      font-size: 11px;
      text-align: right;
    }

    .sin-dato {
      color: #97a3b0;
    }

    .tarjeta-pospuesta {
      display: flex;
      align-items: flex-start;
      gap: 4px;
      margin: 0;
      padding: 5px 7px;
      border: 1px solid #f5d6b3;
      border-radius: 6px;
      background: #fdf6ec;
      color: #8a5a00;
      font-size: 10.5px;
      line-height: 1.4;
    }

    .tarjeta-pospuesta app-icono {
      margin-top: 1px;
    }

    .tarjeta-acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 2px;
      padding-top: 6px;
      border-top: 1px solid #eef1f4;
    }

    .tarjeta-acciones button {
      padding: 3px 7px;
      border: 1px solid var(--line);
      border-radius: 5px;
      background: #fff;
      color: var(--muted);
      font: inherit;
      font-size: 10px;
      cursor: pointer;
    }

    .tarjeta-acciones button:hover:not(:disabled) {
      border-color: var(--blue);
      color: var(--blue);
    }

    .tarjeta-acciones button[aria-pressed='true'] {
      border-color: var(--blue);
      background: var(--blue-pale);
      color: var(--blue-dark);
      font-weight: 600;
      cursor: default;
    }

    .tarjeta-acciones button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .tarjeta-acciones .editar {
      margin-left: auto;
      border-color: #cddcef;
      color: var(--blue);
      font-weight: 600;
    }

    /* Formulario en la tarjeta -------------------------------------- */

    .tarjeta-form {
      display: grid;
      gap: 6px;
      padding: 8px;
      border: 1px solid #cddcef;
      border-radius: 7px;
      background: #f8fbff;
    }

    .tarjeta-form label {
      display: grid;
      gap: 2px;
      color: #647487;
      font-size: 10px;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }

    .tarjeta-form input {
      min-height: 27px;
      padding: 4px 7px;
      border: 1px solid #dce3e8;
      border-radius: 5px;
      background: #fff;
      color: var(--ink);
      font: inherit;
      font-size: 11px;
    }

    .tarjeta-form input:focus-visible {
      border-color: var(--blue);
      outline: 2px solid #cddcef;
      outline-offset: 0;
    }

    .tarjeta-form-acciones {
      display: flex;
      gap: 5px;
      margin-top: 2px;
    }

    .tarjeta-form-acciones button {
      min-height: 26px;
      padding: 0 9px;
      font-size: 11px;
    }

    /* Candidatos y completitud -------------------------------------- */

    .candidato-mover {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .candidato-mover button {
      padding: 3px 7px;
      border: 1px solid var(--line);
      border-radius: 5px;
      background: #fff;
      color: var(--muted);
      font: inherit;
      font-size: 10px;
      cursor: pointer;
    }

    .candidato-mover button:hover:not(:disabled) {
      border-color: var(--blue);
      color: var(--blue);
    }

    .candidato-mover button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .num {
      font-variant-numeric: tabular-nums;
      text-align: right;
    }

    .tablero-aviso {
      margin: 0;
      padding: 12px 14px;
      border: 1px solid #f1d9a8;
      border-radius: 8px;
      background: #fffaf0;
      color: #8a5a00;
      font-size: 12px;
      line-height: 1.5;
    }

    .tablero-aviso strong {
      color: #6d4700;
    }

    .accion-aviso {
      margin: 0;
      color: var(--green);
      font-size: 12px;
    }

    .accion-error {
      margin: 0;
      color: var(--red);
      font-size: 12px;
    }

    @media (max-width: 1080px) {
      .tablero {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 620px) {
      .tablero {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class BandejaPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly servicio = inject(BandejaService);
  private readonly capacidades = inject(CapacidadesService);

  readonly opcionesTipo = OPCIONES_FILTRO;
  readonly etiquetasColumna = ETIQUETAS_COLUMNA;
  readonly etiquetasTipo = ETIQUETAS_TIPO;
  readonly destinos = COLUMNAS_TABLERO.map((clave) => ({
    clave,
    etiqueta: ETIQUETAS_COLUMNA[clave],
  }));

  readonly puedeEditar = this.capacidades.puedeEditar;

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly errorAccion = signal<string | null>(null);
  readonly guardando = signal(false);
  readonly tarjetaEnEdicion = signal<string | null>(null);
  readonly formulario = signal<FormularioTarjeta>(formularioVacio());

  /** `?tipo=` de la URL; cualquier variante desconocida cae en «todas». */
  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({ tipo: normalizarFiltroTipo(params.get('tipo')) })),
    ),
    { initialValue: { tipo: 'todas' as FiltroTipoTablero } },
  );

  readonly filtroTipo = computed(() => this.parametros().tipo);

  private readonly recursoTablero = consulta({
    fuente: () =>
      urlConParametros(urlApi('/v1/bandeja'), {
        tipo: this.filtroTipo() === 'todas' ? null : this.filtroTipo(),
      }),
    esquema: normalizarTablero,
  });

  private readonly recursoCompletitud = consulta({
    fuente: () =>
      urlConParametros(urlApi('/v1/bandeja/completitud'), {
        tipo: this.filtroTipo() === 'todas' ? null : this.filtroTipo(),
      }),
    esquema: normalizarCompletitud,
  });

  readonly tablero = this.recursoTablero.valor;
  readonly completitud = this.recursoCompletitud.valor;

  readonly columnas = computed(() => this.tablero()?.columnas ?? []);
  readonly candidatos = computed(() => this.tablero()?.candidatos ?? []);
  readonly sinTarjetas = computed(() => (this.tablero()?.total ?? 0) === 0);
  readonly sinCandidatos = computed(() => this.candidatos().length === 0);
  readonly incompletas = computed(() => this.completitud()?.total.incompletas ?? 0);

  readonly cargando = computed(
    () =>
      this.recursoTablero.estado() === 'cargando' || this.recursoTablero.estado() === 'inactivo',
  );

  readonly error = computed(
    () => this.recursoTablero.error()?.message ?? this.recursoCompletitud.error()?.message ?? null,
  );

  /* ------------------------------------------------------------------ *
   * Helpers de plantilla
   * ------------------------------------------------------------------ */

  /** Completitud de una columna; `null` mientras no llegó el endpoint. */
  completitudDe(clave: ClaveColumna): CompletitudColumna | null {
    return this.completitud()?.columnas.find((columna) => columna.clave === clave) ?? null;
  }

  /** Conteo de los chips de tipo: lo entrega la API, ya sumado por tipo. */
  contadorTipo(valor: FiltroTipoTablero): string {
    const conteos = this.tablero()?.conteosTipo;
    if (!conteos) return '';
    if (valor === 'todas') {
      return String(conteos.alerta + conteos.compromiso + conteos.demanda + conteos.caso);
    }
    return String(conteos[valor]);
  }

  claseTipoDe(tarjeta: Pick<TarjetaTablero, 'entidadTipo'>): string {
    return claseTipo(tarjeta.entidadTipo);
  }

  claseRiesgoDe(tarjeta: Pick<TarjetaTablero, 'riesgo'>): string {
    return claseRiesgo(tarjeta.riesgo);
  }

  responsable(tarjeta: TarjetaTablero): string {
    return responsableDe(tarjeta);
  }

  sinResponsable(tarjeta: TarjetaTablero): boolean {
    return !tieneResponsable(tarjeta);
  }

  fecha(valor: string | null): string {
    return fechaTexto(valor);
  }

  claseFecha(tarjeta: TarjetaTablero): string {
    return claseFechaLimite(tarjeta.fechaLimite, this.tablero()?.hoy ?? null);
  }

  etiquetaFecha(tarjeta: TarjetaTablero): string {
    return etiquetaFechaLimite(tarjeta.fechaLimite, this.tablero()?.hoy ?? null);
  }

  rutaDe(tarjeta: TarjetaTablero): string | null {
    const codigo = tarjeta.entidadTipo === 'caso' ? tarjeta.codigo : tarjeta.casoCodigo;
    return rutaEntidad(tarjeta.entidadTipo, codigo);
  }

  rutaCandidato(candidato: CandidatoTablero): string | null {
    return rutaEntidad(candidato.entidadTipo, candidato.casoCodigo);
  }

  enEdicion(tarjeta: TarjetaTablero): boolean {
    return this.tarjetaEnEdicion() === claveTarjeta(tarjeta);
  }

  /* ------------------------------------------------------------------ *
   * Acciones
   * ------------------------------------------------------------------ */

  editar(tarjeta: TarjetaTablero): void {
    if (!this.puedeEditar()) return;
    this.errorAccion.set(null);
    this.aviso.set(null);
    this.formulario.set({
      asignacionTexto: tarjeta.asignacionTexto ?? '',
      responsableTexto: tarjeta.responsableTexto ?? '',
      fechaLimite: tarjeta.fechaLimite ?? '',
      pospuestoHasta: tarjeta.pospuestoHasta ?? '',
      motivoPosposicion: tarjeta.motivoPosposicion ?? '',
    });
    this.tarjetaEnEdicion.set(claveTarjeta(tarjeta));
  }

  cancelar(): void {
    this.tarjetaEnEdicion.set(null);
    this.errorAccion.set(null);
    this.formulario.set(formularioVacio());
  }

  campo(campo: keyof FormularioTarjeta, evento: Event): void {
    const valor = (evento.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.formulario.update((formulario) => ({ ...formulario, [campo]: valor }));
  }

  guardar(evento: Event, tarjeta: TarjetaTablero): void {
    evento.preventDefault();
    if (this.guardando() || !this.puedeEditar()) return;

    const formulario = this.formulario();
    const pospuestoHasta = formulario.pospuestoHasta || null;
    const motivo = formulario.motivoPosposicion.trim() || null;

    if (pospuestoHasta && !motivo) {
      this.errorAccion.set('Indique el motivo de la posposición.');
      return;
    }

    const cambios: CambiosTarjeta = {
      asignacionTexto: formulario.asignacionTexto.trim() || null,
      responsableTexto: formulario.responsableTexto.trim() || null,
      fechaLimite: formulario.fechaLimite || null,
      pospuestoHasta,
      motivoPosposicion: pospuestoHasta ? motivo : null,
    };

    this.enviar(tarjeta, cambios, 'Tarjeta actualizada.');
  }

  mover(tarjeta: TarjetaTablero, columna: ClaveColumna): void {
    if (!this.puedeEditar() || this.guardando() || tarjeta.columna === columna) return;
    this.enviar(tarjeta, { columna }, `Tarjeta movida a ${ETIQUETAS_COLUMNA[columna]}.`);
  }

  moverCandidato(candidato: CandidatoTablero, columna: ClaveColumna): void {
    if (!this.puedeEditar() || this.guardando()) return;
    this.enviar(
      { entidadTipo: candidato.entidadTipo, entidadId: candidato.entidadId },
      { columna },
      `Registro incorporado a ${ETIQUETAS_COLUMNA[columna]}.`,
    );
  }

  private enviar(
    ref: { entidadTipo: string; entidadId: string },
    cambios: CambiosTarjeta,
    mensaje: string,
  ): void {
    this.guardando.set(true);
    this.errorAccion.set(null);
    this.aviso.set(null);

    this.servicio.actualizar(ref.entidadTipo, ref.entidadId, cambios).subscribe({
      next: () => {
        this.guardando.set(false);
        this.tarjetaEnEdicion.set(null);
        this.formulario.set(formularioVacio());
        this.aviso.set(mensaje);
        this.recargar();
      },
      error: (fallo: unknown) => {
        this.guardando.set(false);
        this.errorAccion.set(aErrorApi(fallo).message);
      },
    });
  }

  /** Persiste el filtro en `?tipo=`, sin recargar la pantalla. */
  cambiarTipo(tipo: FiltroTipoTablero): void {
    if (tipo === this.filtroTipo()) return;
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: { tipo: tipo === 'todas' ? null : tipo },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  recargar(): void {
    this.recursoTablero.recargar();
    this.recursoCompletitud.recargar();
  }
}
