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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { urlApi } from '../../core/config/entorno';
import { normalizarColeccion, urlConParametros } from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { IconoComponent } from '../../shared/ui/icono.component';
import { salirModal } from '../../shared/ui/modal-salida';
import {
  aActorDirectorio,
  aCatalogosDirectorio,
  errorDeCorreo,
  errorDeDni,
  errorDeExpedienteOspa,
  errorDeRuc,
  errorDeTelefono,
  TIPOS_ACTOR,
  type ActorDirectorio,
  type CatalogosDirectorio,
} from './directorio.mapeo';

/** `persona` u `organizacion`; determina los bloques del formulario. */
export type NaturalezaAlta = 'persona' | 'organizacion';

const NIVELES_GOBIERNO = [
  '',
  'Nacional',
  'Regional',
  'Local',
  'Empresa',
  'Sociedad Civil',
] as const;

/** Base legal presente en las filas ya migradas; no hay consentimientos registrados. */
const BASE_LEGAL = 'LEGADO_AVISA_2026';

const MOTIVO_DUPLICADOS = 5;

/**
 * Alta de actor (persona u organización).
 *
 * Copia la estructura de `directorio-crud.html` → `openAlta()` y de los cuatro
 * bloques de `actores_editar_actor_modo_oscuro_2.html`: naturaleza y nombre
 * obligatorios, identificación opcional (DNI de 8 dígitos, RUC de 11), membresía
 * OSPA opcional para personas, bloque OSPA para organizaciones y contacto
 * opcional (PII). «Aviso de duplicados» compara el nombre contra el directorio
 * mientras se escribe, como el mockup.
 *
 * No conoce reglas de servidor: valida la forma y envía `POST /v1/actors`; la
 * API revalida todo (incluida la autoridad PII de la sesión).
 */
