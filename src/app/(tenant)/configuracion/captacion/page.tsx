import { redirect } from "next/navigation";
import { assertCaptacionActiva, puedeLeerConfig } from "@/modules/captacion/guard";
import { obtenerEstadoCaptacion } from "@/modules/captacion/conexion-actions";
import { PanelConfigCaptacion } from "@/modules/captacion/panel-config";

export const dynamic = "force-dynamic";

export default async function ConfigCaptacionPage() {
  const session = await assertCaptacionActiva();
  if (!puedeLeerConfig(session)) redirect("/dashboard");

  const estado = await obtenerEstadoCaptacion();
  if (!estado) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Captación por WhatsApp</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          El número con el que se escribe a negocios que aún no son clientes. Cada mensaje en frío
          lo cobra Meta, así que los envíos empiezan apagados.
        </p>
      </div>
      <PanelConfigCaptacion estado={estado} />
    </div>
  );
}
