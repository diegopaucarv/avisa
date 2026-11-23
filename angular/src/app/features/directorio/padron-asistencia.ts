import type { ActorDirectorio } from './directorio.mapeo';

type DatosPadron = {
  titulo: string;
  lugar: string;
  fecha: string;
  actores: ActorDirectorio[];
};

function celdaCsv(valor: string): string {
  const seguro = /^[\s]*[=+@\-]/.test(valor) ? `'${valor}` : valor;
  return `"${seguro.replace(/"/g, '""')}"`;
}

export function crearCsvPadronAsistencia({ titulo, lugar, fecha, actores }: DatosPadron): string {
  const filas = [
    ['Padrón de asistencia'],
    ['Sesión', titulo],
    ['Lugar', lugar],
    ['Fecha', fecha],
    [],
    ['N.º', 'Nombre del actor', 'Cargo / función', 'Organización', 'Región', 'Firma'],
    ...actores.map((actor, indice) => [
      String(indice + 1),
      actor.nombre,
      actor.cargo || actor.funcion || '',
      actor.organizacionAncla || '',
      actor.region || '',
      '',
    ]),
  ];

  return `\uFEFF${filas.map((fila) => fila.map(celdaCsv).join(',')).join('\r\n')}`;
}
