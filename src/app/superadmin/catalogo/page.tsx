import { redirect } from "next/navigation";

/**
 * «Catálogo maestro» entra directamente en la lista nueva (kiosco de
 * categorías). Categorías, atributos, fabricantes y modelos externos tienen
 * su pestaña en la barra del layout. Se conserva la ruta para no romper
 * enlaces (menú, onboarding).
 */
export default function SuperadminCatalogoPage() {
  redirect("/superadmin/catalogo/productos");
}
