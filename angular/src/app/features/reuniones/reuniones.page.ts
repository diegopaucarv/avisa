import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { diaIso, hoyIso } from '../../core/fecha/zona-horaria';
import {
  TAMANO_PAGINA,
  normalizarColeccion,
  paramsDePagina,
  urlConParametros,
  type Coleccion,
} from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { formatearFecha } from '../../shared/formato-fecha';
import { IconoComponent } from '../../shared/ui/icono.component';
import {
  MensajePanelComponent,
  type DestinatarioMensaje,
} from '../../shared/ui/mensaje-panel.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';

/** Término mínimo para buscar a quién añadir a la reunión. */
const MIN_BUSQUEDA = 2;
/** Tope de candidatos que se listan al buscar participantes. */
const TAMANO_BUSQUEDA = 8;

type ReunionFila = {
  id: string;
  codigo: string | null;
  titulo: string | null;
  /** `YYYY-MM-DD` en horario de Lima (lo emite el endpoint de resultados). */
  fecha: string;
  lugar: string | null;
  casoCodigo: string | null;
  casoNombre: string | null;
  asistentes: number;
};

/**
 * `programada` llega en el detalle de participantes y en el PATCH, no en el
 * listado. Mientras se carga es `null` para no ofrecer «Iniciar» a ciegas.
 */
type ReunionDetalleVista = ReunionFila & { programada: boolean | null };

type ParticipanteReunionFila = {
  actorId: string;
  nombre: string;
  cargo: string | null;
  organizacion: string | null;
  asistencia: boolean;
  /** Metadato (`telefono_cifrado is not null`): nunca el número. */
  tieneTelefono: boolean;
};

type Candidato = {
  actorId: string;
  nombre: string;
  cargo: string | null;
};

type Aviso = { tipo: 'exito' | 'error'; texto: string };

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

function textoONull(valor: unknown): string | null {
  const limpio = texto(valor).trim();
  return limpio ? limpio : null;
}

function numero(valor: unknown): number {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : 0;
}

/** Una fila del listado; se descarta la que no traiga identificador. */
function aReunionFila(bruto: unknown): ReunionFila | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  const registro = bruto as Record<string, unknown>;
  const id = texto(registro['id']);
  if (!id) return null;
  return {
    id,
    codigo: textoONull(registro['codigo']),
    titulo: textoONull(registro['titulo']),
    fecha: texto(registro['fecha']),
    lugar: textoONull(registro['lugar']),
    casoCodigo: textoONull(registro['casoCodigo']),
    casoNombre: textoONull(registro['casoNombre']),
    asistentes: numero(registro['asistentes']),
  };
}

function aProgramada(valor: unknown): boolean | null {
  return typeof valor === 'boolean' ? valor : null;
}

function aReunionDetalle(bruto: unknown): ReunionDetalleVista | null {
  const base = aReunionFila(bruto);
  if (!base) return null;
  const registro = bruto as Record<string, unknown>;
  return { ...base, programada: aProgramada(registro['programada']) };
}

function mapearColeccion(bruto: unknown): Coleccion<ReunionFila> {
  const coleccion = normalizarColeccion<unknown>(bruto);
  return {
    ...coleccion,
    elementos: coleccion.elementos
      .map(aReunionFila)
      .filter((fila): fila is ReunionFila => fila !== null),
  };
}

function aParticipante(bruto: unknown): ParticipanteReunionFila | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  const registro = bruto as Record<string, unknown>;
  const actorId = texto(registro['actorId']);
  if (!actorId) return null;
  return {
    actorId,
    nombre: texto(registro['nombre']) || 'Sin nombre',
    cargo: textoONull(registro['cargo']),
    organizacion: textoONull(registro['organizacion']),
    asistencia: registro['asistencia'] === true,
    tieneTelefono: registro['tieneTelefono'] === true,
  };
}

