/**
 * Zona horaria única de AVISA y conversión entre ISO-8601 y fecha local.
 *
 * La API habla ISO-8601 (con o sin hora, siempre en UTC); la pantalla habla
 * `dd/mm/aaaa`. Este módulo es el único punto de traducción para que ningún
 * listado vuelva a improvisar con `new Date().toLocaleDateString()`.
 *
 * Reglas que respeta:
 *  · Un día suelto (`2026-11-24`) es el día de Lima, no el de UTC: se devuelve
 *    tal cual y nunca se desplaza. Si se construyera con `new Date('2026-11-24')`
 *    el navegador lo interpretaría como medianoche UTC, que en Lima es todavía
 *    el día anterior a las 19:00.
 *  · Un instante (`2026-11-24T02:30:00Z`) se pinta en hora de Lima: 23/11/2026
 *    a las 21:30.
 *  · Los límites de un rango de filtros se calculan en la zona, para no perder
 *    los registros de las últimas cinco horas del día.
 *
 * `America/Lima` no tiene horario de verano, pero el cálculo del desfase es
 * general (se apoya en `Intl`), así que cambiar `ZONA_HORARIA` por otra zona
 * sigue siendo correcto.
 */

export const ZONA_HORARIA = 'America/Lima';

/** Marca de dato ausente: se declara, no se estima. */
export const RESPALDO_SIN_DATO = '—';

export type PartesFecha = {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
};

const DIA_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/;
const FECHA_BARRAS = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;

const FORMATO_LOCAL = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_HORARIA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** `true` si el texto es un día ISO completo (`2026-11-24`). */
export function esDiaIso(valor: unknown): valor is string {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor.trim());
}

function dos(valor: number): string {
  return String(valor).padStart(2, '0');
}

/** Partes de reloj de pared de un instante, en la zona de AVISA. */
export function partesEnZona(instante: Date): PartesFecha {
  const partes = FORMATO_LOCAL.formatToParts(instante);
  const buscar = (tipo: string): number => {
    const parte = partes.find((item) => item.type === tipo);
    return parte ? Number(parte.value) : 0;
  };
  return {
    anio: buscar('year'),
    mes: buscar('month'),
    dia: buscar('day'),
    hora: buscar('hour'),
    minuto: buscar('minute'),
    segundo: buscar('second'),
  };
}

/**
 * Minutos que la zona adelanta respecto de UTC en ese instante
 * (`America/Lima` devuelve -300). Se usa para construir instantes a partir de
 * una hora de reloj de pared.
 */
export function desfaseMinutos(instante: Date): number {
  const partes = partesEnZona(instante);
  const comoUtc = Date.UTC(
    partes.anio,
    partes.mes - 1,
    partes.dia,
    partes.hora,
    partes.minuto,
    partes.segundo,
  );
  return Math.round((comoUtc - instante.getTime()) / 60000);
}

/** Instante de un reloj de pared de la zona; dos pasadas absorben el desfase. */
function instanteDeMuro(
  anio: number,
  mes: number,
  dia: number,
  hora = 0,
  minuto = 0,
  segundo = 0,
  milisegundo = 0,
): Date {
  const base = Date.UTC(anio, mes - 1, dia, hora, minuto, segundo, milisegundo);
  let instante = base - desfaseMinutos(new Date(base)) * 60000;
  instante = base - desfaseMinutos(new Date(instante)) * 60000;
  return new Date(instante);
}

/**
 * Día ISO (`YYYY-MM-DD`) de un valor. Un día suelto se devuelve tal cual; un
 * instante se traduce a la fecha de Lima. `null` si no es reconocible.
 */
export function diaIso(
  valor: string | Date | null | undefined,
): string | null {
  if (valor === null || valor === undefined) return null;

  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    const partes = partesEnZona(valor);
    return `${partes.anio}-${dos(partes.mes)}-${dos(partes.dia)}`;
  }

  const texto = valor.trim();
  if (!texto) return null;

  const soloDia = DIA_ISO.exec(texto);
  if (soloDia) return `${soloDia[1]}-${soloDia[2]}-${soloDia[3]}`;

  const instante = new Date(texto);
  if (Number.isNaN(instante.getTime())) return null;
  return diaIso(instante);
}

/** Hoy en Lima como `YYYY-MM-DD`. */
export function hoyIso(): string {
  return diaIso(new Date()) ?? '';
}

/** Instante actual en ISO-8601 UTC. */
export function ahoraIso(): string {
  return new Date().toISOString();
}

/** Día ISO → `dd/mm/aaaa`. */
export function aDdMmAaaa(dia: string): string {
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!coincidencia) return RESPALDO_SIN_DATO;
  return `${coincidencia[3]}/${coincidencia[2]}/${coincidencia[1]}`;
}

/**
 * Fecha para pantalla en `dd/mm/aaaa`. Un `null`, un texto vacío o un valor no
 * reconocible se declaran con el respaldo (nunca se estima una fecha).
 */
