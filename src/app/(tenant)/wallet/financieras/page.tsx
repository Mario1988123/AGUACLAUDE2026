import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { listFinancierPaymentsPending } from "@/modules/wallet/financier-payments-actions";
import { FinancierPaymentsPanel } from "@/modules/wallet/financier-payments-panel";
import { BackButton } from "@/shared/components/back-button";

export const dynamic = "force-dynamic";

export default async function WalletFinancierasPage() {
  const session = await requireSession();
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("commercial_director") &&
    !session.roles.includes("technical_director")
  ) {
    redirect("/dashboard" as never);
  }
  const items = await listFinancierPaymentsPending().catch(() => []);
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pagos de financieras</h1>
          <p className="text-sm text-muted-foreground">
            Contratos renting / financiación firmados pendientes de cobrar a
            la financiera. Cada financiera tarda lo suyo, no hay plazo fijo —
            confirma aquí el ingreso cuando llegue.
          </p>
        </div>
        <BackButton href="/wallet" />
      </div>
      <FinancierPaymentsPanel initial={items} />
    </div>
  );
}
