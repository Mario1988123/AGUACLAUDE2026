import { redirect } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";
import { assertModuleActive } from "@/shared/lib/auth/module-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { BackButton } from "@/shared/components/back-button";
import { AlertTriangle, Scale } from "lucide-react";

export const dynamic = "force-dynamic";

interface LegalRight {
  kind: string;
  label: string;
  amount: string;
  base: string;
  base_year: number;
  notes?: string;
  changed_recently?: boolean;
}

/**
 * Tabla de referencia con los permisos legales españoles, días/semanas
 * y base legal. Cuando haya una reforma, hay que actualizar:
 *   1. Este array con la nueva cifra.
 *   2. DEFAULT_BUDGETS_2026 en absence-labels.ts.
 *   3. Bumpear LAST_REVIEWED_AT para resetear la alerta de revisión.
 */
const LAST_REVIEWED_AT = "2026-01-15";
const REVIEW_INTERVAL_MONTHS = 12;

const LEGAL_RIGHTS: LegalRight[] = [
  {
    kind: "vacation",
    label: "Vacaciones",
    amount: "30 días naturales (≈22 laborables)",
    base: "Estatuto de los Trabajadores Art. 38",
    base_year: 1995,
    notes:
      "Mínimo legal. El convenio colectivo puede mejorar pero no empeorar. Algunos convenios usan horas anuales.",
  },
  {
    kind: "maternity",
    label: "Maternidad",
    amount: "16 semanas",
    base: "RD-ley 6/2019 (Art. 48.4 ET)",
    base_year: 2019,
    notes:
      "6 semanas obligatorias e ininterrumpidas tras el parto. 10 semanas restantes flexibles hasta los 12 meses del menor.",
  },
  {
    kind: "paternity",
    label: "Paternidad",
    amount: "16 semanas",
    base: "RD-ley 6/2019 (equiparado a maternidad)",
    base_year: 2019,
    notes:
      "Igualdad de duración con maternidad. Mismas 6 semanas obligatorias post-parto + 10 flexibles.",
  },
  {
    kind: "parental_paid_8y",
    label: "Parental retribuido (hasta 8 años)",
    amount: "2 semanas",
    base: "RD-ley 7/2024 (transposición Directiva UE 2019/1158)",
    base_year: 2024,
    changed_recently: true,
    notes:
      "Novedad 2026: 2 de las 8 semanas de permiso parental pasan a ser retribuidas. Pueden disfrutarse hasta que el menor cumpla 8 años.",
  },
  {
    kind: "parental_unpaid_8y",
    label: "Parental no retribuido (hasta 8 años)",
    amount: "6 semanas",
    base: "RD-ley 7/2024 (transposición Directiva UE 2019/1158)",
    base_year: 2024,
    changed_recently: true,
    notes:
      "Las 6 semanas restantes del permiso parental, que siguen sin remuneración. Hasta los 8 años del menor.",
  },
  {
    kind: "lactation",
    label: "Lactancia",
    amount: "1 hora/día hasta 9 meses",
    base: "ET Art. 37.4",
    base_year: 1995,
    notes:
      "Reducción de jornada de 1 hora diaria (o 30 min al inicio y 30 min al final) hasta que el menor cumpla 9 meses. Acumulable en jornadas completas según convenio.",
  },
  {
    kind: "marriage",
    label: "Permiso matrimonio / pareja de hecho",
    amount: "15 días naturales",
    base: "ET Art. 37.3 a)",
    base_year: 1995,
    notes:
      "Equiparados matrimonio y pareja de hecho registrada (RD-ley 5/2023).",
  },
  {
    kind: "bereavement",
    label: "Fallecimiento / accidente grave familiar 2º grado",
    amount: "5 días laborables",
    base: "RD-ley 5/2023 (ET Art. 37.3 b)",
    base_year: 2023,
    notes:
      "Hasta 2º grado de consanguinidad o afinidad. Antes eran 2-4 días según parentesco.",
  },
  {
    kind: "mudanza",
    label: "Mudanza domicilio habitual",
    amount: "1 día",
    base: "ET Art. 37.3 c)",
    base_year: 1995,
  },
  {
    kind: "civic_duty",
    label: "Cumplimiento deber inexcusable",
    amount: "El tiempo necesario",
    base: "ET Art. 37.3 d)",
    base_year: 1995,
    notes:
      "Votar, citación judicial, deberes públicos. No tiene tope predefinido en días.",
  },
  {
    kind: "sick",
    label: "Incapacidad temporal (baja médica)",
    amount: "Sin tope anual",
    base: "LGSS + ET Art. 45",
    base_year: 1994,
    notes:
      "Días 1-3 sin retribución (salvo convenio). Días 4-15 al 60% (a cargo empresa). Días 16-20 al 60% (Seg Soc). Día 21+ al 75%. Hasta 365 días + posible prórroga 180.",
  },
];