function aParticipantesRespuesta(bruto: unknown): {
  items: ParticipanteReunionFila[];
  reunion: ReunionDetalleVista | null;
} {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    return { items: [], reunion: null };
  }
  const registro = bruto as Record<string, unknown>;
  const itemsBrutos = Array.isArray(registro['items']) ? registro['items'] : [];
  return {
    items: itemsBrutos
      .map(aParticipante)
      .filter((item): item is ParticipanteReunionFila => item !== null),
    reunion: aReunionDetalle(registro['reunion']),
  };
}

function aCandidato(bruto: unknown): Candidato | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  const registro = bruto as Record<string, unknown>;
  const actorId = texto(registro['id']);
  if (!actorId) return null;
  return {
    actorId,
    nombre: texto(registro['nombre']) || 'Sin nombre',
    cargo: textoONull(registro['cargo']),
  };
}

/** Lee el resumen de `POST /v1/resultados/asistentes`, sin confiar en su forma. */
function leerResumen(bruto: unknown): { vinculados: number; errores: number } | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  const resumen = (bruto as Record<string, unknown>)['resumen'];
  if (!resumen || typeof resumen !== 'object' || Array.isArray(resumen)) return null;
  const registro = resumen as Record<string, unknown>;
  return { vinculados: numero(registro['vinculados']), errores: numero(registro['errores']) };
}

/**
 * Reuniones de diálogo como mesa de trabajo (CRM).
 *
 * Antes esta pantalla era un compositor de mensajes que declaraba «sin
 * reuniones registradas»: un vacío falso, porque `core.reuniones_dialogo` ya
 * tiene filas. Ahora es lo que el endpoint existente ofrece: un listado paginado
 * por fecha descendente con acciones sobre cada reunión.
 *
 * La base NO tiene una columna de estado de reunión. Lo más cercano es el par
 * `fecha` + `programada`: «iniciar la reunión ahora» mueve `fecha` al instante
 * actual y marca `programada = false` (ver `PATCH /api/v1/reuniones/{id}`).
 *
 * Las reuniones con fecha anterior a hoy se atenúan con `var(--muted)` sin tocar
 * la selección del texto: siguen siendo legibles y copiables.
 */
