"use client";

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      <div className="text-6xl">📡</div>
      <h1 className="text-2xl font-extrabold">Sin conexión</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        No hay internet en este momento. Los datos en caché siguen disponibles desde el menú; al
        recuperar la conexión se sincronizarán automáticamente las acciones pendientes.
      </p>
      <button
        type="button"
        onClick={() => location.reload()}
        className="mt-4 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        Reintentar
      </button>
    </div>
  );
}
