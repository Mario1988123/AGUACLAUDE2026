"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error]", error);
  }, [error]);

  return (
    <html lang="es">
      <body>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            textAlign: "center",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div style={{ fontSize: 48 }}>⚠️</div>
          <h1>Algo ha fallado</h1>
          <p style={{ color: "#666", maxWidth: 480 }}>
            Error inesperado a nivel global. Si el problema persiste prueba a borrar caché del
            navegador.
          </p>
          {error.digest && (
            <code style={{ background: "#eee", padding: "6px 10px", borderRadius: 6 }}>
              digest: {error.digest}
            </code>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: 16,
              padding: "10px 16px",
              borderRadius: 12,
              background: "#4880FF",
              color: "white",
              border: "none",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
