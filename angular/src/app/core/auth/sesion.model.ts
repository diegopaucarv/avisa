/** Modelo de sesión: lo que la UI necesita saber de quién está dentro. */
export type Usuario = {
  dni: string;
  nombre: string;
  /** Etiqueta de rol para la interfaz (`Directora`, `Admin`, `Sectorista`…). */
  rol: string;
  /** Códigos de rol de la base (`direccion_oaipcs`, `sectorista`…). */
  roles: string[];
  id: string;
  area: string;
  email: string;
  cargo: string;
  regiones: string[];
};

/** Respuesta de `GET /api/v1/session`. */
export type ApiSesion = {
  user: {
    dni: string;
    nombre: string;
    rol: string;
    roles?: string[];
    id: string;
    area: string;
    email: string;
    cargo: string;
    regiones?: string[];
  };
  scope?: unknown;
  expiresAt?: string;
};

/** Respuesta de `POST /api/auth/login`. */
export type ApiLogin = {
  dni: string;
  nombre: string;
  rol: string;
  id: string;
  area: string;
  email: string;
  cargo: string;
  regiones?: string[];
  rolCodigo?: string;
  roles?: string[];
};

export function aUsuario(datos: ApiLogin | ApiSesion["user"]): Usuario {
  const roles = "roles" in datos && Array.isArray(datos.roles) ? datos.roles : [];
  return {
    dni: datos.dni,
    nombre: datos.nombre,
    rol: datos.rol,
    roles,
    id: datos.id,
    area: datos.area,
    email: datos.email,
    cargo: datos.cargo,
    regiones: Array.isArray(datos.regiones) ? datos.regiones : [],
  };
}
