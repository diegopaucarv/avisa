import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { hoyIso } from '../../core/fecha/zona-horaria';
import { aErrorApi } from '../../core/http/errores';
import { AvisosService } from '../../shared/ui/avisos.service';
import { crearCsvPadronFilas, type FilaPadron } from '../directorio/padron-asistencia';
import { esExcelAntiguo, esExcelBinario, leerTabla, type TablaLeida } from './importacion.csv';
import { leerLibroExcel } from './importacion.xlsx';
import {
  LIMITE_FILAS,
  validarImportacion,
  type FilaValida,
  type Validacion,
} from './importacion.validar';
import { tipoImportacion, type TipoImportacion, type TipoImportacionId } from './importacion.tipos';

export type EstadoImportacion = 'inactivo' | 'listo' | 'aplicando' | 'hecho';

export type ErrorFila = {
  readonly fila: number;
  readonly etiqueta: string;
  readonly codigo: string;
  readonly mensaje: string;
};

export type ResultadoImportacion = {
  readonly creados: number;
  readonly fallidos: number;
  readonly errores: readonly ErrorFila[];
  /** Filas creadas con un pendiente menor (por ejemplo, la foto no se registró). */
  readonly advertencias: readonly ErrorFila[];
  /** Para la lista de asistencia: el documento ya se descargó. */
  readonly documento?: string;
};

const MENSAJE_EXCEL_ANTIGUO =
  'El formato .xls antiguo no se puede leer. En Excel use «Archivo → Guardar como → ' +
  'Libro de Excel (.xlsx)» o «CSV UTF-8» y vuelva a elegir el archivo.';

/**
 * Estado y ejecución de una importación.
 *
 * El panel sólo pinta lo que hay aquí; el «ruteo» por tipo de archivo vive en
 * `importacion.tipos.ts` y la lectura en `importacion.csv.ts` (texto) o
 * `importacion.xlsx.ts` (libro de Excel). Este servicio es el único punto que
 * habla con la API, en serie y fila a fila: un archivo de 400 altas no debe
 * abrir 400 conexiones a la vez.
 */
