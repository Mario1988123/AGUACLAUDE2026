import { notFound, redirect } from "next/navigation";
import { BackButton } from "@/shared/components/back-button";
import { requireSession } from "@/shared/lib/auth/session";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { isProductEditor } from "@/modules/products/permissions";
import { leerCaracteristicasEmpresa } from "@/modules/products/productos-lectura";
import { listProductShares } from "@/modules/products/share-actions";
import { leerAjustesFicha } from "@/modules/products/ficha/cargar-ficha";
import { esPlantillaNueva, leerSeccionesProducto } from "@/modules/products/ficha/modelo";
import { FichaTaller } from "@/modules/products/ficha-taller";

export const dynamic = "force-dynamic";

/**
 * Ficha técnica de un producto: marcar qué sale en el PDF y verlo al momento.
 * Solo el editor de productos (permissions.ts); el resto vuelve a la ficha.
 */
export default async function FichaTecnicaProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (!isProductEditor(session)) redirect(`/productos/${id}` as never);
  if (!session.company_id) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: prod, error } = await admin
    .from("products")
    .select("id, name, datasheet_extra")
    .eq("id", id)
    .eq("company_id", session.company_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el producto: ${error.message}`);
  if (!prod) notFound();

  const [caract, ajustes, shares] = await Promise.all([
    leerCaracteristicasEmpresa(id),
    leerAjustesFicha(admin, session.company_id),
    listProductShares(id).catch(() => []),
  ]);
  const plantillaNueva = esPlantillaNueva(ajustes.plantilla);

  return (
    <div className="min-w-0">
      <div className="mb-4 space-y-1">
        <BackButton href={`/productos/${id}`} label="Ficha" />
        <h1 className="break-words text-2xl font-bold leading-tight">Ficha técnica</h1>
        <p className="break-words text-sm text-muted-foreground">
          {(prod as { name: string }).name} · marca lo que quieres que salga en el PDF.
        </p>
      </div>
      <FichaTaller
        productId={id}
        nombre={(prod as { name: string }).name}
        caracteristicas={caract.caracteristicas}
        seccionesProducto={leerSeccionesProducto((prod as { datasheet_extra: unknown }).datasheet_extra)}
        seccionesEmpresa={{
          ventajas: ajustes.opciones.mostrarVentajas,
          recambios: ajustes.opciones.mostrarRecambios,
          medidas: true,
        }}
        plantilla={plantillaNueva ? ajustes.plantilla : "tarifa"}
        plantillaAnterior={!plantillaNueva}
        shares={shares}
        publicBaseUrl={process.env.NEXT_PUBLIC_SITE_URL ?? ""}
      />
    </div>
  );
}
