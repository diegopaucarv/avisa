import { describe, expect, it } from 'vitest';

import type { DestinatarioMensaje } from '../../shared/ui/mensaje-panel.component';
import { EnviarMensajeService } from './enviar-mensaje.service';

function destinatario(id: string): DestinatarioMensaje {
  return { actorId: id, nombre: `Persona ${id}`, correo: null };
}

describe('destinatarios con semilla', () => {
  it('usa la selección de la vista mientras no se editó el cajón', () => {
    const servicio = new EnviarMensajeService();
    expect(servicio.destinatariosCon([destinatario('a'), destinatario('b')])).toHaveLength(2);
  });

  it('sigue la selección al cambiar de vista', () => {
    const servicio = new EnviarMensajeService();
    servicio.destinatariosCon([destinatario('a')]);
    expect(servicio.destinatariosCon([destinatario('b'), destinatario('c')])).toHaveLength(2);
  });

  it('la lista editada en el panel manda sobre la selección', () => {
    const servicio = new EnviarMensajeService();
    servicio.reemplazar([destinatario('a')]);
    expect(servicio.destinatariosCon([destinatario('b'), destinatario('c')])).toEqual([
      destinatario('a'),
    ]);
  });

  it('vuelve a la selección al vaciar la lista editada', () => {
    const servicio = new EnviarMensajeService();
    servicio.reemplazar([destinatario('a')]);
    servicio.vaciar();
    expect(servicio.destinatariosCon([destinatario('b')])).toEqual([destinatario('b')]);
  });

  it('copia los arreglos: mutarlos fuera no altera el servicio', () => {
    const servicio = new EnviarMensajeService();
    const semilla = [destinatario('a')];
    servicio.reemplazar(semilla);
    semilla.push(destinatario('b'));

    expect(servicio.destinatarios()).toHaveLength(1);
    expect(servicio.destinatariosCon(semilla)).toHaveLength(1);
  });
});
