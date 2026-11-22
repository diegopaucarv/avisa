import type { Session } from "./types";

export async function login(dni: string, password: string): Promise<Session> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dni, password }),
  });
  if (!response.ok)
    throw new Error("DNI o clave incorrectos. Verifique sus credenciales.");
  return response.json();
}
