import { Injector, runInInjectionContext, signal } from '@angular/core';
import { describe, expect, it } from 'vitest';

import { SesionStore } from '../auth/sesion.store';
import { CapacidadesService, ROL } from './capacidades.service';

/** Instancia el servicio con un doble mínimo de la sesión, sin TestBed. */
function servicioCon(...roles: string[]): CapacidadesService {
  const injector = Injector.create({
    providers: [{ provide: SesionStore, useValue: { roles: signal(roles) } }],
  });

  return runInInjectionContext(injector, () => new CapacidadesService());
}

describe('puedeEditar', () => {
  it.each([
    ROL.administrador,
    ROL.direccionOaipcs,
    ROL.sectorista,
    ROL.servicioAgente,
    ROL.analistaCualitativo,
    ROL.curadorPolitica,
  ])('habilita la escritura para %s', (rol) => {
    expect(servicioCon(rol).puedeEditar()).toBe(true);
  });

  it.each([ROL.consultaLectura, ROL.altaDireccion, ROL.auditor, ROL.externoPublico])(
    'niega la escritura a %s',
    (rol) => {
      expect(servicioCon(rol).puedeEditar()).toBe(false);
    },
  );

  it('niega la escritura sin roles o con un rol desconocido', () => {
    expect(servicioCon().puedeEditar()).toBe(false);
    expect(servicioCon('rol-inexistente').puedeEditar()).toBe(false);
  });
});

describe('puedeEliminar', () => {
  it.each([ROL.administrador, ROL.sectorista])('habilita la anulación para %s', (rol) => {
    expect(servicioCon(rol).puedeEliminar()).toBe(true);
  });

  it.each([
    ROL.direccionOaipcs,
    ROL.altaDireccion,
    ROL.consultaLectura,
    ROL.servicioAgente,
    ROL.analistaCualitativo,
    ROL.curadorPolitica,
    ROL.auditor,
    ROL.externoPublico,
  ])('niega la anulación a %s', (rol) => {
    expect(servicioCon(rol).puedeEliminar()).toBe(false);
  });

  it('niega la anulación sin roles', () => {
    expect(servicioCon().puedeEliminar()).toBe(false);
  });
});

describe('puedeModificar por clasificación', () => {
  it('deja al administrador modificar cualquier clasificación', () => {
    const servicio = servicioCon(ROL.administrador);

    expect([1, 2, 3, 4].every((clasificacion) => servicio.puedeModificar(clasificacion))).toBe(
      true,
    );
    expect(servicio.puedeModificar(null)).toBe(true);
    expect(servicio.puedeModificar(undefined)).toBe(true);
  });

  it('limita al sectorista a la clasificación máxima de su rol', () => {
    const servicio = servicioCon(ROL.sectorista);

    expect(servicio.puedeModificar(1)).toBe(true);
    expect(servicio.puedeModificar(3)).toBe(true);
    expect(servicio.puedeModificar(4)).toBe(false);
  });

  it('trata la clasificación ausente como reservada (1)', () => {
    const servicio = servicioCon(ROL.curadorPolitica);

    expect(servicio.puedeModificar(null)).toBe(true);
    expect(servicio.puedeModificar(undefined)).toBe(true);
  });

  it('limita al curador de política a clasificación 2', () => {
    const servicio = servicioCon(ROL.curadorPolitica);

    expect(servicio.puedeModificar(1)).toBe(true);
    expect(servicio.puedeModificar(2)).toBe(true);
    expect(servicio.puedeModificar(3)).toBe(false);
  });

  it('niega modificar a quien no tiene escritura aunque su clasificación alcance', () => {
    expect(servicioCon(ROL.consultaLectura).puedeModificar(1)).toBe(false);
    expect(servicioCon(ROL.altaDireccion).puedeModificar(1)).toBe(false);
    expect(servicioCon(ROL.externoPublico).puedeModificar(1)).toBe(false);
  });

  it('acumula los roles: la clasificación máxima más alta prevalece', () => {
    const servicio = servicioCon(ROL.consultaLectura, ROL.curadorPolitica);

    expect(servicio.puedeEditar()).toBe(true);
    expect(servicio.puedeModificar(2)).toBe(true);
    expect(servicio.puedeModificar(3)).toBe(false);
  });

  it('usa clasificación 1 como máximo cuando no hay roles', () => {
    const servicio = servicioCon();

    expect(servicio.maxClasificacion()).toBe(1);
    expect(servicio.puedeModificar(1)).toBe(false);
  });
});
