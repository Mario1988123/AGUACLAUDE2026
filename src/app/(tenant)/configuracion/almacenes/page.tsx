import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * La gestión completa de almacenes (CRUD warehouses, stock, loading requests)
 * vive en /almacenes — esta ruta sólo redirige para mantener consistencia con
 * los enlaces antiguos que pudieran existir.
 */
export default function ConfiguracionAlmacenesPage() {
  redirect("/almacenes" as never);
}
