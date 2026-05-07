import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";

export const dynamic = "force-dynamic";

const METHODS = [
  { key: "cash", label: "Efectivo", desc: "Cobro en mano. Genera pendiente de liquidación." },
  { key: "card", label: "Tarjeta (TPV)", desc: "Pasarela TPV o datafono físico." },
  { key: "bizum", label: "Bizum", desc: "Cobro instantáneo móvil." },
  { key: "transfer", label: "Transferencia", desc: "Pago a cuenta IBAN de la empresa." },
];

export default async function ConfigWalletPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/dashboard");
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Wallet (cobros)</h1>
        <p className="text-sm text-muted-foreground">
          Métodos de cobro habilitados y reglas de validación.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Métodos habilitados</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {METHODS.map((m) => (
            <div
              key={m.key}
              className="flex items-center justify-between rounded-lg border bg-card p-3"
            >
              <div>
                <div className="font-bold">{m.label}</div>
                <div className="text-xs text-muted-foreground">{m.desc}</div>
              </div>
              <Badge variant="success">Activo</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Validación de cobros</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Los cobros del comercial entran en estado{" "}
            <strong>collected_pending_validation</strong>. El admin (o director
            comercial) los <strong>valida</strong> al ver el ingreso real en
            banco/caja. Una vez validados pasan a <strong>collected</strong>.
          </p>
          <p>
            <strong>Efectivo</strong> queda en <strong>pending_settlement</strong>{" "}
            hasta que el comercial liquide en oficina.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
