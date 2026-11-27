import { describe, expect, it } from 'vitest';

import {
  aCatalogosEdicion,
  aDetalleCasoConCierre,
  accionDeEstado,
  CAMPOS_EDITABLES,
  construirCuerpoPatch,
  cuerpoPatchDeCampo,
  esFechaValida,
  estaArchivado,
  etiquetaDeCatalogo,
  etiquetaEstado,
  opcionesDeCampo,
  resolverValorCatalogo,
  sinCambios,
  VALORES_VACIOS,
  validarValorCampo,
  valoresDeCaso,
  type OpcionCatalogo,
  type ValoresEditables,
} from './caso-edicion.mapeo';

function valores(cambios: Partial<ValoresEditables>): ValoresEditables {
  return { ...VALORES_VACIOS, ...cambios };
}

/** Base completa y realista para detectar cambios sin ruido. */
const BASE = valores({
  titulo: 'Bloqueo de la Panamericana Norte',
  resumenEjecutivo: 'Los pescadores denuncian extracción en su área de reserva.',
  prioridad: 'Urgente',
  riesgo: 'Bajo',
  nivelConflicto: 'Conflicto social',
  tematica: 'Gobernanza',
  naturaleza: 'Territorial',
  subsector: 'Pesca y Acuicultura',
  unidadResponsable: 'OAIPCS',
  ciclo: 'Prevención operativa',
  pctAvance: '50',
  fechaInicio: '2024-10-15',
  fechaCierre: '',
});

describe('construirCuerpoPatch', () => {
  it('devuelve un cuerpo vacío cuando nada cambió', () => {
    const cuerpo = construirCuerpoPatch(BASE, { ...BASE });

    expect(cuerpo).toEqual({});
    expect(sinCambios(cuerpo)).toBe(true);
  });

  it('sólo incluye los campos modificados y respeta las claves del PATCH', () => {
    const cuerpo = construirCuerpoPatch(
      BASE,
      valores({
        ...BASE,
        titulo: 'Bloqueo en Cabo Blanco',
        tematica: 'Impactos de terceros',
        pctAvance: '75',
        fechaCierre: '2026-07-31',
      }),
    );

    expect(cuerpo).toEqual({
      titulo: 'Bloqueo en Cabo Blanco',
      tematica: 'Impactos de terceros',
      pctAvance: 75,
      fechaCierre: '2026-07-31',
    });
  });

  it('limpia con null los catálogos y fechas anulables', () => {
    const cuerpo = construirCuerpoPatch(
      BASE,
      valores({ ...BASE, nivelConflicto: '', tematica: '', fechaInicio: '' }),
    );

    expect(cuerpo).toEqual({
      nivelConflicto: null,
      tematica: null,
      fechaInicio: null,
    });
  });

  it('no confunde 50 con 50.0: el número es el mismo', () => {
    expect(construirCuerpoPatch(BASE, valores({ ...BASE, pctAvance: '50.0' }))).toEqual({});
  });

  it('ignora un valor inválido en lugar de enviarlo', () => {
    expect(construirCuerpoPatch(BASE, valores({ ...BASE, pctAvance: '150' }))).toEqual({});
  });
});

describe('cuerpoPatchDeCampo', () => {
  it('devuelve el cuerpo de un solo campo cuando cambia', () => {
    expect(cuerpoPatchDeCampo('tematica', 'Gobernanza', 'Impactos de terceros')).toEqual({
      tematica: 'Impactos de terceros',
    });
  });

  it('devuelve vacío cuando el valor es el mismo', () => {
    const cuerpo = cuerpoPatchDeCampo('titulo', 'Título actual', '  Título actual  ');

    expect(cuerpo).toEqual({});
    expect(sinCambios(cuerpo)).toBe(true);
  });

  it('permite vaciar un campo anulable', () => {
    expect(cuerpoPatchDeCampo('naturaleza', 'Territorial', '')).toEqual({ naturaleza: null });
  });

  it('convierte el avance a número y conserva decimales', () => {
    expect(cuerpoPatchDeCampo('pctAvance', '50', '42,5')).toEqual({ pctAvance: 42.5 });
  });

  it('no construye cuerpo si el valor no es válido', () => {
    expect(cuerpoPatchDeCampo('pctAvance', '50', '101')).toEqual({});
    expect(cuerpoPatchDeCampo('fechaCierre', '', '2026-02-30')).toEqual({});
  });
});

