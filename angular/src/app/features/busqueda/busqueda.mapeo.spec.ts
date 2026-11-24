import { describe, expect, it } from 'vitest';

import {
  GRUPOS,
  aEnlace,
  aIndiceBusqueda,
  aResultado,
  enriquecer,
  type ClaveGrupo,
  type Resultado,
} from './busqueda.mapeo';

function grupo(clave: ClaveGrupo) {
  const definicion = GRUPOS.find((opcion) => opcion.clave === clave);
  if (!definicion) throw new Error(`Grupo no declarado: ${clave}`);
  return definicion;
}

function resultado(parcial: Partial<Resultado> = {}): Resultado {
  return {
    clave: 'case:1',
    id: '1',
    tipo: 'case',
    etiquetaTipo: 'Caso',
    titulo: 'Caso de prueba',
    subtitulo: null,
    codigo: null,
    region: null,
    icono: 'casos',
    ...parcial,
  };
}

describe('aResultado', () => {
  it('normaliza los campos de una fila de casos', () => {
    const fila = aResultado(grupo('casos'), {
      id: 'caso-1',
      code: 'CS-PA-INF-2026-01',
      title: 'Protesta en Piura',
      estado: 'Abierto',
      region: 'Piura',
    });

    expect(fila).toEqual({
      clave: 'case:caso-1',
      id: 'caso-1',
      tipo: 'case',
      etiquetaTipo: 'Caso',
      titulo: 'Protesta en Piura',
      subtitulo: 'Abierto',
      codigo: 'CS-PA-INF-2026-01',
      region: 'Piura',
      icono: 'casos',
    });
  });

  it('usa «Sin título» y deja región nula cuando faltan los datos', () => {
    const fila = aResultado(grupo('casos'), { id: 'caso-2' });

    expect(fila.titulo).toBe('Sin título');
    expect(fila.codigo).toBeNull();
    expect(fila.region).toBeNull();
    expect(fila.subtitulo).toBeNull();
  });

  it('compone la clave con el código y, si tampoco hay, con el título', () => {
    expect(aResultado(grupo('casos'), { id: 'caso-3', code: 'CS-3' }).clave).toBe('case:caso-3');

    const sinId = aResultado(grupo('casos'), { code: 'CS-4' });
    expect(sinId.clave).toBe('case:CS-4');

    const soloTitulo = aResultado(grupo('casos'), { title: 'Solo título' });
    expect(soloTitulo.clave).toBe('case:Solo título');
  });

  it('tolera una fila que no es un registro', () => {
    const fila = aResultado(grupo('alertas'), null);

    expect(fila).toMatchObject({
      clave: 'alert:Sin título',
      id: '',
      tipo: 'alert',
      etiquetaTipo: 'Alerta temprana',
      titulo: 'Sin título',
      codigo: null,
      region: null,
    });
  });

  it('lee el título de la demanda en descripción y recurre al problema si falta', () => {
    const definicion = grupo('demandas');

    expect(
      aResultado(definicion, { id: 'd-1', descripcion: 'Descripción', problema: 'Problema' })
        .titulo,
    ).toBe('Descripción');
    expect(aResultado(definicion, { id: 'd-2', problema: 'Problema' }).titulo).toBe('Problema');
  });
});

describe('aIndiceBusqueda', () => {
  it('indexa por `tipo:id` y normaliza el tipo a minúsculas', () => {
    const indice = aIndiceBusqueda({
      results: [
        { type: 'CASE', id: '1', code: 'CS-1', region: 'Piura' },
        { type: 'demanda', id: '9', region: 'Lima' },
      ],
    });

    expect([...indice.keys()]).toEqual(['case:1', 'demanda:9']);
    expect(indice.get('case:1')).toEqual({ codigo: 'CS-1', region: 'Piura' });
    expect(indice.get('demanda:9')).toEqual({ codigo: null, region: 'Lima' });
  });

  it('ignora filas sin tipo, sin id o que no son registros', () => {
    const indice = aIndiceBusqueda({
      results: [
        { id: '1', code: 'SIN-TIPO' },
        { type: 'case' },
        { type: 'case', id: '   ' },
        null,
        'texto',
        ['case', '2'],
        { type: 'case', id: '2', code: 'OK' },
      ],
    });

    expect([...indice.keys()]).toEqual(['case:2']);
  });

  it('devuelve un índice vacío cuando la respuesta no trae una lista de resultados', () => {
    expect(aIndiceBusqueda({}).size).toBe(0);
    expect(aIndiceBusqueda(null).size).toBe(0);
    expect(aIndiceBusqueda({ results: 'no-es-lista' }).size).toBe(0);
  });
});

