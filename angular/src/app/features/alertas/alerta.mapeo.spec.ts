import { describe, expect, it } from 'vitest';

import {
  PASO_APROBACION_DEFINITIVA,
  accionesDeFlujo,
  claseEstado,
  etapaDeFlujo,
  plantillaWhatsapp,
  type Alerta,
} from './alerta.mapeo';

describe('transiciones del flujo de alertas', () => {
  it('declara los destinos legales desde cada paso', () => {
    expect(accionesDeFlujo(1).map((accion) => accion.paso)).toEqual([2]);
    expect(accionesDeFlujo(2).map((accion) => accion.paso)).toEqual([3, 1]);
    expect(accionesDeFlujo(3).map((accion) => accion.paso)).toEqual([4, 2, 1]);
    expect(accionesDeFlujo(4).map((accion) => accion.paso)).toEqual([5]);
  });

  it('cierra el flujo en el paso 5 sin acciones', () => {
    expect(accionesDeFlujo(5)).toEqual([]);
  });

  it('no ofrece acciones para pasos fuera del flujo', () => {
    expect(accionesDeFlujo(0)).toEqual([]);
    expect(accionesDeFlujo(6)).toEqual([]);
    expect(accionesDeFlujo(99)).toEqual([]);
  });

  it('coloca la aprobación definitiva en el paso 3', () => {
    expect(PASO_APROBACION_DEFINITIVA).toBe(3);
    expect(accionesDeFlujo(2)).toContainEqual(
      expect.objectContaining({ paso: PASO_APROBACION_DEFINITIVA }),
    );
  });

  it('acompaña cada acción con etiqueta, detalle y responsable', () => {
    for (const paso of [1, 2, 3, 4]) {
      for (const accion of accionesDeFlujo(paso)) {
        expect(accion.etiqueta.trim()).not.toBe('');
        expect(accion.detalle.trim()).not.toBe('');
        expect(accion.responsable.trim()).not.toBe('');
        expect(accion.paso).not.toBe(paso);
      }
    }
  });

  it('describe la acción de envío a aprobación definitiva', () => {
    expect(accionesDeFlujo(2)[0]).toMatchObject({
      paso: 3,
      etiqueta: 'Enviar a aprobación definitiva',
      responsable: 'Dirección OAIPCS',
    });
  });
});

describe('etapaDeFlujo', () => {
  it('devuelve la etapa declarada para cada paso', () => {
    expect(etapaDeFlujo(1)).toMatchObject({ nombre: 'Elaboración', estado: 'Registrado' });
    expect(etapaDeFlujo(5)).toMatchObject({ nombre: 'Archivo', estado: 'Archivado' });
  });

  it('describe la aprobación definitiva con su responsable', () => {
    expect(etapaDeFlujo(PASO_APROBACION_DEFINITIVA)).toEqual({
      paso: 3,
      nombre: 'Aprobación definitiva',
      estado: 'Aprobado',
      responsable: 'Dirección OAIPCS',
    });
  });

  it('devuelve null para pasos que no existen en el flujo', () => {
    expect(etapaDeFlujo(0)).toBeNull();
    expect(etapaDeFlujo(6)).toBeNull();
  });
});

