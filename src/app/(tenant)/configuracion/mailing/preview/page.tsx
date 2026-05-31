import { redirect } from "next/navigation";
import Link from "next/link";
import { Mail, ArrowLeft } from "lucide-react";
import { requireSession } from "@/shared/lib/auth/session";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { getSystemTemplates } from "@/modules/mailing/system-templates";
import { renderTemplate, buildEmailHtml } from "@/modules/mailing/templates";
import { loadCompanyEmailContext } from "@/modules/mailing/company-context";
import { getSampleVars } from "@/modules/mailing/sample-vars";
import { TestSendButton } from "@/modules/mailing/test-send-button";

export const dynamic = "force-dynamic";

/**
 * Pre-visualización de todas las plantillas con datos de muestra.
 * Sirve para validar diseños sin enviar nada. No toca Resend ni BD.
 */
export default async function MailingPreviewPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/configuracion/mailing");
  }

  // Branding + datos reales de la empresa para que el preview se parezca al
  // email que recibirá el cliente. Fail-soft a datos de muestra.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const ctx = session.company_id
    ? await loadCompanyEmailContext(session.company_id, admin).catch(() => null)
    : null;
  const company = ctx?.company ?? {
    legal_name: "Hidromanager Demo SL",
    tax_id: "B12345678",
    address: "Calle Falsa 123, 28012 Madrid",
    email: "info@hidromanager.es",
    phone: "900 100 200",
  };
  const branding = ctx?.branding ?? null;
  const sampleVars = getSampleVars({ company_name: company.legal_name });

  const templates = getSystemTemplates();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Mail className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Preview de plantillas</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Renderizado con datos de muestra. NO se envía nada. Total{" "}
            {templates.length} plantillas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TestSendButton defaultEmail={session.email ?? ""} />
          <Link
            href="/configuracion/mailing"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {templates.map((t) => {
          const subject = renderTemplate(t.subject, sampleVars);
          const body = renderTemplate(t.body_html, sampleVars);
          const fullHtml = buildEmailHtml({
            body_html: body,
            company,
            branding,
            kind: t.kind,
            unsubscribe_url:
              t.kind === "marketing"
                ? "https://crm.example.com/u/abc"
                : undefined,
          });
          return (
            <div
              key={t.key}
              className="overflow-hidden rounded-2xl border border-border bg-card"
            >
              <div className="border-b bg-muted/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold">{t.name}</div>
                    <code className="text-[10px] text-muted-foreground">
                      {t.key}
                    </code>
                  </div>
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                      t.kind === "transactional"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-purple-100 text-purple-800"
                    }`}
                  >
                    {t.kind}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t.description}
                </p>
              </div>
              <div className="border-b bg-amber-50/50 px-3 py-2 text-xs">
                <span className="font-bold text-amber-900">Asunto: </span>
                <span className="text-amber-900">{subject}</span>
              </div>
              <iframe
                title={t.name}
                srcDoc={fullHtml}
                className="block w-full"
                style={{ height: 480, border: 0 }}
                sandbox=""
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
