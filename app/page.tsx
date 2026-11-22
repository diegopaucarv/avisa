"use client";

import { useEffect, useState } from "react";
import { AvisaDashboard } from "@/components/avisa-dashboard";
import { AvisaLogin } from "@/components/avisa-login";
import { LoadingState } from "@/components/avisa-view-state";
import { AvisaProvider } from "@/lib/avisa-store";
import { ApiClientError, apiGet } from "@/lib/api-client";
import { mapSessionUser, type ApiSessionResponse } from "@/lib/api-mappers";
import type { Session } from "@/frontend/types";

export default function Page() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      try {
        const data = await apiGet<ApiSessionResponse>("/api/v1/session");
        if (!cancelled) setSession(mapSessionUser(data.user));
      } catch (error) {
        // 401 significa "sin sesión": se muestra el login sin ruido extra.
        if (
          !cancelled &&
          !(error instanceof ApiClientError && error.status === 401)
        ) {
          console.warn("No se pudo restaurar la sesión", error);
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    };

    restore().catch(() => {
      if (!cancelled) setChecking(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = () => {
    setSession(null);
    void fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    }).catch((error: unknown) => {
      console.warn("No se pudo cerrar la sesión en el servidor", error);
    });
  };

  if (checking) {
    return (
      <main className="login-screen">
        <LoadingState label="Restaurando sesión…" />
      </main>
    );
  }

  if (!session) {
    return <AvisaLogin onSuccess={setSession} />;
  }

  return (
    <AvisaProvider>
      <AvisaDashboard session={session} onLogout={handleLogout} />
    </AvisaProvider>
  );
}
