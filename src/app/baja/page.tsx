import { redirect } from "next/navigation";
import { unsubscribeByTokenAction } from "@/modules/mailing/actions";

export const dynamic = "force-dynamic";

/**
 * Página pública de baja de comunicaciones comerciales (RGPD / LSSI).
 * El link va en el pie de los emails de campaña: /baja?token=...
 * No requiere sesión (el destinatario no es usuario del CRM).
 *
 * Auditoría 2026-10-01 (menor): la baja se hacía con el simple GET, así que
 * los escáneres de enlaces de los servidores de correo (Outlook Safe Links,
 * Gmail, antivirus) daban de baja a la gente sin que lo pidiera. Ahora el GET
 * solo enseña un botón y la baja se hace con un POST (server action).
 *
 * Nota: hoy ningún envío pone la cabecera List-Unsubscribe-Post (one-click
 * RFC 8058) apuntando aquí; si algún día se pone, necesitará su propia ruta
 * POST, porque una página no la atiende.
 */

async function confirmarBaja(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  if (!token) redirect("/baja");
  let ok = false;
  try {
    ok = (await unsubscribeByTokenAction(token)).ok;
  } catch {
    ok = false;
  }
  redirect(`/baja?estado=${ok ? "hecho" : "error"}`);
}

export default async function BajaPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; estado?: string }>;
}) {
  const { token, estado } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-2xl border bg-white p-8 text-center shadow-sm">
        {estado === "hecho" ? (
          <>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl">
              ✓
            </div>
            <h1 className="text-xl font-bold text-gray-900">Baja confirmada</h1>
            <p className="mt-2 text-sm text-gray-600">
              Tu dirección ya no recibirá más comunicaciones comerciales. Puede
              tardar unos minutos en aplicarse.
            </p>
          </>
        ) : estado === "error" ? (
          <>
            <h1 className="text-xl font-bold text-gray-900">No se pudo procesar</h1>
            <p className="mt-2 text-sm text-gray-600">
              El enlace no es válido o ha caducado. Si sigues recibiendo correos
              que no deseas, responde a uno de ellos para solicitarlo.
            </p>
          </>
        ) : !token ? (
          <>
            <h1 className="text-xl font-bold text-gray-900">Enlace no válido</h1>
            <p className="mt-2 text-sm text-gray-600">
              Falta el identificador de baja. Usa el enlace que aparece en el
              email que recibiste.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-gray-900">
              ¿Dejar de recibir comunicaciones comerciales?
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              Pulsa el botón para confirmar la baja de las comunicaciones
              comerciales de esta empresa.
            </p>
            <form action={confirmarBaja} className="mt-6">
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-gray-900 px-5 text-sm font-semibold text-white hover:bg-gray-800"
              >
                Confirmar la baja
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
