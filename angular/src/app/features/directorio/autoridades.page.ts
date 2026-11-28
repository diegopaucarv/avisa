import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import {
  TAMANO_PAGINA,
  normalizarColeccion,
  paramsDePagina,
  urlConParametros,
} from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import {
  AnularPanelComponent,
  type ResultadoAnulacion,
} from '../../shared/ui/anular-panel.component';
import { BarraSeleccionComponent } from '../../shared/ui/barra-seleccion.component';
import { BotonAccionComponent } from '../../shared/ui/boton-accion.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { esDialogoSuperior } from '../../shared/ui/modal-salida';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import { SeleccionTabla } from '../../shared/ui/seleccion-tabla';
import type { DestinatarioMensaje } from '../../shared/ui/mensaje-panel.component';
import { ActorPanelComponent } from './actor-panel.component';
import { EnviarMensajeComponent } from './enviar-mensaje.component';
import {
  aActorDirectorio,
  aCatalogosDirectorio,
  type ActorDirectorio,
  type CatalogosDirectorio,
} from './directorio.mapeo';

/**
 * Directorio · «Autoridades y agentes».
 *
 * Separa a las autoridades y a los agentes del sector del listado general de
 * actores. Consume `GET /api/v1/autoridades`, que aplica el único criterio
 * verificable de la base: las personas registradas como «Actor público». El
 * reparto autoridad/agente sale del cargo y la institución del dominio del
 * correo de contacto.
 *
 * La ficha permite editar la persona reutilizando `actor-panel`, con la misma
 * comprobación de permisos que el resto del directorio.
 *
 * El listado no trae datos personales: el DNI y el teléfono se piden sólo al
 * pulsar «Ver datos personales», con un motivo auditado. Sin permiso, la ficha
 * muestra «—» y «sin acceso» sin romper la pantalla.
 */

type TipoAutoridad = 'autoridad' | 'agente';

type AutoridadFila = {
  id: string;
  nombre: string;
  cargo: string | null;
  email: string | null;
  tipo: TipoAutoridad;
  institucion: string | null;
  institucionNombre: string | null;
  region: string | null;
  distrito: string | null;
  nivelGobierno: string | null;
  perfil: string | null;
  abreviatura: string | null;
  clasificacion: number;
  validado: boolean;
  activo: boolean;
};

type AutoridadFaceta = { valor: string; etiqueta: string; conteo: number };

type AutoridadFacets = {
  tipos: AutoridadFaceta[];
  instituciones: AutoridadFaceta[];
  regiones: AutoridadFaceta[];
};

type AutoridadCriterio = {
  universo: string;
  tipo: string;
  institucion: string;
  territorio: string;
  casos: string;
};

type PaginaAutoridades = {
  filas: AutoridadFila[];
  total: number;
  facets: AutoridadFacets;
  criterio: AutoridadCriterio;
};

type AutoridadCaso = {
  codigo: string;
  nombre: string;
  estado: string | null;
  nivelInfluencia: number | null;
  posicion: string | null;
};

type DatosPersonales = { dni: string | null; email: string | null; telefono: string | null };

type EstadoPii = 'inactivo' | 'cargando' | 'listo' | 'sin_ficha' | 'prohibido' | 'error';

/** Baja lógica o restauración pendiente de confirmar en el panel. */
type BajaAutoridad = {
  id: string;
  nombre: string;
  abreviatura: string | null;
  modo: 'anular' | 'restaurar';
};

type FiltrosAutoridades = {
  q: string;
  tipo: string;
  institucion: string;
  region: string;
  pagina: number;
  tamano: number;
};

const FILTROS_INICIALES: FiltrosAutoridades = {
  q: '',
  tipo: '',
  institucion: '',
  region: '',
  pagina: 1,
  tamano: TAMANO_PAGINA,
};

const SIN_DATO = '—';

/**
 * Motivo que la base audita antes de descifrar (Ley 29733). Espejo del que usa
 * la ficha general del actor: concreto y con finalidad explícita.
 */
const MOTIVO_PII = 'Consulta de datos personales de una autoridad del directorio';

/**
 * Espejo de `CRITERIO_AUTORIDADES` de `lib/db/repos/autoridades.ts`, para que
 * el criterio mapeado no quede vacío si la API no lo envía. Si cambia el
 * criterio, cambia en ambos.
 */
