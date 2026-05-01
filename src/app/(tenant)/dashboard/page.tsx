import { requireSession } from "@/shared/lib/auth/session";

export default async function DashboardPage() {
  const session = await requireSession();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Bienvenido, {session.full_name ?? session.email}
        </p>
      </div>
      <div className="rounded-lg border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          Los KPIs y comparativas se implementarán en la última capa, una vez todos los módulos
          estén operativos.
        </p>
      </div>
    </div>
  );
}
