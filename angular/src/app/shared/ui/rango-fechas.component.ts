import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';

import {
  aDdMmAaaa,
  desdeDdMmAaaa,
  diaIso,
  formatearEntradaFecha,
  hoyIso,
  mascaraDdMmAaaa,
  primerDiaDelAnio,
  primerDiaDelMes,
  sumarDias,
} from '../../core/fecha/zona-horaria';

/**
 * Rango de fechas de una barra de filtros.
 *
 * Entra y sale en dos lenguajes a la vez: lo que se escribe y se ve es
 * `dd/mm/aaaa`; lo que se emite es ISO (`YYYY-MM-DD`), listo para la query.
 * Para un filtro que compara instantes, el consumidor envuelve el día con
 * `inicioDelDiaIso()` y `finDelDiaIso()` de `core/fecha/zona-horaria`.
 *
 * No emite rangos inválidos (`desde > hasta`, fechas inexistentes o posteriores
 * al máximo): los señala con un mensaje y deja los últimos valores válidos.
 */

export type RangoFechas = {
  /** Día ISO corto (`YYYY-MM-DD`) o `null` si el extremo está abierto. */
  desde: string | null;
  /** Día ISO corto (`YYYY-MM-DD`) o `null` si el extremo está abierto. */
  hasta: string | null;
};

export type AtajoRango = '7d' | '30d' | 'mes' | 'anio' | 'todo';

type OpcionAtajo = { clave: AtajoRango; etiqueta: string };

const ATAJOS: readonly OpcionAtajo[] = [
  { clave: '7d', etiqueta: '7 d' },
  { clave: '30d', etiqueta: '30 d' },
  { clave: 'mes', etiqueta: 'Mes actual' },
  { clave: 'anio', etiqueta: 'Año' },
  { clave: 'todo', etiqueta: 'Todo' },
];

