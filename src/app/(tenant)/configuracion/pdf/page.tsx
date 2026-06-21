import { redirect } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { BackButton } from "@/shared/components/back-button";
import { getPdfSettings } from "@/modules/config/pdf/actions";
import { PdfSettingsForm } from "@/modules/config/pdf/form";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPdfPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/dashboard");
  }
  const settings = await getPdfSettings();

  return (
    <div className="space-y-4">
      <BackButton href="/configuracion" />
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
          Fichas técnicas (PDF)
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Elige el formato con el que se generan las fichas técnicas de tus productos
          y personaliza sus colores. Iremos añadiendo más plantillas.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Formato y colores</CardTitle>
        </CardHeader>
        <CardContent>
          <PdfSettingsForm initial={settings} />
        </CardContent>
      </Card>
    </div>
  );
}
