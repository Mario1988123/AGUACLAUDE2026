import Link from "next/link";
import { FileSignature } from "lucide-react";
import { Badge } from "@/shared/ui/badge";

interface Row {
  id: string;
  reference_code: string | null;
  status: string;
  plan_type: string;
  total_cash_cents: number | null;
  monthly_cents: number | null;
  signed_at: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  pending_signature: "Pdte. firma",
  signed: "Firmado",
  active: "Activo",
  cancelled: "Cancelado",
  ended: "Finalizado",
};
const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  draft: "secondary",
  pending_signature: "warning",
  signed: "default",
  active: "success",
  cancelled: "destructive",
  ended: "outline",
};
const PLAN_LABEL: Record<string, string> = {
  cash: "Contado",
  renting: "Renting",
  rental: "Alquiler",
};

function fmtEur(c: number | null) {
  if (c == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(c / 100);
}

export function CustomerContractsCard({ contracts }: { contracts: Row[] }) {
  if (contracts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin contratos. Aceptar una propuesta crea el contrato automáticamente.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {contracts.map((c) => (
        <li
          key={c.id}
          className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FileSignature className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <Link
              href={`/contratos/${c.id}` as never}
              className="text-sm font-semibold hover:underline"
            >
              {c.reference_code ?? `#${c.id.slice(0, 8)}`}
            </Link>
            <div className="text-xs text-muted-foreground">
              {PLAN_LABEL[c.plan_type] ?? c.plan_type} · {fmtEur(c.total_cash_cents)}
              {c.monthly_cents ? ` · ${fmtEur(c.monthly_cents)}/mes` : ""}
              {c.signed_at && ` · firmado ${new Date(c.signed_at).toLocaleDateString("es-ES")}`}
            </div>
          </div>
          <Badge variant={STATUS_VARIANT[c.status] ?? "default"}>
            {STATUS_LABEL[c.status] ?? c.status}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
