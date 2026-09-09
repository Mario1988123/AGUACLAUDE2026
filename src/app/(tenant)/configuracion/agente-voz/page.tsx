import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { assertModuleActive } from "@/shared/lib/auth/module-guard";
import { getVoiceSettingsAction } from "@/modules/voice-agent/settings-actions";
import { VoiceSettingsForm } from "@/modules/voice-agent/settings-form";
import { listInboundNumbers } from "@/modules/voice-agent/inbound-actions";
import { InboundNumbersPanel } from "@/modules/voice-agent/inbound-numbers-panel";

export const dynamic = "force-dynamic";

export default async function ConfigAgenteVozPage() {
  await assertModuleActive("voice_agent");
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/dashboard");
  }

  const [settings, inboundNumbers] = await Promise.all([
    getVoiceSettingsAction(),
    listInboundNumbers(),
  ]);
  if (!settings) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
          Configurar el agente de voz
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Tres agentes separados, con número, guion y reglas propias: el de
          servicio llama a tus clientes para agendar, el comercial solo llama a
          empresas, y la recepcionista atiende lo que entra. No comparten nada,
          y esa separación no se puede desactivar.
        </p>
      </div>
      <VoiceSettingsForm initial={settings} />

      <section className="space-y-4 rounded-xl border border-border p-5">
        <div>
          <h2 className="text-base font-bold">Números que atiende la recepcionista</h2>
          <p className="text-sm text-muted-foreground">
            El número marcado es lo único que dice de qué empresa es una llamada
            entrante, así que cada uno atiende a una sola.
          </p>
        </div>
        <InboundNumbersPanel numbers={inboundNumbers} />
      </section>
    </div>
  );
}
