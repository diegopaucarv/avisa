import { jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerPagina,
  queryParams,
} from "@/lib/db/http";
import { crearUsuario, listarUsuarios } from "@/lib/db/repos/admin";
import { withSession } from "@/lib/db/tenant";

import { leerCuerpo, sesionAdministrador, textoDe } from "../_comun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/admin/usuarios?q=&pagina=1&tamano=25`
 *
 * Lista `core.usuarios` con sus roles vigentes y el último acceso correcto.
 * Nunca expone `clave_hash`: sólo `tieneClave`. Incluye `rolesDisponibles`
 * (`core.roles`) para el selector de cambio de rol.
 */
export async function GET(request: Request) {
  try {
    const ctx = sesionAdministrador(request);
    const params = queryParams(request);
    const { page, pageSize } = leerPagina(params);
    const q = params.get("q")?.trim() ?? "";

    const resultado = await withSession(ctx, (client) =>
      listarUsuarios(client, { q, page, pageSize }),
    );

    return jsonOk(conAliasDePagina(resultado));
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * `POST /api/v1/admin/usuarios`
 * Cuerpo: `{ nombre, dni, email?, cargo?, clave, rolCodigo }`.
 *
 * Crea la cuenta con clave bcrypt local (`public.crypt`/`gen_salt`) y le asigna
 * un rol vigente. Responde 201 con `{ usuario }`. La clave nunca se devuelve ni
 * se audita.
 */
export async function POST(request: Request) {
  try {
    const ctx = sesionAdministrador(request);
    const body = await leerCuerpo(request);

    const usuario = await withSession(ctx, (client) =>
      crearUsuario(client, ctx, {
        nombre: textoDe(body, "nombre"),
        dni: textoDe(body, "dni"),
        email: textoDe(body, "email") || null,
        cargo: textoDe(body, "cargo") || null,
        clave: textoDe(body, "clave"),
        rolCodigo: textoDe(body, "rolCodigo"),
      }),
    );

    return jsonOk({ usuario }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
