import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { StatusPill } from "@/shared/components/status-pill";
import { estadoEmpresa, esEmpresaProtegida } from "@/shared/lib/empresas/estado";
import { AccionesRapidasEmpresa } from "./ciclo-vida-ui";

/** Tarjeta de la lista de empresas (móvil y tableta). */
export function TarjetaEmpresa({
  empresa: c,
  usuarios,
  clientes,
  contratos,
}: {
  empresa: { id: string; name: string; slug: string; status: string; max_users: number };
  usuarios: number;
  clientes: number;
  contratos: number;
}) {
  const e = estadoEmpresa(c.status);
  return (
    <li className="overflow-hidden rounded-2xl border bg-card">
      <Link href={`/superadmin/empresas/${c.id}` as never} className="block p-4 active:bg-muted/40">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-semibold">
              <span className="truncate">{c.name}</span>
              {esEmpresaProtegida(c.id) ? (
                <ShieldCheck className="h-4 w-4 shrink-0 text-success" aria-label="Protegida" />
              ) : null}
            </p>
            <p className="truncate text-xs text-muted-foreground">{c.slug}</p>
          </div>
          <StatusPill label={e.label} tone={e.tono} className="shrink-0" />
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Usuarios</dt>
            <dd className="tabular-nums">
              {usuarios}
              <span className="text-xs text-muted-foreground"> / {c.max_users}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Clientes</dt>
            <dd className="tabular-nums">{clientes}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Contratos</dt>
            <dd className="tabular-nums">{contratos}</dd>
          </div>
        </dl>
      </Link>
      <div className="flex gap-2 border-t p-2">
        <AccionesRapidasEmpresa companyId={c.id} nombre={c.name} status={c.status} />
        <Button asChild variant="ghost" className="h-11 flex-1">
          <Link href={`/superadmin/empresas/${c.id}` as never}>Editar</Link>
        </Button>
      </div>
    </li>
  );
}
