import { notFound } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";
import { listSuperadminAudit } from "@/modules/superadmin/audit-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { BackButton } from "@/shared/components/back-button";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  "company.created": "Empresa creada",
  "company.updated": "Empresa actualizada",
  "company.suspended": "Empresa suspendida",
  "company.deleted": "Empresa eliminada",
  "module.toggled": "Módulo activado/desactivado",
  "user.impersonated": "Suplantación de usuario",
  "catalog.updated": "Catálogo global modificado",
  "billing.adjusted": "Ajuste de facturación",
};

export default async function SuperadminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; company_id?: string; days?: string }>;
}) {
  const session = await requireSession();
  if (!session.is_superadmin) notFound();

  const sp = await searchParams;
  const days = sp.days ? Number(sp.days) : 30;
  const rows = await listSuperadminAudit({
    action: sp.action || undefined,
    company_id: sp.company_id || undefined,
    days,
  }).catch(() => []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Audit log superadmin
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Registro append-only de las acciones críticas realizadas por
            superadmins. Visibilidad legal y compliance.
          </p>
        </div>
        <BackButton href="/superadmin" />
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Días</label>
          <select
            name="days"
            defaultValue={String(days)}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="7">7 días</option>
            <option value="30">30 días</option>
            <option value="90">90 días</option>
            <option value="365">1 año</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Acción</label>
          <select
            name="action"
            defaultValue={sp.action ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Todas</option>
            {Object.entries(ACTION_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Aplicar
        </button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Eventos ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              Sin acciones registradas en este periodo. El helper
              `logSuperadminAction` se invoca desde cada server action de
              superadmin para alimentar este log.
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="rounded-xl border bg-card p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {ACTION_LABEL[r.action] ?? r.action}
                      </Badge>
                      {r.affected_company_name && (
                        <Badge variant="secondary">
                          {r.affected_company_name}
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString("es-ES")}
                      {r.actor_name && ` · ${r.actor_name}`}
                    </span>
                  </div>
                  {Object.keys(r.payload).length > 0 && (
                    <pre className="mt-2 overflow-x-auto rounded bg-muted/50 p-2 text-[11px] font-mono">
                      {JSON.stringify(r.payload, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
