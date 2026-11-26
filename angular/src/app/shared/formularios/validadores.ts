/**
 * Validadores de formulario compartidos.
 *
 * Son funciones puras: reciben el valor crudo del control y devuelven el
 * mensaje de error, o `null` cuando el valor es válido. Así se pueden probar
 * sin TestBed, sin DOM y sin depender de Reactive Forms, y reutilizar tanto en
 * plantillas como en el `guardar()` de un panel.
 *
 * Decisiones que conviene conocer:
 *  · El **DNI** peruano tiene ocho dígitos; el **RUC**, once con dígito
 *    verificador (módulo 11, pesos SUNAT). No se consulta RENIEC ni SUNAT.
 *  · La **fecha** es `dd/mm/aaaa` y se valida que exista (31/02 no existe). Con
 *    `noFutura` se compara contra hoy en `America/Lima`, nunca contra la zona
 *    del navegador.
 *  · El **teléfono** acepta las formas con las que se escribe en Perú
 *    (`+51 987 654 321`, `(01) 456-7890`); se normaliza a dígitos antes de
 *    comprobar.
 *  · El **ubigeo** son seis dígitos; no se deduce ni se rellena.
 *
 * No se inventan reglas que el proyecto no haya fijado: por ejemplo, el RUC no
 * se restringe a ciertos prefijos porque la especificación sólo exige el dígito
 * verificador.
 */

import { desdeDdMmAaaa, hoyIso } from '../../core/fecha/zona-horaria';

/** Mensaje de error, o `null` si el valor es válido. */
export type ResultadoValidacion = string | null;

export type OpcionesTexto = {
  /** Nombre visible del campo para el mensaje: «el nombre», «la descripción». */
  campo?: string;
  /** Longitud mínima (por defecto 1, porque el campo es obligatorio). */
  minimo?: number;
  /** Longitud máxima, medida sobre el texto sin espacios en los extremos. */
  maximo?: number;
};

export type OpcionesFecha = {
  /** Rechaza fechas posteriores a hoy en `America/Lima`. */
  noFutura?: boolean;
  /** Día de referencia ISO (`YYYY-MM-DD`); por defecto, hoy en Lima. */
  hoy?: string;
  /** Nombre visible del campo para el mensaje. */
  campo?: string;
};

/** Pesos SUNAT para el dígito verificador del RUC (sobre los 10 primeros). */
const PESOS_RUC = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

const CORREO = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

/** `true` si todos los caracteres son dígitos (sin espacios ni signos). */
function soloDigitos(valor: string): boolean {
  return /^\d+$/.test(valor);
}

/**
 * DNI: exactamente ocho dígitos.
 *
 * Se ignoran los espacios de los extremos, pero un guion, un punto o una letra
 * hacen inválido el valor: no son parte del documento.
 */
export function validarDni(valor: string | null | undefined): ResultadoValidacion {
  const limpio = (valor ?? '').trim();
  if (!limpio) return 'Ingrese el DNI de 8 dígitos.';
  if (!soloDigitos(limpio) || limpio.length !== 8) {
    return 'El DNI debe tener exactamente 8 dígitos.';
  }
  return null;
}

/**
 * RUC: once dígitos con dígito verificador módulo 11.
 *
 * Suma ponderada de los diez primeros dígitos; `11 - (suma % 11)` da el
 * verificador (`10` vale `0` y `11` vale `1`). No se exige un prefijo concreto
 * porque la especificación no lo pide.
 */
export function validarRuc(valor: string | null | undefined): ResultadoValidacion {
  const limpio = (valor ?? '').trim();
  if (!limpio) return 'Ingrese el RUC de 11 dígitos.';
  if (!soloDigitos(limpio) || limpio.length !== 11) {
    return 'El RUC debe tener exactamente 11 dígitos.';
  }

  const digitos = limpio.split('').map(Number);
  let suma = 0;
  for (let indice = 0; indice < PESOS_RUC.length; indice += 1) {
    suma += (digitos[indice] ?? 0) * (PESOS_RUC[indice] ?? 0);
  }

  const resto = 11 - (suma % 11);
  const verificador = resto === 10 ? 0 : resto === 11 ? 1 : resto;

  if (verificador !== digitos[10]) {
    return 'El RUC no es válido: el dígito verificador no coincide.';
  }
  return null;
}

/** Correo electrónico: una sola arroba, dominio con punto y TLD alfabético. */
export function validarCorreo(valor: string | null | undefined): ResultadoValidacion {
  const limpio = (valor ?? '').trim();
  if (!limpio) return 'Ingrese el correo electrónico.';
  if (limpio.length > 254 || !CORREO.test(limpio)) {
    return 'Ingrese un correo electrónico válido, por ejemplo nombre@entidad.gob.pe.';
  }
  return null;
}