export function formatearFecha(
  valor: string | Date | null | undefined,
  respaldo: string = RESPALDO_SIN_DATO,
): string {
  const dia = diaIso(valor);
  return dia ? aDdMmAaaa(dia) : respaldo;
}

/** Fecha y hora de Lima en `dd/mm/aaaa hh:mm`. */
export function formatearFechaHora(
  valor: string | Date | null | undefined,
  respaldo: string = RESPALDO_SIN_DATO,
): string {
  if (valor === null || valor === undefined || valor === '') return respaldo;
  const instante = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(instante.getTime())) return respaldo;
  const partes = partesEnZona(instante);
  return (
    `${dos(partes.dia)}/${dos(partes.mes)}/${partes.anio}` +
    ` ${dos(partes.hora)}:${dos(partes.minuto)}`
  );
}

/** Valor para un `<input>` de fecha de la interfaz (`dd/mm/aaaa` o vacío). */
export function formatearEntradaFecha(
  valor: string | Date | null | undefined,
): string {
  const dia = diaIso(valor);
  return dia ? aDdMmAaaa(dia) : '';
}

/**
 * Inserta las barras mientras se escribe y corta en ocho dígitos.
 * `1203` → `12/03`; `12032026` → `12/03/2026`.
 */
export function mascaraDdMmAaaa(texto: string): string {
  const digitos = texto.replace(/\D/g, '').slice(0, 8);
  const dia = digitos.slice(0, 2);
  const mes = digitos.slice(2, 4);
  const anio = digitos.slice(4, 8);
  if (!mes) return dia;
  if (!anio) return `${dia}/${mes}`;
  return `${dia}/${mes}/${anio}`;
}

/**
 * `dd/mm/aaaa` (o `dd-mm-aaaa`) → día ISO. Valida que la fecha exista: un
 * `31/02/2026` devuelve `null` en vez de rodar al 3 de marzo.
 */
export function desdeDdMmAaaa(
  texto: string | null | undefined,
): string | null {
  const limpio = (texto ?? '').trim();
  if (!limpio) return null;

  const coincidencia = FECHA_BARRAS.exec(limpio);
  if (!coincidencia) return null;

  const dia = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);
  const anio = Number(coincidencia[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;

  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    return null;
  }

  return `${anio}-${dos(mes)}-${dos(dia)}`;
}

/** Suma (o resta, con signo negativo) días a un día ISO. */
export function sumarDias(dia: string, dias: number): string {
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!coincidencia) return dia;
  const fecha = new Date(
    Date.UTC(
      Number(coincidencia[1]),
      Number(coincidencia[2]) - 1,
      Number(coincidencia[3]) + Math.trunc(dias),
    ),
  );
  return `${fecha.getUTCFullYear()}-${dos(fecha.getUTCMonth() + 1)}-${dos(fecha.getUTCDate())}`;
}

/** Diferencia en días entre dos días ISO (`hasta - desde`). */
export function diasEntre(desde: string, hasta: string): number {
  const partesA = /^(\d{4})-(\d{2})-(\d{2})$/.exec(desde);
  const partesB = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hasta);
  if (!partesA || !partesB) return Number.NaN;
  const ms =
    Date.UTC(Number(partesB[1]), Number(partesB[2]) - 1, Number(partesB[3])) -
    Date.UTC(Number(partesA[1]), Number(partesA[2]) - 1, Number(partesA[3]));
  return Math.round(ms / 86400000);
}

/** Primer día del mes de un día ISO. */
export function primerDiaDelMes(dia: string): string {
  const coincidencia = /^(\d{4})-(\d{2})/.exec(dia);
  if (!coincidencia) return dia;
  return `${coincidencia[1]}-${coincidencia[2]}-01`;
}

/** Primer día del año de un día ISO. */
export function primerDiaDelAnio(dia: string): string {
  const coincidencia = /^(\d{4})/.exec(dia);
  if (!coincidencia) return dia;
  return `${coincidencia[1]}-01-01`;
}

/**
 * Inicio del día (00:00:00.000 en Lima) como instante ISO-8601 UTC.
 * Es el `desde` de un filtro por fecha.
 */
export function inicioDelDiaIso(
  valor: string | Date | null | undefined,
): string | null {
  const dia = diaIso(valor);
  if (!dia) return null;
  const [anio, mes, numeroDia] = dia.split('-').map(Number);
  return instanteDeMuro(anio, mes, numeroDia).toISOString();
}

/**
 * Fin del día (23:59:59.999 en Lima) como instante ISO-8601 UTC.
 * Es el `hasta` de un filtro por fecha: incluye las últimas horas del día.
 */
export function finDelDiaIso(
  valor: string | Date | null | undefined,
): string | null {
  const dia = diaIso(valor);
  if (!dia) return null;
  const [anio, mes, numeroDia] = dia.split('-').map(Number);
  return instanteDeMuro(anio, mes, numeroDia, 23, 59, 59, 999).toISOString();
}

/** `true` si `zona` es una zona IANA que este runtime reconoce. */
export function esZonaHorariaValida(zona: string): boolean {
  try {
    new Intl.DateTimeFormat('es-PE', { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}
