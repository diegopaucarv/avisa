import { Injectable, computed } from "@angular/core";

import { urlApi } from "../config/entorno";
import { urlConParametros } from "./coleccion";
import { consulta } from "./consulta";

/**
 * Contador de avisos sin leer para la campana de la cabecera.
 *
 * El total lo calcula el servidor (`noLeidas` de `GET /v1/notifications`) y no
 * se deduce de las filas: pedimos una sola fila porque sólo interesa el
 * agregado. Si la consulta falla, el contador queda en cero y la pantalla de
 * notificaciones sigue siendo la fuente de verdad al abrirse.
 */
@Injectable({ providedIn: "root" })
export class NotificacionesService {
  private readonly resumen = consulta<number>({
    fuente: () => urlConParametros(urlApi("/v1/notifications"), { pageSize: 1 }),
    esquema: (valor) => {
      const registro = (valor ?? {}) as Record<string, unknown>;
      const bruto = registro["noLeidas"] ?? registro["no_leidas"] ?? 0;
      const numero = typeof bruto === "number" ? bruto : Number(bruto);
      return Number.isFinite(numero) && numero > 0 ? Math.trunc(numero) : 0;
    },
  });

  /** Avisos sin leer; `0` cuando todavía no hay respuesta. */
  readonly noLeidas = computed(() => this.resumen.valor() ?? 0);

  /** Texto del globo: se corta en «99+» para no romper la cabecera. */
  readonly etiqueta = computed(() => {
    const total = this.noLeidas();
    if (total <= 0) return "";
    return total > 99 ? "99+" : String(total);
  });

  /** Vuelve a pedir el total (tras leer o archivar avisos). */
  readonly recargar = this.resumen.recargar;
}
