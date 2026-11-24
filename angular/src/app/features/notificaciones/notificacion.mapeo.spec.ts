import { describe, expect, it } from 'vitest';

import {
  aNotificacion,
  claseLectura,
  enlaceNotificacion,
  esEstadoFiltro,
  estadoDeMarcado,
  etiquetaEstadoFiltro,
  etiquetaLectura,
  formatearFecha,
} from './notificacion.mapeo';

describe('aNotificacion', () => {
  it('mapea el aviso tal como llega del listado, incluido el código del caso', () => {
    const aviso = aNotificacion({
      id: '11111111-1111-1111-1111-111111111111',
      tipo: 'caso_por_vencer',
      entidadTipo: 'caso',
      entidadId: '22222222-2222-2222-2222-222222222222',
      entidadCodigo: 'CS-PA-INF-2026-01',
      venceEn: '2026-12-01',
      estado: 'pendiente',
      createdAt: '2026-11-20T10:00:00.000Z',
    });

    expect(aviso).toMatchObject({
      id: '11111111-1111-1111-1111-111111111111',
      tipo: 'caso_por_vencer',
      titulo: 'Caso por vencer',
      categoria: 'Caso',
      icono: 'casos',
      entidadTipo: 'caso',
      entidadCodigo: 'CS-PA-INF-2026-01',
      estado: 'pendiente',
      leida: false,
    });
    expect(aviso.seccion).toEqual({ ruta: '/casos', etiqueta: 'Casos' });
  });

  it('acepta las grafías en snake_case del sobre', () => {
    const aviso = aNotificacion({
      id: 'n-1',
      tipo: 'alerta_nueva',
      entidad_tipo: 'alerta',
      entidad_id: 'a-1',
      entidad_codigo: null,
      vence_en: null,
      estado: 'leida',
      created_at: '2026-11-21',
    });

    expect(aviso.entidadTipo).toBe('alerta');
    expect(aviso.entidadCodigo).toBeNull();
    expect(aviso.leida).toBe(true);
  });

  it('sólo «leida» cuenta como leída, sin distinguir mayúsculas ni acentos', () => {
    expect(aNotificacion({ estado: 'leida' }).leida).toBe(true);
    expect(aNotificacion({ estado: 'LEÍDA' }).leida).toBe(true);
    expect(aNotificacion({ estado: 'enviada' }).leida).toBe(false);
    expect(aNotificacion({ estado: 'pendiente' }).leida).toBe(false);
    expect(aNotificacion({ estado: null }).leida).toBe(false);
  });

  it('deja «Sistema» cuando el aviso no coincide con una categoría conocida', () => {
    const aviso = aNotificacion({ tipo: 'regla_por_vencer', entidadTipo: 'policy.regla' });
    expect(aviso.categoria).toBe('Sistema');
    expect(aviso.icono).toBe('campana');
    expect(aviso.seccion).toBeNull();
  });
});

describe('lectura', () => {
  it('rotula las no leídas como «Sin leer»', () => {
    expect(etiquetaLectura('pendiente')).toBe('Sin leer');
    expect(etiquetaLectura('enviada')).toBe('Sin leer');
    expect(etiquetaLectura('leida')).toBe('Leída');
  });

  it('usa la clase de estado pendiente para lo no leído', () => {
    expect(claseLectura('pendiente')).toBe('state-pending');
    expect(claseLectura(null)).toBe('state-pending');
    expect(claseLectura('leida')).toBe('state-approved');
  });

  it('traduce el booleano al estado que acepta el PATCH', () => {
    expect(estadoDeMarcado(true)).toBe('leida');
    expect(estadoDeMarcado(false)).toBe('pendiente');
  });
});

describe('enlaceNotificacion', () => {
  it('abre la ficha del caso cuando la API entrega el código', () => {
    const aviso = aNotificacion({
      tipo: 'caso_actualizado',
      entidadTipo: 'caso',
      entidadCodigo: 'CS-PA-INF-2026-01',
    });

    expect(enlaceNotificacion(aviso)).toEqual({
      ruta: '/casos/CS-PA-INF-2026-01',
      etiqueta: 'Caso CS-PA-INF-2026-01',
      concreta: true,
    });
  });

  it('codifica el código en la ruta', () => {
    const aviso = aNotificacion({ tipo: 'caso', entidadTipo: 'casos', entidadCodigo: 'CS 01/2026' });
    expect(enlaceNotificacion(aviso)?.ruta).toBe('/casos/CS%2001%2F2026');
  });

  it('sin código no inventa la ficha: cae en la sección y lo declara', () => {
    const aviso = aNotificacion({ tipo: 'alerta_nueva', entidadTipo: 'alerta' });
    expect(enlaceNotificacion(aviso)).toEqual({
      ruta: '/alertas',
      etiqueta: 'Alertas tempranas',
      concreta: false,
    });
  });

  it('devuelve null cuando el recurso no tiene pantalla propia', () => {
    const aviso = aNotificacion({ tipo: 'regla_por_vencer', entidadTipo: 'policy.regla' });
    expect(enlaceNotificacion(aviso)).toBeNull();
  });
});

describe('filtro por estado', () => {
  it('acepta sólo los estados del CHECK de core.notificaciones', () => {
    expect(esEstadoFiltro('pendiente')).toBe(true);
    expect(esEstadoFiltro('enviada')).toBe(true);
    expect(esEstadoFiltro('leida')).toBe(true);
    expect(esEstadoFiltro('')).toBe(false);
    expect(esEstadoFiltro('Leída')).toBe(false);
    expect(esEstadoFiltro('archivada')).toBe(false);
  });

  it('rotula cada opción del filtro', () => {
    expect(etiquetaEstadoFiltro('pendiente')).toBe('Pendientes');
    expect(etiquetaEstadoFiltro('enviada')).toBe('Enviadas');
    expect(etiquetaEstadoFiltro('leida')).toBe('Leídas');
    expect(etiquetaEstadoFiltro('')).toBe('Todos');
    expect(etiquetaEstadoFiltro('otro')).toBe('Todos');
  });
});

describe('formatearFecha', () => {
  it('presenta las fechas del backend como DD/MM/YYYY', () => {
    expect(formatearFecha('2026-01-05')).toBe('05/01/2026');
    expect(formatearFecha('2026-01-05T00:00:00.000Z')).toBe('05/01/2026');
  });

  it('deja el guion cuando no hay fecha', () => {
    expect(formatearFecha(null)).toBe('—');
    expect(formatearFecha(undefined)).toBe('—');
  });
});
