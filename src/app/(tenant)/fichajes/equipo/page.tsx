import { assertModuleActive } from "@/shared/lib/auth/module-guard";
import { getWhosInSnapshot, type WhosInPerson } from "@/modules/time-tracking/whos-in-actions";
import { BackButton } from "@/shared/components/back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Clock, Coffee, User, Ghost } from "lucide-react";

export const dynamic = "force-dynamic";

function fmtHHMM(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Madrid",
    });
  } catch {
    return null;
  }
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function PersonRow({
  p,
  hint,
}: {
  p: WhosInPerson;
  hint?: string | null;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-bold">
        {initials(p.full_name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{p.full_name}</div>
        {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

export default async function WhosInPage() {
  await assertModuleActive("time_tracking");
  const snap = await getWhosInSnapshot();

  const sections = [
    {
      key: "working",
      label: "Trabajando",
      icon: Clock,
      iconBg: "bg-emerald-100 text-emerald-700",
      people: snap.working,
      hintFor: (p: WhosInPerson) =>
        p.since ? `Entrada ${fmtHHMM(p.since)}` : null,
    },
    {
      key: "on_break",
      label: "Descansos",
      icon: Coffee,
      iconBg: "bg-amber-100 text-amber-700",
      people: snap.on_break,
      hintFor: (p: WhosInPerson) =>
        p.since ? `Desde ${fmtHHMM(p.since)}` : null,
    },
    {
      key: "absences",
      label: "Ausencias",
      icon: Ghost,
      iconBg: "bg-orange-100 text-orange-700",
      people: snap.absences,
      hintFor: (p: WhosInPerson) => p.absence_label,
    },
    {
      key: "out",
      label: "Fuera",
      icon: User,
      iconBg: "bg-slate-100 text-slate-600",
      people: snap.out,
      hintFor: (p: WhosInPerson) =>
        p.since ? `Última: ${fmtHHMM(p.since)}` : "Sin fichar hoy",
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Quién está</h1>
        <BackButton href="/fichajes" />
      </div>
      <p className="text-sm text-muted-foreground">
        Estado del equipo en este momento. Se actualiza con cada fichaje.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.key}>
              <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${s.iconBg}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-base">{s.label}</CardTitle>
                </div>
                <div className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold tabular-nums">
                  {s.people.length}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {s.people.length === 0 ? (
                  <p className="text-xs text-muted-foreground">— Nadie</p>
                ) : (
                  <div className="divide-y">
                    {s.people.map((p) => (
                      <PersonRow key={p.user_id} p={p} hint={s.hintFor(p)} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
