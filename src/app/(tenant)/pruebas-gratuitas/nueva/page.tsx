import { notFound, redirect } from "next/navigation";
import { listProducts } from "@/modules/products/actions";
import { listAddresses } from "@/modules/addresses/actions";
import { listInstallers } from "@/modules/agenda/actions";
import { getCustomer } from "@/modules/customers/actions";
import { getFreeTrialsConfigParaAlta } from "@/modules/config/free-trials/actions";
import { DEFAULT_FREE_TRIAL_DURATION_DAYS } from "@/modules/config/free-trials/defaults";
import { FreeTrialCreateForm } from "@/modules/free-trials/create-form";
import { puedeAgendarPrueba } from "@/modules/free-trials/permisos";
import {
  ROL_PRUEBA_GRATUITA,
  productosParaPrueba,
} from "@/modules/free-trials/productos-prueba";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export const dynamic = "force-dynamic";

function customerName(c: {
  party_kind: "individual" | "company";
  trade_name: string | null;
  legal_name: string | null;
  first_name: string | null;
  last_name: string | null;
}): string {
  if (c.party_kind === "company") return c.trade_name || c.legal_name || "Cliente";
  return `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Cliente";
}

export default async function NuevaPruebaGratuitaPage({
  searchParams,
}: {
  searchParams: Promise<{ customer_id?: string; lead_id?: string }>;
}) {
  const sp = await searchParams;
  const customerId = sp.customer_id;
  const leadId = sp.lead_id;

  if (!customerId && !leadId) {
    // Sin propietario, redirigimos al listado con instrucciones.
    redirect("/pruebas-gratuitas?from=nueva-sin-owner" as never);
  }

  let ownerKind: "customer" | "lead" = customerId ? "customer" : "lead";
  let ownerName = "";
  const ownerId = (customerId ?? leadId)!;

  if (customerId) {
    try {
      const c = await getCustomer(customerId);
      ownerName = customerName(c as never);
    } catch {
      notFound();
    }
  } else if (leadId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = (await createClient()) as any;
    const { data: lead } = await sb
      .from("leads")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name")
      .eq("id", leadId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!lead) notFound();
    ownerKind = "lead";
    ownerName = customerName(lead as never);
  }

  const session = await requireSession();
  // El comercial no asigna instalador: lo hace quien agenda (admin o
  // director técnico) desde la ficha de la prueba.
  const puedeAgendar = puedeAgendarPrueba(session);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const [products, addresses, installers, config, marcadosRes] = await Promise.all([
    listProducts({ active_only: true }).catch(() => []),
    listAddresses(
      ownerKind === "customer" ? { customer_id: ownerId } : { lead_id: ownerId },
    ).catch(() => []),
    puedeAgendar ? listInstallers().catch(() => []) : Promise.resolve([]),
    getFreeTrialsConfigParaAlta().catch(() => ({
      duration_days: DEFAULT_FREE_TRIAL_DURATION_DAYS,
      conditions_text: "",
      default_renting_quote_months: 48,
    })),
    // Productos marcados «Disponible en prueba gratuita» en su ficha.
    admin
      .from("products")
      .select("id")
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .contains("roles", [ROL_PRUEBA_GRATUITA]),
  ]);

  const marcados = new Set(
    ((marcadosRes.data ?? []) as Array<{ id: string }>).map((r) => r.id),
  );
  const { productos: productosPrueba, hayMarcados } = productosParaPrueba(
    products,
    marcados,
  );
  const productOptions = productosPrueba.map((p) => ({ id: p.id, name: p.name }));
  const addressOptions = addresses.map((a) => ({
    id: a.id,
    label:
      [
        a.label,
        a.street_type ?? "",
        a.street ?? "",
        a.street_number ?? "",
        a.city ? `· ${a.city}` : "",
      ]
        .filter(Boolean)
        .join(" ")
        .trim() || "Dirección",
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <FreeTrialCreateForm
        ownerKind={ownerKind}
        ownerId={ownerId}
        ownerName={ownerName}
        defaultDurationDays={config.duration_days}
        defaultConditionsText={config.conditions_text}
        products={productOptions}
        addresses={addressOptions}
        installers={installers}
        puedeAsignarInstalador={puedeAgendar}
        productosSinMarcar={!hayMarcados}
      />
    </div>
  );
}
