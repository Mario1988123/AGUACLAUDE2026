import { notFound } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";
import { datosSaludCaptacion } from "@/modules/captacion/salud-servidor";
import { PanelSaludCaptacion } from "@/modules/captacion/salud-ui";

export const dynamic = "force-dynamic";

/**
 * Salud de la captación por WhatsApp en todas las empresas (fase 8, plan §8:
 * «panel de salud de todas las conexiones para Vercomi»). Solo superadmin: el
 * layout ya lo exige y aquí se repite, porque los datos se leen con el
 * cliente de servicio y son de todas las empresas.
 */
export default async function SaludCaptacionPage() {
  const session = await requireSession();
  if (!session.is_superadmin) notFound();
  const datos = await datosSaludCaptacion();

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Salud de la captación</h1>
        <p className="text-sm text-muted-foreground">
          Conexiones de WhatsApp, envíos, gasto, avisos de Meta y crons de las empresas con el módulo activo.
        </p>
      </div>
      <PanelSaludCaptacion datos={datos} />
    </div>
  );
}
