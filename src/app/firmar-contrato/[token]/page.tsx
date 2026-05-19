import { getContractByRemoteToken } from "@/modules/contracts/remote-sign-actions";
import { RemoteSignClient } from "./remote-sign-client";

export const dynamic = "force-dynamic";

export default async function FirmarContratoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const r = await getContractByRemoteToken(token);

  if (!r.ok) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-2xl border-2 border-red-200 bg-white p-8 text-center shadow-lg">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-3xl">
            ⚠
          </div>
          <h1 className="text-xl font-extrabold text-red-900">
            Enlace no disponible
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{r.error}</p>
        </div>
      </div>
    );
  }

  return <RemoteSignClient token={token} contract={r.contract} />;
}