const RECENT_REFORMS = [
  {
    year: 2024,
    title: "RD-ley 7/2024 — Permiso parental retribuido",
    summary:
      "Transposición de la Directiva UE 2019/1158. 2 de las 8 semanas de permiso parental pasan a ser retribuidas. Disfrutables hasta los 8 años del menor.",
  },
  {
    year: 2023,
    title: "RD-ley 5/2023 — Conciliación familiar",
    summary:
      "Permiso por fallecimiento de familiar 2º grado: 5 días laborables (antes 2-4 según parentesco). Equiparación matrimonio/pareja de hecho.",
  },
  {
    year: 2019,
    title: "RD-ley 6/2019 — Equiparación permisos parentales",
    summary:
      "Paternidad equiparada a maternidad en duración (16 semanas), eliminando la brecha histórica.",
  },
];

export default async function LeyesPage() {
  await assertModuleActive("time_tracking");
  const session = await requireSession();
  const isAdmin =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");
  if (!isAdmin) redirect("/fichajes" as never);

  const lastReviewed = new Date(LAST_REVIEWED_AT);
  const monthsSinceReview = Math.round(
    (Date.now() - lastReviewed.getTime()) / (30 * 86400000),
  );
  const overdue = monthsSinceReview > REVIEW_INTERVAL_MONTHS;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
            <Scale className="h-7 w-7" /> Marco legal de permisos
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Referencia de los días, semanas y horas que la ley española
            reconoce para cada permiso laboral. Última revisión:{" "}
            <strong>{lastReviewed.toLocaleDateString("es-ES")}</strong>.
          </p>
        </div>
        <BackButton href="/fichajes/admin" />
      </div>

      {overdue && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="flex items-start gap-3 pt-4">
            <AlertTriangle className="h-5 w-5 text-amber-700" />
            <div className="text-sm text-amber-900">
              <strong>Aviso de revisión legal</strong>
              <p className="mt-0.5">
                Hace {monthsSinceReview} meses que no se revisan estos valores.
                Comprueba en el BOE (www.boe.es) si hay un nuevo RD-ley o
                modificación del Estatuto de los Trabajadores que afecte a los
                permisos. Si actualizas, edita{" "}
                <code className="rounded bg-amber-100 px-1">
                  src/modules/time-tracking/absence-labels.ts
                </code>{" "}
                y la constante <code>LAST_REVIEWED_AT</code> en esta página.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Permisos y duraciones</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 text-left">Permiso</th>
                  <th className="py-2 text-left">Duración</th>
                  <th className="py-2 text-left">Base legal</th>
                  <th className="py-2 text-center">Año</th>
                </tr>
              </thead>
              <tbody>
                {LEGAL_RIGHTS.map((r) => (
                  <tr key={r.kind} className="border-b align-top last:border-0">
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{r.label}</span>
                        {r.changed_recently && (
                          <Badge variant="warning" className="text-[10px]">
                            Nuevo {r.base_year}
                          </Badge>
                        )}
                      </div>
                      {r.notes && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {r.notes}
                        </p>
                      )}
                    </td>
                    <td className="py-3 pr-3 font-mono text-sm tabular-nums">
                      {r.amount}
                    </td>
                    <td className="py-3 pr-3 text-xs">{r.base}</td>
                    <td className="py-3 text-center tabular-nums">{r.base_year}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reformas recientes</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {RECENT_REFORMS.map((r) => (
              <li key={r.year} className="rounded-xl border bg-card p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{r.year}</Badge>
                  <strong className="text-sm">{r.title}</strong>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{r.summary}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>¿Se puede automatizar la actualización?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <strong>Respuesta corta:</strong> no de forma 100% automática y fiable.
          </p>
          <p>
            El BOE publica las reformas pero NO ofrece una API JSON estructurada
            con &quot;permiso X cambia de N a M días&quot;. Se podría hacer un
            scraper de los textos legales, pero parsear lenguaje jurídico para
            extraer cifras y aplicarlas como cambio en un CRM es arriesgado:
            una mala interpretación afectaría cálculos de nómina.
          </p>
          <p>
            <strong>Lo que sí hacemos:</strong>
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              Aviso anual en esta página: si pasan {REVIEW_INTERVAL_MONTHS} meses
              desde la última revisión, sale el banner ámbar de arriba.
            </li>
            <li>
              Los valores legales están centralizados en
              <code className="ml-1 rounded bg-muted px-1">absence-labels.ts</code>
              {" "}— una sola edición y todo el módulo se ajusta.
            </li>
            <li>
              Cuando salga una reforma, basta cambiar el valor + bumpar
              {" "}<code>LAST_REVIEWED_AT</code>{" "}
              y la app se auto-actualiza para todas las empresas.
            </li>
            <li>
              Para empresas con presupuesto distinto (convenio que mejora),
              el admin puede sobreescribir per-empleado desde
              {" "}<code>user_leave_budgets</code>.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
