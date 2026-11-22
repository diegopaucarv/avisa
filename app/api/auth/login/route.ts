import { NextResponse } from "next/server";
import { getPool } from "@/lib/db/pool";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  signSession,
  type SessionPayload,
} from "@/lib/db/auth";
import { jsonError } from "@/lib/db/errors";
import type { Role } from "@/frontend/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthRow = {
  usuario_id: string;
  codigo_legado: string | null;
  nombre: string;
  dni: string;
  cargo: string | null;
  unidad_siglas: string | null;
  rol_codigo: string | null;
  roles: string[] | null;
  regiones: string[] | null;
};

/**
 * Los códigos de rol de la base no son etiquetas de interfaz. La base decide el
 * rol vigente (ya ordenado por precedencia); aquí sólo se traduce para la UI.
 */
const UI_ROLE: Record<string, Role> = {
  direccion_oaipcs: "Directora",
  administrador: "Admin",
  alta_direccion: "Autoridad",
  sectorista: "Sectorista",
  consulta_lectura: "PuntoFocal",
};

export async function POST(request: Request) {
  let payload: { dni?: unknown; password?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { detail: "Solicitud inválida." },
      { status: 400 },
    );
  }

  const dni = typeof payload.dni === "string" ? payload.dni.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";

  if (
    dni.length < 8 ||
    dni.length > 12 ||
    password.length < 1 ||
    password.length > 128
  ) {
    return NextResponse.json(
      { detail: "DNI o clave incorrectos." },
      { status: 401 },
    );
  }

  try {
    const result = await getPool().query<AuthRow>(
      `select usuario_id, codigo_legado, nombre, dni, cargo,
              unidad_siglas, rol_codigo, roles, regiones
         from core.autenticar_usuario($1, $2)`,
      [dni, password],
    );

    const row = result.rows[0];
    if (!row) {
      return NextResponse.json(
        { detail: "DNI o clave incorrectos." },
        { status: 401 },
      );
    }

    const rol = UI_ROLE[row.rol_codigo ?? ""] ?? "PuntoFocal";
    const roles = row.roles ?? [];
    const regiones = row.regiones ?? [];

    const session: SessionPayload = {
      uid: row.usuario_id,
      rol: row.rol_codigo ?? "consulta_lectura",
      roles,
      nom: row.nombre,
      cod: row.codigo_legado ?? "",
      dn: row.dni,
      area: row.unidad_siglas ?? "OAIPCS",
      cargo: row.cargo ?? rol,
      regs: regiones,
      exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
    };

    const response = NextResponse.json({
      dni: row.dni,
      nombre: row.nombre,
      rol,
      id: row.codigo_legado ?? row.usuario_id,
      area: session.area,
      cargo: session.cargo,
      regiones,
      rolCodigo: session.rol,
      roles,
    });

    response.cookies.set(SESSION_COOKIE, signSession(session), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
      secure: process.env.NODE_ENV === "production",
    });

    return response;
  } catch (error) {
    return jsonError(error);
  }
}