@Injectable({ providedIn: 'root' })
export class ImportacionService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly avisos = inject(AvisosService);

  readonly abierto = signal(false);
  readonly tipo = signal<TipoImportacion>(tipoImportacion(null));
  readonly texto = signal('');
  readonly nombreArchivo = signal<string | null>(null);
  /** Hoja de un .xlsx ya normalizada; si existe, la previsualización la usa. */
  readonly tablaArchivo = signal<TablaLeida | null>(null);
  readonly validacion = signal<Validacion | null>(null);
  readonly estado = signal<EstadoImportacion>('inactivo');
  readonly errorArchivo = signal<string | null>(null);
  readonly progreso = signal<{ hechos: number; total: number }>({ hechos: 0, total: 0 });
  readonly resultado = signal<ResultadoImportacion | null>(null);

  readonly aplicando = computed(() => this.estado() === 'aplicando');
  readonly puedeAplicar = computed(
    () => (this.validacion()?.validas.length ?? 0) > 0 && !this.aplicando(),
  );
  readonly limite = LIMITE_FILAS;

  /** Abre el panel; sin tipo, se queda el último elegido o el primero. */
  abrir(id?: TipoImportacionId): void {
    if (id) this.tipo.set(tipoImportacion(id));
    this.reiniciar();
    this.abierto.set(true);
  }

  cerrar(): void {
    this.abierto.set(false);
    this.reiniciar();
  }

  cambiarTipo(id: string): void {
    this.tipo.set(tipoImportacion(id));
    this.reiniciar();
  }

  escribir(texto: string): void {
    this.texto.set(texto);
    // Pegar o escribir a mano invalida la hoja binaria ya cargada.
    this.tablaArchivo.set(null);
    this.validacion.set(null);
    this.resultado.set(null);
    this.estado.set('inactivo');
  }

  async elegirArchivo(archivo: File): Promise<void> {
    this.errorArchivo.set(null);
    this.nombreArchivo.set(archivo.name);
    this.tablaArchivo.set(null);
    this.validacion.set(null);
    this.resultado.set(null);
    this.estado.set('inactivo');

    try {
      if (esExcelAntiguo(archivo.name)) {
        this.texto.set('');
        this.errorArchivo.set(MENSAJE_EXCEL_ANTIGUO);
        return;
      }

      const firma = await leerFirma(archivo);
      if (esExcelBinario(archivo.name, firma)) {
        this.texto.set('');
        const lectura = await leerLibroExcel(archivo);
        if (!lectura.ok) {
          this.errorArchivo.set(lectura.mensaje);
          return;
        }
        this.tablaArchivo.set(lectura.tabla);
        return;
      }

      const contenido = await archivo.text();
      this.escribir(contenido);
    } catch {
      this.errorArchivo.set('No se pudo leer el archivo seleccionado.');
    }
  }

  previsualizar(): void {
    const tablaArchivo = this.tablaArchivo();
    const texto = this.texto().trim();
    if (!tablaArchivo && texto === '') {
      this.errorArchivo.set('Pegue el contenido de la hoja o elija un archivo.');
      return;
    }

    this.errorArchivo.set(null);
    this.resultado.set(null);
    const tabla = tablaArchivo ?? leerTabla(texto);
    if (tabla.filas.length === 0) {
      this.errorArchivo.set('La hoja no tiene filas: sólo cabecera o nada.');
      return;
    }

    const validacion = validarImportacion(this.tipo(), tabla);
    this.validacion.set(validacion);
    this.estado.set(validacion.validas.length > 0 ? 'listo' : 'inactivo');
  }

  /** Ejecuta la estrategia del tipo elegido. */
  async aplicar(): Promise<void> {
    const tipo = this.tipo();
    const validacion = this.validacion();
    if (!validacion || validacion.validas.length === 0 || this.aplicando()) return;

    if (tipo.estrategia === 'delegar') {
      this.cerrar();
      void this.router.navigateByUrl(tipo.destino);
      return;
    }

    if (tipo.estrategia === 'padron') {
      this.descargarPadron(validacion);
      return;
    }

    this.estado.set('aplicando');
    this.progreso.set({ hechos: 0, total: validacion.validas.length });
    this.resultado.set(null);

    const errores: ErrorFila[] = [];
    const advertencias: ErrorFila[] = [];
    let creados = 0;

    for (const fila of validacion.validas) {
      try {
        const aviso = await this.crearRegistro(tipo, fila);
        if (aviso) advertencias.push(aviso);
        creados += 1;
      } catch (fallo) {
        const api = aErrorApi(fallo, 'La API rechazó la fila.');
        errores.push({
          fila: fila.fila,
          etiqueta: fila.etiqueta,
          codigo: api.codigo,
          mensaje: api.message,
        });
      }

      this.progreso.update((actual) => ({ ...actual, hechos: actual.hechos + 1 }));
    }

    const resultado: ResultadoImportacion = {
      creados,
      fallidos: errores.length,
      errores,
      advertencias,
    };
    this.resultado.set(resultado);
    this.estado.set('hecho');

    if (creados === 0) {
      this.avisos.error(
        'No se importó ningún registro',
        `Las ${errores.length} filas fueron rechazadas.`,
        errores[0]?.codigo,
      );
      return;
    }

    if (errores.length === 0 && advertencias.length === 0) {
      this.avisos.exito(
        `${creados} ${creados === 1 ? 'registro creado' : 'registros creados'}`,
        `Importación de «${tipo.etiqueta}» completada.`,
      );
      return;
    }

    const detalles: string[] = [];
    if (errores.length > 0) {
      detalles.push(
        `${errores.length} ${errores.length === 1 ? 'fila rechazada' : 'filas rechazadas'}`,
      );
    }
    if (advertencias.length > 0) {
      detalles.push(
        `${advertencias.length} ${advertencias.length === 1 ? 'aviso' : 'avisos'} (el registro sí se creó)`,
      );
    }

    this.avisos.info(
      `Importación parcial: ${creados} de ${creados + errores.length}`,
      `${detalles.join('. ')}. El detalle está en el panel.`,
    );
  }

  /** CSV con la cabecera del tipo, para llenarla fuera de la aplicación. */
  descargarPlantilla(): void {
    const columnas = this.tipo().columnas.map((columna) => columna.rotulo);
    if (columnas.length === 0) return;
    const escapado = columnas.map((rotulo) => `"${rotulo.replace(/"/g, '""')}"`);
    descargar(`avisa_${this.tipo().id}_plantilla.csv`, `\uFEFF${escapado.join(',')}\r\n`);
  }

  private descargarPadron(validacion: Validacion): void {
    const filas: FilaPadron[] = validacion.validas.map((fila) => ({
      nombre: String(fila.payload['nombre'] ?? ''),
      cargo: String(fila.payload['cargo'] ?? ''),
      organizacion: String(fila.payload['organizacion'] ?? ''),
      region: String(fila.payload['region'] ?? ''),
    }));

    const hoy = hoyIso();
    const csv = crearCsvPadronFilas({
      titulo: 'Importado de lista de asistencia',
      lugar: '',
      fecha: hoy,
      filas,
    });

    descargar('avisa_lista_asistencia.csv', csv);
    this.resultado.set({
      creados: filas.length,
      fallidos: validacion.rechazos.length,
      errores: [],
      advertencias: [],
      documento: 'avisa_lista_asistencia.csv',
    });
    this.estado.set('hecho');
    this.avisos.exito(
      `Padrón generado con ${filas.length} ${filas.length === 1 ? 'asistente' : 'asistentes'}`,
      'Complete la sesión, el lugar y la fecha en el archivo descargado.',
    );
  }

  /**
   * Alta del registro de una fila. Las demandas van después de su caso. Devuelve
   * un aviso cuando el registro se creó pero un paso secundario falló (la foto).
   */
  private async crearRegistro(tipo: TipoImportacion, fila: FilaValida): Promise<ErrorFila | null> {
    if (tipo.id === 'casos' || tipo.id === 'casos-demandas') {
      const creado = await firstValueFrom(
        this.http.post<unknown>(urlApi('/v1/cases'), fila.payload),
      );
      const codigo = codigoDeCaso(creado);

      for (const demanda of fila.demandas) {
        if (!codigo) {
          throw new Error('El caso se creó, pero la API no devolvió su código.');
        }
        try {
          await firstValueFrom(
            this.http.post<unknown>(urlApi('/v1/demandas'), {
              descripcion: demanda,
              tematica: fila.payload['tematica'],
              casoCode: codigo,
            }),
          );
        } catch (fallo) {
          const api = aErrorApi(fallo, 'La API rechazó la demanda.');
          // El caso ya existe: se dice cuál para no duplicarlo al reintentar.
          throw new Error(
            `El caso ${codigo} se creó, pero la demanda «${demanda}» fue rechazada: ${api.message}`,
          );
        }
      }
      return null;
    }

    const creado = await firstValueFrom(
      this.http.post<unknown>(urlApi('/v1/actors'), fila.payload),
    );

    const foto = fila.foto ?? '';
    if (foto === '') return null;

    // La foto es un paso posterior: si falla, el actor ya existe y la fila no
    // se marca como rechazada para no invitar a repetir el alta.
    try {
      await this.registrarFoto(creado, foto);
      return null;
    } catch (fallo) {
      const api = aErrorApi(fallo, 'La API rechazó la foto.');
      return {
        fila: fila.fila,
        etiqueta: fila.etiqueta,
        codigo: 'FOTO_NO_REGISTRADA',
        mensaje: `El actor se creó, pero la foto no se registró: ${api.message}`,
      };
    }
  }

  /** Registra la foto declarada como medio principal del actor recién creado. */
  private async registrarFoto(actor: unknown, url: string): Promise<void> {
    const entidadId = idDeActor(actor);
    if (!entidadId) {
      throw new Error('La API no devolvió el identificador del actor creado.');
    }

    await firstValueFrom(
      this.http.post<unknown>(urlApi('/v1/media'), {
        entidadTipo: 'actor',
        entidadId,
        rol: 'principal',
        esPrincipal: true,
        url,
      }),
    );
  }

  private reiniciar(): void {
    this.texto.set('');
    this.nombreArchivo.set(null);
    this.tablaArchivo.set(null);
    this.validacion.set(null);
    this.errorArchivo.set(null);
    this.resultado.set(null);
    this.estado.set('inactivo');
    this.progreso.set({ hechos: 0, total: 0 });
  }
}