@Component({
  selector: 'app-reuniones',
  imports: [RouterLink, IconoComponent, PaginacionComponent, MensajePanelComponent],
  templateUrl: './reuniones.page.html',
  styleUrl: './reuniones.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReunionesPage {
  private readonly http = inject(HttpClient);
  private readonly destruccion = inject(DestroyRef);

  readonly q = signal('');
  readonly pagina = signal(1);
  readonly tamano = signal(TAMANO_PAGINA);

  private readonly listado = consulta<Coleccion<ReunionFila>>({
    fuente: () => this.urlListado(),
    esquema: mapearColeccion,
  });

  readonly estado = this.listado.estado;
  readonly error = this.listado.error;
  readonly reuniones = computed(() => this.listado.valor()?.elementos ?? []);
  readonly total = computed(() => this.listado.valor()?.total ?? 0);

  /** Reunión abierta en el panel lateral. */
  readonly seleccionada = signal<ReunionFila | null>(null);
  readonly participantes = signal<ParticipanteReunionFila[]>([]);
  readonly reunionActual = signal<ReunionDetalleVista | null>(null);

  readonly cargandoParticipantes = signal(false);
  readonly errorParticipantes = signal<string | null>(null);

  readonly confirmandoInicio = signal(false);
  readonly iniciando = signal(false);
  readonly accionAviso = signal<Aviso | null>(null);
  readonly accionError = signal<string | null>(null);

  /** Buscador de candidatos para añadir a la reunión. */
  readonly busquedaActor = signal('');
  readonly resultadosActor = signal<Candidato[]>([]);
  readonly buscandoActor = signal(false);
  readonly errorBusquedaActor = signal<string | null>(null);
  readonly agregandoId = signal<string | null>(null);
  readonly mensajeParticipantes = signal<string | null>(null);

  /** Panel «Enviar mensaje» montado sobre el cajón de la reunión. */
  readonly mensajeAbierto = signal(false);
  readonly destinatariosMensaje = signal<DestinatarioMensaje[]>([]);

  private tokenBusqueda = 0;
  private temporizadorBusqueda?: ReturnType<typeof setTimeout>;

  constructor() {
    this.destruccion.onDestroy(() => clearTimeout(this.temporizadorBusqueda));
  }

  readonly contextoMensaje = computed(() => {
    const reunion = this.seleccionada();
    if (!reunion) return 'Reunión';
    const titulo = reunion.titulo ?? 'Reunión';
    return reunion.codigo ? `${reunion.codigo} · ${titulo}` : titulo;
  });

  /** `true` si la reunión es anterior a hoy en Lima (se pinta atenuada). */
  esPasada(fecha: string | null | undefined): boolean {
    const dia = diaIso(fecha);
    return !!dia && dia < hoyIso();
  }

  fechaTexto(valor: string | null | undefined): string {
    return formatearFecha(valor);
  }

  buscar(evento: Event): void {
    this.q.set((evento.target as HTMLInputElement).value);
    this.pagina.set(1);
  }

  cambiarPagina(pagina: number): void {
    this.pagina.set(pagina);
  }

  cambiarTamano(tamano: number): void {
    this.tamano.set(tamano);
    this.pagina.set(1);
  }

  recargar(): void {
    this.listado.recargar();
  }

  abrir(reunion: ReunionFila): void {
    this.seleccionada.set(reunion);
    // Mientras llega el detalle, `programada` es desconocida: no se ofrece iniciar.
    this.reunionActual.set({ ...reunion, programada: null });
    this.participantes.set([]);
    this.confirmandoInicio.set(false);
    this.iniciando.set(false);
    this.accionAviso.set(null);
    this.accionError.set(null);
    this.mensajeParticipantes.set(null);
    this.busquedaActor.set('');
    this.resultadosActor.set([]);
    this.errorBusquedaActor.set(null);
    void this.cargarParticipantes(reunion.id);
  }

  cerrarPanel(): void {
    this.seleccionada.set(null);
    this.mensajeAbierto.set(false);
    this.confirmandoInicio.set(false);
  }

  /** Clic en el velo: sólo cierra si nació fuera del cajón. */
  alFondo(evento: Event): void {
    if (evento.target !== evento.currentTarget) return;
    this.cerrarPanel();
  }

  /** Escape cierra el cajón salvo que el panel de mensaje esté encima. */
  alEscape(): void {
    if (this.mensajeAbierto()) return;
    this.cerrarPanel();
  }

  pedirInicio(): void {
    this.confirmandoInicio.set(true);
    this.accionAviso.set(null);
    this.accionError.set(null);
  }

  cancelarInicio(): void {
    this.confirmandoInicio.set(false);
  }

  /** «Iniciar la reunión ahora»: `fecha = now()`, `programada = false`. */
  async iniciar(): Promise<void> {
    const reunion = this.seleccionada();
    if (!reunion || this.iniciando()) return;

    this.iniciando.set(true);
    this.accionError.set(null);
    this.accionAviso.set(null);

    try {
      const bruto = await firstValueFrom(
        this.http.patch<unknown>(urlApi(`/v1/reuniones/${encodeURIComponent(reunion.id)}`), {}),
      );
      const actualizada = aReunionDetalle(bruto);
      if (actualizada) this.reunionActual.set(actualizada);
      this.confirmandoInicio.set(false);
      this.accionAviso.set({ tipo: 'exito', texto: 'La reunión se marcó como iniciada.' });
      this.listado.recargar();
      await this.cargarParticipantes(reunion.id);
    } catch (fallo) {
      this.accionError.set(aErrorApi(fallo, 'No se pudo iniciar la reunión.').message);
    } finally {
      this.iniciando.set(false);
    }
  }

  avisarATodos(): void {
    const participantes = this.participantes();
    if (participantes.length === 0) return;
    this.destinatariosMensaje.set(
      participantes.map((p) => ({ actorId: p.actorId, nombre: p.nombre })),
    );
    this.mensajeAbierto.set(true);
  }

  cerrarMensaje(): void {
    this.mensajeAbierto.set(false);
  }

  alCambiarDestinatarios(lista: DestinatarioMensaje[]): void {
    this.destinatariosMensaje.set(lista);
  }

  alBuscarActor(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.busquedaActor.set(valor);
    clearTimeout(this.temporizadorBusqueda);
    this.temporizadorBusqueda = setTimeout(() => void this.buscarActor(valor), 250);
  }

  async agregarParticipante(candidato: Candidato): Promise<void> {
    const reunion = this.seleccionada();
    if (!reunion || this.agregandoId()) return;

    this.agregandoId.set(candidato.actorId);
    this.accionError.set(null);
    this.mensajeParticipantes.set(null);

    try {
      const bruto = await firstValueFrom(
        this.http.post<unknown>(urlApi('/v1/resultados/asistentes'), {
          reunionId: reunion.id,
          asistentes: [
            { actorId: candidato.actorId, nombre: candidato.nombre, cargo: candidato.cargo },
          ],
        }),
      );
      const resumen = leerResumen(bruto);
      if (resumen && resumen.vinculados > 0) {
        this.mensajeParticipantes.set(`${candidato.nombre} se añadió a la reunión.`);
      } else if (resumen && resumen.errores > 0) {
        this.accionError.set('No se pudo añadir al participante a la reunión.');
      } else {
        this.mensajeParticipantes.set(`${candidato.nombre} ya figuraba en la lista.`);
      }
      this.busquedaActor.set('');
      this.resultadosActor.set([]);
      this.listado.recargar();
      await this.cargarParticipantes(reunion.id);
    } catch (fallo) {
      this.accionError.set(aErrorApi(fallo, 'No se pudo añadir al participante.').message);
    } finally {
      this.agregandoId.set(null);
    }
  }

  private urlListado(): string {
    return urlConParametros(urlApi('/v1/resultados/reuniones'), {
      q: this.q().trim(),
      ...paramsDePagina({ pagina: this.pagina(), tamano: this.tamano() }),
    });
  }

  private async cargarParticipantes(reunionId: string): Promise<void> {
    this.cargandoParticipantes.set(true);
    this.errorParticipantes.set(null);
    try {
      const bruto = await firstValueFrom(
        this.http.get<unknown>(
          urlApi(`/v1/reuniones/${encodeURIComponent(reunionId)}/participantes`),
        ),
      );
      const { items, reunion } = aParticipantesRespuesta(bruto);
      // Si la reunión ya no está abierta cuando responde, se descarta la lectura.
      if (this.seleccionada()?.id !== reunionId) return;
      this.participantes.set(items);
      if (reunion) this.reunionActual.set(reunion);
    } catch (fallo) {
      if (this.seleccionada()?.id !== reunionId) return;
      this.errorParticipantes.set(
        aErrorApi(fallo, 'No se pudieron cargar los participantes.').message,
      );
    } finally {
      if (this.seleccionada()?.id === reunionId) this.cargandoParticipantes.set(false);
    }
  }

  private async buscarActor(textoBruto: string): Promise<void> {
    const termino = textoBruto.trim();
    this.tokenBusqueda += 1;
    const token = this.tokenBusqueda;
    this.errorBusquedaActor.set(null);

    if (termino.length < MIN_BUSQUEDA) {
      this.resultadosActor.set([]);
      this.buscandoActor.set(false);
      return;
    }

    this.buscandoActor.set(true);
    try {
      const bruto = await firstValueFrom(
        this.http.get<unknown>(
          urlConParametros(urlApi('/v1/actors'), {
            q: termino,
            ...paramsDePagina({ pagina: 1, tamano: TAMANO_BUSQUEDA }),
          }),
        ),
      );
      if (token !== this.tokenBusqueda) return;
      const coleccion = normalizarColeccion<unknown>(bruto);
      this.resultadosActor.set(
        coleccion.elementos
          .map(aCandidato)
          .filter((candidato): candidato is Candidato => candidato !== null),
      );
    } catch (fallo) {
      if (token !== this.tokenBusqueda) return;
      this.errorBusquedaActor.set(aErrorApi(fallo, 'No se pudo buscar participantes.').message);
    } finally {
      if (token === this.tokenBusqueda) this.buscandoActor.set(false);
    }
  }
}
