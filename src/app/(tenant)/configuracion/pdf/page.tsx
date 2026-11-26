import { redirect } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { fetchAllRows } from "@/shared/lib/supabase/fetch-all";
import { BackButton } from "@/shared/components/back-button";
import { getPdfSettings } from "@/modules/config/pdf/actions";
import { PdfSettingsForm, type MuestraOpcion } from "@/modules/config/pdf/form";
import { cargarFicha } from "@/modules/products/ficha/cargar-ficha";
import { descargar, coloresDeLogo } from "@/modules/products/ficha/imagenes";
import type { FichaModelo } from "@/modules/products/ficha/modelo";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPdfPage({
  searchParams,
}: {
  searchParams: Promise<{ muestra?: string }>;
}) {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/dashboard");
  }
  const { muestra } = await searchParams;
  const settings = await getPdfSettings();

  // Productos de muestra: los que tienen más datos (foto y características)
  // primero, no «el más reciente».
  let opciones: MuestraOpcion[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createClient()) as any;
    const { data: prods, error } = await supabase
      .from("products")
      .select("id, name, main_image_url, kind")
      .eq("company_id", session.company_id!)
      .is("deleted_at", null)
      .order("name")
      .limit(500);
    if (error) console.error("[configuracion/pdf] productos:", error.message);
    const lista = (prods ?? []) as Array<{ id: string; name: string; main_image_url: string | null; kind: string }>;
    const valores = await fetchAllRows<{ product_id: string }>(
      (from, to) =>
        supabase
          .from("product_attribute_values")
          .select("product_id")
          .eq("company_id", session.company_id!)
          .eq("is_visible", true)
          .range(from, to),
      { maxRows: 20000, label: "configuracion-pdf:valores" },
    );
    const cuenta = new Map<string, number>();
    for (const v of valores) cuenta.set(v.product_id, (cuenta.get(v.product_id) ?? 0) + 1);
    opciones = lista
      .map((p) => ({
        id: p.id,
        nombre: p.name,
        datos: (cuenta.get(p.id) ?? 0) + (p.main_image_url ? 10 : 0) + (p.kind === "equipment" ? 5 : 0),
      }))
      .sort((a, b) => b.datos - a.datos || a.nombre.localeCompare(b.nombre, "es"))
      .slice(0, 60)
      .map(({ id, nombre }) => ({ id, nombre }));
  } catch (e) {
    console.error("[configuracion/pdf] muestras:", e instanceof Error ? e.message : e);
  }
  const muestraId = opciones.find((o) => o.id === muestra)?.id ?? opciones[0]?.id ?? null;

  // Modelo de la ficha de muestra (el producto es de la empresa: sale de la
  // lista de arriba, leída con la sesión) y colores del logo.
  let modelo: FichaModelo | null = null;
  if (muestraId) {
    try {
      modelo = (await cargarFicha(createAdminClient(), muestraId)).modelo;
    } catch (e) {
      console.error("[configuracion/pdf] modelo:", e instanceof Error ? e.message : e);
    }
  }
  const coloresLogo = await coloresDeLogo(await descargar(settings.logoUrl, 8000));

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <BackButton href="/configuracion" />
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Fichas técnicas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cómo salen en PDF las fichas de tus productos: la plantilla y los colores de tu marca.
        </p>
      </div>
      <PdfSettingsForm
        initial={settings}
        modelo={modelo}
        muestras={opciones}
        muestraId={muestraId}
        coloresLogo={coloresLogo}
      />
    </div>
  );
}
