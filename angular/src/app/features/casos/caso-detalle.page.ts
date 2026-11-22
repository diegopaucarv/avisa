import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { map } from "rxjs";

import { urlApi } from "../../core/config/entorno";
import { consulta } from "../../core/http/consulta";
import { aDetalleCaso, DetalleCaso } from "../../dominio/mapeo";
import { IconoComponent } from "../../shared/ui/icono.component";

@Component({
  selector: "app-caso-detalle",
  imports: [RouterLink, IconoComponent],
  templateUrl: "./caso-detalle.page.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CasoDetallePage {
  private readonly ruta = inject(ActivatedRoute);

  readonly codigo = toSignal(
    this.ruta.paramMap.pipe(map((params) => params.get("codigo") ?? "")),
    { initialValue: "" },
  );

  private readonly recurso = consulta<DetalleCaso>({
    fuente: () => {
      const codigo = this.codigo();
      if (!codigo) return null;
      return urlApi(`/v1/cases/${encodeURIComponent(codigo)}`);
    },
    esquema: aDetalleCaso,
  });

  readonly detalle = this.recurso.valor;
  readonly estado = this.recurso.estado;
  readonly error = this.recurso.error;
  readonly caso = computed(() => this.detalle()?.caso);

  recargar(): void {
    this.recurso.recargar();
  }
}
