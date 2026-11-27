import { describe, expect, it } from 'vitest';

import {
  PASO_APROBACION_DEFINITIVA,
  aAlerta,
  accionesDeFlujo,
  actorSinTelefono,
  aristaPermitida,
  claseEstado,
  etapaDeFlujo,
  hechosComoLineas,
  partirHecho,
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

describe('aristaPermitida', () => {
  it('deja subir al sectorista de elaboración a validación previa', () => {
    expect(aristaPermitida(['sectorista'], 1, 2)).toBe(true);
  });

  it('deja aprobar a la Dirección sólo desde validación previa', () => {
    expect(aristaPermitida(['direccion_oaipcs'], 2, 3)).toBe(true);
    expect(aristaPermitida(['alta_direccion'], 2, 3)).toBe(true);
    expect(aristaPermitida(['direccion_oaipcs'], 1, 3)).toBe(false);
  });

  it('deja devolver a validación previa a la Dirección desde la aprobación', () => {
    expect(aristaPermitida(['direccion_oaipcs'], 3, 2)).toBe(true);
    expect(aristaPermitida(['direccion_oaipcs'], 5, 2)).toBe(false);
  });

  it('deja devolver a elaboración al sectorista desde validación previa', () => {
    expect(aristaPermitida(['sectorista'], 2, 1)).toBe(true);
    expect(aristaPermitida(['sectorista'], 3, 1)).toBe(false);
  });

  it('deja devolver a elaboración a la Dirección desde la aprobación', () => {
    expect(aristaPermitida(['direccion_oaipcs'], 3, 1)).toBe(true);
    expect(aristaPermitida(['alta_direccion'], 2, 1)).toBe(false);
  });

  it('no deja al sectorista cruzar aristas de dirección ni de remisión', () => {
    expect(aristaPermitida(['sectorista'], 2, 3)).toBe(false);
    expect(aristaPermitida(['sectorista'], 3, 4)).toBe(false);
    expect(aristaPermitida(['sectorista'], 3, 2)).toBe(false);
  });

  it('deja remitir al servicio de agente desde la aprobación', () => {
    expect(aristaPermitida(['servicio_agente'], 3, 4)).toBe(true);
    expect(aristaPermitida(['servicio_agente'], 1, 2)).toBe(false);
  });

  it('no deja remitir a la Dirección, que sólo ordena la remisión al servicio', () => {
    expect(aristaPermitida(['direccion_oaipcs'], 3, 4)).toBe(false);
  });

  it('deja archivar al sectorista y cierra el paso 5', () => {
    expect(aristaPermitida(['sectorista'], 4, 5)).toBe(true);
    expect(aristaPermitida(['sectorista'], 5, 2)).toBe(false);
    expect(aristaPermitida(['direccion_oaipcs'], 5, 4)).toBe(false);
  });

  it('deja pasar al administrador por cualquier arista', () => {
    expect(aristaPermitida(['administrador'], 1, 3)).toBe(true);
    expect(aristaPermitida(['administrador'], 5, 1)).toBe(true);
  });

  it('trata el paso sin cambio como no transición', () => {
    expect(aristaPermitida(['sectorista'], 2, 2)).toBe(false);
    expect(aristaPermitida(['administrador'], 3, 3)).toBe(false);
  });

  it('no bloquea pasos no numéricos', () => {
    expect(aristaPermitida(['sectorista'], Number.NaN, 3)).toBe(true);
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

  it('omite la sección del caso cuando no se pasan sus datos', () => {
    expect(plantillaWhatsapp(alertaBase())).not.toContain('📎 Caso vinculado');
    expect(plantillaWhatsapp(alertaBase(), null)).not.toContain('📎 Caso vinculado');
  });

  it('anexa nombre, resumen, actores y demandas del caso vinculado', () => {
    const mensaje = plantillaWhatsapp(alertaBase(), {
      codigo: 'CA-2026-001',
      titulo: 'Protesta en Puno',
      resumen: 'Conflicto por el transporte urbano.',
      actores: ['Federación de transportistas', 'Municipalidad de Puno'],
      demandas: ['Derogar la ordenanza municipal'],
    });

    expect(mensaje).toContain('*📎 Caso vinculado*');
    expect(mensaje).toContain('CA-2026-001 · Protesta en Puno');
    expect(mensaje).toContain('Conflicto por el transporte urbano.');
    expect(mensaje).toContain(
      'Actores principales:\n- Federación de transportistas\n- Municipalidad de Puno',
    );
    expect(mensaje).toContain('Demandas:\n- Derogar la ordenanza municipal');
  });

  it('coloca la sección del caso después de las acciones sugeridas', () => {
    const mensaje = plantillaWhatsapp(alertaBase(), { codigo: 'CA-2026-001' });
    expect(mensaje.indexOf('*📎 Caso vinculado*')).toBeGreaterThan(
      mensaje.indexOf('*🧭 ACCIONES SUGERIDAS*'),
    );
  });

  it('no añade la sección del caso si viene sin ningún dato útil', () => {
    const mensaje = plantillaWhatsapp(alertaBase(), {
      codigo: '   ',
      titulo: null,
      resumen: '',
      actores: [],
      demandas: [],
    });
    expect(mensaje).not.toContain('📎 Caso vinculado');
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

describe('actorSinTelefono', () => {
  it('quita el sufijo «· Tel. …» del final', () => {
    expect(actorSinTelefono('Juan Pérez – FENACO, Presidente · Tel. 987654321')).toBe(
      'Juan Pérez – FENACO, Presidente',
    );
  });

  it('deja la línea intacta cuando no hay teléfono', () => {
    expect(actorSinTelefono('Juan Pérez – FENACO')).toBe('Juan Pérez – FENACO');
  });

  it('no arrastra el teléfono al mensaje de WhatsApp', () => {
    const mensaje = plantillaWhatsapp(
      aAlerta({
        codigo: 'AT-2026-01',
        actoresClave: ['Juan Pérez – FENACO · Tel. 987654321'],
      }),
    );
    expect(mensaje).toContain('- Juan Pérez – FENACO');
    expect(mensaje).not.toContain('987654321');
  });
});

describe('partirHecho', () => {
  it('separa la fecha numérica con puntos y el texto', () => {
    expect(partirHecho('12.06.2026 Se reunieron los gremios')).toEqual({
      fecha: '2026-06-12',
      texto: 'Se reunieron los gremios',
    });
  });

  it('acepta barras y descarta el separador con dos puntos', () => {
    expect(partirHecho('24.01.2026: Se emitió el informe')).toEqual({
      fecha: '2026-01-24',
      texto: 'Se emitió el informe',
    });
    expect(partirHecho('24/01/2026 Informe emitido')).toEqual({
      fecha: '2026-01-24',
      texto: 'Informe emitido',
    });
  });

  it('reconoce el mes en letras, incluida la abreviatura local SET', () => {
    expect(partirHecho('08.SET.2025 Paro de 24 horas').fecha).toBe('2025-09-08');
    expect(partirHecho('08.SEP.2025 Paro de 24 horas').fecha).toBe('2025-09-08');
  });

  it('reconoce el formato compacto que recompone la API', () => {
    // Es el texto derivado de `core.alerta_hechos`; si no se reparsea, al editar
    // la fecha quedaría pegada a la descripción.
    expect(partirHecho('05NOV2026 — Se reunieron los gremios')).toEqual({
      fecha: '2026-11-05',
      texto: 'Se reunieron los gremios',
    });
    expect(partirHecho('04SET2025: Paro de 24 horas').fecha).toBe('2025-09-04');
  });

  it('no fuerza una fecha compacta imposible', () => {
    expect(partirHecho('31FEB2026 Reunión')).toEqual({
      fecha: null,
      texto: '31FEB2026 Reunión',
    });
  });

  it('conserva el texto completo en un rango de fechas', () => {
    // La segunda fecha aporta contexto; limpiarla perdería información.
    const hecho = partirHecho('28.04.2026–30.04.2026 Bloqueo del muelle');
    expect(hecho.fecha).toBe('2026-04-28');
    expect(hecho.texto).toBe('28.04.2026–30.04.2026 Bloqueo del muelle');
  });

  it('deduce el año de «dd.mm» con la fecha de reporte', () => {
    expect(partirHecho('09.02 - Operativo en la caleta', '2026-02-10').fecha).toBe('2026-02-09');
  });

  it('retrocede un año si el hecho cae después del reporte', () => {
    expect(partirHecho('15.12 - Reunión gremial', '2025-01-20').fecha).toBe('2024-12-15');
  });

  it('no inventa el año de «dd.mm» sin fecha de reporte', () => {
    expect(partirHecho('09.02 - Operativo en la caleta')).toEqual({
      fecha: null,
      texto: '09.02 - Operativo en la caleta',
    });
  });

  it('deja intacta una fecha imposible', () => {
    expect(partirHecho('31.02.2026 Reunión')).toEqual({
      fecha: null,
      texto: '31.02.2026 Reunión',
    });
  });

  it('deja intacto el texto libre', () => {
    expect(partirHecho('Se convocó a una reunión')).toEqual({
      fecha: null,
      texto: 'Se convocó a una reunión',
    });
  });
});

describe('hechosComoLineas', () => {
  it('parte por saltos de línea y descarta vacíos', () => {
    const lineas = hechosComoLineas('12.06.2026 Uno\n\n13.06.2026 Dos\n   ');
    expect(lineas).toEqual([
      { fecha: '2026-06-12', texto: 'Uno' },
      { fecha: '2026-06-13', texto: 'Dos' },
    ]);
  });

  it('quita las viñetas «- », «* » y «• » del relato heredado', () => {
    const lineas = hechosComoLineas('- 12.06.2026 Uno\n* 13.06.2026 Dos\n• Tres');
    expect(lineas.map((linea) => linea.texto)).toEqual(['Uno', 'Dos', 'Tres']);
    expect(lineas[2].fecha).toBeNull();
  });

  it('parte el texto derivado con fechas compactas', () => {
    const lineas = hechosComoLineas('- 05NOV2026 — Se reunieron los gremios\n- Sin fecha todavía');
    expect(lineas).toEqual([
      { fecha: '2026-11-05', texto: 'Se reunieron los gremios' },
      { fecha: null, texto: 'Sin fecha todavía' },
    ]);
  });

  it('devuelve una lista vacía cuando no hay texto', () => {
    expect(hechosComoLineas(null)).toEqual([]);
    expect(hechosComoLineas('   ')).toEqual([]);
  });

  it('pasa la fecha de reporte a cada línea', () => {
    const lineas = hechosComoLineas('09.02 - Operativo\n10.02 - Reunión', '2026-02-10');
    expect(lineas.map((linea) => linea.fecha)).toEqual(['2026-02-09', '2026-02-10']);
  });
});
