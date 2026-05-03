import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { getFiscalSettings } from "@/modules/config/fiscal/actions";
import { NewInvoiceForm } from "@/modules/invoices/new-invoice-form";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/facturas" as never);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: customers } = await admin
    .from("customers")
    .select("id, party_kind, legal_name, trade_name, first_name, last_name")
    .eq("company_id", session.company_id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(500);
  type C = {
    id: string;
    party_kind: "individual" | "company";
    legal_name: string | null;
    trade_name: string | null;
    first_name: string | null;
    last_name: string | null;
  };
  const opts = ((customers ?? []) as C[]).map((c) => ({
    id: c.id,
    name:
      c.party_kind === "company"
        ? c.trade_name || c.legal_name || "Cliente"
        : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Cliente",
  }));
  const fiscal = await getFiscalSettings();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Nueva factura</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Crea una factura manual con líneas libres. IVA por defecto {fiscal.invoice_default_iva}%.
        </p>
      </div>
      <NewInvoiceForm customers={opts} defaultIva={fiscal.invoice_default_iva} />
    </div>
  );
}
