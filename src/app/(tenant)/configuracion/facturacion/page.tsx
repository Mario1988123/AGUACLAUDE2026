import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { listInvoiceSeries } from "@/modules/invoices/verifactu-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { InvoiceSeriesPanel } from "@/modules/invoices/series-panel";
import { VerifactuModePanel } from "@/modules/invoices/verifactu-mode-panel";
import { CertUploader } from "@/modules/invoices/cert-uploader";
import { createAdminClient } from "@/shared/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function FacturacionConfigPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/dashboard");
  }

  const series = await listInvoiceSeries().catch(() => []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: cs } = await admin
    .from("company_settings")
    .select("verifactu_mode, verifactu_environment, verifactu_cert_alias, verifactu_cert_expires_at")
    .eq("company_id", session.company_id)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Facturación</h1>
        <p className="text-sm text-muted-foreground">
          Configura las series de facturación, el modo Verifactu y el
          certificado FNMT para envío automático a la AEAT.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Modo Verifactu
            <Badge
              variant={
                cs?.verifactu_mode === "verifactu"
                  ? "success"
                  : cs?.verifactu_mode === "verifactu_test"
                    ? "warning"
                    : "secondary"
              }
            >
              {cs?.verifactu_mode === "verifactu"
                ? "Producción"
                : cs?.verifactu_mode === "verifactu_test"
                  ? "Test AEAT"
                  : "Solo registro local"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <VerifactuModePanel
            initialMode={cs?.verifactu_mode ?? "no_envio"}
            initialEnvironment={cs?.verifactu_environment ?? "production"}
            certAlias={cs?.verifactu_cert_alias ?? null}
            certExpiresAt={cs?.verifactu_cert_expires_at ?? null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Certificado digital FNMT</CardTitle>
        </CardHeader>
        <CardContent>
          <CertUploader
            certAlias={cs?.verifactu_cert_alias ?? null}
            certExpiresAt={cs?.verifactu_cert_expires_at ?? null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Series de facturación</CardTitle>
        </CardHeader>
        <CardContent>
          <InvoiceSeriesPanel series={series} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calendario obligatoriedad</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <strong>1 enero 2027</strong> — obligatorio para empresas (S.L., S.A., etc.).
          </p>
          <p>
            <strong>1 julio 2027</strong> — obligatorio para autónomos.
          </p>
          <p className="text-xs text-muted-foreground">
            Real Decreto 1007/2023 + Orden HAC/1177/2024 + RD 254/2025.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
