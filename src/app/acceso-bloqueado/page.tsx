import { LockKeyhole } from "lucide-react";
import { MENSAJE_BLOQUEO } from "@/shared/lib/empresas/estado";

export const dynamic = "force-dynamic";

/**
 * Pantalla a la que `requireSession()` manda a quien no puede entrar: su
 * empresa está pausada o de baja, o su usuario está desactivado.
 *
 * NO llama a requireSession (volvería a redirigir aquí). Tampoco es pública:
 * sin sesión, el middleware lleva al login, y tras entrar se vuelve a aquí.
 * Solo enseña un texto fijo según `motivo`; no lee datos de nadie.
 */
export default async function AccesoBloqueadoPage({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string }>;
}) {
  const { motivo } = await searchParams;
  const clave = motivo === "pausada" || motivo === "baja" || motivo === "usuario" ? motivo : "pausada";
  const m = MENSAJE_BLOQUEO[clave];

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 px-4 pb-[calc(var(--safe-bottom)+1rem)] pt-[calc(var(--safe-top)+1rem)]">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warning/15 text-warning">
          <LockKeyhole className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{m.titulo}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{m.texto}</p>
        <form action="/logout" method="post" className="mt-6">
          <button
            type="submit"
            className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Cerrar sesión
          </button>
        </form>
      </div>
    </main>
  );
}
