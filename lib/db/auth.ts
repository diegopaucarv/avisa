import { createHmac, timingSafeEqual } from "node:crypto";
import { ConfigError } from "./config-error";

export const SESSION_COOKIE = "avisa_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

export type SessionPayload = {
  uid: string;
  rol: string;
  roles: string[];
  nom: string;
  cod: string;
  dn: string;
  area: string;
  cargo: string;
  regs: string[];
  exp: number;
};

function sessionSecret(): string {
  const value = process.env.APP_SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new ConfigError(
      "Falta la variable de entorno APP_SESSION_SECRET en el servidor (mínimo 32 caracteres).",
    );
  }
  return value;
}

export function signSession(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", sessionSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${mac}`;
}

export function verifySession(
  token: string | null | undefined,
): SessionPayload | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;

  const expected = createHmac("sha256", sessionSecret())
    .update(body)
    .digest("base64url");
  const received = Buffer.from(mac);
  const computed = Buffer.from(expected);
  if (
    received.length !== computed.length ||
    !timingSafeEqual(received, computed)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readSession(request: Request): SessionPayload | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const prefix = `${SESSION_COOKIE}=`;
  const raw = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!raw) return null;
  return verifySession(decodeURIComponent(raw.slice(prefix.length)));
}
