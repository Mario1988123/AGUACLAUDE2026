import Link from "next/link";
import { requireSession } from "@/shared/lib/auth/session";
import {
  assertModuleActive,
  requireModuleAccess,
} from "@/shared/lib/auth/module-guard";
import { listCampaigns } from "@/modules/voice-agent/campaign-actions";
import { getVoiceSettingsAction } from "@/modules/voice-agent/settings-actions";
import { CampaignsPanel } from "@/modules/voice-agent/campaigns-panel";
import { PREFIX_400_MANDATORY_FROM } from "@/modules/voice-agent/guardrails";
import { ArrowLeft, PhoneOff, ShieldAlert } from "lucide-react";

export const dynamic = "force-dynamic";

// Quién entra aquí. `technical_director` no: gestiona mantenimientos, no
// captación en frío. Es la misma lista que valida `campaign-actions.ts`.
const CAMPAIGN_ROLES = ["company_admin", "telemarketing_director"];

export default async function CampanasVozPage() {
  await assertModuleActive("voice_agent");
  const session = await requireSession();
  requireModuleAccess(session, CAMPAIGN_ROLES);

  const [settings, campaigns] = await Promise.all([
    getVoiceSettingsAction(),
    listCampaigns(),
  ]);

  const sin400 = !settings?.caller_id_commercial;
  // Antes del 17-oct-2026 la falta del 400 es un aviso; a partir de esa fecha
  // el operador bloquea la llamada y no sale ni una. El texto cambia porque el
  // problema cambia: hoy "vete pidiéndolo", después "esto no funciona".
  const yaObligatorio = Date.now() >= PREFIX_400_MANDATORY_FROM;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/agente-voz"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Agente de voz
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
          Campañas comerciales
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Tandas de llamadas de captación en frío, <strong>solo a empresas</strong>.
          Una campaña se crea en borrador, se siembra con filtros, se revisa a
          quién ha cogido y solo entonces se pone en marcha. Pausarla anula de
          golpe todo lo que quede en cola.
        </p>
      </div>

      {sin400 && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40"
        >
          <PhoneOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-bold">
              {yaObligatorio
                ? "No se pueden hacer campañas comerciales: falta el número del rango 400"
                : "Falta el número del rango 400 para las campañas comerciales"}
            </p>
            <p className="text-muted-foreground">
              Desde el <strong>17 de octubre de 2026</strong> (Resolución de
              14-abr-2026, BOE-A-2026-8409) las llamadas comerciales solo pueden
              salir de numeración <strong>+34 400 XXXXXX</strong>; los operadores
              bloquean cualquier otra.{" "}
              {yaObligatorio
                ? "Puedes preparar y sembrar campañas para ver a quién llamarían, pero no saldrá ninguna llamada hasta que haya un 400 configurado."
                : "Pídeselo a tu operador de telefonía: la CNMC lo asigna a operadores registrados y tarda."}{" "}
              Se configura en{" "}
              <Link href="/configuracion/agente-voz" className="font-medium underline">
                Configuración del agente de voz
              </Link>
              .
            </p>
          </div>
        </div>
      )}

      {!settings?.commercial_enabled && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4 text-sm">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-bold">La captación comercial está apagada</p>
            <p className="text-muted-foreground">
              Puedes crear y sembrar campañas para ver a quién llamarían, pero no
              se marcará ningún número hasta que se active en Configuración.
            </p>
          </div>
        </div>
      )}

      <CampaignsPanel campaigns={campaigns} />
    </div>
  );
}