describe('resolverValorCatalogo', () => {
  const opciones: OpcionCatalogo[] = [
    { valor: 'Conflicto social', etiqueta: 'Conflicto social' },
    { valor: 'Prevencion_operativa', etiqueta: 'Prevención operativa' },
    { valor: 'OAIPCS', etiqueta: 'Oficina de Análisis de Políticas y Conflictos Sociales' },
  ];

  it('resuelve por valor canónico', () => {
    expect(resolverValorCatalogo(opciones, 'Conflicto social')).toBe('Conflicto social');
  });

  it('resuelve por etiqueta visible', () => {
    expect(
      resolverValorCatalogo(opciones, 'Oficina de Análisis de Políticas y Conflictos Sociales'),
    ).toBe('OAIPCS');
  });

  it('ignora tildes, mayúsculas y guiones bajos', () => {
    expect(resolverValorCatalogo(opciones, 'PREVENCION OPERATIVA')).toBe('Prevencion_operativa');
    expect(resolverValorCatalogo(opciones, 'conflicto social')).toBe('Conflicto social');
  });

  it('devuelve null cuando el valor no existe o está vacío', () => {
    expect(resolverValorCatalogo(opciones, 'Inexistente')).toBeNull();
    expect(resolverValorCatalogo(opciones, '   ')).toBeNull();
  });

  it('encuentra la etiqueta visible para un valor', () => {
    expect(etiquetaDeCatalogo(opciones, 'OAIPCS')).toBe(
      'Oficina de Análisis de Políticas y Conflictos Sociales',
    );
  });
});

describe('validarValorCampo', () => {
  it('acepta el avance entre 0 y 100 y lo devuelve como número', () => {
    expect(validarValorCampo('pctAvance', '0')).toEqual({ valido: true, valor: 0 });
    expect(validarValorCampo('pctAvance', '100')).toEqual({ valido: true, valor: 100 });
    expect(validarValorCampo('pctAvance', '42,5')).toEqual({ valido: true, valor: 42.5 });
  });

  it('rechaza números fuera de rango o no numéricos', () => {
    expect(validarValorCampo('pctAvance', '101').valido).toBe(false);
    expect(validarValorCampo('pctAvance', '-1').valido).toBe(false);
    expect(validarValorCampo('pctAvance', 'cincuenta').valido).toBe(false);
  });

  it('acepta un avance vacío como «sin dato»', () => {
    expect(validarValorCampo('pctAvance', '')).toEqual({ valido: true, valor: null });
  });

  it('acepta fechas reales y rechaza imposibles o de otro formato', () => {
    expect(esFechaValida('2026-01-05')).toBe(true);
    expect(esFechaValida('2026-02-30')).toBe(false);
    expect(validarValorCampo('fechaInicio', '2026-01-05')).toEqual({
      valido: true,
      valor: '2026-01-05',
    });
    expect(validarValorCampo('fechaInicio', '05/01/2026').valido).toBe(false);
    expect(validarValorCampo('fechaCierre', '').valido).toBe(true);
  });

  it('exige los campos obligatorios y respeta la longitud máxima', () => {
    expect(validarValorCampo('titulo', '').valido).toBe(false);
    expect(validarValorCampo('titulo', 'x'.repeat(256)).valido).toBe(false);
    expect(validarValorCampo('titulo', 'Caso válido')).toEqual({
      valido: true,
      valor: 'Caso válido',
    });
  });
});

describe('etiquetas de estado y archivo', () => {
  it('canoniza el estado aunque llegue con otra caja o tildes', () => {
    expect(etiquetaEstado('archivado')).toBe('Archivado');
    expect(etiquetaEstado('RESUELTO')).toBe('Resuelto');
    expect(etiquetaEstado('activo')).toBe('Abierto');
    expect(etiquetaEstado(null)).toBe('Abierto');
  });

  it('reconoce el estado Archivado', () => {
    expect(estaArchivado('Archivado')).toBe(true);
    expect(estaArchivado('archivado')).toBe(true);
    expect(estaArchivado('Abierto')).toBe(false);
  });

  it('ofrece Archivar caso y Reabrir caso con sus destinos', () => {
    expect(accionDeEstado('Abierto')).toMatchObject({
      modo: 'archivar',
      etiqueta: 'Archivar caso',
      destino: 'Archivado',
    });
    expect(accionDeEstado('Archivado')).toMatchObject({
      modo: 'reabrir',
      etiqueta: 'Reabrir caso',
      destino: 'Abierto',
    });
  });

  it('declara que archivar no es anular en la ayuda de la acción', () => {
    expect(accionDeEstado('Abierto').ayuda).toContain('archivo');
  });
});