/** El alta de actor responde la ficha (`{ id, nombre, … }`); se aceptan alias. */
function idDeActor(bruto: unknown): string | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const objeto = bruto as Record<string, unknown>;
  const detalle =
    objeto['actor'] && typeof objeto['actor'] === 'object'
      ? (objeto['actor'] as Record<string, unknown>)
      : objeto;

  for (const clave of ['id', 'uid', 'actorUid', 'actor_uid']) {
    const valor = detalle[clave];
    if (typeof valor === 'string' && valor.trim() !== '') return valor.trim();
  }
  return null;
}

/** El alta de caso responde `{ case: { codigo } }`; se aceptan alias por si cambia. */
function codigoDeCaso(bruto: unknown): string | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const objeto = bruto as Record<string, unknown>;
  const detalle =
    objeto['case'] && typeof objeto['case'] === 'object'
      ? (objeto['case'] as Record<string, unknown>)
      : objeto;

  for (const clave of ['codigo', 'codigoCaso', 'codigo_caso', 'code']) {
    const valor = detalle[clave];
    if (typeof valor === 'string' && valor.trim() !== '') return valor.trim();
  }
  return null;
}

/** Primeros bytes del archivo, para distinguir un ZIP (xlsx) de texto. */
async function leerFirma(archivo: File): Promise<string> {
  const trozo = await archivo.slice(0, 4).arrayBuffer();
  return String.fromCharCode(...new Uint8Array(trozo));
}

function descargar(nombre: string, contenido: string): void {
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8' });
  const objeto = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = objeto;
  enlace.download = nombre;
  enlace.rel = 'noopener';
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(objeto), 0);
}