@Component({
  selector: 'app-actor-panel-alta',
  imports: [IconoComponent],
  templateUrl: './actor-panel-alta.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }

    .alta-scrim {
      position: fixed;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      box-sizing: border-box;
    }

    .alta-modal {
      display: flex;
      flex-direction: column;
      width: min(760px, 100%);
      max-height: min(92vh, 900px);
      overflow: hidden;
      border: 1px solid #e1e7ec;
      border-radius: 14px;
      background: #fff;
      box-shadow: 0 24px 60px rgba(15, 35, 55, 0.28);
    }

    .alta-cabecera {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 18px 22px 12px;
      border-bottom: 1px solid #eef2f6;
    }

    .alta-cabecera h2 {
      margin: 0;
      color: #1c2a38;
      font: 700 19px/1.3 var(--font-display);
    }

    .alta-cabecera p {
      margin: 3px 0 0;
      color: #647487;
      font-size: 12.5px;
      line-height: 1.5;
    }

    .alta-cuerpo {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 16px 22px 4px;
    }

    .alta-bloque {
      margin: 0 0 18px;
      padding-bottom: 14px;
      border-bottom: 1px solid #eef2f6;
    }

    .alta-bloque:last-child {
      border-bottom: 0;
    }

    .alta-bloque h3 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 10px;
      color: #465a6c;
      font: 700 11px/1.3 var(--font-display);
      letter-spacing: 0.6px;
      text-transform: uppercase;
    }

    .alta-bloque h3 .num {
      display: inline-grid;
      place-items: center;
      min-width: 20px;
      height: 20px;
      border-radius: 5px;
      background: #eaf1fb;
      color: #2455a2;
      font-size: 12px;
    }

    .alta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px 16px;
    }

    .alta-grid label,
    .alta-campo {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
      color: #33475b;
      font-size: 12.5px;
      font-weight: 600;
    }

    .ancho {
      grid-column: 1 / -1;
    }

    .alta-grid input:not([type='radio']),
    .alta-grid select {
      height: 36px;
      padding: 0 10px;
      border: 1px solid #dbe3ea;
      border-radius: 8px;
      background: #f7f9fb;
      color: #1c2a38;
      font: 400 13.5px/1 var(--font-body, inherit);
      box-sizing: border-box;
    }

    .alta-grid input:focus-visible,
    .alta-grid select:focus-visible {
      outline: 2px solid #2455a2;
      outline-offset: 1px;
    }

    .alta-radios {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 18px;
      margin-top: 4px;
    }

    .alta-radios label {
      display: inline-flex;
      flex-direction: row;
      align-items: center;
      gap: 6px;
      font-weight: 500;
    }

    .alta-pista {
      color: #8a98a5;
      font-size: 11.5px;
      font-weight: 400;
      line-height: 1.45;
    }

    .alta-dup {
      margin-top: 12px;
      padding: 10px 12px;
      border: 1px solid #e6e0cf;
      border-radius: 8px;
      background: #fdfaf1;
    }

    .alta-dup h4 {
      margin: 0 0 4px;
      color: #7d6a35;
      font: 700 12px/1.3 var(--font-display);
    }

    .alta-dup p,
    .alta-dup li {
      margin: 0;
      color: #7d6a35;
      font-size: 12px;
      line-height: 1.5;
    }

    .alta-dup ul {
      margin: 6px 0 0;
      padding: 0;
      list-style: none;
    }

    .alta-error {
      margin: 4px 0 0;
      padding: 9px 11px;
      border: 1px solid #f0d9d5;
      border-radius: 7px;
      background: #fdf6f5;
      color: #a3402f;
      font-size: 13px;
      line-height: 1.5;
    }

    .alta-pie {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding: 14px 22px;
      border-top: 1px solid #eef2f6;
      background: #fbfcfd;
    }

    @media (max-width: 640px) {
      .alta-grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class ActorPanelAltaComponent {
  /** Naturaleza con la que se abre (`Nueva organización` la fuerza). */
  readonly naturalezaInicial = input<NaturalezaAlta>('persona');

  readonly cerrar = output<void>();

  /** Cierra con la animación de salida y luego avisa al contenedor. */
  cerrarConSalida(): void {
    salirModal(this.modal()?.nativeElement, () => this.cerrar.emit());
  }
  readonly creado = output<ActorDirectorio>();

  private readonly http = inject(HttpClient);
  private readonly destruccion = inject(DestroyRef);

  readonly naturaleza = signal<NaturalezaAlta>('persona');
  readonly identificacion = signal<'dni' | 'otro' | 'sin'>('sin');
  readonly nombre = signal('');
  readonly abreviatura = signal('');
  readonly cargo = signal('');
  readonly nivelGobierno = signal('');
  readonly region = signal('');
  readonly tipo = signal('');
  readonly funcion = signal('');
  readonly posicionamiento = signal('');
  readonly dni = signal('');
  readonly ruc = signal('');
  readonly telefono = signal('');
  readonly correo = signal('');
  readonly expedienteOspa = signal('');
  readonly estadoOspa = signal('');
  readonly vigenciaDesde = signal('');
  readonly vigenciaHasta = signal('');
  readonly organizacionUid = signal('');
  readonly membresiaCargo = signal('');
  readonly membresiaDesde = signal('');

  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);

  /** Coincidencias del nombre contra el directorio (aviso de duplicados). */
  readonly duplicados = signal<ActorDirectorio[]>([]);
  readonly buscandoDuplicados = signal(false);
  private temporizadorDuplicados?: ReturnType<typeof setTimeout>;

  readonly esOrganizacion = computed(() => this.naturaleza() === 'organizacion');

  readonly nivelesGobierno = NIVELES_GOBIERNO;
  readonly tiposActor = TIPOS_ACTOR;

  private readonly catalogos = consulta<CatalogosDirectorio>({
    fuente: () => urlApi('/v1/catalogs'),
    esquema: aCatalogosDirectorio,
  });

  readonly regiones = computed(() => this.catalogos.valor()?.regiones ?? []);
  readonly funciones = computed(() => this.catalogos.valor()?.funcionesActor ?? []);
  readonly perfiles = computed(() => this.catalogos.valor()?.perfilesActor ?? []);

  /** Organizaciones disponibles para la membresía OSPA de una persona. */
  private readonly organizaciones = consulta<ActorDirectorio[]>({
    fuente: () =>
      urlConParametros(urlApi('/v1/actors'), {
        naturaleza: 'organizacion',
        sort: 'name',
        tamano: '100',
        pagina: '1',
      }),
    esquema: (bruto) => normalizarColeccion<unknown>(bruto).elementos.map(aActorDirectorio),
  });

  readonly opcionesOrganizacion = computed(() => this.organizaciones.valor() ?? []);

  private readonly modal = viewChild<ElementRef<HTMLElement>>('modal');

  private readonly focoPrevio =
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);

  constructor() {
    effect(() => this.naturaleza.set(this.naturalezaInicial()));

    afterNextRender(() => this.modal()?.nativeElement.focus());

    this.destruccion.onDestroy(() => {
      clearTimeout(this.temporizadorDuplicados);
      this.focoPrevio?.focus?.();
    });
  }

  cambiarNaturaleza(valor: NaturalezaAlta): void {
    this.naturaleza.set(valor);
    this.identificacion.set('sin');
    this.dni.set('');
    this.ruc.set('');
  }

  alEscribirNombre(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.nombre.set(valor);
    this.buscarDuplicados(valor);
  }

  private buscarDuplicados(valor: string): void {
    clearTimeout(this.temporizadorDuplicados);
    const q = valor.trim();
    if (q.length < 3) {
      this.duplicados.set([]);
      this.buscandoDuplicados.set(false);
      return;
    }

    this.buscandoDuplicados.set(true);
    this.temporizadorDuplicados = setTimeout(() => {
      const url = urlConParametros(urlApi('/v1/actors'), {
        q,
        tamano: String(MOTIVO_DUPLICADOS),
        pagina: '1',
      });
      this.http
        .get<unknown>(url)
        .pipe(takeUntilDestroyed(this.destruccion))
        .subscribe({
          next: (bruto) => {
            this.duplicados.set(
              normalizarColeccion<unknown>(bruto).elementos.map(aActorDirectorio),
            );
            this.buscandoDuplicados.set(false);
          },
          error: () => {
            this.duplicados.set([]);
            this.buscandoDuplicados.set(false);
          },
        });
    }, 350);
  }

  /** Valida la forma del formulario y devuelve el primer error, o `null`. */
  private validar(): string | null {
    if (!this.nombre().trim()) return 'El nombre del actor es obligatorio.';

    if (this.identificacion() === 'dni') {
      const error = errorDeDni(this.dni());
      if (error) return error;
    }

    const ruc = this.ruc().trim();
    if (ruc) {
      const error = errorDeRuc(ruc);
      if (error) return error;
      if (!this.esOrganizacion()) {
        return 'El RUC sólo aplica a organizaciones.';
      }
    }

    const expediente = errorDeExpedienteOspa(this.expedienteOspa());
    if (expediente) return expediente;

    if (this.esOrganizacion() && this.vigenciaDesde() && this.vigenciaHasta()) {
      if (this.vigenciaHasta() < this.vigenciaDesde()) {
        return 'La vigencia OSPA no puede terminar antes de empezar.';
      }
    }

    const telefono = errorDeTelefono(this.telefono());
    if (telefono) return telefono;
    const correo = errorDeCorreo(this.correo());
    if (correo) return correo;

    return null;
  }

  guardar(evento: Event): void {
    evento.preventDefault();
    if (this.enviando()) return;

    const error = this.validar();
    if (error) {
      this.error.set(error);
      return;
    }

    const esOrganizacion = this.esOrganizacion();
    const payload: Record<string, unknown> = {
      naturaleza: esOrganizacion ? 'organizacion' : 'persona',
      nombre: this.nombre().trim(),
      abreviatura: this.abreviatura().trim() || null,
      cargo: this.cargo().trim() || null,
      nivelGobierno: this.nivelGobierno() || null,
      tipo: this.tipo() || undefined,
      funcion: this.funcion() || undefined,
      posicionamiento: this.posicionamiento() || undefined,
      region: this.region() || undefined,
      baseLegal: BASE_LEGAL,
    };

    const dni = this.dni().trim();
    if (!esOrganizacion && this.identificacion() === 'dni' && dni) {
      payload['dni'] = dni;
    }

    const ruc = this.ruc().trim();
    if (esOrganizacion && ruc) payload['ruc'] = ruc;

    if (esOrganizacion) {
      if (this.expedienteOspa().trim()) {
        payload['expedienteOspa'] = this.expedienteOspa().trim();
      }
      if (this.estadoOspa().trim()) payload['estadoOspa'] = this.estadoOspa().trim();
      if (this.vigenciaDesde()) payload['vigenciaDesde'] = this.vigenciaDesde();
      if (this.vigenciaHasta()) payload['vigenciaHasta'] = this.vigenciaHasta();
    } else if (this.organizacionUid()) {
      payload['organizacionUid'] = this.organizacionUid();
      if (this.membresiaCargo().trim()) {
        payload['membresiaCargo'] = this.membresiaCargo().trim();
      }
      if (this.membresiaDesde()) payload['membresiaDesde'] = this.membresiaDesde();
    }

    if (this.telefono().trim()) payload['telefono'] = this.telefono().trim();
    if (this.correo().trim()) payload['email'] = this.correo().trim();

    this.enviando.set(true);
    this.error.set(null);

    this.http
      .post<unknown>(urlApi('/v1/actors'), payload)
      .pipe(takeUntilDestroyed(this.destruccion))
      .subscribe({
        next: (respuesta) => {
          this.enviando.set(false);
          this.creado.emit(aActorDirectorio(respuesta));
        },
        error: (fallo: unknown) => {
          this.enviando.set(false);
          this.error.set(aErrorApi(fallo).message);
        },
      });
  }

  alTecla(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFoco(evento);
  }

  private atraparFoco(evento: KeyboardEvent): void {
    const modal = this.modal()?.nativeElement;
    if (!modal) return;

    const enfocables = Array.from(
      modal.querySelectorAll<HTMLElement>(
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
    if (evento.shiftKey && (activo === primero || !modal.contains(activo))) {
      evento.preventDefault();
      ultimo.focus();
    }
  }
}