describe('aCatalogosEdicion', () => {
  const bruto = {
    catalogs: {
      prioridadesAtencion: [{ codigo: 'Urgente', etiqueta: 'Urgente' }],
      nivelesRiesgo: [{ codigo: 'Bajo', etiqueta: 'Bajo' }],
      nivelesConflicto: [{ codigo: 'Conflicto social', etiqueta: 'Conflicto social' }],
      tematicas: [{ codigo: 'Gobernanza', etiqueta: 'Gobernanza' }],
      naturalezasCaso: [{ codigo: 'Territorial', etiqueta: 'Territorial' }],
      subsectores: [{ codigo: 'Pesca y Acuicultura', etiqueta: 'Pesca y Acuicultura' }],
      unidades: [{ codigo: 'OAIPCS', etiqueta: 'Oficina de Análisis' }],
      ciclos: [{ codigo: 'Prevención operativa', etiqueta: 'Prevención operativa' }],
      estadosCaso: [{ codigo: 'Archivado', etiqueta: 'Archivado' }],
    },
  };

  it('extrae las opciones de cada desplegable', () => {
    const catalogos = aCatalogosEdicion(bruto);

    expect(opcionesDeCampo(catalogos, 'unidadResponsable')).toEqual([
      { valor: 'OAIPCS', etiqueta: 'Oficina de Análisis' },
    ]);
    expect(catalogos.estado).toEqual([{ valor: 'Archivado', etiqueta: 'Archivado' }]);
    expect(opcionesDeCampo(catalogos, 'titulo')).toEqual([]);
    expect(opcionesDeCampo(null, 'riesgo')).toEqual([]);
  });

  it('tolera una respuesta vacía', () => {
    const catalogos = aCatalogosEdicion({});

    expect(opcionesDeCampo(catalogos, 'riesgo')).toEqual([]);
  });

  /**
   * El selector de punto focal se identifica por UUID, no por `codigo`, así que
   * tiene su propia forma. Sin esta lista el campo Sectorista se pinta en sólo
   * lectura: el usuario ve el nombre pero no puede cambiarlo.
   */
  it('conserva los sectoristas con su UUID y descarta filas incompletas', () => {
    const catalogos = aCatalogosEdicion({
      catalogs: {
        sectoristas: [
          { id: '00000000-0000-0000-0000-000000000010', nombre: 'Peggy Contreras Montes' },
          { id: '', nombre: 'Sin identificador' },
          { nombre: 'Sin identificador' },
          null,
        ],
      },
    });

    expect(catalogos.sectoristas).toEqual([
      { id: '00000000-0000-0000-0000-000000000010', nombre: 'Peggy Contreras Montes' },
    ]);
    expect(aCatalogosEdicion(bruto).sectoristas).toEqual([]);
  });
});

describe('valores y detalle', () => {
  it('puebla los recuadros desde el caso, incluido el cierre', () => {
    const valoresCaso = valoresDeCaso({
      titulo: 'Caso',
      resumen: null,
      prioridad: 'Urgente',
      riesgo: 'Bajo',
      nivelConflicto: null,
      tematica: null,
      naturaleza: null,
      subsector: null,
      unidadResponsable: null,
      etapa: 'Prevención operativa',
      avance: 68,
      inicio: '2024-10-15',
      cierre: '2026-07-31',
    });

    expect(valoresCaso).toMatchObject({
      titulo: 'Caso',
      resumenEjecutivo: '',
      ciclo: 'Prevención operativa',
      pctAvance: '68',
      fechaInicio: '2024-10-15',
      fechaCierre: '2026-07-31',
      nivelConflicto: '',
    });
  });

  it('lee la fecha de cierre del detalle que el mapeo genérico descarta', () => {
    const detalle = aDetalleCasoConCierre({
      caso: { codigo: 'CS-PA-OAT-2024-02', titulo: 'Caso', fechaCierre: '2026-07-31' },
      actores: [],
    });

    expect(detalle.caso.cierre).toBe('2026-07-31');
    expect(detalle.caso.titulo).toBe('Caso');
  });

  it('deja el cierre en null cuando el detalle no lo trae', () => {
    const detalle = aDetalleCasoConCierre({ caso: { titulo: 'Caso' }, actores: [] });

    expect(detalle.caso.cierre).toBeNull();
  });

  it('no incluye el estado entre los campos editables', () => {
    expect(CAMPOS_EDITABLES.map((definicion) => definicion.campo)).not.toContain('estado');
  });
});