describe('plantillaWhatsapp', () => {
  const ENCABEZADOS = [
    '🔍 1. SITUACIÓN ACTUAL',
    '🏗️ 2. HECHOS RECIENTES Y ACCIONES EN CURSO',
    '👥 3. ACTORES CLAVE',
    '📌 4. DEMANDAS INMEDIATAS',
    '⚠️ RIESGOS',
    '🧭 ACCIONES SUGERIDAS',
  ];

  function alertaBase(cambios: Partial<Alerta> = {}): Alerta {
    return {
      id: 'alerta-1',
      codigo: 'AL-2026-001',
      titulo: '🔔 REPORTE DE ALERTA TEMPRANA | Protesta en Puno',
      casoId: 'caso-1',
      casoCodigo: 'CA-2026-001',
      casoTitulo: 'Protesta en Puno',
      riesgo: 'Alto',
      alcance: 'Región',
      region: 'Puno',
      provincia: 'Puno',
      prioridad: null,
      plazoHoras: null,
      grave: false,
      nivel: 'Inmediato',
      nivelCodigo: '1',
      pasoActual: 1,
      estadoLegado: null,
      visibilidad: 'Interna',
      fechaReporte: '2026-11-05',
      fechaValidacion: null,
      fechaAprobacion: null,
      aprobadaPor: null,
      validadaPor: null,
      ultimoRevisor: null,
      ultimaModificacion: '2026-11-05T09:00:00.000Z',
      modificadoPor: null,
      historial: [],
      descripcionRiesgo: null,
      hechosRecientes: null,
      situacionActual: null,
      accionesOaipcs: null,
      riesgos: [],
      accionesSugeridas: [],
      actoresClave: [],
      demandasInmediatas: [],
      plantillaWhatsapp: null,
      fuenteTipo: null,
      fuenteDescripcion: null,
      fuenteUrl: null,
      distritoId: null,
      distrito: null,
      distritoRuta: null,
      casoDistritoId: null,
      casoDistrito: null,
      casoDistritoRuta: null,
      distritoCoincideConCaso: null,
      subsector: null,
      origen: null,
      confianza: null,
      validado: false,
      clasificacion: 1,
      estado: 'Registrada',
      atendida: false,
      anuladoEn: null,
      motivoAnulacion: null,
      anuladoPor: null,
      anuladoPorNombre: null,
      anulacionId: null,
      archivadoEn: null,
      motivoArchivo: null,
      archivadoPor: null,
      archivadoPorNombre: null,
      ...cambios,
    };
  }

  it('empieza con el encabezado del reporte y el título limpio', () => {
    const mensaje = plantillaWhatsapp(alertaBase());
    expect(mensaje.startsWith('*🔔 REPORTE DE ALERTA TEMPRANA | ')).toBe(true);
    expect(mensaje.split('\n')[0]).toBe('*🔔 REPORTE DE ALERTA TEMPRANA | Protesta en Puno*');
  });

  it('rotula fecha y ámbito en cursiva con el nivel territorial', () => {
    const mensaje = plantillaWhatsapp(alertaBase());
    expect(mensaje).toContain('📅 _*Fecha de emisión*: 05NOV2026_');
    expect(mensaje).toContain('🌍 _*Ámbito*: Regional · Puno_');
  });

  it('mantiene las seis secciones aunque una alerta vacía no tenga contenido', () => {
    const mensaje = plantillaWhatsapp(alertaBase());
    for (const encabezado of ENCABEZADOS) {
      expect(mensaje).toContain(`*${encabezado}*`);
    }
  });

  it('emite la fecha en formato G1', () => {
    const mensaje = plantillaWhatsapp(alertaBase({ fechaReporte: '2026-11-05' }));
    expect(mensaje).toContain('📅 _*Fecha de emisión*: 05NOV2026_');
  });

  it('no usa encabezados obsoletos', () => {
    const mensaje = plantillaWhatsapp(alertaBase());
    expect(mensaje).not.toContain('🚨');
    expect(mensaje).not.toContain('🗓️');
    expect(mensaje).not.toContain('📌 1.');
    expect(mensaje).not.toContain('⚠️ 5. DESCRIPCIÓN DEL RIESGO');
  });

  it('coloca los riesgos dentro de la sección RIESGOS', () => {
    const mensaje = plantillaWhatsapp(
      alertaBase({
        descripcionRiesgo: 'La conflictividad puede escalar.',
        riesgos: ['Incremento de conflictividad', 'Bloqueo de vías'],
      }),
    );
    const seccion = mensaje.split('*⚠️ RIESGOS*')[1] ?? '';
    expect(seccion).toContain('La conflictividad puede escalar.');
    expect(seccion).toContain('- Incremento de conflictividad');
    expect(seccion).toContain('- Bloqueo de vías');
  });

  it('abre las acciones sugeridas con la fórmula institucional', () => {
    const mensaje = plantillaWhatsapp(
      alertaBase({ accionesSugeridas: ['Reunión con dirigentes'] }),
    );
    const seccion = mensaje.split('*🧭 ACCIONES SUGERIDAS*')[1] ?? '';
    expect(seccion).toContain('De considerarlo pertinente, se sugiere:');
    expect(seccion).toContain('- Reunión con dirigentes');
  });
});

describe('claseEstado', () => {
  it.each([
    ['Aprobada', 'state-approved'],
    ['Atendida', 'state-dismissed'],
    ['Registrado', 'state-pending'],
    ['Validado', 'state-pending'],
    ['Remitido', 'state-pending'],
    ['Archivado', 'state-pending'],
    ['', 'state-pending'],
  ] as const)('%s usa la clase %s', (estado: string, clase: string) => {
    expect(claseEstado(estado)).toBe(clase);
  });
});
