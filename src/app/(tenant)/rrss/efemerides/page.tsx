import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { BackButton } from "@/shared/components/back-button";
import { requireSession } from "@/shared/lib/auth/session";
import { listEphemerides } from "@/modules/social/actions";

export const dynamic = "force-dynamic";

const MONTHS = [
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

const CATEGORY_LABEL: Record<string, string> = {
  agua: "Agua",
  medio_ambiente: "Medio ambiente",
  sequia: "Sequía",
  oceanos: "Océanos",
  plastico: "Plástico",
  salud: "Salud",
  sostenibilidad: "Sostenibilidad",
  social: "Social",
};

const CATEGORY_TONE: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  agua: "default",
  medio_ambiente: "success",
  sequia: "warning",
  oceanos: "default",
  plastico: "destructive",
  salud: "secondary",
  sostenibilidad: "success",
  social: "outline",
};

export default async function EphemeridesPage() {
  const session = await requireSession();
  const allowed =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");
  if (!allowed) redirect("/dashboard");

  const all = await listEphemerides();
  const byMonth = new Map<number, typeof all>();
  for (const e of all) {
    if (!byMonth.has(e.month_of_year)) byMonth.set(e.month_of_year, []);
    byMonth.get(e.month_of_year)!.push(e);
  }

  const currentMonth = new Date().getMonth() + 1;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Calendario de efemérides
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Catálogo anual con efemérides relacionadas con agua, sequía,
            océanos, medio ambiente, plásticos y saneamiento. Las marcadas
            como <strong>oficiales</strong> están reconocidas por ONU,
            UNESCO, OMS, FAO, PNUMA u organismos similares.
          </p>
        </div>
        <BackButton href="/rrss" />
      </div>

      <div className="rounded-2xl border-2 border-blue-200 bg-blue-50/40 p-4 text-sm text-blue-900">
        <strong>{all.length}</strong> efemérides registradas ·{" "}
        <strong>{all.filter((e) => e.is_official).length}</strong> oficiales
        · {all.filter((e) => e.importance === "high").length} de alta
        importancia para el sector.
      </div>

      {Array.from({ length: 12 }).map((_, idx) => {
        const monthNum = idx + 1;
        const items = byMonth.get(monthNum) ?? [];
        if (items.length === 0) return null;
        const isCurrent = monthNum === currentMonth;
        return (
          <Card key={monthNum} className={isCurrent ? "border-primary/50" : ""}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>
                  {MONTHS[idx]}{" "}
                  {isCurrent && (
                    <Badge variant="default" className="ml-2">
                      mes actual
                    </Badge>
                  )}
                </span>
                <span className="text-xs text-muted-foreground font-normal">
                  {items.length} efeméride{items.length === 1 ? "" : "s"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {items.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-start gap-3 rounded-xl border bg-card p-3"
                  >
                    <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <span className="text-lg font-extrabold leading-none">
                        {e.day_of_month}
                      </span>
                      <span className="text-[9px] uppercase tracking-wider">
                        {MONTHS[e.month_of_year - 1]?.slice(0, 3)}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold">{e.name}</span>
                        <Badge variant={CATEGORY_TONE[e.category] ?? "outline"}>
                          {CATEGORY_LABEL[e.category] ?? e.category}
                        </Badge>
                        {e.importance === "high" && (
                          <Badge variant="default">Importancia alta</Badge>
                        )}
                        {e.is_official ? (
                          <Badge variant="success" className="text-[10px]">
                            ✓ Oficial · {e.official_org}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            Concienciación no oficial
                          </Badge>
                        )}
                      </div>
                      {e.description && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {e.description}
                        </p>
                      )}
                      {e.hashtags && e.hashtags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {e.hashtags.map((h) => (
                            <span
                              key={h}
                              className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
                            >
                              {h}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}

      <p className="text-xs text-muted-foreground">
        Las fechas pueden variar anualmente (algunas se celebran el primer
        lunes de mes, último domingo, etc.). En esos casos se muestra una
        fecha aproximada — verifica el día concreto para el año actual.
      </p>
      <p className="text-xs text-muted-foreground">
        ¿Falta una efeméride relevante? El catálogo lo gestiona superadmin
        en la tabla <code className="font-mono">social_ephemerides</code>.
      </p>
    </div>
  );
}