@Component({
  selector: 'app-rango-fechas',
  templateUrl: './rango-fechas.component.html',
  styleUrl: './rango-fechas.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RangoFechasComponent {
  /** Extremo inicial: día ISO o instante ISO. */
  readonly desde = input<string | null>(null);
  /** Extremo final: día ISO o instante ISO. */
  readonly hasta = input<string | null>(null);
  /** Tope superior (por ejemplo, hoy): no se acepta una fecha posterior. */
  readonly maximo = input<string | null>(null);
  readonly deshabilitado = input(false);
  /** Atajos rápidos (7 d, 30 d, mes actual, año, todo). */
  readonly atajos = input(true);
  readonly etiquetaDesde = input('Desde');
  readonly etiquetaHasta = input('Hasta');
  readonly etiquetaGrupo = input('Rango de fechas');
  /** Prefijo de los `id` de los controles, para los `<label for>`. */
  readonly idBase = input('rango-fechas');

  readonly cambio = output<RangoFechas>();

  readonly atajosDisponibles = ATAJOS;

  /** Texto editable. Se reinicia cuando la pantalla cambia los extremos. */
  readonly textoDesde = linkedSignal(() => formatearEntradaFecha(this.desde()));
  readonly textoHasta = linkedSignal(() => formatearEntradaFecha(this.hasta()));

  /** El error no aparece mientras la persona todavía está escribiendo. */
  private readonly tocado = signal(false);

  readonly error = computed(() => (this.tocado() ? this.mensaje() : null));

  readonly atajoActivo = computed<AtajoRango | null>(() => {
    const actual = {
      desde: diaIso(this.desde()),
      hasta: diaIso(this.hasta()),
    };
    for (const atajo of ATAJOS) {
      const rango = this.rangoDe(atajo.clave);
      if (rango.desde === actual.desde && rango.hasta === actual.hasta) {
        return atajo.clave;
      }
    }
    return null;
  });

  idDesde(): string {
    return `${this.idBase()}-desde`;
  }

  idHasta(): string {
    return `${this.idBase()}-hasta`;
  }

  idError(): string {
    return `${this.idBase()}-error`;
  }

  cambiarDesde(evento: Event): void {
    this.escribir('desde', evento);
    this.emitir();
  }

  cambiarHasta(evento: Event): void {
    this.escribir('hasta', evento);
    this.emitir();
  }

  confirmarDesde(): void {
    this.tocado.set(true);
    this.normalizar('desde');
    this.emitir();
  }

  confirmarHasta(): void {
    this.tocado.set(true);
    this.normalizar('hasta');
    this.emitir();
  }

  aplicarAtajo(clave: AtajoRango): void {
    if (this.deshabilitado()) return;
    const rango = this.rangoDe(clave);
    this.tocado.set(false);
    this.textoDesde.set(formatearEntradaFecha(rango.desde));
    this.textoHasta.set(formatearEntradaFecha(rango.hasta));
    this.cambio.emit(rango);
  }

  limpiar(): void {
    this.aplicarAtajo('todo');
  }

  private escribir(extremo: 'desde' | 'hasta', evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const limpio = mascaraDdMmAaaa(entrada.value);
    // Se reescribe el control: así un noveno dígito no se queda en pantalla
    // cuando la máscara ya no cambia la señal.
    entrada.value = limpio;
    if (extremo === 'desde') {
      this.textoDesde.set(limpio);
    } else {
      this.textoHasta.set(limpio);
    }
  }

  private normalizar(extremo: 'desde' | 'hasta'): void {
    const texto = extremo === 'desde' ? this.textoDesde() : this.textoHasta();
    const dia = desdeDdMmAaaa(texto);
    if (!dia) return;
    const canonico = aDdMmAaaa(dia);
    if (extremo === 'desde') {
      this.textoDesde.set(canonico);
    } else {
      this.textoHasta.set(canonico);
    }
  }

  private emitir(): void {
    const desde = desdeDdMmAaaa(this.textoDesde());
    const hasta = desdeDdMmAaaa(this.textoHasta());
    if (this.mensaje()) return;

    const actual: RangoFechas = {
      desde: diaIso(this.desde()),
      hasta: diaIso(this.hasta()),
    };
    if (actual.desde === desde && actual.hasta === hasta) return;

    this.cambio.emit({ desde, hasta });
  }

  private mensaje(): string | null {
    const textoDesde = this.textoDesde().trim();
    const textoHasta = this.textoHasta().trim();
    const desde = desdeDdMmAaaa(textoDesde);
    const hasta = desdeDdMmAaaa(textoHasta);

    if (textoDesde && !desde) {
      return 'La fecha «desde» no es válida. Usa dd/mm/aaaa.';
    }
    if (textoHasta && !hasta) {
      return 'La fecha «hasta» no es válida. Usa dd/mm/aaaa.';
    }
    if (desde && hasta && desde > hasta) {
      return 'La fecha «desde» no puede ser posterior a «hasta».';
    }

    const maximo = diaIso(this.maximo());
    if (maximo) {
      if (desde && desde > maximo) {
        return `La fecha «desde» no puede ser posterior al ${aDdMmAaaa(maximo)}.`;
      }
      if (hasta && hasta > maximo) {
        return `La fecha «hasta» no puede ser posterior al ${aDdMmAaaa(maximo)}.`;
      }
    }

    return null;
  }

  private rangoDe(clave: AtajoRango): RangoFechas {
    const hoy = hoyIso();
    switch (clave) {
      case '7d':
        return { desde: sumarDias(hoy, -6), hasta: hoy };
      case '30d':
        return { desde: sumarDias(hoy, -29), hasta: hoy };
      case 'mes':
        return { desde: primerDiaDelMes(hoy), hasta: hoy };
      case 'anio':
        return { desde: primerDiaDelAnio(hoy), hasta: hoy };
      case 'todo':
        return { desde: null, hasta: null };
    }
  }
}
