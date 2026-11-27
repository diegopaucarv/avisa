import { describe, expect, it } from 'vitest';

import { alcanceDesdeAmbito, parsearPlantillaAlerta } from './alerta-plantilla';

/** Reporte de ejemplo con la estructura obligatoria y markdown real. */
const REPORTE = `*🔔 REPORTE DE ALERTA TEMPRANA | Pesca artesanal, Máncora: paro ante nueva veda*
📅 _*Fecha de emisión*: 28.ABR.2026 - 16:00 hrs_
🌍 _*Ámbito*: Local — Máncora*

*🔍 1. SITUACIÓN ACTUAL*
Dirigentes de pescadores artesanales de Máncora anuncian un paro de 48 horas.
Exigen la derogatoria de la RM que amplía la veda.

*🏗️ 2. HECHOS RECIENTES Y ACCIONES EN CURSO*
- 26.ABR.2026 — Asamblea de bases acuerda el paro.
- 27.ABR.2026 — Presentan oficio al despacho regional.

*👥 3. ACTORES CLAVE*
- Juan Pérez — Presidente, AGREPESAR — 999888777
- María Gómez — Dirigente, Máncora

*📌 4. DEMANDAS INMEDIATAS*
Máncora
- Derogatoria de la RM.
- Mesa de diálogo con PRODUCE.

Los Órganos
- Respeto al cronograma de veda.

*⚠️ RIESGOS*
- Bloqueo de la carretera Panamericana Norte.

*🧭 ACCIONES SUGERIDAS*
De considerarlo pertinente, se sugiere: abrir mesa de diálogo.
- Coordinar con la Dirección de Orden Público.

📝 Notas para el editor:
- [POR CONFIRMAR: número de oficio]`;

describe('parsearPlantillaAlerta', () => {
  it('lee el título sin el prefijo del reporte', () => {
    const datos = parsearPlantillaAlerta(REPORTE);
    expect(datos?.titulo).toBe('Pesca artesanal, Máncora: paro ante nueva veda');
  });

  it('lee la fecha de emisión en ISO y la hora', () => {
    const datos = parsearPlantillaAlerta(REPORTE);
    expect(datos?.fechaEmision).toBe('2026-04-28');
    expect(datos?.hora).toBe('16:00');
  });

  it('lee el ámbito en texto libre', () => {
    const datos = parsearPlantillaAlerta(REPORTE);
    expect(datos?.ambito).toBe('Local — Máncora');
  });

  it('separa la situación actual por líneas', () => {
    const datos = parsearPlantillaAlerta(REPORTE);
    expect(datos?.situacionActual).toEqual([
      'Dirigentes de pescadores artesanales de Máncora anuncian un paro de 48 horas.',
      'Exigen la derogatoria de la RM que amplía la veda.',
    ]);
  });

  it('convierte los hechos a fecha ISO + descripción', () => {
    const datos = parsearPlantillaAlerta(REPORTE);
    expect(datos?.hechos).toEqual([
      { fecha: '2026-04-26', texto: 'Asamblea de bases acuerda el paro.' },
      { fecha: '2026-04-27', texto: 'Presentan oficio al despacho regional.' },
    ]);
  });

  it('lee los actores clave', () => {
    const datos = parsearPlantillaAlerta(REPORTE);
    expect(datos?.actores).toEqual([
      'Juan Pérez — Presidente, AGREPESAR — 999888777',
      'María Gómez — Dirigente, Máncora',
    ]);
  });

  it('adjunta el subtítulo de grupo a cada demanda', () => {
    const datos = parsearPlantillaAlerta(REPORTE);
    expect(datos?.demandas).toEqual([
      { organizacion: 'Máncora', demanda: 'Derogatoria de la RM.' },
      { organizacion: 'Máncora', demanda: 'Mesa de diálogo con PRODUCE.' },
      { organizacion: 'Los Órganos', demanda: 'Respeto al cronograma de veda.' },
    ]);
  });

  it('lee riesgos y acciones, incluida la línea sin viñeta', () => {
    const datos = parsearPlantillaAlerta(REPORTE);
    expect(datos?.riesgos).toEqual(['Bloqueo de la carretera Panamericana Norte.']);
    expect(datos?.acciones).toEqual([
      'De considerarlo pertinente, se sugiere: abrir mesa de diálogo.',
      'Coordinar con la Dirección de Orden Público.',
    ]);
  });

  it('ignora lo que sigue a las notas del editor', () => {
    const datos = parsearPlantillaAlerta(REPORTE);
    const textos = [
      ...(datos?.situacionActual ?? []),
      ...(datos?.riesgos ?? []),
      ...(datos?.acciones ?? []),
      ...(datos?.actores ?? []),
    ];
    expect(textos.some((texto) => texto.includes('POR CONFIRMAR'))).toBe(false);
  });

  it('acepta fechas numéricas y año de dos dígitos', () => {
    const datos = parsearPlantillaAlerta(
      'REPORTE DE ALERTA TEMPRANA | x\nFecha de emisión: 05/11/26 - 09:30',
    );
    expect(datos?.fechaEmision).toBe('2026-11-05');
    expect(datos?.hora).toBe('09:30');
  });

  it('deja la fecha del hecho en null si solo trae texto', () => {
    const datos = parsearPlantillaAlerta(
      'REPORTE DE ALERTA TEMPRANA | Prueba\n2. HECHOS RECIENTES Y ACCIONES EN CURSO\n- Sin fecha, solo relato.',
    );
    expect(datos?.hechos).toEqual([{ fecha: null, texto: 'Sin fecha, solo relato.' }]);
  });

  it('reconoce el título aunque falte la fecha y el ámbito', () => {
    const datos = parsearPlantillaAlerta('REPORTE DE ALERTA TEMPRANA | Solo título');
    expect(datos?.titulo).toBe('Solo título');
    expect(datos?.fechaEmision).toBeNull();
    expect(datos?.ambito).toBeNull();
  });

  it('devuelve null con texto que no es un reporte', () => {
    expect(parsearPlantillaAlerta('Hola, esto es una nota cualquiera.')).toBeNull();
    expect(parsearPlantillaAlerta('')).toBeNull();
    expect(parsearPlantillaAlerta(null)).toBeNull();
  });

  it('es tolerante a tildes y mayúsculas en los rótulos', () => {
    const datos = parsearPlantillaAlerta(
      'reporte de alerta temprana | x\n1. situacion actual\n- Algo pasa.',
    );
    expect(datos?.situacionActual).toEqual(['Algo pasa.']);
  });
});

describe('alcanceDesdeAmbito', () => {
  it('traduce el ámbito a la granularidad del select', () => {
    expect(alcanceDesdeAmbito('Local — Máncora')).toBe('Distrito');
    expect(alcanceDesdeAmbito('Regional — Piura')).toBe('Región');
    expect(alcanceDesdeAmbito('Nacional')).toBe('Nacional');
  });

  it('devuelve null cuando no reconoce el ámbito', () => {
    expect(alcanceDesdeAmbito(null)).toBeNull();
    expect(alcanceDesdeAmbito('Zona gris')).toBeNull();
  });
});
