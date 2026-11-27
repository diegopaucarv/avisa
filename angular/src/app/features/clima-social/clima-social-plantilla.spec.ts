import { describe, expect, it } from 'vitest';

import { PLANTILLA_CLIMA_SOCIAL, parsearPlantillaClimaSocial } from './clima-social-plantilla';

describe('parsearPlantillaClimaSocial', () => {
  it('lee las cinco secciones con sus líneas', () => {
    const datos = parsearPlantillaClimaSocial(
      [
        '## Resumen ejecutivo',
        'Mes con tensión moderada en el litoral.',
        '',
        '## Actores',
        '- Juan Pérez — Presidente, AGREPESAR',
        '',
        '## Clima social y hechos recientes',
        '- 27.NOV.2026 — Reunión con dirigentes.',
        '',
        '## Demandas locales',
        '- Ampliar la cuota de captura.',
        '',
        '## Foco PRODUCE',
        '- Abrir mesa de diálogo en diciembre.',
      ].join('\n'),
    );

    expect(datos).not.toBeNull();
    expect(datos?.resumen).toEqual(['Mes con tensión moderada en el litoral.']);
    expect(datos?.actores).toEqual(['Juan Pérez — Presidente, AGREPESAR']);
    expect(datos?.clima).toEqual(['27.NOV.2026 — Reunión con dirigentes.']);
    expect(datos?.demandas).toEqual(['Ampliar la cuota de captura.']);
    expect(datos?.foco).toEqual(['Abrir mesa de diálogo en diciembre.']);
  });

  it('reconoce alias de sección sin encabezado markdown', () => {
    const datos = parsearPlantillaClimaSocial(
      'Resumen\nTodo tranquilo.\nDemandas\n- Nada pendiente.',
    );
    expect(datos?.resumen).toEqual(['Todo tranquilo.']);
    expect(datos?.demandas).toEqual(['Nada pendiente.']);
  });

  it('tolera tildes, mayúsculas y numeración', () => {
    const datos = parsearPlantillaClimaSocial('3. CLIMA SOCIAL\n- Algo ocurrió.');
    expect(datos?.clima).toEqual(['Algo ocurrió.']);
  });

  it('adjunta el texto sin viñeta a la sección abierta', () => {
    const datos = parsearPlantillaClimaSocial(
      '## Resumen ejecutivo\nPrimera línea.\nSegunda línea.',
    );
    expect(datos?.resumen).toEqual(['Primera línea.', 'Segunda línea.']);
  });

  it('devuelve null si no reconoce ninguna sección', () => {
    expect(parsearPlantillaClimaSocial('Texto cualquiera sin estructura.')).toBeNull();
    expect(parsearPlantillaClimaSocial('')).toBeNull();
    expect(parsearPlantillaClimaSocial(null)).toBeNull();
  });

  it('la plantilla se puede releer con el propio parser', () => {
    const datos = parsearPlantillaClimaSocial(PLANTILLA_CLIMA_SOCIAL);
    expect(datos).not.toBeNull();
    expect(datos?.resumen.length).toBe(1);
    expect(datos?.actores.length).toBe(1);
    expect(datos?.clima.length).toBe(1);
    expect(datos?.demandas.length).toBe(1);
    expect(datos?.foco.length).toBe(1);
  });
});
