import type { ActorDirectorio } from './directorio.mapeo';

/** Una línea del padrón; es lo que se imprime para que cada asistente firme. */
export type FilaPadron = {
  nombre: string;
  cargo: string;
  organizacion: string;
  region: string;
};

type DatosPadron = {
  titulo: string;
  lugar: string;
  fecha: string;
  actores: ActorDirectorio[];
};

type DatosPadronFilas = {
  titulo: string;
  lugar: string;
  fecha: string;
  filas: readonly FilaPadron[];
};

function celdaCsv(valor: string): string {
  const seguro = /^[\s]*[=+@\-]/.test(valor) ? `'${valor}` : valor;
  return `"${seguro.replace(/"/g, '""')}"`;
}

/**
 * Padrón a partir de filas ya armadas. Es la forma que usa la importación de
 * listas de asistencia, que no conoce fichas del directorio.
 */
export function crearCsvPadronFilas({ titulo, lugar, fecha, filas }: DatosPadronFilas): string {
  const lineas = [
    ['Lista de asistencia'],
    ['Sesión', titulo],
    ['Lugar', lugar],
    ['Fecha', fecha],
    [],
    ['N.º', 'Nombre del actor', 'Cargo / función', 'Organización', 'Región', 'Firma'],
    ...filas.map((fila, indice) => [
      String(indice + 1),
      fila.nombre,
      fila.cargo,
      fila.organizacion,
      fila.region,
      '',
    ]),
  ];

  return `\uFEFF${lineas.map((fila) => fila.map(celdaCsv).join(',')).join('\r\n')}`;
}

/**
 * Padrón a partir de fichas del directorio. Sólo datos públicos: el padrón se
 * imprime y circula, así que no lleva DNI ni contactos.
 */
export function crearCsvPadronAsistencia({ titulo, lugar, fecha, actores }: DatosPadron): string {
  return crearCsvPadronFilas({
    titulo,
    lugar,
    fecha,
    filas: actores.map((actor) => ({
      nombre: actor.nombre,
      cargo: actor.cargo || actor.funcion || '',
      organizacion: actor.organizacionAncla || '',
      region: actor.region || '',
    })),
  });
}
