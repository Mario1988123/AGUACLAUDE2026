import Link from "next/link";

interface InstallationLite {
  id: string;
  reference_code: string | null;
  status: string;
  scheduled_at: string | null;
  installer_user_id: string | null;
  installer_name?: string | null;
  customer_name?: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-900 border-blue-300",
  in_progress: "bg-amber-100 text-amber-900 border-amber-300",
  paused: "bg-zinc-100 text-zinc-900 border-zinc-300",
  completed: "bg-emerald-100 text-emerald-900 border-emerald-300",
  cancelled: "bg-red-100 text-red-900 border-red-300",
  incident_pending: "bg-red-200 text-red-900 border-red-400",
};

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const DAY_NAMES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/**
 * Vista calendario mensual de instalaciones. Cada celda muestra hasta
 * 3 instalaciones del día con color por estado y enlace a su detalle.
 *
 * Decisión 2026-05-20: vista propia de /instalaciones — agenda muestra
 * todo (instalaciones + mantenimientos + tareas), esta solo instalaciones.
 */
export function InstallationsCalendar({
  year,
  month, // 0-11
  installations,
}: {
  year: number;
  month: number;
  installations: InstallationLite[];
}) {
  // Agrupar por día (YYYY-MM-DD)
  const byDay = new Map<string, InstallationLite[]>();
  for (const i of installations) {
    if (!i.scheduled_at) continue;
    const d = new Date(i.scheduled_at);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const arr = byDay.get(key) ?? [];
    arr.push(i);
    byDay.set(key, arr);
  }

  // Construir grid: primera celda = lunes anterior al día 1 (o el 1 si cae en lunes)
  const firstDay = new Date(year, month, 1);
  // En JS: 0=domingo, 1=lunes. Queremos lunes como primer día.
  const offset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ date: Date | null; isCurrentMonth: boolean }> = [];
  for (let i = 0; i < offset; i++) {
    const d = new Date(year, month, -offset + i + 1);
    cells.push({ date: d, isCurrentMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ date: new Date(year, month, day), isCurrentMonth: true });
  }
  // Completar última semana
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1]!.date!;
    const next = new Date(last);
    next.setDate(next.getDate() + 1);
    cells.push({ date: next, isCurrentMonth: false });
  }

  // Nav prev/next
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;
  const today = new Date();
  const isCurrentMonth =
    today.getFullYear() === year && today.getMonth() === month;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/instalaciones?view=cal&y=${prevYear}&m=${prevMonth}` as never}
          className="inline-flex h-9 items-center rounded-xl border border-border bg-card px-3 text-sm hover:bg-muted"
        >
          ← {MONTH_NAMES[prevMonth]}
        </Link>
        <h2 className="text-xl font-extrabold capitalize">
          {MONTH_NAMES[month]} {year}
        </h2>
        <Link
          href={`/instalaciones?view=cal&y=${nextYear}&m=${nextMonth}` as never}
          className="inline-flex h-9 items-center rounded-xl border border-border bg-card px-3 text-sm hover:bg-muted"
        >
          {MONTH_NAMES[nextMonth]} →
        </Link>
      </div>
      <div className="grid grid-cols-7 gap-1 rounded-xl border bg-card p-2">
        {DAY_NAMES.map((d) => (
          <div
            key={d}
            className="px-2 py-1 text-center text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
          >
            {d}
          </div>
        ))}
        {cells.map((c, idx) => {
          if (!c.date) return <div key={idx} />;
          const key = `${c.date.getFullYear()}-${String(c.date.getMonth() + 1).padStart(2, "0")}-${String(c.date.getDate()).padStart(2, "0")}`;
          const items = byDay.get(key) ?? [];
          const isToday =
            isCurrentMonth && c.date.getDate() === today.getDate();
          return (
            <div
              key={idx}
              className={`min-h-[88px] rounded-lg border p-1.5 ${
                c.isCurrentMonth ? "bg-background" : "bg-muted/30 opacity-60"
              } ${isToday ? "border-primary border-2" : "border-border"}`}
            >
              <div
                className={`text-xs font-bold ${isToday ? "text-primary" : "text-muted-foreground"}`}
              >
                {c.date.getDate()}
              </div>
              <div className="mt-1 space-y-0.5">
                {items.slice(0, 3).map((it) => (
                  <Link
                    key={it.id}
                    href={`/instalaciones/${it.id}` as never}
                    className={`block truncate rounded border px-1 py-0.5 text-[10px] font-semibold hover:opacity-80 ${
                      STATUS_COLOR[it.status] ?? "bg-card text-foreground"
                    }`}
                    title={`${it.customer_name ?? "Cliente"} · ${it.reference_code ?? ""}`}
                  >
                    {new Date(it.scheduled_at!).toLocaleTimeString("es-ES", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    {it.customer_name ?? it.reference_code ?? "—"}
                  </Link>
                ))}
                {items.length > 3 && (
                  <div className="text-[10px] text-muted-foreground">
                    +{items.length - 3} más
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
