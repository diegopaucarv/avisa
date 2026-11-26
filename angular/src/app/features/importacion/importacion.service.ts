import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { aErrorApi } from '../../core/http/errores';
import { AvisosService } from '../../shared/ui/avisos.service';
import { crearCsvPadronFilas, type FilaPadron } from '../directorio/padron-asistencia';
import { esExcelBinario, leerTabla } from './importacion.csv';
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
  /** Para la lista de asistencia: el documento ya se descargó. */
  readonly documento?: string;
};

const MENSAJE_EXCEL =
  'Un .xlsx es un archivo comprimido, no una hoja de texto: no se puede leer aquí. ' +
  'En Excel use «Archivo → Guardar como → CSV UTF-8», o seleccione las celdas, cópielas ' +
  '(Ctrl+C) y péguenlas en el cuadro de abajo: se leen tabuladores, comas y puntos y coma.';

/**
 * Estado y ejecución de una importación.
 *
 * El panel sólo pinta lo que hay aquí; el «ruteo» por tipo de archivo vive en
 * `importacion.tipos.ts` y la lectura del archivo en `importacion.csv.ts`. Este
 * servicio es el único punto que habla con la API, en serie y fila a fila: un
 * archivo de 400 altas no debe abrir 400 conexiones a la vez.
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
    this.validacion.set(null);
    this.resultado.set(null);
    this.estado.set('inactivo');
  }

  async elegirArchivo(archivo: File): Promise<void> {
    this.errorArchivo.set(null);
    this.nombreArchivo.set(archivo.name);

    try {
      const firma = await leerFirma(archivo);
      if (esExcelBinario(archivo.name, firma)) {
        this.errorArchivo.set(MENSAJE_EXCEL);
        this.texto.set('');
        return;
      }

      const contenido = await archivo.text();
      this.escribir(contenido);
    } catch {
      this.errorArchivo.set('No se pudo leer el archivo seleccionado.');
    }
  }

  previsualizar(): void {
    const texto = this.texto().trim();
    if (texto === '') {
      this.errorArchivo.set('Pegue el contenido de la hoja o elija un archivo.');
      return;
    }

    this.errorArchivo.set(null);
    this.resultado.set(null);
    const tabla = leerTabla(texto);
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
    let creados = 0;

    for (const fila of validacion.validas) {
      try {
        await this.crearRegistro(tipo, fila);
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

    if (errores.length === 0) {
      this.avisos.exito(
        `${creados} ${creados === 1 ? 'registro creado' : 'registros creados'}`,
        `Importación de «${tipo.etiqueta}» completada.`,
      );
      return;
    }

    this.avisos.info(
      `Importación parcial: ${creados} de ${creados + errores.length}`,
      `${errores.length} ${errores.length === 1 ? 'fila rechazada' : 'filas rechazadas'}. ` +
        'El detalle está en el panel.',
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

    const hoy = new Date().toISOString().slice(0, 10);
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
      documento: 'avisa_lista_asistencia.csv',
    });
    this.estado.set('hecho');
    this.avisos.exito(
      `Padrón generado con ${filas.length} ${filas.length === 1 ? 'asistente' : 'asistentes'}`,
      'Complete la sesión, el lugar y la fecha en el archivo descargado.',
    );
  }

  /** Alta del registro de una fila. Las demandas van después de su caso. */
  private async crearRegistro(tipo: TipoImportacion, fila: FilaValida): Promise<void> {
    if (tipo.id === 'casos' || tipo.id === 'casos-demandas') {
      const creado = await firstValueFrom(
        this.http.post<unknown>(urlApi('/v1/cases'), fila.payload),
      );
      const codigo = codigoDeCaso(creado);

      for (const demanda of fila.demandas) {
        if (!codigo) {
          throw new Error('El caso se creó, pero la API no devolvió su código.');
        }
        await firstValueFrom(
          this.http.post<unknown>(urlApi('/v1/demandas'), {
            descripcion: demanda,
            tematica: fila.payload['tematica'],
            casoCode: codigo,
          }),
        );
      }
      return;
    }

    await firstValueFrom(this.http.post<unknown>(urlApi('/v1/actors'), fila.payload));
  }

  private reiniciar(): void {
    this.texto.set('');
    this.nombreArchivo.set(null);
    this.validacion.set(null);
    this.errorArchivo.set(null);
    this.resultado.set(null);
    this.estado.set('inactivo');
    this.progreso.set({ hechos: 0, total: 0 });
  }
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
