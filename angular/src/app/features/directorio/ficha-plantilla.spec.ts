import { describe, expect, it } from 'vitest';

import { parsearFicha, PLANTILLA_FICHA } from './ficha-plantilla';

const SIN_DATOS = {
  artesDePesca: null,
  inscripcionProduce: null,
  vigenciaPoder: null,
  registrosPublicos: null,
  ambito: null,
  cantidadAfiliados: null,
  cantidadOrganizacionesAfiliadas: null,
  capacidadOrdenar: null,
  cargoPublico: null,
  cercaniaProduce: null,
  declaracionesRedes: null,
  edad: null,
  direccion: null,
  enlaceMapa: null,
  accesibilidad: null,
  ventilacion: null,
};

describe('parsearFicha', () => {
  it('interpreta un documento completo con todas las secciones', () => {
    const datos = parsearFicha(`## Organización e inscripción

- Artes de pesca: redes de cerco y anzuelos
- Inscripción en PRODUCE: R-012345
- Vigencia de poder actual: Notaría Lima, partida 12345, vence 31/12/2027
- Registros públicos: partida 11001122, Oficina Lima
- Ámbito de acción: Paita y Sechura
- Cantidad de afiliados: 120
- Cantidad de organizaciones afiliadas: 4
- Capacidad de ordenar: sí, convoca a sus bases

## Perfil político y redes

- Cargo público o político: regidor provincial 2019-2022
- Cercanía a PRODUCE: vínculo declarado con la Dirección Regional
- Declaraciones en redes: publicaciones en Facebook
- Edad: 54 (años)

## Local

- Dirección: Av. Los Andes 123, Paita
- Enlace de mapa: https://maps.app.goo.gl/abc123

## Accesibilidad
- Escaleras en la entrada
- Sin rampa

## Ventilación
- Ventilación natural`);

    expect(datos.artesDePesca).toBe('redes de cerco y anzuelos');
    expect(datos.inscripcionProduce).toBe('R-012345');
    expect(datos.vigenciaPoder).toBe('Notaría Lima, partida 12345, vence 31/12/2027');
    expect(datos.registrosPublicos).toBe('partida 11001122, Oficina Lima');
    expect(datos.ambito).toBe('Paita y Sechura');
    expect(datos.cantidadAfiliados).toBe('120');
    expect(datos.cantidadOrganizacionesAfiliadas).toBe('4');
    expect(datos.capacidadOrdenar).toBe('sí, convoca a sus bases');
    expect(datos.cargoPublico).toBe('regidor provincial 2019-2022');
    expect(datos.cercaniaProduce).toBe('vínculo declarado con la Dirección Regional');
    expect(datos.declaracionesRedes).toBe('publicaciones en Facebook');
    expect(datos.edad).toBe('54 (años)');
    expect(datos.direccion).toBe('Av. Los Andes 123, Paita');
    expect(datos.enlaceMapa).toBe('https://maps.app.goo.gl/abc123');
    expect(datos.accesibilidad).toEqual(['Escaleras en la entrada', 'Sin rampa']);
    expect(datos.ventilacion).toEqual(['Ventilación natural']);
  });

  it('deja en null los campos que no aparecen en el documento', () => {
    const datos = parsearFicha(`## Organización e inscripción

- Artes de pesca: redes
- Cantidad de afiliados: 30

## Local

- Dirección: Calle Real 45`);

    expect(datos.artesDePesca).toBe('redes');
    expect(datos.cantidadAfiliados).toBe('30');
    expect(datos.direccion).toBe('Calle Real 45');
    expect(datos.enlaceMapa).toBeNull();
    expect(datos.cargoPublico).toBeNull();
    expect(datos.edad).toBeNull();
    expect(datos.accesibilidad).toBeNull();
    expect(datos.ventilacion).toBeNull();
  });

  it('devuelve todo null ante texto libre sin formato y no se rompe', () => {
    const texto = `Reunión con los dirigentes el martes: se acordó convocar a una nueva asamblea.
Se mencionó que el local queda en la Calle Real - frente a la plaza.
- se levantó la sesión sin acuerdos`;

    expect(parsearFicha(texto)).toEqual(SIN_DATOS);
  });

  it('conserva valores con dos puntos y guiones', () => {
    const datos = parsearFicha(`- Declaraciones en redes: "No hay diálogo: exigimos mesa" - textual
- Ámbito de acción: Lima - Callao - Ica
- Enlace de mapa: https://www.google.com/maps/search/?api=1&query=Paita`);

    expect(datos.declaracionesRedes).toBe('"No hay diálogo: exigimos mesa" - textual');
    expect(datos.ambito).toBe('Lima - Callao - Ica');
    expect(datos.enlaceMapa).toBe('https://www.google.com/maps/search/?api=1&query=Paita');
  });

  it('tolera viñetas de riesgo escritas como clave:valor fuera de su sección', () => {
    const datos = parsearFicha(`## Local

- Dirección: Calle Real 45
- Accesibilidad: rampa en el ingreso
- Ventilación: ventanas al patio`);

    expect(datos.direccion).toBe('Calle Real 45');
    expect(datos.accesibilidad).toEqual(['rampa en el ingreso']);
    expect(datos.ventilacion).toEqual(['ventanas al patio']);
  });

  it('devuelve el objeto vacío para null, undefined o texto en blanco', () => {
    expect(parsearFicha(null)).toEqual(SIN_DATOS);
    expect(parsearFicha(undefined)).toEqual(SIN_DATOS);
    expect(parsearFicha('   \n  ')).toEqual(SIN_DATOS);
  });

  it('la plantilla ofrecida es interpretable por el parser', () => {
    const datos = parsearFicha(PLANTILLA_FICHA);

    expect(datos.artesDePesca).toContain('redes');
    expect(datos.inscripcionProduce).toContain('inscripción');
    expect(datos.ambito).toContain('distritos');
    expect(datos.edad).toContain('años');
    expect(datos.accesibilidad?.[0]).toContain('barreras de acceso');
    expect(datos.ventilacion?.[0]).toContain('ventilación natural');
  });
});
