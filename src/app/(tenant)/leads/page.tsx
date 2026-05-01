import Link from "next/link";
import { listLeads } from "@/modules/leads/actions";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import {
  STATUS_LABEL,
  STATUS_VARIANT,
  ORIGIN_LABEL,
  LEAD_STATUS,
} from "@/modules/leads/schemas";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const status = LEAD_STATUS.includes(sp.status as never) ? (sp.status as never) : undefined;
  const leads = await listLeads({ status, q: sp.q });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="text-sm text-muted-foreground">{leads.length} resultados</p>
        </div>
        <Button asChild>
          <Link href={"/leads/nuevo" as never}>+ Nuevo lead</Link>
        </Button>
      </div>

      <form className="flex flex-wrap gap-2 rounded-lg border bg-card p-4">
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Buscar por nombre, email, teléfono..."
          className="flex h-11 flex-1 min-w-60 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          className="flex h-11 rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">Todos los estados</option>
          {LEAD_STATUS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
      </form>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Nombre</th>
              <th className="px-4 py-3 text-left">Contacto</th>
              <th className="px-4 py-3 text-left">Origen</th>
              <th className="px-4 py-3 text-left">Estado</th>
              <th className="px-4 py-3 text-left">Pot.</th>
              <th className="px-4 py-3 text-right">Días</th>
              <th className="px-4 py-3 text-right">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {leads.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  No hay leads que coincidan con los filtros.
                </td>
              </tr>
            ) : (
              leads.map((l) => (
                <tr key={l.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link
                      href={`/leads/${l.id}` as never}
                      className="font-medium text-primary hover:underline"
                    >
                      {l.display_name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {l.party_kind === "company" ? "Empresa" : "Particular"}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {l.phone_primary && (
                      <a href={`tel:${l.phone_primary}`} className="block text-xs hover:underline">
                        {l.phone_primary}
                      </a>
                    )}
                    {l.email && (
                      <a
                        href={`mailto:${l.email}`}
                        className="block text-xs text-muted-foreground hover:underline"
                      >
                        {l.email}
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">{ORIGIN_LABEL[l.origin]}</td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[l.status]}>{STATUS_LABEL[l.status]}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                        l.potential === "A"
                          ? "bg-success/20 text-success"
                          : l.potential === "B"
                            ? "bg-warning/20 text-warning"
                            : l.potential === "C"
                              ? "bg-muted text-muted-foreground"
                              : "bg-secondary text-secondary-foreground"
                      }`}
                    >
                      {l.potential === "unknown" ? "?" : l.potential}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {l.days_since_created}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/leads/${l.id}` as never}
                      className="text-sm text-primary hover:underline"
                    >
                      Ver
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
