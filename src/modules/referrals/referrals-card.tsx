import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { UsersRound, Phone } from "lucide-react";
import { STATUS_LABEL, STATUS_VARIANT } from "@/modules/leads/schemas";
import { listReferralsByCustomer } from "./actions";
import { ReferralForm } from "./referral-form";

/**
 * Tarjeta de la ficha de cliente: amigos que este cliente ha recomendado
 * (leads con referred_by_customer_id = este cliente) + botón para añadir uno
 * con el cliente ya fijado. Render condicionado a módulo activo desde la página.
 */
export async function CustomerReferralsCard({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const referrals = await listReferralsByCustomer(customerId);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <UsersRound className="h-4 w-4" /> Referidos de este cliente
          {referrals.length > 0 && (
            <Badge variant="secondary">{referrals.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Amigos que este cliente nos ha recomendado. Cada uno entra como lead
          nuevo listo para contactar.
        </p>
        <ReferralForm presetCustomer={{ id: customerId, name: customerName }} />
        {referrals.length > 0 && (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {referrals.map((r) => (
              <li key={r.lead_id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <Link
                    href={`/leads/${r.lead_id}` as never}
                    className="truncate text-sm font-semibold hover:underline"
                  >
                    {r.name}
                  </Link>
                  {r.phone && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" /> {r.phone}
                    </div>
                  )}
                </div>
                <Badge variant={STATUS_VARIANT[r.status as never] ?? "default"}>
                  {STATUS_LABEL[r.status as never] ?? r.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
