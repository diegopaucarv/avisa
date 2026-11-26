import { describe, expect, it } from 'vitest';

import {
  MINUTOS_INACTIVIDAD,
  MS_INACTIVIDAD,
  SEGUNDOS_AVISO,
  enVentanaDeAviso,
  inactividadAgotada,
  segundosDeAviso,
  segundosHastaCaducar,
} from './inactividad.service';

/**
 * La lógica del temporizador se prueba por sus funciones puras: no hacen falta
 * temporizadores falsos ni un TestBed, y el servicio usa exactamente las mismas.
 */
describe('duración por defecto', () => {
  it('cierra la sesión a los 30 minutos', () => {
    expect(MINUTOS_INACTIVIDAD).toBe(30);
    expect(MS_INACTIVIDAD).toBe(30 * 60_000);
  });

  it('empieza con la duración completa', () => {
    expect(segundosHastaCaducar(0)).toBe(MINUTOS_INACTIVIDAD * 60);
  });
});

describe('segundosHastaCaducar', () => {
  it('redondea hacia arriba para no mostrar 0 antes de tiempo', () => {
    expect(segundosHastaCaducar(MS_INACTIVIDAD - 1)).toBe(1);
    expect(segundosHastaCaducar(MS_INACTIVIDAD - 1_001)).toBe(2);
  });

  it('nunca devuelve negativos', () => {
    expect(segundosHastaCaducar(MS_INACTIVIDAD)).toBe(0);
    expect(segundosHastaCaducar(MS_INACTIVIDAD + 60_000)).toBe(0);
  });

  it('trata un transcurrido negativo como recién reiniciado', () => {
    expect(segundosHastaCaducar(-5_000)).toBe(MINUTOS_INACTIVIDAD * 60);
  });

  it('acepta una duración ajustada', () => {
    expect(segundosHastaCaducar(0, 90_000)).toBe(90);
    expect(segundosHastaCaducar(30_000, 90_000)).toBe(60);
    expect(segundosHastaCaducar(60_000, 90_000)).toBe(30);
  });
});

describe('umbral de aviso', () => {
  it('avisa en el último minuto y no antes', () => {
    expect(enVentanaDeAviso(SEGUNDOS_AVISO + 1)).toBe(false);
    expect(enVentanaDeAviso(SEGUNDOS_AVISO)).toBe(true);
    expect(enVentanaDeAviso(1)).toBe(true);
  });

  it('no avisa sin segundos pendientes ni con valores negativos', () => {
    expect(enVentanaDeAviso(0)).toBe(false);
    expect(enVentanaDeAviso(-3)).toBe(false);
  });
});

describe('segundosDeAviso', () => {
  const inicioAviso = MS_INACTIVIDAD - SEGUNDOS_AVISO * 1_000;

  it('publica 0 hasta que empieza el último minuto', () => {
    expect(segundosDeAviso(0)).toBe(0);
    expect(segundosDeAviso(inicioAviso - 1_000)).toBe(0);
  });

  it('publica la cuenta regresiva dentro del último minuto', () => {
    expect(segundosDeAviso(inicioAviso)).toBe(60);
    expect(segundosDeAviso(inicioAviso + 1_000)).toBe(59);
    expect(segundosDeAviso(MS_INACTIVIDAD - 1)).toBe(1);
  });

  it('publica 0 al agotarse la inactividad', () => {
    expect(segundosDeAviso(MS_INACTIVIDAD)).toBe(0);
    expect(segundosDeAviso(MS_INACTIVIDAD + 5_000)).toBe(0);
  });
});

describe('reinicio por actividad', () => {
  it('vuelve a la duración completa y oculta el aviso', () => {
    // Una actividad equivale a poner el transcurrido a cero.
    expect(segundosHastaCaducar(0)).toBe(MS_INACTIVIDAD / 1_000);
    expect(segundosDeAviso(0)).toBe(0);
    expect(enVentanaDeAviso(segundosDeAviso(0))).toBe(false);
  });
});

describe('inactividadAgotada', () => {
  it('no expira antes de la duración', () => {
    expect(inactividadAgotada(0)).toBe(false);
    expect(inactividadAgotada(MS_INACTIVIDAD - 1)).toBe(false);
  });

  it('expira al alcanzar o superar la duración', () => {
    expect(inactividadAgotada(MS_INACTIVIDAD)).toBe(true);
    expect(inactividadAgotada(MS_INACTIVIDAD + 1)).toBe(true);
  });

  it('respeta una duración ajustada', () => {
    expect(inactividadAgotada(4_999, 5_000)).toBe(false);
    expect(inactividadAgotada(5_000, 5_000)).toBe(true);
  });
});
