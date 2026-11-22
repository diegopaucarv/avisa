"use client";

/**
 * Barrera de error raíz. Reemplaza el layout de la aplicación cuando falla
 * algo fuera del árbol de la página, por eso declara su propio `html`/`body`
 * y usa estilos en línea (el CSS global puede no estar disponible).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f4f7fa",
          color: "#22303f",
          fontFamily:
            "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
          padding: "24px",
        }}
      >
        <main
          role="alert"
          style={{
            maxWidth: "520px",
            width: "100%",
            background: "#ffffff",
            border: "1px solid #dce4ea",
            borderRadius: "10px",
            padding: "28px",
            boxShadow: "0 12px 32px rgba(17, 32, 45, 0.08)",
          }}
        >
          <p
            style={{
              margin: "0 0 8px",
              fontSize: "10px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#7b8896",
            }}
          >
            AVISA · Prototipo de demostración
          </p>
          <h1 style={{ margin: "0 0 10px", fontSize: "18px" }}>
            La aplicación no pudo iniciarse
          </h1>
          <p
            style={{
              margin: "0 0 18px",
              fontSize: "12.5px",
              lineHeight: 1.6,
              color: "#5a6b7c",
            }}
          >
            Ocurrió un error inesperado en la interfaz simulada. Puedes
            reintentar la carga; si el problema continúa, recarga la página.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: "38px",
              padding: "0 16px",
              border: "1px solid #2455a2",
              borderRadius: "7px",
              background: "#2455a2",
              color: "#ffffff",
              fontFamily: "inherit",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reintentar carga
          </button>
          {error.digest ? (
            <p
              style={{
                margin: "16px 0 0",
                fontSize: "10px",
                color: "#8b97a1",
              }}
            >
              Referencia: {error.digest}
            </p>
          ) : null}
          <p
            style={{
              margin: "16px 0 0",
              fontSize: "10px",
              color: "#8b97a1",
            }}
          >
            Información simulada, no usar para decisiones institucionales.
          </p>
        </main>
      </body>
    </html>
  );
}
