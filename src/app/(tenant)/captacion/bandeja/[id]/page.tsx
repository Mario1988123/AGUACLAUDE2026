import { notFound } from "next/navigation";
import { requireModuleAccess } from "@/shared/lib/auth/module-guard";
import { assertCaptacionActiva } from "@/modules/captacion/guard";
import { obtenerConversacion } from "@/modules/captacion/bandeja-actions";
import { ConversacionVista } from "@/modules/captacion/conversacion-vista";

export const dynamic = "force-dynamic";

export default async function ConversacionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await assertCaptacionActiva();
  requireModuleAccess(session, [
    "commercial_director",
    "telemarketing_director",
    "sales_rep",
    "telemarketer",
  ]);
  const { id } = await params;
  // La RLS decide si la sesión ve esta conversación; si no, 404 (no se dice que existe).
  const c = await obtenerConversacion(id);
  if (!c) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <ConversacionVista c={c} />
    </div>
  );
}
