import { describe, expect, it } from 'vitest';

import type { ActorDirectorio } from './directorio.mapeo';
import { crearCsvPadronAsistencia } from './padron-asistencia';

const actor: ActorDirectorio = {
  id: 'actor-1',
  nombre: '=HYPERLINK("https://example.com")',
  abreviatura: null,
  naturaleza: 'Persona',
  tipo: null,
  funcion: 'Representante',
  posicionamiento: null,
  cargo: null,
  nivelGobierno: null,
  categoria: null,
  region: 'Piura',
  distrito: null,
  organizacionAncla: 'Asociación local',
  validado: false,
  activo: true,
  clasificacion: 2,
  perfil: null,
};

describe('padrón de asistencia', () => {
  it('exporta metadatos y atributos públicos sin datos de contacto', () => {
    const csv = crearCsvPadronAsistencia({
      titulo: 'Mesa técnica',
      lugar: 'Auditorio regional',
      fecha: '2026-11-23',
      actores: [actor],
    });

    expect(csv).toContain('Mesa técnica');
    expect(csv).toContain('Auditorio regional');
    expect(csv).toContain('Representante');
    expect(csv).toContain('Asociación local');
    expect(csv).toContain('Piura');
    expect(csv).toContain("'=HYPERLINK(");
    expect(csv).not.toMatch(/DNI|teléfono|correo/i);
  });

  it('escapa comillas y conserva las firmas en blanco', () => {
    const csv = crearCsvPadronAsistencia({
      titulo: 'Reunión "A"',
      lugar: 'Sala 1',
      fecha: '2026-11-23',
      actores: [actor],
    });

    expect(csv).toContain('"Reunión ""A"""');
    expect(csv).toMatch(/"Piura",""\r?\n?$/m);
  });
});
