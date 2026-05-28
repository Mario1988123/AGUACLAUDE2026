import { redirect } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";
import { assertModuleActive } from "@/shared/lib/auth/module-guard";
import { BackButton } from "@/shared/components/back-button";
import { CampaignsClient } from "@/modules/mailing/campaigns-client";
import {
  listCampaignsAction,
  listMarketingTemplatesAction,
  getEphemerisSuggestionsAction,
  previewCampaignAudienceAction,
} from "@/modules/mailing/campaigns-actions";

export const dynamic = "force-dynamic";

const MAILING_ROLES = ["company_admin", "telemarketing_director", "telemarketer"];

export default async function CampanasPage() {
  await assertModuleActive("mailing");
  const session = await requireSession();
  if (
    !session.is_superadmin &&
    !session.roles.some((r) => MAILING_ROLES.includes(r))
  ) {
    redirect("/dashboard");
  }

  const [campaigns, templates, suggestions, audience] = await Promise.all([
    listCampaignsAction().catch(() => []),
    listMarketingTemplatesAction().catch(() => []),
    getEphemerisSuggestionsAction().catch(() => []),
    previewCampaignAudienceAction().catch(() => ({ count: 0 })),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Campañas de email</h1>
          <p className="text-sm text-muted-foreground">
            Envíos masivos de marketing a clientes con consentimiento comercial
            (RGPD). Cada email incluye enlace de baja. El tracking de aperturas
            y clics está disponible si la empresa usa Resend.
          </p>
        </div>
        <BackButton href="/mailing" />
      </div>

      <CampaignsClient
        campaigns={campaigns}
        templates={templates}
        suggestions={suggestions}
        audienceCount={audience.count}
      />
    </div>
  );
}
