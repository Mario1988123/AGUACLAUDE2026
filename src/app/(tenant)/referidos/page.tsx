import Link from "next/link";
import { requireSession } from "@/shared/lib/auth/session";
import { assertModuleActive, requireModuleAccess } from "@/shared/lib/auth/module-guard";
import { listReferrals } from "@/modules/referrals/actions";
import { ReferralForm } from "@/modules/referrals/referral-form";
import { STATUS_LABEL, STATUS_VARIANT } from "@/modules/leads/schemas";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { UsersRound, Phone } from "lucide-react";

export const dynamic = "force-dynamic";

const SALES_ROLES = [
  "company_admin",
  "technical_director",
  "commercial_director",
  "telemarketing_director",
  "sales_rep",
];

export default async function ReferidosPage() {
  await assertModuleActive("referrals");
  const session = await requireSession();
  requireModuleAccess(session, SALES_ROLES);

  const groups = await listReferrals();
  const total = groups.reduce((n, g) => n + g.count, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Referidos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Amigos recomendados por tus clientes. Cada uno entra como lead nuevo
            listo para contactar y vender.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nuevo referido</CardTitle>
        </CardHeader>
        <CardContent>
          <ReferralForm />
        </CardContent>
      </Card>

      <div className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
        {total} referido{total === 1 ? "" : "s"} · {groups.length} cliente
        {groups.length === 1 ? "" : "s"} recomendador{groups.length === 1 ? "" : "es"}
      </div>

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Aún no hay referidos. Pulsa «Añadir referido» y registra el amigo que
          te ha pasado un cliente.
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.customer_id}>
              <CardHeader className="flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">
                  <Link
                    href={`/clientes/${g.customer_id}` as never}
                    className="hover:underline"
                  >
                    {g.customer_name}
                  </Link>
                </CardTitle>
                <Badge variant="secondary">
                  <UsersRound className="mr-1 h-3.5 w-3.5" />
                  {g.count}
                </Badge>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-border">
                  {g.referrals.map((r) => (
                    <li key={r.lead_id} className="flex items-center justify-between gap-3 py-2">
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
