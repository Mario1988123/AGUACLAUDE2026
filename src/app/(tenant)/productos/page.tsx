import Link from "next/link";
import { listProducts } from "@/modules/products/actions";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { KIND_LABEL } from "@/modules/products/schemas";

function formatCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export default async function ProductsPage() {
  const products = await listProducts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Productos</h1>
          <p className="text-sm text-muted-foreground">{products.length} productos</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href={"/configuracion/productos" as never}>Configuración</Link>
          </Button>
          <Button asChild>
            <Link href={"/productos/nuevo" as never}>+ Nuevo producto</Link>
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Producto</th>
              <th className="px-4 py-3 text-left">Tipo</th>
              <th className="px-4 py-3 text-left">Categoría</th>
              <th className="px-4 py-3 text-left">Ref.</th>
              <th className="px-4 py-3 text-right">Precio contado</th>
              <th className="px-4 py-3 text-left">Estado</th>
              <th className="px-4 py-3 text-right">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {products.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  No hay productos. Crea categorías en{" "}
                  <Link href={"/configuracion/productos" as never} className="text-primary underline">
                    Configuración
                  </Link>{" "}
                  y luego añade productos.
                </td>
              </tr>
            ) : (
              products.map((p) => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link
                      href={`/productos/${p.id}` as never}
                      className="font-medium text-primary hover:underline"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs">{KIND_LABEL[p.kind]}</td>
                  <td className="px-4 py-3 text-xs">{p.category_name ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {p.internal_reference ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCents(p.cash_price_cents)}
                  </td>
                  <td className="px-4 py-3">
                    {p.is_active ? (
                      <Badge variant="success">Activo</Badge>
                    ) : (
                      <Badge variant="secondary">Inactivo</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/productos/${p.id}` as never}
                      className="text-sm text-primary hover:underline"
                    >
                      Ver
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
