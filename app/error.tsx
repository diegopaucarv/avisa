"use client";

import { ErrorState } from "@/components/avisa-view-state";

/**
 * Barrera de error a nivel de ruta. Evita que un fallo de render deje la
 * consola en blanco y ofrece reintentar sin recargar todo el prototipo.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="avisa-route-error">
      <ErrorState
        title="La consola AVISA encontró un error"
        description="Un módulo de la demostración no pudo renderizarse. Puedes reintentar la carga; el resto de la sesión simulada sigue disponible."
        onRetry={reset}
        retryLabel="Reintentar carga"
      />
      <details className="avisa-route-error-detail">
        <summary>Detalle técnico</summary>
        <pre>{error.message || "Sin mensaje de error."}</pre>
        {error.digest ? <p>Referencia: {error.digest}</p> : null}
      </details>
      <p className="avisa-route-error-note">
        Prototipo de interfaz con información simulada. Ningún dato de esta
        pantalla es real.
      </p>
    </main>
  );
}
