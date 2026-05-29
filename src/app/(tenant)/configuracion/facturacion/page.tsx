import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { listInvoiceSeries } from "@/modules/invoices/verifactu-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { InvoiceSeriesPanel } from "@/modules/invoices/series-panel";
import { VerifactuModePanel } from "@/modules/invoices/verifactu-mode-panel";
import { CertUploader } from "@/modules/invoices/cert-uploader";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { BackButton } from "@/shared/components/back-button";
import { getCompanyInvoicingMode } from "@/modules/invoices/mode";
import { ShieldCheck, FileText } from "lucide-react";

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

  const modeInfo = await getCompanyInvoicingMode(session.company_id!, admin);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Facturación</h1>
          <p className="text-sm text-muted-foreground">
            Configura las series de facturación, el modo Verifactu y el
            certificado FNMT para envío automático a la AEAT.
          </p>
        </div>
        <BackButton href="/configuracion" />
      </div>

      {/* Banner: modo de facturación efectivo según presencia del certificado.
          Subir el certificado activa Verifactu; eliminarlo vuelve a simple. */}
      <div
        className={`rounded-2xl border-2 p-4 ${
          modeInfo.mode === "verifactu"
            ? "border-emerald-300 bg-emerald-50"
            : "border-sky-300 bg-sky-50"
        }`}
      >
        <div className="flex items-start gap-3">
          {modeInfo.mode === "verifactu" ? (
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
          ) : (
            <FileText className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
          )}
          <div className="flex-1">
            <div className="text-sm font-bold">
              {modeInfo.mode === "verifactu"
                ? "Modo VERIFACTU activo"
                : "Modo facturación SIMPLE"}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {modeInfo.mode === "verifactu" ? (
                <>
                  Tienes el certificado FNMT instalado, así que las nuevas
                  facturas se emiten con huella encadenada y QR de Verifactu.
                  Si quieres volver al modo simple, elimina el certificado
                  abajo (el modo cae a «no envío» automáticamente).
                </>
              ) : (
                <>
                  No tienes certificado FNMT instalado, así que las facturas se
                  generan con la numeración normal y NO se envían a la AEAT.
                  Es el modo válido hasta que Verifactu sea obligatorio (empresas
                  ene-2027, autónomos jul-2027). Para activar Verifactu sube el
                  certificado en el panel «Certificado digital FNMT» de abajo.
                </>
              )}
            </p>
          </div>
        </div>
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
