import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/shared/lib/auth/module-guard";
import { assertCaptacionActiva } from "@/modules/captacion/guard";
import { listarConversaciones, type FiltroBandeja } from "@/modules/captacion/bandeja-actions";
import { BandejaLista } from "@/modules/captacion/bandeja-lista";

export const dynamic = "force-dynamic";

const FILTROS: FiltroBandeja[] = ["sin_atender", "mias", "todas"];

/** Bandeja de captación (fase 2): conversaciones de WhatsApp. */
export default async function BandejaPage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string }>;
}) {
  const session = await assertCaptacionActiva();
  requireModuleAccess(session, [
    "commercial_director",
    "telemarketing_director",
    "sales_rep",
    "telemarketer",
  ]);
  const { filtro: f } = await searchParams;
  const filtro: FiltroBandeja = FILTROS.includes(f as FiltroBandeja) ? (f as FiltroBandeja) : "todas";
  const datos = await listarConversaciones(filtro);
  if (!datos) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Bandeja</h1>
      <BandejaLista conversaciones={datos.conversaciones} filtro={filtro} />
    </div>
  );
}