const CRITERIO_LOCAL: AutoridadCriterio = {
  universo:
    'Personas registradas como «Actor público»: funcionarios y servidores del sector PRODUCE y de sus organismos adscritos.',
  tipo: 'Se considera «autoridad» a quien tiene cargo de dirección, jefatura, presidencia, secretaría técnica o general, procuraduría, titularidad del despacho, coordinación ejecutiva, ejecución coactiva o viceministerio; el resto se muestra como «agente».',
  institucion:
    'La institución se deriva del dominio del correo de contacto (por ejemplo, produce.gob.pe → PRODUCE). No es un campo del modelo.',
  territorio:
    'La base no registra región, distrito ni nivel de gobierno para este universo; la columna se muestra como «sin dato».',
  casos:
    'Los casos vinculados se leen de core.casos_actores; cuando no hay vínculos se indica «sin casos vinculados».',
};

type Registro = Record<string, unknown>;

function esRegistro(valor: unknown): valor is Registro {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

function numero(valor: unknown, respaldo: number): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : respaldo;
}

function lista(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

function aFila(bruto: unknown): AutoridadFila | null {
  if (!esRegistro(bruto)) return null;
  const id = texto(bruto['id']);
  const nombre = texto(bruto['nombre']);
  if (!id || !nombre) return null;

  return {
    id,
    nombre,
    cargo: texto(bruto['cargo']),
    email: texto(bruto['email']),
    tipo: bruto['tipo'] === 'autoridad' ? 'autoridad' : 'agente',
    institucion: texto(bruto['institucion']),
    institucionNombre: texto(bruto['institucionNombre']),
    region: texto(bruto['region']),
    distrito: texto(bruto['distrito']),
    nivelGobierno: texto(bruto['nivelGobierno']),
    perfil: texto(bruto['perfil']),
    abreviatura: texto(bruto['abreviatura']),
    clasificacion: numero(bruto['clasificacion'], 1),
    validado: bruto['validado'] === true,
    activo: bruto['activo'] !== false,
  };
}

function aFaceta(bruto: unknown): AutoridadFaceta | null {
  if (!esRegistro(bruto)) return null;
  const valor = texto(bruto['valor']);
  if (!valor) return null;
  return {
    valor,
    etiqueta: texto(bruto['etiqueta']) ?? valor,
    conteo: numero(bruto['conteo'], 0),
  };
}

function aFacetas(bruto: unknown): AutoridadFacets {
  const registro = esRegistro(bruto) ? bruto : {};
  const facetas = (valor: unknown): AutoridadFaceta[] =>
    lista(valor)
      .map(aFaceta)
      .filter((faceta): faceta is AutoridadFaceta => faceta !== null);

  return {
    tipos: facetas(registro['tipos']),
    instituciones: facetas(registro['instituciones']),
    regiones: facetas(registro['regiones']),
  };
}

function aCriterio(bruto: unknown): AutoridadCriterio {
  if (!esRegistro(bruto)) return CRITERIO_LOCAL;
  return {
    universo: texto(bruto['universo']) ?? CRITERIO_LOCAL.universo,
    tipo: texto(bruto['tipo']) ?? CRITERIO_LOCAL.tipo,
    institucion: texto(bruto['institucion']) ?? CRITERIO_LOCAL.institucion,
    territorio: texto(bruto['territorio']) ?? CRITERIO_LOCAL.territorio,
    casos: texto(bruto['casos']) ?? CRITERIO_LOCAL.casos,
  };
}

function aPagina(bruto: unknown): PaginaAutoridades {
  const coleccion = normalizarColeccion<unknown>(bruto);
  const registro = esRegistro(bruto) ? bruto : {};

  return {
    filas: coleccion.elementos.map(aFila).filter((fila): fila is AutoridadFila => fila !== null),
    total: coleccion.total,
    facets: aFacetas(registro['facets']),
    criterio: aCriterio(registro['criterio']),
  };
}

function aCaso(bruto: unknown): AutoridadCaso | null {
  if (!esRegistro(bruto)) return null;
  const codigo = texto(bruto['codigo']);
  const nombre = texto(bruto['nombre']);
  if (!codigo || !nombre) return null;
  const influencia = bruto['nivelInfluencia'];
  return {
    codigo,
    nombre,
    estado: texto(bruto['estado']),
    nivelInfluencia: typeof influencia === 'number' ? influencia : null,
    posicion: texto(bruto['posicion']),
  };
}

function aDatosPersonales(bruto: unknown): { tieneFicha: boolean; datos: DatosPersonales } {
  const registro = esRegistro(bruto) ? bruto : {};
  const pii = esRegistro(registro['pii']) ? registro['pii'] : {};
  return {
    tieneFicha: registro['tieneFicha'] === true,
    datos: {
      dni: texto(pii['dni']),
      email: texto(pii['email']),
      telefono: texto(pii['telefono']),
    },
  };
}

@Component({
  selector: 'app-autoridades-page',
  imports: [
    IconoComponent,
    BotonAccionComponent,
    PaginacionComponent,
    BarraSeleccionComponent,
    ActorPanelComponent,
    AnularPanelComponent,
    EnviarMensajeComponent,
  ],
  templateUrl: './autoridades.page.html',
  styleUrl: './autoridades.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AutoridadesPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly destruccion = inject(DestroyRef);

  /** Ficha lateral: la guarda de Escape distingue si está debajo de otro modal. */
  private readonly fichaPanel = viewChild<ElementRef<HTMLElement>>('fichaPanel');

  /** Permisos de la sesión: sólo se muestra PII a quien puede descifrarla. */
  readonly capacidades = inject(CapacidadesService);

  /** Texto único para un dato ausente; nunca se presenta como error. */
  readonly sinDato = SIN_DATO;

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => {
        const tipo = (params.get('tipo') ?? '').toLowerCase();
        return {
          q: params.get('q') ?? '',
          tipo: tipo === 'autoridad' || tipo === 'agente' ? tipo : '',
          institucion: params.get('institucion') ?? '',
          region: params.get('region') ?? '',
          pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
          tamano: Math.min(
            100,
            Math.max(1, Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA),
          ),
        };
      }),
    ),
    { initialValue: FILTROS_INICIALES },
  );

  readonly filtros = computed<FiltrosAutoridades>(() => this.parametros());

  private readonly listado = consulta<PaginaAutoridades>({
    fuente: () => {
      const filtros = this.filtros();
      return urlConParametros(urlApi('/v1/autoridades'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        q: filtros.q,
        tipo: filtros.tipo,
        institucion: filtros.institucion,
        region: filtros.region,
      });
    },
    esquema: aPagina,
  });

  readonly filas = computed(() => this.listado.valor()?.filas ?? []);
  readonly total = computed(() => this.listado.valor()?.total ?? 0);
  readonly estado = this.listado.estado;
  readonly error = this.listado.error;

  readonly tipos = computed(() => this.listado.valor()?.facets.tipos ?? []);
  readonly instituciones = computed(() => this.listado.valor()?.facets.instituciones ?? []);
  readonly regiones = computed(() => this.listado.valor()?.facets.regiones ?? []);

  /** Total del universo, para la pestaña «Todos». */
  readonly totalUniverso = computed(() => {
    const suma = this.tipos().reduce((acumulado, faceta) => acumulado + faceta.conteo, 0);
    return suma > 0 ? suma : this.total();
  });

  /** Ficha abierta en el panel lateral. */
  readonly seleccionada = signal<AutoridadFila | null>(null);

  /** Selección de la tabla (página visible) para exportar. */
  readonly seleccion = new SeleccionTabla();

  /**
   * Nombres de las filas ya vistas, por id. La selección sobrevive al cambio
   * de página, pero `filas()` sólo trae la página actual; este mapa permite
   * sembrar el FAB de mensajes con todas las personas marcadas.
   */
  private readonly nombresSeleccion = signal<
    Record<string, { nombre: string; correo: string | null }>
  >({});

  private readonly recordarNombres = effect(() => {
    const mapa = { ...this.nombresSeleccion() };
    let cambio = false;
    for (const fila of this.filas()) {
      const correo = fila.email ?? null;
      const previo = mapa[fila.id];
      if (!previo || previo.nombre !== fila.nombre || previo.correo !== correo) {
        mapa[fila.id] = { nombre: fila.nombre, correo };
        cambio = true;
      }
    }
    if (cambio) this.nombresSeleccion.set(mapa);
  });

  /** Destinatarios iniciales del FAB «Enviar mensaje»: las filas seleccionadas. */
  readonly semillaMensaje = computed<DestinatarioMensaje[]>(() => {
    const mapa = this.nombresSeleccion();
    return [...this.seleccion.ids()].map((id) => ({
      actorId: id,
      nombre: mapa[id]?.nombre ?? id,
      correo: mapa[id]?.correo ?? null,
    }));
  });

  /** Actor completo de la fila que se edita; `null` cuando no hay panel abierto. */
  readonly actorEdicion = signal<ActorDirectorio | null>(null);
  readonly cargandoEdicion = signal(false);
  readonly errorAccion = signal<string | null>(null);
  readonly exportarError = signal<string | null>(null);

  /** Baja lógica o restauración pendiente de confirmar. */
  readonly bajaAbierta = signal<BajaAutoridad | null>(null);
  readonly enviandoBaja = signal(false);
  readonly errorBaja = signal<string | null>(null);

  /**
   * Regiones del catálogo territorial para el select de la edición. Es un
   * catálogo aparte de `regiones()`, que son las facetas del listado.
   */
  private readonly catalogos = consulta<CatalogosDirectorio>({
    fuente: () => urlApi('/v1/catalogs'),
    esquema: aCatalogosDirectorio,
  });
  readonly regionesCatalogo = computed(() => this.catalogos.valor()?.regiones ?? []);

  /** Casos vinculados de la ficha abierta; se piden aparte del listado. */
  private readonly detalle = consulta<AutoridadCaso[]>({
    fuente: () => {
      const id = this.seleccionada()?.id;
      if (!id) return null;
      return urlApi(`/v1/autoridades/${encodeURIComponent(id)}`);
    },
    esquema: (bruto) => {
      const registro = esRegistro(bruto) ? bruto : {};
      return lista(registro['casos'])
        .map(aCaso)
        .filter((caso): caso is AutoridadCaso => caso !== null);
    },
  });

  readonly casos = computed(() => this.detalle.valor() ?? []);
  readonly cargandoCasos = computed(() => this.detalle.estado() === 'cargando');
  readonly errorCasos = computed(() => this.detalle.error()?.message ?? null);

  /** Estado del bloque de datos personales (sólo bajo demanda). */
  readonly estadoPii = signal<EstadoPii>('inactivo');
  readonly datosPii = signal<DatosPersonales | null>(null);
  readonly errorPii = signal<string | null>(null);

  readonly puedeVerPii = this.capacidades.puedeVerPii;
  readonly piiVisible = computed(() => this.estadoPii() === 'listo');
  readonly piiCargando = computed(() => this.estadoPii() === 'cargando');
  readonly sinAccesoPii = computed(() => !this.puedeVerPii() || this.estadoPii() === 'prohibido');

  /** Valor copiado recientemente, para confirmar la acción. */
  readonly copiado = signal<string | null>(null);
  private temporizadorCopiado?: ReturnType<typeof setTimeout>;
  private temporizadorBusqueda?: ReturnType<typeof setTimeout>;

  constructor() {
    this.destruccion.onDestroy(() => {
      clearTimeout(this.temporizadorBusqueda);
      clearTimeout(this.temporizadorCopiado);
    });
  }

  etiquetaTipo(tipo: TipoAutoridad): string {
    return tipo === 'autoridad' ? 'Autoridad' : 'Agente';
  }

  claseTipo(tipo: TipoAutoridad): string {
    return tipo === 'autoridad' ? 'badge-autoridad' : 'badge-agente';
  }

  inicialesDe(nombre: string): string {
    return nombre
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((parte) => parte[0]?.toUpperCase() ?? '')
      .join('');
  }

  abrir(fila: AutoridadFila): void {
    this.reiniciarPii();
    this.seleccionada.set(fila);
  }

  cerrarFicha(): void {
    this.reiniciarPii();
    this.seleccionada.set(null);
  }

  /** Escape sólo cierra la ficha si no hay un panel abierto encima. */
  cerrarFichaConEscape(): void {
    if (!this.seleccionada()) return;
    if (!esDialogoSuperior(this.fichaPanel()?.nativeElement)) return;
    this.cerrarFicha();
  }

  /** El clic fuera cierra; arrastrar dentro del contenido no. */
  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrarFicha();
  }

  /** Ids de la página visible, para «seleccionar todos». */
  idsVisibles(): string[] {
    return this.filas().map((fila) => fila.id);
  }

  /**
   * Abre la ficha de edición. La fila de autoridades sólo trae la proyección
   * del listado, así que se pide el actor completo a `GET /v1/actors/{uid}` y
   * se entrega al panel, que ya conoce el modo edición.
   */
  editar(fila: AutoridadFila, evento?: Event): void {
    evento?.stopPropagation();
    if (!this.capacidades.puedeModificar(fila.clasificacion)) return;

    this.errorAccion.set(null);
    this.cargandoEdicion.set(true);
    this.actorEdicion.set(null);

    this.http
      .get<unknown>(urlApi(`/v1/actors/${encodeURIComponent(fila.id)}`))
      .pipe(takeUntilDestroyed(this.destruccion))
      .subscribe({
        next: (bruto) => {
          this.cargandoEdicion.set(false);
          // `GET /v1/actors/{uid}` devuelve el detalle envuelto (`{ actor, … }`);
          // pasarlo tal cual a `aActorDirectorio` dejaría un actor vacío.
          const registro = esRegistro(bruto) ? bruto : {};
          const actor = esRegistro(registro['actor']) ? registro['actor'] : registro;
          this.actorEdicion.set(aActorDirectorio(actor));
        },
        error: (fallo: unknown) => {
          this.cargandoEdicion.set(false);
          this.errorAccion.set(aErrorApi(fallo).message);
        },
      });
  }

  cerrarEdicion(): void {
    this.actorEdicion.set(null);
    this.cargandoEdicion.set(false);
  }

  /** Refleja lo guardado en la ficha abierta y refresca el listado. */
  alActualizarActor(actor: ActorDirectorio): void {
    this.actorEdicion.set(actor);
    this.seleccionada.update((actual) =>
      actual && actual.id === actor.id
        ? {
            ...actual,
            nombre: actor.nombre,
            abreviatura: actor.abreviatura,
            cargo: actor.cargo,
            email: actor.email ?? null,
            region: actor.region,
            distrito: actor.distrito,
            nivelGobierno: actor.nivelGobierno,
            perfil: actor.perfil,
            activo: actor.activo,
          }
        : actual,
    );
    this.listado.recargar();
  }

  /** Abre el panel de baja o restauración desde una fila de la tabla. */
  abrirBaja(fila: AutoridadFila, evento?: Event): void {
    evento?.stopPropagation();
    if (!this.capacidades.puedeModificar(fila.clasificacion)) return;
    this.errorBaja.set(null);
    this.bajaAbierta.set({
      id: fila.id,
      nombre: fila.nombre,
      abreviatura: fila.abreviatura,
      modo: fila.activo ? 'anular' : 'restaurar',
    });
  }

  /** Abre la baja o restauración pedida desde el pie del panel de edición. */
  abrirBajaDesdePanel(modo: 'anular' | 'restaurar'): void {
    const actor = this.actorEdicion();
    if (!actor) return;
    this.errorBaja.set(null);
    this.bajaAbierta.set({
      id: actor.id,
      nombre: actor.nombre,
      abreviatura: actor.abreviatura,
      modo,
    });
  }

  cerrarBaja(): void {
    this.bajaAbierta.set(null);
    this.errorBaja.set(null);
  }

  /** Ejecuta `POST …/baja` o `POST …/restaurar` según lo confirmado. */
  alConfirmarBaja(resultado: ResultadoAnulacion): void {
    const abierta = this.bajaAbierta();
    if (!abierta || this.enviandoBaja()) return;

    const esAnular = resultado.modo === 'anular';
    const url = urlApi(
      `/v1/actors/${encodeURIComponent(abierta.id)}/${esAnular ? 'baja' : 'restaurar'}`,
    );

    this.enviandoBaja.set(true);
    this.errorBaja.set(null);

    const peticion = esAnular
      ? this.http.post<unknown>(url, { motivo: resultado.motivo })
      : this.http.post<unknown>(url, {});

    peticion.pipe(takeUntilDestroyed(this.destruccion)).subscribe({
      next: (bruto) => {
        this.enviandoBaja.set(false);
        this.bajaAbierta.set(null);

        // La fila deja de estar seleccionada: su estado acaba de cambiar.
        if (this.seleccion.esta(abierta.id)) this.seleccion.alternar(abierta.id);

        const actor = aActorDirectorio(bruto);
        if (this.actorEdicion()) this.actorEdicion.set(actor);
        this.seleccionada.update((actual) =>
          actual && actual.id === abierta.id ? { ...actual, activo: actor.activo } : actual,
        );
        this.listado.recargar();
      },
      error: (fallo: unknown) => {
        this.enviandoBaja.set(false);
        this.errorBaja.set(aErrorApi(fallo).message);
      },
    });
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  /**
   * Pide DNI, correo y teléfono con motivo auditado. Sólo se llama desde el
   * botón explícito de la ficha; abrirla no registra ningún acceso a PII.
   */
  solicitarPii(): void {
    const ficha = this.seleccionada();
    if (!ficha) return;

    if (!this.puedeVerPii()) {
      this.estadoPii.set('prohibido');
      this.errorPii.set('Su rol no permite ver datos personales.');
      return;
    }

    if (this.estadoPii() === 'cargando') return;

    this.estadoPii.set('cargando');
    this.errorPii.set(null);
    this.datosPii.set(null);

    const url = urlConParametros(urlApi(`/v1/autoridades/${encodeURIComponent(ficha.id)}/pii`), {
      motivo: MOTIVO_PII,
    });

    this.http
      .get<unknown>(url)
      .pipe(takeUntilDestroyed(this.destruccion))
      .subscribe({
        next: (bruto) => {
          const { tieneFicha, datos } = aDatosPersonales(bruto);
          this.datosPii.set(datos);
          // «sin ficha» no es error: el actor existe y el rol alcanza, pero no
          // registró datos personales.
          this.estadoPii.set(tieneFicha ? 'listo' : 'sin_ficha');
        },
        error: (fallo: unknown) => {
          const error = aErrorApi(fallo);
          this.datosPii.set(null);

          if (error.esProhibido) {
            this.errorPii.set('Su rol no permite ver datos personales.');
            this.estadoPii.set('prohibido');
            return;
          }

          this.errorPii.set(error.message);
          this.estadoPii.set('error');
        },
      });
  }

  ocultarPii(): void {
    this.reiniciarPii();
  }

  copiar(valor: string | null | undefined, evento?: Event): void {
    evento?.stopPropagation();
    if (!valor) return;

    void navigator.clipboard?.writeText(valor);
    this.copiado.set(valor);
    clearTimeout(this.temporizadorCopiado);
    this.temporizadorCopiado = setTimeout(() => this.copiado.set(null), 1600);
  }

  buscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizadorBusqueda);
    this.temporizadorBusqueda = setTimeout(() => {
      void this.actualizar({ q: valor, pagina: 1 });
    }, 300);
  }

  cambiarTipo(evento: Event): void {
    void this.actualizar({ tipo: (evento.target as HTMLSelectElement).value, pagina: 1 });
  }

  cambiarInstitucion(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ institucion: valor, pagina: 1 });
  }

  cambiarRegion(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ region: valor, pagina: 1 });
  }

  cambiarPagina(pagina: number): void {
    void this.actualizar({ pagina });
  }

  cambiarTamano(tamano: number): void {
    void this.actualizar({ tamano, pagina: 1 });
  }

  recargar(): void {
    this.listado.recargar();
  }

  limpiar(): void {
    clearTimeout(this.temporizadorBusqueda);
    this.cerrarFicha();
    this.cerrarEdicion();
    this.cerrarBaja();
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {},
    });
  }

  private reiniciarPii(): void {
    this.datosPii.set(null);
    this.errorPii.set(null);
    this.estadoPii.set('inactivo');
  }

  private actualizar(cambios: Partial<FiltrosAutoridades>): void {
    const siguiente = { ...this.parametros(), ...cambios };

    // Cualquier cambio de consulta descarta la ficha abierta: así no queda PII
    // en pantalla mientras el listado de fondo ya es otro.
    this.cerrarFicha();
    this.cerrarEdicion();
    this.cerrarBaja();

    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        q: siguiente.q || null,
        tipo: siguiente.tipo || null,
        institucion: siguiente.institucion || null,
        region: siguiente.region || null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
