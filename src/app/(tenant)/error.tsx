"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Error boundary del área tenant. Muestra el digest y un mensaje accionable
 * en lugar del genérico "Application error: a server-side exception" de Next.
 */
export default function TenantError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Imprime al menos en consola del cliente para diagnóstico
    console.error("[tenant error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-5xl">⚠️</div>
      <h1 className="text-2xl font-extrabold">Algo ha fallado</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Ha ocurrido un error inesperado al cargar esta página. Esto suele pasar cuando una
        migración SQL no se ha aplicado todavía en Supabase.
      </p>
      {error.digest && (
        <code className="rounded-md bg-muted px-3 py-1.5 text-xs">
          digest: {error.digest}
        </code>
      )}
      {error.message && (
        <details className="max-w-2xl text-left">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Detalles técnicos
          </summary>
          <pre className="mt-2 overflow-auto rounded-md bg-muted p-3 text-xs">
            {error.message}
            {error.stack && `\n\n${error.stack}`}
          </pre>
        </details>
      )}
      <div className="mt-4 flex gap-2">
        <button
          onClick={reset}
          className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Reintentar
        </button>
        <Link
          href="/"
          className="inline-flex h-10 items-center rounded-xl border border-border px-4 text-sm font-semibold hover:bg-muted"
        >
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