/**
 * Teléfono peruano.
 *
 * Se aceptan separadores (espacios, guiones, puntos y paréntesis) y el prefijo
 * del país (`+51` o `51`). Quedan nueve dígitos: los celulares empiezan con `9`
 * y los fijos con `0` (Lima es `01`).
 */
export function validarTelefonoPe(valor: string | null | undefined): ResultadoValidacion {
  const crudo = (valor ?? '').trim();
  if (!crudo) return 'Ingrese el teléfono.';
  if (/[A-Za-z]/.test(crudo)) return 'El teléfono sólo puede contener números y separadores.';

  let digitos = crudo.replace(/[^\d]/g, '');
  if (digitos.startsWith('51') && digitos.length === 11) {
    digitos = digitos.slice(2);
  }

  if (digitos.length !== 9) {
    return 'El teléfono debe tener 9 dígitos (por ejemplo 987 654 321).';
  }
  if (!digitos.startsWith('9') && !digitos.startsWith('0')) {
    return 'El teléfono debe empezar con 9 (celular) o 0 (fijo).';
  }
  return null;
}

/**
 * Fecha `dd/mm/aaaa`.
 *
 * Comprueba el formato con barras, que la fecha exista en el calendario y,
 * opcionalmente, que no sea posterior a hoy en `America/Lima`.
 */
export function validarFechaDdMmAaaa(
  valor: string | null | undefined,
  opciones: OpcionesFecha = {},
): ResultadoValidacion {
  const campo = opciones.campo ?? 'la fecha';
  const limpio = (valor ?? '').trim();
  if (!limpio) return `Ingrese ${campo} en formato dd/mm/aaaa.`;

  if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(limpio)) {
    return `Use el formato dd/mm/aaaa para ${campo}.`;
  }

  const dia = desdeDdMmAaaa(limpio);
  if (!dia) {
    return `La fecha de ${campo} no existe en el calendario.`;
  }

  if (opciones.noFutura) {
    const hoy = opciones.hoy ?? hoyIso();
    // Ambos son `YYYY-MM-DD`: la comparación lexicográfica equivale a la
    // cronológica y no depende de la zona horaria del navegador.
    if (hoy && dia > hoy) {
      return `${campo.charAt(0).toUpperCase() + campo.slice(1)} no puede ser posterior a hoy.`;
    }
  }
  return null;
}

/**
 * Texto obligatorio con longitud.
 *
 * La longitud se mide sobre el texto sin espacios en los extremos para no
 * aceptar un campo relleno sólo con espacios.
 */
export function validarTextoObligatorio(
  valor: string | null | undefined,
  opciones: OpcionesTexto = {},
): ResultadoValidacion {
  const campo = opciones.campo ?? 'el campo';
  const minimo = opciones.minimo ?? 1;
  const texto = (valor ?? '').trim();

  if (texto.length < Math.max(1, minimo)) {
    return `Complete ${campo}.`;
  }
  if (opciones.maximo !== undefined && texto.length > opciones.maximo) {
    return `${campo.charAt(0).toUpperCase() + campo.slice(1)} admite ${opciones.maximo} caracteres como máximo.`;
  }
  return null;
}

/** URL absoluta con protocolo `http` o `https`. */
export function validarUrlHttp(valor: string | null | undefined): ResultadoValidacion {
  const limpio = (valor ?? '').trim();
  if (!limpio) return 'Ingrese la dirección web.';

  let url: URL;
  try {
    url = new URL(limpio);
  } catch {
    return 'Ingrese una dirección web válida, por ejemplo https://www.gob.pe/produce.';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'La dirección web debe empezar con http:// o https://.';
  }
  if (!url.hostname) {
    return 'La dirección web debe incluir un dominio.';
  }
  return null;
}

/** UBIGEO: exactamente seis dígitos (no se deduce ni se rellena). */
export function validarUbigeo(valor: string | null | undefined): ResultadoValidacion {
  const limpio = (valor ?? '').trim();
  if (!limpio) return 'Ingrese el ubigeo de 6 dígitos.';
  if (!soloDigitos(limpio) || limpio.length !== 6) {
    return 'El ubigeo debe tener exactamente 6 dígitos.';
  }
  return null;
}

/** Atajo para plantillas: `true` cuando no hay mensaje de error. */
export function esValido(resultado: ResultadoValidacion): boolean {
  return resultado === null;
}
