import { redirect } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";
import { createClient } from "@/shared/lib/supabase/server";
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

  // Producto de muestra para la vista previa (el más reciente de la empresa).
  let sampleProductId: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createClient()) as any;
    const { data } = await supabase
      .from("products")
      .select("id")
      .eq("company_id", session.company_id!)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    sampleProductId = (data as { id: string } | null)?.id ?? null;
  } catch {
    /* fail-soft: sin muestra no se muestra la vista previa */
  }

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
          <PdfSettingsForm initial={settings} sampleProductId={sampleProductId} />
        </CardContent>
      </Card>
    </div>
  );
}
