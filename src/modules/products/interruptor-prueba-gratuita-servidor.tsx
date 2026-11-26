import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { esDePruebaGratuita } from "@/modules/free-trials/productos-prueba";
import { InterruptorPruebaGratuitaCliente } from "./interruptor-prueba-gratuita";

/**
 * Lee la marca del producto y pinta el interruptor. Va aparte para que la
 * ficha (productos/[id]/page.tsx) solo tenga que añadir una línea.
 */
export async function InterruptorPruebaGratuita({ productId }: { productId: string }) {
  const session = await requireSession();
  if (!session.company_id) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("products")
    .select("roles")
    .eq("id", productId)
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (!data) return null;
  return (
    <InterruptorPruebaGratuitaCliente
      productId={productId}
      inicial={esDePruebaGratuita((data as { roles: string[] | null }).roles)}
    />
  );
}
