import { unsubscribeByTokenAction } from "@/modules/mailing/actions";

export const dynamic = "force-dynamic";

/**
 * Página pública de baja de comunicaciones comerciales (RFC 8058 / RGPD).
 * El link va en el pie de los emails de campaña: /baja?token=...
 * No requiere sesión (el destinatario no es usuario del CRM).
 */
export default async function BajaPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  let result: { ok: boolean; email?: string } | null = null;
  if (token) {
    try {
      result = await unsubscribeByTokenAction(token);
    } catch {
      result = { ok: false };
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-2xl border bg-white p-8 text-center shadow-sm">
        {!token ? (
          <>
            <h1 className="text-xl font-bold text-gray-900">Enlace no válido</h1>
            <p className="mt-2 text-sm text-gray-600">
              Falta el identificador de baja. Usa el enlace que aparece en el
              email que recibiste.
            </p>
          </>
        ) : result?.ok ? (
          <>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl">
              ✓
            </div>
            <h1 className="text-xl font-bold text-gray-900">Baja confirmada</h1>
            <p className="mt-2 text-sm text-gray-600">
              {result.email ? <strong>{result.email}</strong> : "Tu dirección"} ya
              no recibirá más comunicaciones comerciales. Puede tardar unos
              minutos en aplicarse.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-gray-900">No se pudo procesar</h1>
            <p className="mt-2 text-sm text-gray-600">
              El enlace no es válido o ha caducado. Si sigues recibiendo correos
              que no deseas, responde a uno de ellos para solicitarlo.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