describe('enriquecer', () => {
  const indice = aIndiceBusqueda({
    results: [{ type: 'case', id: '1', code: 'CS-1', region: 'Piura' }],
  });

  it('completa código y región desde el índice', () => {
    const enriquecido = enriquecer(resultado(), indice);

    expect(enriquecido).toMatchObject({ codigo: 'CS-1', region: 'Piura' });
  });

  it('no inventa región ni código si el índice no cubre la fila', () => {
    const base = resultado();

    expect(enriquecer(base, aIndiceBusqueda({ results: [] }))).toBe(base);
    expect(base.codigo).toBeNull();
    expect(base.region).toBeNull();
  });

  it('respeta el código presente y sólo completa la región', () => {
    const enriquecido = enriquecer(resultado({ codigo: 'CS-PROPIO' }), indice);

    expect(enriquecido.codigo).toBe('CS-PROPIO');
    expect(enriquecido.region).toBe('Piura');
  });

  it('devuelve la misma instancia si no hay nada que completar', () => {
    const base = resultado({ codigo: 'CS-1', region: 'Piura' });

    expect(enriquecer(base, indice)).toBe(base);
  });
});

describe('aEnlace', () => {
  it('abre la ficha del caso cuando hay código', () => {
    const enlace = aEnlace(
      grupo('casos'),
      resultado({ codigo: 'CS-PA-INF-2026-01' }),
      'protesta',
    );

    expect(enlace.ruta).toEqual(['/casos', 'CS-PA-INF-2026-01']);
    expect(enlace.parametros).toEqual({});
    expect(enlace.abreFicha).toBe(true);
  });

  it('manda alerta, compromiso y documento a su listado filtrado por el código', () => {
    const casos: [ClaveGrupo, string, string][] = [
      ['alertas', 'AL-1', '/alertas'],
      ['compromisos', 'CM-1', '/compromisos'],
      ['documentos', 'DOC-1', '/documentos'],
    ];

    for (const [clave, codigo, listado] of casos) {
      const definicion = grupo(clave);
      const enlace = aEnlace(
        definicion,
        resultado({ tipo: definicion.tipo, codigo, titulo: 'Registro' }),
        'término',
      );

      expect(enlace.ruta).toEqual([listado]);
      expect(enlace.parametros).toEqual({ q: codigo });
      expect(enlace.abreFicha).toBe(false);
    }
  });

  it('envía al directorio de actores con el título como término', () => {
    const enlace = aEnlace(
      grupo('actores'),
      resultado({ tipo: 'actor', codigo: 'AC-1', titulo: 'Rosa Quispe' }),
      'rosa',
    );

    expect(enlace.ruta).toEqual(['/directorio', 'actores']);
    expect(enlace.parametros).toEqual({ q: 'Rosa Quispe' });
    expect(enlace.abreFicha).toBe(false);
  });

  it('reenvía el término a demandas sin caso', () => {
    const enlace = aEnlace(
      grupo('demandas'),
      resultado({ tipo: 'demanda', titulo: 'Demanda sin código' }),
      'término buscado',
    );

    expect(enlace.ruta).toEqual(['/casos', 'sin-caso']);
    expect(enlace.parametros).toEqual({ q: 'término buscado' });
    expect(enlace.abreFicha).toBe(false);
  });

  it('manda al listado de casos con el término si el caso no tiene código', () => {
    const enlace = aEnlace(grupo('casos'), resultado(), 'protesta');

    expect(enlace.ruta).toEqual(['/casos']);
    expect(enlace.parametros).toEqual({ q: 'protesta' });
    expect(enlace.abreFicha).toBe(false);
  });
});
