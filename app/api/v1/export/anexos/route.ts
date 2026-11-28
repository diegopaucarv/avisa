import { registrarDescarga } from "@/lib/db/auditoria-descargas";
import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { withSession } from "@/lib/db/tenant";
import { listarAnexosDisponibles } from "@/lib/db/repos/export-anexos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ruta que genera cada anexo. El 14 y el 15 tienen endpoint propio. */
function rutaDe(numero: string): string {
  if (numero === "14") return "/api/v1/export/anexo-14";
  if (numero === "15") return "/api/v1/export/anexo-15";
  return `/api/v1/export/anexos/${numero}`;
}

/**
 * Catálogo de anexos generables (ítems 75 y 86).
 *
 * Devuelve, por cada anexo, si se puede generar hoy (`disponible`), cuántos
 * registros tienen cuerpo suficiente (`registros`) frente al total de la fuente
 * (`total`), los formatos admitidos y los campos del formato oficial que no
 * tienen fuente (`faltantes`). Nada se marca «completo» si le faltan secciones:
 * la galería muestra los faltantes antes de descargar.
 *
 * Los conteos pasan por la RLS de la sesión: cada usuario ve lo que puede emitir.
 */
export async function GET(request: Request) {
  try {
    const sesion = requireSession(request);

    const anexos = await withSession(
      { usuarioId: sesion.uid, rolCodigo: sesion.rol },
      (client) => listarAnexosDisponibles(client),
    );

    await registrarDescarga(request, sesion, {
      entidad: "anexos",
      formato: "json",
      filtros: {},
      filas: anexos.length,
    });

    return jsonOk({
      generadoEn: new Date().toISOString(),
      anexos: anexos.map((anexo) => ({
        ...anexo,
        ruta: rutaDe(anexo.numero),
        endpoint: `${rutaDe(anexo.numero)}?formato=html`,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
